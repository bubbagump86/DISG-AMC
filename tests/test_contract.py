"""Contract tests for the AI Intel Dashboard dataset.

These pin down the exact shape of ``data.json`` and ``stats.json`` that
``index.html`` depends on.  They are the Phase 0 safety net: every later change
(pipeline rebuild, frontend refactor) has to keep passing them.

No third-party dependencies -- stdlib ``unittest`` only::

    python -m unittest discover -s tests -v        # stdlib
    pytest tests -v                                # also works, if installed

Three layers of protection:

1. **Shape contract** -- types, required keys, ranges, encodings.
2. **Cross-file consistency** -- ``stats.json`` must equal a fresh recompute
   from ``data.json`` (the drift guard).
3. **Golden snapshot** -- ``tests/fixtures/*.snapshot.json`` freeze the dataset
   as taken over.  Identity checks fail if a refresh silently adds, drops,
   renames or re-categorises anything.  Update the fixture deliberately when a
   change is intended.

``KnownIssues`` holds defects found during the takeover.  They are written as
``@expectedFailure`` so they are visibly tracked but do not break the suite.
When Phase 1 fixes one, it starts reporting as *unexpected success* -- that is
the signal to delete the marker and promote the assertion into the contract.
"""

from __future__ import annotations

import json
import re
import unittest
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _data_file(name: str) -> Path:
    """Locate a published data file.

    Phase 0/1 keep the files at the repo root (the live page fetches
    ``./data.json``).  The planned Phase 2 layout moves them under ``data/``.
    Both locations are supported so the move cannot silently disable the suite.
    """
    for candidate in (REPO_ROOT / "data" / name, REPO_ROOT / name):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"could not find {name} in {REPO_ROOT} or {REPO_ROOT / 'data'}")


def load_data() -> list:
    return json.loads(_data_file("data.json").read_text(encoding="utf-8"))


def load_stats() -> dict:
    return json.loads(_data_file("stats.json").read_text(encoding="utf-8"))


