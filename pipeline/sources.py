"""Collecting news items for a company from one or more feeds.

Responsibilities: turn a company's feed configuration into live items, merge
them with the history already in ``data.json``, and hand back a deduplicated,
newest-first, capped list.

Merging (rather than replacing) is deliberate: it preserves the archive that
upstream accumulated, and it is what makes the sort fix safe -- we re-sort the
whole merged list, so out-of-order history is repaired on the next run.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .httpio import FetchError, Fetcher
from .rss import FeedParseError, FeedItem, parse, strip_html

GOOGLE_NEWS_TEMPLATE = "https://news.google.com/rss/search?q={query}&hl={hl}&gl={gl}&ceid={ceid}"

DEFAULT_QUERY_SETTINGS = {"hl": "en-US", "gl": "US", "ceid": "US:en"}
DEFAULT_MAX_NEWS = 10

#: Item types, best first.  An official/PR item carries the publisher's own
#: canonical URL, so it wins a dedupe against a Google News redirect.
_TYPE_RANK = {"official": 0, "press": 1, "news": 2}

#: Query-string keys that never identify an article.
TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "oc", "hl", "gl", "ceid", "gclid", "fbclid", "mc_cid", "mc_eid", "ref",
}

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class FeedSpec:
    url: str
    label: str
    type: str = "news"


def google_news_url(query: str, settings: dict | None = None) -> str:
    merged = {**DEFAULT_QUERY_SETTINGS, **(settings or {})}
    return GOOGLE_NEWS_TEMPLATE.format(
        query=_url_quote(query),
        hl=merged["hl"],
        gl=merged["gl"],
        ceid=_url_quote(merged["ceid"]),
    )


def _url_quote(value: str) -> str:
    from urllib.parse import quote_plus

    return quote_plus(value)


def feeds_for(company: dict, defaults: dict | None = None) -> list[FeedSpec]:
    """Feed list for a company: explicit ``feeds`` plus a Google News query.

    ``news_query`` overrides the query string; it defaults to the quoted company
    name.  Ambiguous names lean on this (see ``seed.py``).
    """
    specs: list[FeedSpec] = []
    for entry in company.get("feeds") or []:
        if isinstance(entry, str):
            specs.append(FeedSpec(url=entry, label="feed", type="official"))
        elif entry.get("url"):
            specs.append(
                FeedSpec(
                    url=entry["url"],
                    label=entry.get("label") or "feed",
                    type=entry.get("type") or "official",
                )
            )
    query = company.get("news_query") or f'"{company["name"]}"'
    settings = {**(defaults or {}).get("news", {}), **(company.get("news_settings") or {})}
    specs.append(FeedSpec(url=google_news_url(query, settings), label="Google News", type="news"))
    return specs


def canonical_url(url: str) -> str:
    """Strip tracking parameters so the same article dedupes across feeds."""
    if not url:
        return ""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMS
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), ""))


def normalize_title(headline: str) -> str:
    """Lowercase, drop the trailing " - Publisher", and strip punctuation.

    Feed titles routinely carry a publisher suffix that the publisher's own feed
    omits, which would otherwise defeat cross-source dedupe.
    """
    text = (headline or "").strip()
    if " - " in text:
        head, _, tail = text.rpartition(" - ")
        if head and len(tail) <= 40:
            text = head
    return _NON_ALNUM_RE.sub(" ", text.lower()).strip()


def dedupe_keys(item: dict) -> tuple[str, ...]:
    """Every identity a news item can be recognised by.

    Google News hands out a different redirect per query for the same story, so
    its URLs are useless for identity and the headline is used instead.  A real
    publisher URL is also included, so a re-titled article still dedupes.
    """
    keys: list[str] = []
    link = canonical_url(item.get("source") or "")
    if link and "news.google.com/rss/articles/" not in link:
        keys.append(f"url:{link.lower()}")
    title = normalize_title(item.get("headline") or "")
    if title:
        keys.append(f"title:{title}")
    return tuple(keys)


def dedupe_key(item: dict) -> str:
    """Primary identity of a news item (first of ``dedupe_keys``)."""
    keys = dedupe_keys(item)
    return keys[0] if keys else ""


def item_from_feed(feed_item: FeedItem, spec: FeedSpec) -> dict | None:
    """Convert a parsed feed entry to the stored news-item shape."""
    if not feed_item.published:
        return None
    headline = strip_html(feed_item.title)
    if not headline:
        return None
    summary = strip_html(feed_item.summary) or headline
    return {
        "date": feed_item.published,
        "headline": headline,
        "summary": summary,
        "source": feed_item.link or "",
        "source_name": feed_item.publisher or spec.label,
        "source_url": feed_item.publisher_url or "",
        "feed": spec.label,
    }


def collect(
    company: dict,
    fetcher: Fetcher,
    *,
    defaults: dict | None = None,
    log=None,
) -> list[dict]:
    """Fetch and parse every configured feed for ``company``."""
    collected: list[dict] = []
    for spec in feeds_for(company, defaults):
        try:
            body = fetcher.get(spec.url)
        except FetchError as exc:
            _log(log, f"  ! {company['name']}: fetch failed for {spec.label}: {exc}")
            continue
        try:
            entries = parse(body)
        except FeedParseError as exc:
            _log(log, f"  ! {company['name']}: unparsable feed {spec.label}: {exc}")
            continue
        kept = 0
        for entry in entries:
            item = item_from_feed(entry, spec)
            if item:
                item["_type"] = spec.type
                collected.append(item)
                kept += 1
        _log(log, f"  . {company['name']}: {spec.label} -> {kept} items")
    return collected


def publisher_from_title(headline: str) -> str:
    """Recover a publisher from a headline's trailing " - Publisher".

    History carried over from the original file has no publisher metadata; the
    Google News convention of suffixing the outlet is the only source left.
    """
    text = (headline or "").strip()
    if " - " in text:
        _head, _, tail = text.rpartition(" - ")
        if tail and len(tail) <= 40:
            return tail.strip()
    return ""


def normalize_item(item: dict) -> dict:
    """Guarantee the published news-item shape for any item, new or historical."""
    out = {key: value for key, value in item.items() if not key.startswith("_")}
    out.setdefault("source_name", "")
    out.setdefault("source_url", "")
    out.setdefault("feed", "")
    if not out["source_name"]:
        out["source_name"] = publisher_from_title(out.get("headline", ""))
    if not out["feed"]:
        out["feed"] = "Google News" if "news.google.com" in (out.get("source") or "") else "archive"
    return out


def merge(
    existing: list[dict],
    incoming: list[dict],
    *,
    max_news: int = DEFAULT_MAX_NEWS,
    today: date | None = None,
) -> list[dict]:
    """Union of history and fresh items: deduped, newest first, capped.

    Items are matched on *any* shared identity (canonical URL or normalized
    headline), so the same story arriving from Google News and from the
    publisher's own feed collapses to one entry -- the better-ranked one.
    """
    today = today or date.today()
    horizon = today + timedelta(days=1)  # tolerate timezone skew on "today's" news

    candidates: list[tuple[tuple[str, ...], dict, int]] = []
    for item in [*incoming, *existing]:
        published = item.get("date")
        if not published:
            continue
        try:
            when = date.fromisoformat(published)
        except ValueError:
            continue
        if when > horizon:
            continue
        keys = dedupe_keys(item)
        if not keys:
            continue
        cleaned = normalize_item(item)
        candidates.append((keys, cleaned, _rank(item)))

    if not candidates:
        return []

    # Union-find: an item sharing any key with an earlier one joins that group.
    parent = list(range(len(candidates)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    seen: dict[str, int] = {}
    for index, (keys, _, _) in enumerate(candidates):
        for key in keys:
            if key in seen:
                root_a, root_b = find(index), find(seen[key])
                if root_a != root_b:
                    parent[max(root_a, root_b)] = min(root_a, root_b)
            else:
                seen[key] = index

    groups: dict[int, tuple[int, dict]] = {}
    for index, (_, item, rank) in enumerate(candidates):
        root = find(index)
        current = groups.get(root)
        if current is None or rank < current[0]:
            groups[root] = (rank, item)

    ordered = sorted(
        (item for _, item in groups.values()),
        key=lambda item: item.get("date") or "",
        reverse=True,
    )
    return ordered[:max_news]


def _rank(item: dict) -> int:
    return _TYPE_RANK.get(item.get("_type") or "news", 2)


def _log(log, message: str) -> None:
    if log is not None:
        log(message)
