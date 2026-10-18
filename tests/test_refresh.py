"""End-to-end tests for the refresh orchestrator, with no network access.

A stub fetcher stands in for HTTP, so the whole pipeline -- collect, merge,
funding detection, stats, atomic writes -- is exercised deterministically.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline import refresh
from pipeline.httpio import write_json

RSS_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Stub</title>
{items}
</channel></rss>
"""

ITEM_TEMPLATE = """  <item>
    <title>{title}</title>
    <link>{link}</link>
    <pubDate>{date}</pubDate>
    <description>{title}</description>
    <source url="https://publisher.example">{publisher}</source>
  </item>"""


def rss(items) -> bytes:
    body = "\n".join(
        ITEM_TEMPLATE.format(
            title=title,
            link=link,
            date=pub,
            publisher=publisher,
        )
        for title, link, pub, publisher in items
    )
    return RSS_TEMPLATE.format(items=body).encode("utf-8")


def make_config():
    return {
        "_meta": {"schema": 1},
        "defaults": {"max_news": 10, "news": {"hl": "en-US", "gl": "US", "ceid": "US:en"}},
        "companies": [
            {
                "_id": "alpha",
                "name": "Alpha",
                "category": "Foundation Models",
                "website": "https://alpha.example",
                "founded": "2020",
                "hq": "Nowhere",
                "intro": "Alpha intro",
                "product": "Alpha product",
                "confidence": "high",
                "lat": 1.0,
                "lng": 2.0,
                "arr_usd": 1_000,
                "is_public": False,
                "sources": [{"url": "https://alpha.example", "type": "official", "accessed": "2026-01-01"}],
                "funding": {
                    "latest_round": "Series A",
                    "amount_usd": 100_000_000,
                    "date": "2026-01-01",
                    "lead_investors": ["Someone"],
                    "post_money_valuation_usd": 1_000_000_000,
                    "total_raised_usd": 100_000_000,
                    "source_note": "curated prose",
                },
            },
            {
                "_id": "beta",
                "name": "Beta",
                "category": "AI Agents",
                "website": "https://beta.example",
                "founded": "2022",
                "hq": "Elsewhere",
                "intro": "Beta intro",
                "product": "Beta product",
                "confidence": "medium",
                "lat": 3.0,
                "lng": 4.0,
                "arr_usd": None,
                "is_public": True,
                "sources": [{"url": "https://beta.example", "type": "official", "accessed": "2026-01-01"}],
                "funding": {
                    "latest_round": "Public (NYSE: BETA)",
                    "amount_usd": None,
                    "date": "2021-06-01",
                    "lead_investors": [],
                    "post_money_valuation_usd": None,
                    "total_raised_usd": 5_000_000,
                    "current_market_cap_usd": 50_000_000_000,
                    "source_note": "public",
                },
            },
        ],
    }


