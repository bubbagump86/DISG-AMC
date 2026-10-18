"""Tests for the aggregate rules that produce stats.json."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from pipeline.stats import as_number, build, compute, is_public, latest_news_date


def company(name, *, is_public=False, funding=None, arr=None, category="X", news=()):
    record = {
        "name": name,
        "category": category,
        "is_public": is_public,
        "arr_usd": arr,
        "funding": funding or {},
        "latest_news": list(news),
    }
    return record


class AsNumberTests(unittest.TestCase):
    def test_bool_is_not_a_number(self):
        # True is an int in Python; it must never be summed as a dollar amount.
        self.assertIsNone(as_number(True))
        self.assertIsNone(as_number(False))

    def test_none_and_strings(self):
        self.assertIsNone(as_number(None))
        self.assertIsNone(as_number("100"))
        self.assertEqual(as_number(0), 0)


class IsPublicTests(unittest.TestCase):
    def test_explicit_flag_wins(self):
        self.assertTrue(is_public({"name": "Anything", "is_public": True}))
        self.assertFalse(is_public({"name": "ServiceNow", "is_public": False}))

    def test_legacy_fallback_by_name(self):
        self.assertTrue(is_public({"name": "Snowflake"}))
        self.assertFalse(is_public({"name": "Anthropic"}))


class ComputeTests(unittest.TestCase):
    def test_capital_uses_lifetime_not_latest_round(self):
        companies = [
            company("A", funding={"total_raised_usd": 1_000, "amount_usd": 10}),
            company("B", funding={"total_raised_usd": 2_000, "amount_usd": 20}),
        ]
        stats = compute(companies)
        self.assertEqual(stats["capital_raised"]["total_usd"], 3_000)
        self.assertEqual(stats["capital_raised"]["latest_round_total_usd"], 30)

    def test_undisclosed_values_are_excluded_and_counted(self):
        companies = [
            company("A", funding={"total_raised_usd": 100}, arr=50),
            company("B", funding={"total_raised_usd": None}, arr=None),
        ]
        stats = compute(companies)
        self.assertEqual(stats["capital_raised"]["total_usd"], 100)
        self.assertEqual(stats["capital_raised"]["disclosed_count"], 1)
        self.assertEqual(stats["capital_raised"]["total_count"], 2)
        self.assertEqual(stats["combined_arr"]["disclosed_count"], 1)

    def test_public_uses_market_cap_private_uses_post_money(self):
        companies = [
            company("Private", funding={"post_money_valuation_usd": 5_000, "current_market_cap_usd": 999}),
            company("Public", is_public=True, funding={"current_market_cap_usd": 7_000}),
        ]
        stats = compute(companies)
        val = stats["combined_valuation"]
        self.assertEqual(val["private_post_money_usd"], 5_000, "private ignores any market cap")
        self.assertEqual(val["public_market_cap_usd"], 7_000)
        self.assertEqual(val["total_usd"], 12_000)
        self.assertEqual((val["private_count"], val["public_count"]), (1, 1))

    def test_public_company_without_market_cap_contributes_nothing(self):
        stats = compute([company("Public", is_public=True, funding={})])
        self.assertEqual(stats["combined_valuation"]["public_count"], 0)
        self.assertEqual(stats["combined_valuation"]["total_usd"], 0)

    def test_zero_does_not_count_as_disclosed(self):
        stats = compute([company("A", funding={"total_raised_usd": 0}, arr=0)])
        self.assertEqual(stats["capital_raised"]["disclosed_count"], 0)
        self.assertEqual(stats["combined_arr"]["disclosed_count"], 0)

    def test_categories_and_news_counts(self):
        companies = [
            company("A", category="One", news=[{"date": "2026-10-01"}]),
            company("B", category="Two", news=[{"date": "2026-10-02"}, {"date": "2026-10-03"}]),
            company("C", category="One"),
        ]
        stats = compute(companies)
        self.assertEqual(stats["categories"], 2)
        self.assertEqual(stats["news_items"], 3)
        self.assertEqual(stats["companies_tracked"], 3)

    def test_empty_input(self):
        stats = compute([])
        self.assertEqual(stats["companies_tracked"], 0)
        self.assertEqual(stats["capital_raised"]["total_usd"], 0)
        self.assertEqual(stats["categories"], 0)

    def test_notes_are_present(self):
        stats = compute([company("A")])
        for block in ("capital_raised", "combined_arr", "combined_valuation"):
            self.assertIn("note", stats[block])


class LatestNewsDateTests(unittest.TestCase):
    def test_picks_newest(self):
        companies = [company("A", news=[{"date": "2026-01-01"}, {"date": "2026-09-09"}])]
        self.assertEqual(latest_news_date(companies), "2026-09-09")

    def test_none_when_no_news(self):
        self.assertIsNone(latest_news_date([company("A")]))


class BuildTests(unittest.TestCase):
    def test_stamps_are_added(self):
        moment = datetime(2026, 10, 18, 12, 0, 0, tzinfo=timezone.utc)
        stats = build([company("A", news=[{"date": "2026-10-17"}])], now=moment)
        self.assertEqual(stats["last_updated"], "2026-10-18T12:00:00+00:00")
        self.assertEqual(stats["as_of_date"], "2026-10-17")

    def test_naive_datetime_treated_as_utc(self):
        stats = build([company("A")], now=datetime(2026, 10, 18, 12, 0, 0))
        self.assertIn("+00:00", stats["last_updated"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
