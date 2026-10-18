"""Build ``pipeline/config/companies.json`` from the published ``data.json``.

The pipeline needs a *seed*: the slow-changing curated facts (identity, copy,
funding baseline, coordinates) kept separate from the news that gets rewritten
every run.  This module extracts it, applies the corrections recorded at
takeover, and attaches the feed configuration.

Run it only when onboarding new companies or editing curated facts::

    python -m pipeline.seed                 # regenerate from data.json
    python -m pipeline.seed --check         # verify the seed still matches
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .stats import is_public

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = REPO_ROOT / "data.json"
DEFAULT_CONFIG = Path(__file__).resolve().parent / "config" / "companies.json"

SCHEMA_VERSION = 1

#: Curated fields copied verbatim from data.json into the seed.
CURATED_FIELDS = (
    "_id", "name", "category", "website", "founded", "hq", "intro", "product",
    "confidence", "lat", "lng", "arr_usd", "arr_source_note", "sources",
)

#: Fields that are regenerated on every refresh and must not enter the seed.
REFRESHED_FIELDS = ("latest_news",)

#: Internal/unused fields dropped during onboarding.
#: ``_refresh_note`` was stamped on 1 of 40 companies and read by nothing;
#: ``_founders`` appeared once and was never rendered.
DROPPED_FIELDS = ("_refresh_note", "_founders", "current_market_cap_usd")

#: Corrections to upstream data, applied on every seed run so they cannot
#: silently reappear.  Keyed by the upstream ``_id``.
CORRECTIONS = {
    # "A21 Labs" is AI21 Labs -- the website, intro and _id all say so.
    "a21-labs": {"name": "AI21 Labs"},
    # Triple hyphen from "Cursor / Anysphere"; the frontend's own slug fallback
    # would have produced "cursor-anysphere".
    "cursor---anysphere": {"_id": "cursor-anysphere"},
    # The company is Enigma (enigma.inc), a physical-AI robotics lab. Neither the
    # old display name nor "enigma-aerospace" matched it. Confirmed by the user.
    "enigma-aerospace": {"_id": "enigma", "name": "Enigma", "founded": "2025"},
}

#: Identity corrections that ship as a rename.  When a correction changes ``_id``
#: the old value is recorded in ``previous_ids`` so the refresh can still find
#: that company's news history instead of silently dropping it.
def previous_ids(upstream_id: str, correction: dict) -> list[str]:
    new_id = correction.get("_id")
    return [upstream_id] if new_id and new_id != upstream_id else []

#: Verified official/PR feeds.  Each was fetched and confirmed to return
#: well-formed XML with dated items before being added here.  Most tracked
#: companies publish no feed at all -- coverage is deliberately partial rather
#: than guessed.
OFFICIAL_FEEDS: dict[str, list[dict]] = {
    "OpenAI": [{"url": "https://openai.com/news/rss.xml", "label": "OpenAI News", "type": "official"}],
    "Google DeepMind": [{"url": "https://deepmind.com/blog/feed/basic", "label": "DeepMind Blog", "type": "official"}],
    "Databricks": [{"url": "https://www.databricks.com/feed", "label": "Databricks Blog", "type": "official"}],
    "Snowflake": [{"url": "https://www.snowflake.com/feed/", "label": "Snowflake Blog", "type": "official"}],
    "ElevenLabs": [{"url": "https://elevenlabs.io/blog/rss.xml", "label": "ElevenLabs Blog", "type": "official"}],
    "Workato": [{"url": "https://www.workato.com/the-connector/feed/", "label": "Workato Blog", "type": "official"}],
}

#: Headline filters for companies whose feeds collect unrelated stories.
#: Google News matches loosely: a quoted generic name still returns off-topic
#: results ("Enigma" surfaced the cipher machine and a robotics competition).
#: Opt-in per company -- anything not listed here is unfiltered, so news is
#: never silently dropped for companies nobody has tuned.  Trade-off: a match
#: term costs recall, so keep it to the company's own name where possible.
MATCH_TERMS: dict[str, list[str]] = {
    "Enigma": ["enigma"],
}
EXCLUDE_TERMS: dict[str, list[str]] = {}

#: Google News queries for names that match unrelated things.
#: A bare "Snowflake" surfaced a police blotter from Snowflake, Arizona.
NEWS_QUERIES: dict[str, str] = {
    "AI21 Labs": '"AI21 Labs" OR "AI21"',
    "Cognition AI": '"Cognition AI" OR "Devin AI"',
    "Cursor / Anysphere": '"Cursor AI" OR "Anysphere"',
    "DataDog": '"Datadog"',
    "MiniMax": '"MiniMax AI"',
    "Prometheus": '"Prometheus" AI Bezos OR "Prometheus Project"',
    "Enigma": '"Enigma" robotics',
    "Snowflake": '"Snowflake" AI data cloud',
    "Microsoft Research Asia (MSRA)": '"Microsoft Research Asia"',
    "Advanced Machine Intelligence (AMI)": '"Advanced Machine Intelligence" OR "AMI Labs"',
}


def build_config(companies: list[dict], *, source: str = "data.json") -> dict:
    """Turn published records into seed records."""
    seeded = []
    for company in companies:
        correction = CORRECTIONS.get(company.get("_id"), {})
        record: dict = {}
        for field in CURATED_FIELDS:
            if field in company:
                record[field] = company[field]
            elif field == "arr_usd":
                # Keep the key present even when undisclosed: the published file
                # is more consistent for it, and the contract test checks presence.
                record[field] = None
        record.update(correction)
        carried = previous_ids(company.get("_id", ""), correction)
        if carried:
            record["previous_ids"] = carried

        funding = {
            key: value
            for key, value in (company.get("funding") or {}).items()
            if not key.startswith("_")
        }
        record["funding"] = funding
        record["is_public"] = is_public(company)

        if record["name"] in NEWS_QUERIES:
            record["news_query"] = NEWS_QUERIES[record["name"]]
        if record["name"] in MATCH_TERMS:
            record["match_terms"] = MATCH_TERMS[record["name"]]
        if record["name"] in EXCLUDE_TERMS:
            record["exclude_terms"] = EXCLUDE_TERMS[record["name"]]
        if record["name"] in OFFICIAL_FEEDS:
            record["feeds"] = OFFICIAL_FEEDS[record["name"]]
        seeded.append(record)

    return {
        "_meta": {
            "schema": SCHEMA_VERSION,
            "generated_from": source,
            "note": (
                "Curated facts only. latest_news is refreshed by pipeline/refresh.py "
                "and must never be edited here. previous_ids lists retired _id values "
                "so history survives a rename."
            ),
            "dropped_fields": list(DROPPED_FIELDS),
        },
        "defaults": {
            "max_news": 10,
            "news": {"hl": "en-US", "gl": "US", "ceid": "US:en"},
        },
        "companies": seeded,
    }


def write_config(config: dict, path: Path = DEFAULT_CONFIG) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_config(path: Path = DEFAULT_CONFIG) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--check", action="store_true", help="fail if the seed would change")
    args = parser.parse_args(argv)

    data = json.loads(args.data.read_text(encoding="utf-8"))
    config = build_config(data, source=args.data.name)

    if args.check:
        current = args.config.read_text(encoding="utf-8")
        candidate = json.dumps(config, indent=2, ensure_ascii=False) + "\n"
        if current != candidate:
            print(f"seed out of date: {args.config}", file=sys.stderr)
            return 1
        print(f"seed up to date: {args.config}")
        return 0

    write_config(config, args.config)
    print(f"wrote {args.config} ({len(config['companies'])} companies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