class StubFetcher:
    """Serves canned RSS per URL fragment."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.stats = {"network": 0, "cache_hit": 0, "error": 0}

    def get(self, url: str) -> bytes:
        for fragment, body in self.routes.items():
            if fragment in url:
                return body
        raise RuntimeError(f"no stub route for {url}")


def default_routes():
    """Per-company canned feeds.

    Routing is by company name, which is what the default Google News query
    embeds (``q=%22Alpha%22``), so each company gets its own items.
    """
    return {
        "Alpha": rss([
            ("Alpha ships something - Reuters", "https://news.google.com/rss/articles/AAA", "Sat, 17 Oct 2026 10:00:00 GMT", "Reuters"),
            ("Alpha older story - Reuters", "https://news.google.com/rss/articles/BBB", "Fri, 10 Oct 2026 10:00:00 GMT", "Reuters"),
        ]),
        "Beta": rss([
            ("Beta launches a thing - Reuters", "https://news.google.com/rss/articles/CCC", "Thu, 16 Oct 2026 10:00:00 GMT", "Reuters"),
        ]),
    }


def funding_routes():
    """Two outlets reporting the same round, which corroborates the signal."""
    return {
        "Alpha": rss([
            ("Alpha raises $500M Series B led by Big Fund - Reuters",
             "https://news.google.com/rss/articles/NEW1", "Sat, 17 Oct 2026 10:00:00 GMT", "Reuters"),
            ("Alpha closes $500M Series B round - Bloomberg",
             "https://news.google.com/rss/articles/NEW2", "Sat, 17 Oct 2026 12:00:00 GMT", "Bloomberg"),
        ]),
        "Beta": rss([
            ("Beta is quiet - Reuters", "https://news.google.com/rss/articles/CCC", "Thu, 16 Oct 2026 10:00:00 GMT", "Reuters"),
        ]),
    }


class RunTests(unittest.TestCase):
    def test_records_carry_curated_fields_intact(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()))
        alpha = report.data[0]
        self.assertEqual(alpha["name"], "Alpha")
        self.assertEqual(alpha["intro"], "Alpha intro")
        self.assertEqual(alpha["sources"][0]["url"], "https://alpha.example")
        self.assertEqual(alpha["arr_usd"], 1_000)
        self.assertEqual(alpha["funding"]["source_note"], "curated prose")

    def test_company_order_follows_the_config(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()))
        self.assertEqual([record["_id"] for record in report.data], ["alpha", "beta"])

    def test_news_is_newest_first_and_capped(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()))
        for record in report.data:
            dates = [item["date"] for item in record["latest_news"]]
            self.assertEqual(dates, sorted(dates, reverse=True))
            self.assertLessEqual(len(dates), 10)

    def test_feed_metadata_is_kept(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()))
        item = report.data[0]["latest_news"][0]
        self.assertEqual(item["source_name"], "Reuters")
        self.assertEqual(item["source_url"], "https://publisher.example")
        self.assertTrue(item["feed"])

    def test_is_public_is_published_and_private_has_no_market_cap(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()))
        alpha, beta = report.data
        self.assertFalse(alpha["is_public"])
        self.assertNotIn("current_market_cap_usd", alpha["funding"])
        self.assertTrue(beta["is_public"])
        self.assertEqual(beta["funding"]["current_market_cap_usd"], 50_000_000_000)

    def test_only_filter(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()), only=["Beta"])
        self.assertEqual([record["_id"] for record in report.data], ["beta"])

    def test_fetch_failure_is_recorded_and_does_not_abort(self):
        class Exploding(StubFetcher):
            def get(self, url):
                raise RuntimeError("boom")

        report = refresh.run(make_config(), fetcher=Exploding({}))
        self.assertEqual(report.companies, 2, "all companies still produced")
        self.assertEqual(len(report.failures), 2)

    def test_history_is_preserved_and_merged(self):
        existing = [{"_id": "alpha", "latest_news": [
            {"date": "2026-10-01", "headline": "Old Alpha news", "summary": "s", "source": "https://news.google.com/rss/articles/OLD"},
        ]}]
        report = refresh.run(make_config(), existing_data=existing, fetcher=StubFetcher(default_routes()))
        headlines = [item["headline"] for item in report.data[0]["latest_news"]]
        self.assertIn("Old Alpha news", headlines)
        self.assertEqual(headlines[0], "Alpha ships something - Reuters", "newest first")

    def test_empty_history_is_fine(self):
        report = refresh.run(make_config(), existing_data=[], fetcher=StubFetcher(default_routes()))
        self.assertEqual(report.companies, 2)

    def test_stats_are_computed(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(default_routes()))
        self.assertEqual(report.stats["companies_tracked"], 2)
        self.assertEqual(report.stats["combined_valuation"]["public_market_cap_usd"], 50_000_000_000)
        self.assertEqual(report.stats["combined_arr"]["total_usd"], 1_000)


class FundingIntegrationTests(unittest.TestCase):
    def test_default_policy_never_writes_funding(self):
        """Auto-apply is opt-in; the default run only queues."""
        report = refresh.run(make_config(), fetcher=StubFetcher(funding_routes()))
        self.assertEqual(report.data[0]["funding"]["latest_round"], "Series A")
        self.assertEqual(report.funding_applied, [])
        self.assertGreaterEqual(len(report.funding_queued), 1)

    def test_new_round_is_auto_applied_and_queued_when_opted_in(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(funding_routes()), apply_funding=True)
        funding = report.data[0]["funding"]
        self.assertEqual(funding["latest_round"], "Series B")
        self.assertEqual(funding["amount_usd"], 500_000_000)
        self.assertEqual(funding["source_note"], "curated prose", "prose is never auto-written")
        self.assertEqual(len(report.funding_applied) + len(report.funding_queued), 1)

    def test_at_most_one_apply_per_company_per_run(self):
        """Two detected rounds in one pass must not both be written."""
        routes = {
            "Alpha": rss([
                ("Alpha raises $500M Series B led by Big Fund - Reuters",
                 "https://news.google.com/rss/articles/N1", "Sat, 17 Oct 2026 10:00:00 GMT", "Reuters"),
                ("Alpha closes $500M Series B round - Bloomberg",
                 "https://news.google.com/rss/articles/N2", "Sat, 17 Oct 2026 12:00:00 GMT", "Bloomberg"),
                ("Alpha raises $900M Series C - Reuters",
                 "https://news.google.com/rss/articles/N3", "Sun, 18 Oct 2026 09:00:00 GMT", "Reuters"),
                ("Alpha closes $900M Series C - Bloomberg",
                 "https://news.google.com/rss/articles/N4", "Sun, 18 Oct 2026 10:00:00 GMT", "Bloomberg"),
            ]),
            "Beta": rss([
                ("Beta is quiet - Reuters", "https://news.google.com/rss/articles/CCC", "Thu, 16 Oct 2026 10:00:00 GMT", "Reuters"),
            ]),
        }
        report = refresh.run(make_config(), fetcher=StubFetcher(routes), apply_funding=True)
        self.assertEqual(len(report.funding_applied), 1, "exactly one change written")
        self.assertEqual(report.data[0]["funding"]["latest_round"], "Series C", "the newest wins")
        self.assertTrue(report.funding_queued, "the rest stay queued")

    def test_no_funding_flag_disables_detection(self):
        report = refresh.run(make_config(), fetcher=StubFetcher(funding_routes()), detect_funding=False)
        self.assertEqual(report.funding_applied, [])
        self.assertEqual(report.funding_queued, [])


class CliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.config_path = self.tmp / "companies.json"
        write_json(self.config_path, make_config())
        self.data_path = self.tmp / "data.json"
        self.stats_path = self.tmp / "stats.json"
        self.review_path = self.tmp / "queue.json"
        self.routes = default_routes()

    def tearDown(self):
        self._tmp.cleanup()

    def _argv(self, *extra):
        return [
            "--config", str(self.config_path),
            "--data", str(self.data_path),
            "--stats", str(self.stats_path),
            "--review", str(self.review_path),
            "--cache-dir", str(self.tmp / "cache"),
            "--quiet", *extra,
        ]

    def test_check_reports_pending_changes_before_writing(self):
        # A fresh run against an empty data.json has changes to make.
        import pipeline.refresh as module
        original = module.Fetcher
        module.Fetcher = lambda **kwargs: StubFetcher(self.routes)
        try:
            self.assertEqual(module.main(self._argv("--check")), 1)
            self.assertFalse(self.data_path.exists(), "--check must not write")
            module.main(self._argv())
            self.assertTrue(self.data_path.exists())
            self.assertEqual(module.main(self._argv("--check")), 0, "second check is clean")
        finally:
            module.Fetcher = original

    def test_dry_run_writes_nothing(self):
        import pipeline.refresh as module
        original = module.Fetcher
        module.Fetcher = lambda **kwargs: StubFetcher(self.routes)
        try:
            self.assertEqual(module.main(self._argv("--dry-run")), 0)
            self.assertFalse(self.data_path.exists())
            self.assertFalse(self.stats_path.exists())
        finally:
            module.Fetcher = original

    def test_written_files_are_valid_and_idempotent(self):
        import pipeline.refresh as module
        original = module.Fetcher
        module.Fetcher = lambda **kwargs: StubFetcher(self.routes)
        try:
            module.main(self._argv())
            first = self.data_path.read_text(encoding="utf-8")
            payload = json.loads(first)
            self.assertEqual(len(payload), 2)

            # A second identical run must not touch either file, even though
            # the heartbeat timestamp advances.
            first_stats = self.stats_path.read_text(encoding="utf-8")
            before_data = self.data_path.stat().st_mtime_ns
            before_stats = self.stats_path.stat().st_mtime_ns
            module.main(self._argv())
            self.assertEqual(self.data_path.read_text(encoding="utf-8"), first)
            self.assertEqual(self.stats_path.read_text(encoding="utf-8"), first_stats)
            self.assertEqual(self.data_path.stat().st_mtime_ns, before_data, "data.json rewritten")
            self.assertEqual(self.stats_path.stat().st_mtime_ns, before_stats, "stats.json rewritten")
            self.assertEqual(module.main(self._argv("--check")), 0, "a repeat run reports no changes")
        finally:
            module.Fetcher = original

    def test_review_queue_is_written_when_a_signal_is_found(self):
        import pipeline.refresh as module
        original = module.Fetcher
        module.Fetcher = lambda **kwargs: StubFetcher(funding_routes())
        try:
            module.main(self._argv())
            self.assertTrue(self.review_path.exists())
            payload = json.loads(self.review_path.read_text(encoding="utf-8"))
            self.assertIn("policy", payload)
        finally:
            module.Fetcher = original


if __name__ == "__main__":
    unittest.main(verbosity=2)
