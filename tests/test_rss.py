"""Tests for feed parsing (RSS 2.0, Atom, RDF) and value normalization."""

from __future__ import annotations

import unittest
from pathlib import Path

from pipeline.rss import FeedParseError, parse, parse_date, strip_html

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "rss"

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Blog</title>
  <entry>
    <title>Newer post</title>
    <link rel="alternate" href="https://example.com/newer"/>
    <published>2026-10-12T09:30:00Z</published>
    <summary>Short summary of newer.</summary>
  </entry>
  <entry>
    <title>Older post</title>
    <link href="https://example.com/older"/>
    <updated>2026-09-01T00:00:00+00:00</updated>
    <content type="html">&lt;p&gt;Body of older&lt;/p&gt;</content>
  </entry>
</feed>
"""

RDF = b"""<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item>
    <title>RDF item</title>
    <link>https://example.com/rdf</link>
    <dc:date>2026-08-05T12:00:00Z</dc:date>
    <description>RDF description</description>
  </item>
</rdf:RDF>
"""

NO_DATES = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Undated</title><link>https://example.com/x</link></item>
</channel></rss>
"""


class ParseDateTests(unittest.TestCase):
    def test_rfc822(self):
        self.assertEqual(parse_date("Fri, 16 Oct 2026 19:00:00 GMT"), "2026-10-16")

    def test_rfc822_with_offset_normalizes_to_utc(self):
        self.assertEqual(parse_date("Sat, 17 Oct 2026 02:30:00 +0530"), "2026-10-16")

    def test_iso_with_z(self):
        self.assertEqual(parse_date("2026-10-12T09:30:00Z"), "2026-10-12")

    def test_iso_naive_assumed_utc(self):
        self.assertEqual(parse_date("2026-10-12T09:30:00"), "2026-10-12")

    def test_bare_date_string(self):
        self.assertEqual(parse_date("2026-07-27"), "2026-07-27")

    def test_garbage_and_empty_return_none(self):
        for value in (None, "", "not a date", "  ", "Fri, 99 Xxx 2026"):
            with self.subTest(value=value):
                self.assertIsNone(parse_date(value))


class StripHtmlTests(unittest.TestCase):
    def test_tags_and_entities(self):
        self.assertEqual(strip_html("<p>Hello &amp; welcome</p>"), "Hello & welcome")

    def test_nbsp_and_collapse_whitespace(self):
        self.assertEqual(strip_html("A&nbsp;&nbsp;  B\n C"), "A B C")

    def test_none_and_empty(self):
        self.assertEqual(strip_html(None), "")
        self.assertEqual(strip_html(""), "")


class ParseTests(unittest.TestCase):
    def test_rss2_fixture(self):
        items = parse((FIXTURES / "databricks.xml").read_bytes())
        self.assertGreater(len(items), 0)
        for item in items:
            self.assertTrue(item.title)
            self.assertTrue(item.published)
        dates = [item.published for item in items]
        self.assertEqual(dates, sorted(dates, reverse=True), "items should come back newest first")

    def test_google_news_fixture_has_publisher(self):
        items = parse((FIXTURES / "googlenews_anthropic.xml").read_bytes())
        self.assertTrue(items)
        self.assertTrue(any(item.publisher for item in items), "Google News exposes <source>")

    def test_atom(self):
        items = parse(ATOM)
        self.assertEqual([item.title for item in items], ["Newer post", "Older post"])
        self.assertEqual(items[0].link, "https://example.com/newer")
        self.assertEqual(items[0].published, "2026-10-12")
        self.assertEqual(items[1].published, "2026-09-01")
        self.assertEqual(items[1].summary, "Body of older")

    def test_rdf(self):
        items = parse(RDF)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].title, "RDF item")
        self.assertEqual(items[0].published, "2026-08-05")

    def test_items_without_dates_are_skipped(self):
        self.assertEqual(parse(NO_DATES), [])

    def test_malformed_xml_raises(self):
        with self.assertRaises(FeedParseError):
            parse(b"<rss><channel><item>")

    def test_empty_feed_yields_nothing(self):
        self.assertEqual(parse(b'<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'), [])

    def test_all_captured_fixtures_parse(self):
        for path in sorted(FIXTURES.glob("*.xml")):
            with self.subTest(fixture=path.name):
                self.assertGreater(len(parse(path.read_bytes())), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