def load_snapshot(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# Contract constants -- the fields index.html reads.
# --------------------------------------------------------------------------

# Present on every company (verified 40/40 on takeover).
REQUIRED_COMPANY_KEYS = {
    "_id": str,
    "name": str,
    "category": str,
    "website": str,
    "founded": str,
    "hq": str,
    "intro": str,
    "product": str,
    "confidence": str,
    "lat": (int, float),
    "lng": (int, float),
    "funding": dict,
    "latest_news": list,
    "sources": list,
}

# Read by index.html but legitimately absent on some companies.
# ``arr_source_note`` feeds two render sites, both with a fallback.
OPTIONAL_COMPANY_KEYS = {
    "arr_usd": (int, type(None)),
    "arr_source_note": (str, type(None)),
    "_refresh_note": str,
    "_founders": list,
}

REQUIRED_FUNDING_KEYS = {
    "latest_round": str,
    "amount_usd": (int, type(None)),
    "date": (str, type(None)),
    "lead_investors": list,
    "post_money_valuation_usd": (int, type(None)),
    "total_raised_usd": (int, type(None)),
    "source_note": str,
}

# Only the four listed companies carry a market cap; private ones omit the key.
OPTIONAL_FUNDING_KEYS = {"current_market_cap_usd": (int, type(None))}

REQUIRED_NEWS_KEYS = {"date": str, "headline": str, "summary": str, "source": str}
REQUIRED_SOURCE_KEYS = {"url": str, "type": str, "accessed": str}

ALLOWED_SOURCE_TYPES = {"official", "press", "blog", "regulatory", "filing"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}

MAX_NEWS_PER_COMPANY = 10

# Companies whose valuation is a public market cap rather than a private
# post-money mark.  Kept in sync with index.html:PUBLIC_COMPANIES.
# Phase 1 moves this flag into the dataset as ``is_public``; ``is_public_company``
# already prefers that field, so these tests survive the migration.
PUBLIC_COMPANIES_FALLBACK = {"ServiceNow", "Snowflake", "DataDog", "AvePoint"}

# Known upstream deviations, tolerated but not allowed to grow.
KNOWN_SLUG_DEVIATIONS = {"cursor---anysphere"}  # from "Cursor / Anysphere"
KNOWN_MISSING_ARR_KEY = {"xAI"}  # every other company carries the key (null = undisclosed)
KNOWN_NON_YEAR_FOUNDED = {"Enigma AI Labs"}

SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
YEAR_RE = re.compile(r"(?:1[89]|20)\d{2}")
REPLACEMENT_CHAR = "\ufffd"


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------


def is_public_company(company: dict) -> bool:
    if "is_public" in company:
        return bool(company["is_public"])
    return company.get("name") in PUBLIC_COMPANIES_FALLBACK


def as_number(value):
    """Return ``value`` as a number, or None.  ``bool`` is not a number here."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def parse_iso_date(value):
    if not isinstance(value, str) or not ISO_DATE_RE.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def compute_stats(companies: list) -> dict:
    """Reference implementation of the dashboard's aggregate rules.

    Mirrors ``index.html:computeStatsFromCompanies`` exactly, including the
    deliberate choice that *lifetime* ``total_raised_usd`` is summed for
    "capital raised" -- never the latest-round ``amount_usd``.  Phase 1 replaces
    this with ``pipeline/stats.py``; until then it is the spec.
    """
    total_count = len(companies)
    capital_total = latest_round_total = 0
    capital_disclosed = latest_round_count = 0
    private_val = public_val = 0
    private_count = public_count = 0
    arr_total = arr_disclosed = 0

    for company in companies:
        funding = company.get("funding") or {}

        raised = as_number(funding.get("total_raised_usd"))
        if raised is not None and raised > 0:
            capital_total += raised
            capital_disclosed += 1

        amount = as_number(funding.get("amount_usd"))
        if amount is not None and amount > 0:
            latest_round_total += amount
            latest_round_count += 1

        if is_public_company(company):
            market_cap = as_number(funding.get("current_market_cap_usd"))
            if market_cap is not None and market_cap > 0:
                public_val += market_cap
                public_count += 1
        else:
            post_money = as_number(funding.get("post_money_valuation_usd"))
            if post_money is not None and post_money > 0:
                private_val += post_money
                private_count += 1

        arr = as_number(company.get("arr_usd"))
        if arr is not None and arr > 0:
            arr_total += arr
            arr_disclosed += 1

    news_total = sum(len(company.get("latest_news") or []) for company in companies)
    categories = {company.get("category") for company in companies if company.get("category")}

    return {
        "companies_tracked": total_count,
        "categories": len(categories),
        "news_items": news_total,
        "capital_raised": {
            "total_usd": capital_total,
            "disclosed_count": capital_disclosed,
            "total_count": total_count,
            "latest_round_total_usd": latest_round_total,
            "latest_round_count": latest_round_count,
        },
        "combined_arr": {
            "total_usd": arr_total,
            "disclosed_count": arr_disclosed,
            "total_count": total_count,
        },
        "combined_valuation": {
            "total_usd": private_val + public_val,
            "private_post_money_usd": private_val,
            "private_count": private_count,
            "public_market_cap_usd": public_val,
            "public_count": public_count,
        },
    }


# --------------------------------------------------------------------------
# data.json shape
# --------------------------------------------------------------------------


class DatasetShapeContract(unittest.TestCase):
    """data.json must satisfy everything index.html reads."""

    @classmethod
    def setUpClass(cls):
        cls.companies = load_data()

    def test_is_a_non_empty_list_of_dicts(self):
        self.assertIsInstance(self.companies, list)
        self.assertGreater(len(self.companies), 0)
        for company in self.companies:
            self.assertIsInstance(company, dict)

    def test_no_replacement_characters(self):
        for path in (_data_file("data.json"), _data_file("stats.json")):
            self.assertNotIn(
                REPLACEMENT_CHAR,
                path.read_text(encoding="utf-8"),
                f"{path.name} contains U+FFFD -- an upstream encoding bug",
            )

    def test_required_company_keys_and_types(self):
        for company in self.companies:
            label = company.get("name") or company.get("_id") or "<unnamed>"
            for key, expected in REQUIRED_COMPANY_KEYS.items():
                with self.subTest(company=label, key=key):
                    self.assertIn(key, company, f"{label} is missing {key}")
                    self.assertIsInstance(company[key], expected, f"{label}.{key} has wrong type")

    def test_optional_company_keys_have_correct_type_when_present(self):
        for company in self.companies:
            label = company.get("name") or "<unnamed>"
            for key, expected in OPTIONAL_COMPANY_KEYS.items():
                if key not in company:
                    continue
                with self.subTest(company=label, key=key):
                    self.assertIsInstance(company[key], expected, f"{label}.{key} has wrong type")

    def test_ids_and_names_are_unique(self):
        ids = [company["_id"] for company in self.companies]
        names = [company["name"] for company in self.companies]
        self.assertEqual(len(ids), len(set(ids)), "duplicate _id values")
        self.assertEqual(len(names), len(set(names)), "duplicate company names")

    def test_ids_are_clean_slugs(self):
        """No *new* malformed ids.  Registry shrinks as Phase 1 fixes them."""
        offenders = {c["_id"] for c in self.companies if not SLUG_RE.fullmatch(c["_id"])}
        self.assertTrue(
            offenders <= KNOWN_SLUG_DEVIATIONS,
            f"new malformed _id values: {sorted(offenders - KNOWN_SLUG_DEVIATIONS)}",
        )

    def test_founded_format_is_registered(self):
        """No *new* non-year founded values."""
        offenders = {
            company["name"]
            for company in self.companies
            if not YEAR_RE.fullmatch(company["founded"])
        }
        self.assertTrue(
            offenders <= KNOWN_NON_YEAR_FOUNDED,
            f"new non-year founded values: {sorted(offenders - KNOWN_NON_YEAR_FOUNDED)}",
        )

    def test_arr_key_presence_is_registered(self):
        """No *new* companies missing the arr_usd key.

        ``arr_usd: null`` means "not disclosed" and is legitimate; the key being
        absent entirely (as with xAI) is the inconsistency.
        """
        missing = {company["name"] for company in self.companies if "arr_usd" not in company}
        self.assertTrue(
            missing <= KNOWN_MISSING_ARR_KEY,
            f"new companies without an arr_usd key: {sorted(missing - KNOWN_MISSING_ARR_KEY)}",
        )

    def test_coordinates_are_valid(self):
        for company in self.companies:
            with self.subTest(company=company["name"]):
                self.assertGreaterEqual(company["lat"], -90)
                self.assertLessEqual(company["lat"], 90)
                self.assertGreaterEqual(company["lng"], -180)
                self.assertLessEqual(company["lng"], 180)
                self.assertNotEqual((company["lat"], company["lng"]), (0, 0), "unset coordinates")

    def test_confidence_is_known_value(self):
        for company in self.companies:
            with self.subTest(company=company["name"]):
                self.assertIn(company["confidence"], ALLOWED_CONFIDENCE)

    def test_website_looks_like_a_url(self):
        for company in self.companies:
            with self.subTest(company=company["name"]):
                self.assertRegex(company["website"], r"^https?://[^\s]+$")

    def test_funding_block_shape(self):
        for company in self.companies:
            label = company["name"]
            funding = company["funding"]
            for key, expected in REQUIRED_FUNDING_KEYS.items():
                with self.subTest(company=label, key=key):
                    self.assertIn(key, funding, f"{label}.funding is missing {key}")
                    self.assertIsInstance(funding[key], expected, f"{label}.funding.{key} wrong type")

            for key, expected in OPTIONAL_FUNDING_KEYS.items():
                if key not in funding:
                    continue
                with self.subTest(company=label, key=key):
                    self.assertIsInstance(funding[key], expected, f"{label}.funding.{key} wrong type")

            for key in (
                "amount_usd",
                "post_money_valuation_usd",
                "total_raised_usd",
                "current_market_cap_usd",
            ):
                value = funding.get(key)
                if value is None:
                    continue
                with self.subTest(company=label, key=key):
                    self.assertGreaterEqual(value, 0, f"{label}.funding.{key} is negative")

            with self.subTest(company=label, key="lead_investors"):
                for investor in funding["lead_investors"]:
                    self.assertIsInstance(investor, str)
                    self.assertTrue(investor.strip())

            with self.subTest(company=label, key="source_note"):
                self.assertTrue(funding["source_note"].strip(), "empty source_note")

    def test_funding_date_is_iso_or_null(self):
        for company in self.companies:
            value = company["funding"]["date"]
            if value is None:
                continue
            with self.subTest(company=company["name"]):
                self.assertIsNotNone(parse_iso_date(value), f"bad funding date {value!r}")

    def test_valuation_field_matches_public_vs_private(self):
        for company in self.companies:
            funding = company["funding"]
            with self.subTest(company=company["name"]):
                cap = as_number(funding.get("current_market_cap_usd"))
                if is_public_company(company):
                    self.assertIsNotNone(cap, "public company needs a numeric market cap")
                    self.assertGreater(cap, 0)
                else:
                    self.assertIsNone(cap, "private company should not carry a market cap")

    def test_news_items_shape_and_cap(self):
        for company in self.companies:
            news = company["latest_news"]
            label = company["name"]
            with self.subTest(company=label):
                self.assertLessEqual(len(news), MAX_NEWS_PER_COMPANY)
            for item in news:
                with self.subTest(company=label, headline=item.get("headline", "")[:40]):
                    for key, expected in REQUIRED_NEWS_KEYS.items():
                        self.assertIn(key, item)
                        self.assertIsInstance(item[key], expected)
                    self.assertTrue(item["headline"].strip(), "empty headline")
                    self.assertIsNotNone(parse_iso_date(item["date"]), f"bad news date {item['date']!r}")
                    self.assertRegex(item["source"], r"^https?://[^\s]+$")

    def test_sources_block_shape(self):
        for company in self.companies:
            for source in company["sources"]:
                with self.subTest(company=company["name"]):
                    for key, expected in REQUIRED_SOURCE_KEYS.items():
                        self.assertIn(key, source)
                        self.assertIsInstance(source[key], expected)
                    self.assertIn(source["type"], ALLOWED_SOURCE_TYPES)
                    self.assertRegex(source["url"], r"^https?://[^\s]+$")
                    self.assertIsNotNone(parse_iso_date(source["accessed"]))


# --------------------------------------------------------------------------
# stats.json shape + consistency with data.json
# --------------------------------------------------------------------------


class StatsShapeContract(unittest.TestCase):
    """stats.json must carry every aggregate renderStats() reads."""

    @classmethod
    def setUpClass(cls):
        cls.stats = load_stats()

    def test_top_level_keys(self):
        self.assertIsInstance(self.stats, dict)
        for key in ("last_updated", "as_of_date", "companies_tracked", "categories", "news_items"):
            self.assertIn(key, self.stats, f"stats.json missing {key}")
        self.assertIsNotNone(parse_iso_date(self.stats["as_of_date"]))

    def test_last_updated_is_an_iso_timestamp(self):
        self.assertRegex(self.stats["last_updated"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")

    def test_nested_aggregate_blocks(self):
        expected = {
            "capital_raised": {"total_usd", "disclosed_count", "total_count"},
            "combined_arr": {"total_usd", "disclosed_count", "total_count"},
            "combined_valuation": {
                "total_usd",
                "private_post_money_usd",
                "private_count",
                "public_market_cap_usd",
                "public_count",
            },
        }
        for block, keys in expected.items():
            with self.subTest(block=block):
                self.assertIn(block, self.stats)
                self.assertIsInstance(self.stats[block], dict)
                for key in keys:
                    self.assertIn(key, self.stats[block])
                    self.assertIsInstance(self.stats[block][key], int)


class StatsMatchesDataContract(unittest.TestCase):
    """The drift guard: stats.json must equal a fresh recompute from data.json."""

    @classmethod
    def setUpClass(cls):
        cls.stats = load_stats()
        cls.recomputed = compute_stats(load_data())

    def test_scalar_aggregates_match(self):
        for key in ("companies_tracked", "categories", "news_items"):
            with self.subTest(key=key):
                self.assertEqual(self.stats[key], self.recomputed[key])

    def test_nested_aggregates_match(self):
        for block in ("capital_raised", "combined_arr", "combined_valuation"):
            for key, expected in self.recomputed[block].items():
                with self.subTest(block=block, key=key):
                    self.assertEqual(
                        self.stats[block][key],
                        expected,
                        f"{block}.{key} in stats.json disagrees with data.json",
                    )


# --------------------------------------------------------------------------
# Golden snapshot
# --------------------------------------------------------------------------


class GoldenSnapshotContract(unittest.TestCase):
    """The tracked universe must not change silently between refreshes."""

    @classmethod
    def setUpClass(cls):
        cls.companies = load_data()
        cls.stats = load_stats()
        cls.snapshot = load_snapshot("data.snapshot.json")
        cls.stats_snapshot = load_snapshot("stats.snapshot.json")

    def test_company_set_unchanged(self):
        live = {company["name"] for company in self.companies}
        frozen = {company["name"] for company in self.snapshot}
        self.assertEqual(live - frozen, set(), "companies added since the snapshot")
        self.assertEqual(frozen - live, set(), "companies dropped since the snapshot")

    def test_category_set_unchanged(self):
        live = {company["category"] for company in self.companies}
        frozen = {company["category"] for company in self.snapshot}
        self.assertEqual(live, frozen, "category vocabulary changed")

    def test_id_mapping_unchanged(self):
        live = {company["name"]: company["_id"] for company in self.companies}
        frozen = {company["name"]: company["_id"] for company in self.snapshot}
        self.assertEqual(live, frozen, "name -> _id mapping changed (breaks deep links)")

    def test_tracked_company_count_matches_snapshot(self):
        self.assertEqual(len(self.companies), len(self.snapshot))

    def test_stats_json_key_set_matches_snapshot(self):
        self.assertEqual(set(self.stats), set(self.stats_snapshot), "stats.json key set changed")


# --------------------------------------------------------------------------
# Known issues found during takeover.
# Each is @expectedFailure: green now, and they report "unexpected success"
# once Phase 1 fixes the underlying data.
# --------------------------------------------------------------------------


class KnownIssues(unittest.TestCase):
    """Defects recorded during the takeover, tracked until Phase 1 fixes them."""

    @classmethod
    def setUpClass(cls):
        cls.companies = load_data()

    @unittest.expectedFailure
    def test_news_is_sorted_newest_first(self):
        """29/40 companies store latest_news out of order.

        The global timeline sorts before rendering, but per-company detail
        sections and the modal render the stored order, so the newest headline
        can appear mid-list.
        """
        unsorted = [
            company["name"]
            for company in self.companies
            if [item["date"] for item in company["latest_news"]]
            != sorted((item["date"] for item in company["latest_news"]), reverse=True)
        ]
        self.assertEqual(unsorted, [], f"{len(unsorted)} companies have unsorted news")

    @unittest.expectedFailure
    def test_founded_is_a_bare_year(self):
        """'Enigma AI Labs' has founded == '2025-01' instead of a year."""
        offenders = {
            company["name"]
            for company in self.companies
            if not YEAR_RE.fullmatch(company["founded"])
        }
        self.assertEqual(offenders, set())

    @unittest.expectedFailure
    def test_every_company_has_an_arr_key(self):
        """'xAI' omits the arr_usd key entirely; the other 39 carry it (null = undisclosed)."""
        missing = {company["name"] for company in self.companies if "arr_usd" not in company}
        self.assertEqual(missing, set())

    @unittest.expectedFailure
    def test_no_known_typo_display_names(self):
        """'A21 Labs' should be 'AI21 Labs' (website and intro both say AI21)."""
        names = {company["name"] for company in self.companies}
        self.assertNotIn("A21 Labs", names)

    @unittest.expectedFailure
    def test_refresh_note_is_populated_for_all_companies(self):
        """_refresh_note is stamped on 1/40 companies; the field is vestigial."""
        stamped = [company for company in self.companies if "_refresh_note" in company]
        self.assertEqual(len(stamped), len(self.companies))


if __name__ == "__main__":
    unittest.main(verbosity=2)
