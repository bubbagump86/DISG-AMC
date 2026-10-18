"""Feed parsing for RSS 2.0, Atom and RDF -- no third-party dependencies.

``xml.etree`` is used with **local tag names** so namespace prefixes (or their
absence) never matter.  Feed vendors are inconsistent about which elements they
populate, so every accessor is defensive.
"""

from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

# Google News supplies no real summary -- its ``<description>`` is just an
# anchor wrapping the headline plus the publisher name.  Upstream duplicated the
# headline into ``summary``; keep that behaviour for now so the UI has no blank
# rows, and let the Phase 2 frontend refactor drop the duplication.
DUPLICATE_TITLE_AS_SUMMARY = True

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_ISO_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


@dataclass
class FeedItem:
    """One normalized feed entry."""

    title: str
    link: str
    published: str | None  # ISO 'YYYY-MM-DD'
    summary: str
    publisher: str | None = None
    publisher_url: str | None = None


class FeedParseError(ValueError):
    """The body was not a feed we can read."""


def local_name(tag: str) -> str:
    """``{http://...}entry`` -> ``entry``."""
    return tag.rsplit("}", 1)[-1]


def strip_html(value: str | None) -> str:
    """Turn feed HTML into plain text."""
    if not value:
        return ""
    text = _TAG_RE.sub(" ", value)
    text = html.unescape(text)
    text = text.replace("\u00a0", " ").replace("\u202f", " ")
    return _WS_RE.sub(" ", text).strip()


def parse_date(value: str | None) -> str | None:
    """Parse RFC 822 or ISO 8601 into an ISO ``YYYY-MM-DD`` string.

    Returns ``None`` rather than guessing: an undated item is dropped, which
    keeps the newest-first ordering meaningful.
    """
    if not value:
        return None
    raw = value.strip()
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed is not None:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).date().isoformat()
    except (TypeError, ValueError, IndexError):
        pass
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).date().isoformat()
    except ValueError:
        pass
    match = _ISO_DATE_RE.search(raw)
    return match.group(1) if match else None


# -- element accessors -------------------------------------------------------


def _text(node: ET.Element, *names: str) -> str | None:
    for name in names:
        for child in node:
            if local_name(child.tag) == name:
                if child.text and child.text.strip():
                    return child.text.strip()
                # Atom <content> may wrap XHTML; fall back to all inner text.
                inner = "".join(child.itertext()).strip()
                if inner:
                    return inner
    return None


def _atom_link(node: ET.Element) -> str | None:
    """Prefer rel=alternate, then a bare <link href>, then the first href."""
    fallback = None
    for child in node:
        if local_name(child.tag) != "link":
            continue
        href = child.get("href")
        if not href:
            continue
        rel = (child.get("rel") or "alternate").lower()
        if rel == "alternate":
            return href.strip()
        fallback = fallback or href.strip()
    return fallback


def _publisher(node: ET.Element) -> tuple[str | None, str | None]:
    """RSS ``<source url="...">Name</source>`` -> (name, url)."""
    for child in node:
        if local_name(child.tag) == "source":
            name = strip_html(child.text) or None
            return name, (child.get("url") or None)
    return None, None


def _item_date(node: ET.Element) -> str | None:
    # RSS pubDate, Atom published/updated, Dublin Core date.
    for name in ("pubDate", "published", "updated", "date"):
        value = _text(node, name)
        parsed = parse_date(value)
        if parsed:
            return parsed
    return None


# -- public API --------------------------------------------------------------


def parse(body: bytes, *, encoding: str | None = None) -> list[FeedItem]:
    """Parse a feed body into normalized items, newest first.

    Raises ``FeedParseError`` if the body is not well-formed XML -- callers log
    and skip that feed rather than aborting the run.
    """
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise FeedParseError(str(exc)) from exc

    nodes = [node for node in root.iter() if local_name(node.tag) in ("item", "entry")]
    items: list[FeedItem] = []
    for node in nodes:
        title = strip_html(_text(node, "title"))
        if not title:
            continue
        published = _item_date(node)
        if not published:
            # Undated entries are dropped: they cannot be ordered, so keeping
            # them would corrupt the newest-first guarantee.
            continue
        link = _text(node, "link") or _atom_link(node) or ""
        link = html.unescape(link.strip())
        summary = strip_html(_text(node, "description", "summary", "content", "encoded"))
        publisher, publisher_url = _publisher(node)
        if not summary and DUPLICATE_TITLE_AS_SUMMARY:
            summary = title
        items.append(
            FeedItem(
                title=title,
                link=link,
                published=published,
                summary=summary,
                publisher=publisher,
                publisher_url=publisher_url,
            )
        )
    items.sort(key=lambda item: item.published or "", reverse=True)
    return items
