"""Tests for funding detection, the 10% no-churn rule and the review queue."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.funding import (
    CHURN_THRESHOLD,
    FundingSignal,
    apply_signal,
    decide,
    find_signals,
    is_speculative,
    normalize_round,
    parse_amounts,
    parse_raise_amount,
    parse_round,
    parse_valuation,
    write_queue,
)


class ParseAmountsTests(unittest.TestCase):
    def test_common_shapes(self):
        cases = {
            "$65B": 65_000_000_000,
            "$2.5 billion": 2_500_000_000,
            "US$150M": 150_000_000,
            "£300M": 300_000_000,
            "$1.2 trillion": 1_200_000_000_000,
            "$71M": 71_000_000,
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertIn(expected, parse_amounts(text))

    def test_model_sizes_are_not_money(self):
        # No currency symbol and no funding context: "600B MoE", "1M context".
        self.assertEqual(parse_amounts("Step 5 Preview: 600B MoE, 27B active, 1M context"), [])

    def test_bare_words_need_funding_context(self):
        self.assertEqual(parse_amounts("The model has 1.5 billion parameters"), [])
        self.assertIn(1_500_000_000, parse_amounts("The startup raised 1.5 billion in funding"))

    def test_multiple_amounts(self):
        found = parse_amounts("Raises $500M at a $4B valuation")
        self.assertIn(500_000_000, found)
        self.assertIn(4_000_000_000, found)

    def test_no_amount(self):
        self.assertEqual(parse_amounts("Company launches a new product"), [])


class SpeculationTests(unittest.TestCase):
    """A hedged headline must never move curated numbers (real live case)."""

    IPO_HEADLINES = [
        "Anthropic's Dario Amodei is steering a possible $2 trillion IPO",
        "Investors temper Anthropic IPO valuation expectations, sources say",
        "Anthropic could raise $5B in an IPO next year",
        "Reportedly, Anthropic targets a $350B valuation",
        "Startup in talks to raise $200M Series C",
    ]

    def test_hedged_language_is_detected(self):
        for text in self.IPO_HEADLINES:
            with self.subTest(text=text):
                self.assertTrue(is_speculative(text))

    def test_no_raise_amount_from_speculation(self):
        for text in self.IPO_HEADLINES:
            with self.subTest(text=text):
                self.assertIsNone(parse_raise_amount(text))

    def test_confident_raise_still_parses(self):
        self.assertEqual(parse_raise_amount("Anthropic raises $500M Series B"), 500_000_000)

    def test_valuation_is_not_a_raise_amount(self):
        # "(at a) $965B post-money" is a valuation, not money raised.
        self.assertIsNone(parse_raise_amount("Anthropic closes round at a $965B valuation"))

    def test_ipo_round_is_never_auto_applied(self):
        sig = signal(round_label="IPO", amount_usd=2_000_000_000_000)
        should, reason = decide(sig, funding())
        self.assertFalse(should, "an IPO headline must not overwrite the last priced round")
        self.assertIn("always reviewed", reason)


class ParseRoundTests(unittest.TestCase):
    def test_series_letters(self):
        self.assertEqual(parse_round("closes Series C round"), "Series C")
        self.assertEqual(parse_round("a series h at $965B"), "Series H")

    def test_named_rounds(self):
        self.assertEqual(parse_round("raises seed funding"), "Seed")
        self.assertEqual(parse_round("files for IPO"), "IPO")
        self.assertEqual(parse_round("pre-IPO round"), "Pre-IPO")
        self.assertEqual(parse_round("employee tender offer"), "Tender Offer")

    def test_no_round(self):
        self.assertIsNone(parse_round("announces new model"))


class ParseValuationTests(unittest.TestCase):
    def test_valued_at(self):
        self.assertEqual(parse_valuation("valued at $2.5B"), 2_500_000_000)

    def test_valuation_of(self):
        self.assertEqual(parse_valuation("a valuation of $965B post-money"), 965_000_000_000)

    def test_missing(self):
        self.assertIsNone(parse_valuation("raises $71M"))


def item(headline, summary="", date="2026-10-17", origin="Reuters", source="https://x/1", official=False):
    return {"headline": headline, "summary": summary, "date": date,
            "source": source, "source_name": origin, "feed": origin,
            "_type": "official" if official else "news"}


class FindSignalsTests(unittest.TestCase):
    def test_no_signal_without_funding_keywords(self):
        self.assertEqual(find_signals({"_id": "a", "name": "A"}, [item("Launches a new model")]), [])

    def test_high_confidence_with_round_amount_and_official_origin(self):
        signals = find_signals(
            {"_id": "elevenlabs", "name": "ElevenLabs"},
            [item("ElevenLabs raises $150M Series B", origin="ElevenLabs", official=True)],
        )
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0].confidence, "high")
        self.assertEqual(signals[0].amount_usd, 150_000_000)
        self.assertEqual(signals[0].round_label, "Series B")

    def test_corroboration_across_outlets_merges_to_one_signal(self):
        signals = find_signals(
            {"_id": "x", "name": "X"},
            [
                item("X raises $100M Series A", date="2026-10-10"),
                item("X closes $100M Series A round", date="2026-10-11"),
            ],
        )
        self.assertEqual(len(signals), 1)
        self.assertTrue(any("corroborating" in reason for reason in signals[0].reasons))

    def test_different_rounds_stay_separate(self):
        signals = find_signals(
            {"_id": "x", "name": "X"},
            [
                item("X raises $100M Series A", date="2026-10-10"),
                item("X raises $200M Series B", date="2026-11-10"),
            ],
        )
        self.assertEqual(len(signals), 2)

    def test_amount_only_is_low_confidence(self):
        signals = find_signals({"_id": "x", "name": "X"}, [item("X raises $100M")])
        self.assertEqual(signals[0].confidence, "low")


def funding(**overrides):
    base = {
        "latest_round": "Series A",
        "amount_usd": 100_000_000,
        "post_money_valuation_usd": 1_000_000_000,
        "total_raised_usd": 100_000_000,
        "date": "2026-01-01",
        "lead_investors": [],
        "source_note": "curated",
    }
    base.update(overrides)
    return base


def signal(**overrides):
    base = dict(
        company_id="x", company_name="X", kind="round", round_label="Series B",
        amount_usd=500_000_000, valuation_usd=None, date="2026-10-17",
        headline="h", source="s", origin="Reuters", official=False, confidence="high", reasons=[],
    )
    base.update(overrides)
    return FundingSignal(**base)


class DecideTests(unittest.TestCase):
    def test_new_round_applies(self):
        should, reason = decide(signal(round_label="Series B"), funding())
        self.assertTrue(should, reason)

    def test_low_confidence_never_applies(self):
        should, reason = decide(signal(confidence="low"), funding())
        self.assertFalse(should)
        self.assertIn("confidence=low", reason)

    def test_same_round_within_threshold_does_not_churn(self):
        should, reason = decide(signal(round_label="Series A", amount_usd=105_000_000), funding())
        self.assertFalse(should)
        self.assertIn("no churn", reason)

    def test_same_round_material_change_applies(self):
        should, reason = decide(signal(round_label="Series A", amount_usd=200_000_000), funding())
        self.assertTrue(should, reason)
        self.assertIn("amount", reason)

    def test_threshold_boundary(self):
        # Exactly at the threshold is "no churn"; just past it applies.
        at = int(100_000_000 * (1 + CHURN_THRESHOLD))
        self.assertFalse(decide(signal(round_label="Series A", amount_usd=at), funding())[0])
        self.assertTrue(decide(signal(round_label="Series A", amount_usd=at + 1), funding())[0])

    def test_signal_without_round_label_is_rejected(self):
        should, reason = decide(signal(round_label=None), funding())
        self.assertFalse(should)
        self.assertIn("no round label", reason)


class NormalizeRoundTests(unittest.TestCase):
    def test_noise_words_are_folded(self):
        self.assertEqual(normalize_round("Series B Funding"), normalize_round("Series B"))
        self.assertEqual(normalize_round("Series D"), normalize_round("series d"))

    def test_genuinely_different_rounds_stay_different(self):
        self.assertNotEqual(normalize_round("Series B"), normalize_round("Series C"))

    def test_public_issuer_label_is_folded(self):
        self.assertEqual(normalize_round("Public (NYSE: NOW)"), normalize_round("Public"))

    def test_empty(self):
        self.assertEqual(normalize_round(None), "")


class KnownRoundRecognitionTests(unittest.TestCase):
    """A round already recorded must not look like a brand-new one."""

    def test_series_b_funding_matches_series_b(self):
        stored = funding(latest_round="Series B Funding", amount_usd=12_000_000_000)
        sig = signal(round_label="Series B", amount_usd=12_000_000_000, date="2026-10-17")
        should, reason = decide(sig, stored)
        self.assertFalse(should, "a known round must not re-apply")
        self.assertIn("no churn", reason)


class GuardRailTests(unittest.TestCase):
    def test_signal_older_than_stored_is_rejected(self):
        stored = funding(latest_round="Series B", date="2026-10-17")
        sig = signal(round_label="Series C", date="2026-01-01")
        should, reason = decide(sig, stored)
        self.assertFalse(should)
        self.assertIn("not newer", reason)

    def test_missing_amount_is_rejected(self):
        should, reason = decide(signal(round_label="Series C", amount_usd=None), funding())
        self.assertFalse(should)
        self.assertIn("no raise amount", reason)


class ApplySignalTests(unittest.TestCase):
    def test_only_numeric_fields_change(self):
        updated = apply_signal(funding(), signal(round_label="Series B", amount_usd=500_000_000,
                                                 valuation_usd=9_000_000_000))
        self.assertEqual(updated["latest_round"], "Series B")
        self.assertEqual(updated["amount_usd"], 500_000_000)
        self.assertEqual(updated["post_money_valuation_usd"], 9_000_000_000)
        self.assertEqual(updated["source_note"], "curated", "prose is never auto-written")
        self.assertEqual(updated["total_raised_usd"], 100_000_000)

    def test_missing_values_leave_fields_alone(self):
        updated = apply_signal(funding(), signal(amount_usd=None, valuation_usd=None, round_label=None))
        self.assertEqual(updated, funding())

    def test_original_is_not_mutated(self):
        original = funding()
        apply_signal(original, signal())
        self.assertEqual(original["latest_round"], "Series A")


class WriteQueueTests(unittest.TestCase):
    def test_splits_applied_and_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "queue.json"
            applied = signal(round_label="Series B")
            applied.applied = True
            write_queue(path, [signal(round_label="Series C"), applied])
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["pending"]), 1)
            self.assertEqual(len(payload["applied"]), 1)
            self.assertIn("policy", payload)
            self.assertEqual(payload["pending"][0]["round_label"], "Series C")

    def test_creates_parent_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "deep" / "nested" / "queue.json"
            write_queue(path, [])
            self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
