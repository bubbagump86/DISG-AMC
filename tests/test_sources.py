"""Tests for multi-feed collection, dedupe and the history merge."""

from __future__ import annotations

import unittest
from datetime import date

from pipeline.rss import FeedItem
from pipeline.sources import (
    FeedSpec,
    canonical_url,
    dedupe_key,
    feeds_for,
    google_news_url,
    item_from_feed,
    merge,
)

TODAY = date(2026, 10, 18)


def news(day: str, headline: str, source: str = "", **extra) -> dict:
    item = {"date": day, "headline": headline, "summary": headline, "source": source}
    item.update(extra)
    return item


class GoogleNewsUrlTests(unittest.TestCase):
    def test_default_settings_and_quoting(self):
        url = google_news_url('"Snowflake" AI data cloud')
        self.assertTrue(url.startswith("https://news.google.com/rss/search?q="))
        self.assertIn("hl=en-US", url)
        self.assertIn("gl=US", url)
        self.assertIn("ceid=US%3Aen", url)
        self.assertNotIn(" ", url, "query must be percent-encoded")

    def test_settings_override(self):
        self.assertIn("hl=en-GB", google_news_url("x", {"hl": "en-GB"}))


class FeedsForTests(unittest.TestCase):
    def test_official_feeds_come_first_then_google_news(self):
        company = {
            "name": "Workato",
            "feeds": [{"url": "https://www.workato.com/the-connector/feed/", "label": "Workato Blog", "type": "official"}],
        }
        specs = feeds_for(company)
        self.assertEqual([spec.type for spec in specs], ["official", "news"])
        self.assertEqual(specs[-1].label, "Google News")

    def test_news_query_overrides_company_name(self):
        specs = feeds_for({"name": "Snowflake", "news_query": '"Snowflake" AI data cloud'})
        self.assertIn("AI+data+cloud", specs[0].url)

    def test_bare_string_feed_is_treated_as_official(self):
        specs = feeds_for({"name": "X", "feeds": ["https://example.com/feed"]})
        self.assertEqual(specs[0].type, "official")
        self.assertEqual(specs[0].url, "https://example.com/feed")

    def test_company_without_feeds_still_gets_google_news(self):
        self.assertEqual(len(feeds_for({"name": "Anthropic"})), 1)


class CanonicalUrlTests(unittest.TestCase):
    def test_strips_tracking_params(self):
        self.assertEqual(
            canonical_url("https://example.com/a?utm_source=x&id=1&oc=5"),
            "https://example.com/a?id=1",
        )

    def test_empty(self):
        self.assertEqual(canonical_url(""), "")


class DedupeKeyTests(unittest.TestCase):
    def test_same_article_different_tracking_is_one_key(self):
        a = news("2026-10-17", "H", "https://example.com/a?utm_source=newsletter")
        b = news("2026-10-17", "H", "https://example.com/a")
        self.assertEqual(dedupe_key(a), dedupe_key(b))

    def test_google_news_links_fall_back_to_headline(self):
        # Google hands out a different redirect per query for the same story.
        a = news("2026-10-17", "Same Story - Reuters", "https://news.google.com/rss/articles/AAA")
        b = news("2026-10-17", "Same Story   -   Reuters", "https://news.google.com/rss/articles/BBB")
        self.assertEqual(dedupe_key(a), dedupe_key(b))

    def test_different_headlines_differ(self):
        a = news("2026-10-17", "One", "https://news.google.com/rss/articles/AAA")
        b = news("2026-10-17", "Two", "https://news.google.com/rss/articles/BBB")
        self.assertNotEqual(dedupe_key(a), dedupe_key(b))


class ItemFromFeedTests(unittest.TestCase):
    def test_maps_fields(self):
        spec = FeedSpec(url="https://x/feed", label="Blog", type="official")
        entry = FeedItem(
            title="Falls back to headline",
            link="https://example.com/1",
            published="2026-10-01",
            summary="",
            publisher="Example",
            publisher_url="https://example.com",
        )
        item = item_from_feed(entry, spec)
        self.assertEqual(item["date"], "2026-10-01")
        self.assertEqual(item["headline"], "Falls back to headline")
        self.assertEqual(item["summary"], "Falls back to headline", "empty summary mirrors the headline")
        self.assertEqual(item["source_name"], "Example")
        self.assertEqual(item["source_url"], "https://example.com")

    def test_undated_entry_is_dropped(self):
        spec = FeedSpec(url="x", label="y", type="news")
        entry = FeedItem(title="T", link="u", published=None, summary="s")
        self.assertIsNone(item_from_feed(entry, spec))


class MergeTests(unittest.TestCase):
    def test_newest_first(self):
        existing = [news("2026-10-01", "old")]
        incoming = [news("2026-10-10", "new")]
        merged = merge(existing, incoming, today=TODAY)
        self.assertEqual([item["headline"] for item in merged], ["new", "old"])

    def test_history_is_repaired_not_replaced(self):
        # The takeover defect: stored order was not chronological. Merging re-sorts.
        existing = [news("2026-10-01", "a"), news("2026-10-05", "b")]
        merged = merge(existing, [], today=TODAY)
        self.assertEqual([item["date"] for item in merged], ["2026-10-05", "2026-10-01"])

    def test_capped(self):
        existing = [news(f"2026-09-{day:02d}", f"d{day}") for day in range(1, 21)]
        self.assertEqual(len(merge(existing, [], max_news=10, today=TODAY)), 10)

    def test_deduplicates_across_sources(self):
        existing = [news("2026-10-01", "Same", "https://example.com/a")]
        incoming = [news("2026-10-01", "Same", "https://example.com/a?utm_source=x")]
        self.assertEqual(len(merge(existing, incoming, today=TODAY)), 1)

    def test_official_item_beats_google_news_for_same_story(self):
        google = news("2026-10-01", "Story", "https://news.google.com/rss/articles/AAA", _type="news")
        official = news("2026-10-01", "Story", "https://openai.com/story", _type="official")
        merged = merge([google], [official], today=TODAY)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["source"], "https://openai.com/story")

    def test_future_items_are_dropped(self):
        merged = merge([], [news("2027-01-01", "from the future")], today=TODAY)
        self.assertEqual(merged, [])

    def test_tomorrow_is_tolerated_for_timezone_skew(self):
        merged = merge([], [news("2026-10-19", "tomorrow")], today=TODAY)
        self.assertEqual(len(merged), 1)

    def test_undated_items_are_dropped(self):
        self.assertEqual(merge([], [{"headline": "no date", "source": ""}], today=TODAY), [])

    def test_internal_keys_are_not_published(self):
        merged = merge([], [news("2026-10-01", "x", _type="official")], today=TODAY)
        self.assertNotIn("_type", merged[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
