"""Refresh ``data.json`` and ``stats.json`` from the curated seed plus live feeds.

Design contract:

* curated facts come **only** from ``pipeline/config/companies.json`` -- a bad
  run can never corrupt a company's copy, funding baseline or coordinates;
* the only field rewritten is ``latest_news`` (merged with history, deduped,
  newest-first, capped);
* funding candidates are only *detected* and queued.  Auto-applying the numbers
  is opt-in via ``--apply-funding`` because regex extraction over hand-curated
  data produced confidently-wrong edits in testing;
* writes are atomic, and a run that changes nothing writes nothing.

Examples::

    python -m pipeline.refresh                      # live run, writes files
    python -m pipeline.refresh --dry-run            # fetch + report, write nothing
    python -m pipeline.refresh --check              # exit 1 if files would change
    python -m pipeline.refresh --only Anthropic     # one company
    python -m pipeline.refresh --offline            # cache only, no network
    python -m pipeline.refresh --apply-funding      # opt in to numeric auto-apply
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from . import funding as funding_mod
from . import sources, stats
from .httpio import Fetcher, FetchError, atomic_write_bytes, write_json
from .seed import DEFAULT_CONFIG, load_config

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = REPO_ROOT / "data.json"
DEFAULT_STATS = REPO_ROOT / "stats.json"
DEFAULT_CACHE = REPO_ROOT / "pipeline" / ".cache"
DEFAULT_REVIEW = REPO_ROOT / "pipeline" / "review" / "funding_queue.json"

#: Key order for the published records -- keeps diffs in the daily commits small
#: and readable, and matches the shape the original file used.
COMPANY_KEY_ORDER = (
    "name", "category", "website", "founded", "hq", "intro", "product", "funding",
    "latest_news", "sources", "confidence", "_id", "lat", "lng",
    "arr_usd", "arr_source_note",
)
_CONFIDENCE_RANK = {"high": 2, "medium": 1, "low": 0}

FUNDING_KEY_ORDER = (
    "latest_round", "amount_usd", "date", "lead_investors",
    "post_money_valuation_usd", "total_raised_usd", "source_note",
    "current_market_cap_usd",
)


@dataclass
class Report:
    companies: int = 0
    news_total: int = 0
    news_added: int = 0
    failures: list[str] = field(default_factory=list)
    funding_applied: list = field(default_factory=list)
    funding_queued: list = field(default_factory=list)
    data_changed: bool = False
    stats_changed: bool = False
    data: list = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def changed(self) -> bool:
        return self.data_changed or self.stats_changed


def ordered(record: dict, order: tuple[str, ...]) -> dict:
    """Reorder ``record`` by ``order``, appending any unexpected keys."""
    result = {key: record[key] for key in order if key in record}
    for key, value in record.items():
        if key not in result:
            result[key] = value
    return result


def _log(log, message: str) -> None:
    if log is not None:
        log(message)


def _find_history(history: dict, seed: dict) -> dict:
    """The published record this seed continues, following renames.

    ``previous_ids`` carries retired ``_id`` values, so a company that was
    renamed keeps its news archive instead of starting from scratch.
    """
    current = history.get(seed.get("_id"))
    if current is not None:
        return current
    for old_id in seed.get("previous_ids") or []:
        found = history.get(old_id)
        if found is not None:
            return found
    return {}


def build_record(seed: dict, news: list[dict]) -> dict:
    """Assemble one published record: curated facts + refreshed news."""
    internal = {"feeds", "news_query", "news_settings", "previous_ids",
                "match_terms", "exclude_terms"}
    record = {key: value for key, value in seed.items() if key not in internal}
    record["latest_news"] = news
    if isinstance(record.get("funding"), dict):
        record["funding"] = ordered(record["funding"], FUNDING_KEY_ORDER)
    return ordered(record, COMPANY_KEY_ORDER)


def render(records: list[dict]) -> str:
    return json.dumps(records, indent=2, ensure_ascii=False) + "\n"


def _normalize(text: str) -> str:
    """Ignore CRLF/LF differences when deciding whether a file changed."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def run(
    config: dict,
    *,
    existing_data: list[dict] | None = None,
    fetcher: Fetcher | None = None,
    only: list[str] | None = None,
    max_news: int | None = None,
    detect_funding: bool = True,
    apply_funding: bool = False,
    reset_news: bool = False,
    log=None,
) -> Report:
    """Fetch, merge and assemble.  Pure with respect to the filesystem.

    ``only`` restricts which companies are *refreshed* -- it never restricts what
    is published.  Companies outside the selection keep their existing published
    record, so a partial run can never shrink ``data.json``.
    """
    report = Report()
    defaults = config.get("defaults") or {}
    default_max_news = max_news or defaults.get("max_news") or sources.DEFAULT_MAX_NEWS
    fetcher = fetcher or Fetcher()

    history = {company.get("_id"): company for company in (existing_data or [])}
    wanted = {value.lower() for value in (only or [])}

    for seed in config.get("companies", []):
        previous = _find_history(history, seed)

        selected = (
            not wanted
            or seed["_id"].lower() in wanted
            or (seed.get("name") or "").lower() in wanted
        )
        if not selected:
            # Carried through untouched: either its published record verbatim, or
            # a fresh one when there is nothing published yet.
            carried = previous if previous else build_record(seed, [])
            report.data.append(carried)
            report.news_total += len(carried.get("latest_news") or [])
            report.companies += 1
            continue

        previous_news = [] if reset_news else (previous.get("latest_news") or [])
        previous_keys = {sources.dedupe_key(item) for item in previous_news}

        try:
            collected = sources.collect(seed, fetcher, defaults=defaults, log=log)
        except Exception as exc:  # noqa: BLE001 - one bad company must not stop the run
            report.failures.append(f"{seed['name']}: {exc}")
            _log(log, f"  ! {seed['name']}: {exc}")
            collected = []

        fresh = [item for item in collected if sources.dedupe_key(item) not in previous_keys]
        merged = sources.merge(previous_news, collected, max_news=default_max_news)

        new_keys = {sources.dedupe_key(item) for item in merged} - previous_keys
        report.news_added += len(new_keys)
        report.news_total += len(merged)

        funding = dict(seed.get("funding") or {})
        if detect_funding and fresh:
            signals = funding_mod.find_signals(seed, fresh)
            applicable = []
            for signal in signals:
                should_apply, reason = funding_mod.decide(signal, funding)
                signal.decision = reason
                if should_apply:
                    applicable.append(signal)
                else:
                    report.funding_queued.append(signal)

            if applicable and apply_funding:
                # At most one change per company per run: a company with two
                # detected rounds must not have both written in one pass.
                best = max(applicable, key=lambda s: (_CONFIDENCE_RANK.get(s.confidence, 0), s.date or ""))
                funding = funding_mod.apply_signal(funding, best)
                best.applied = True
                report.funding_applied.append(best)
                applicable.remove(best)

            # Everything not applied is queued, including lower-ranked candidates
            # that were auto-applyable but lost to a better one.
            report.funding_queued.extend(applicable)

            for signal in signals:
                _log(log, f"  $ {seed['name']}: {signal.decision} ({signal.confidence})")

        record = build_record({**seed, "funding": funding}, merged)
        report.data.append(record)
        report.companies += 1

    report.stats = stats.build(report.data)
    return report


def write_outputs(
    report: Report,
    *,
    data_path: Path = DEFAULT_DATA,
    stats_path: Path = DEFAULT_STATS,
    review_path: Path | None = DEFAULT_REVIEW,
    dry_run: bool = False,
) -> None:
    """Write the published files, plus the funding review queue."""
    if report.funding_queued or report.funding_applied:
        if review_path is not None and not dry_run:
            funding_mod.write_queue(review_path, report.funding_queued + report.funding_applied)
    if dry_run:
        return
    data_text = render(report.data)
    if _normalize(_read_text(data_path)) != _normalize(data_text):
        atomic_write_bytes(data_path, data_text.encode("utf-8"))
    if report.stats_changed:
        write_json(stats_path, report.stats)


def _stats_body(stats: dict) -> dict:
    """Stats without the heartbeat, for change detection.

    ``last_updated`` moves on every run by definition, so including it would make
    every run look like a change and defeat the no-op exit.
    """
    return {key: value for key, value in stats.items() if key != "last_updated"}


def detect_changes(
    report: Report,
    *,
    data_path: Path = DEFAULT_DATA,
    stats_path: Path = DEFAULT_STATS,
) -> Report:
    report.data_changed = _normalize(_read_text(data_path)) != _normalize(render(report.data))
    existing_stats = _read_text(stats_path)
    if not existing_stats.strip():
        report.stats_changed = True
    else:
        try:
            report.stats_changed = _stats_body(json.loads(existing_stats)) != _stats_body(report.stats)
        except json.JSONDecodeError:
            report.stats_changed = True
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--stats", type=Path, default=DEFAULT_STATS)
    parser.add_argument("--review", type=Path, default=DEFAULT_REVIEW)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--only", action="append", default=[], metavar="COMPANY",
                        help="restrict to one company (name or _id); repeatable")
    parser.add_argument("--limit", type=int, help="refresh at most N companies (the rest are carried through)")
    parser.add_argument("--max-news", type=int, help="news items kept per company")
    parser.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    parser.add_argument("--check", action="store_true", help="exit 1 if the published files would change")
    parser.add_argument("--reset-news", action="store_true",
                        help="ignore stored news history for the selected companies "
                             "(use after changing a news query)")
    parser.add_argument("--offline", action="store_true", help="serve feeds from the cache; never touch the network")
    parser.add_argument("--no-cache", action="store_true", help="ignore and do not write the fetch cache")
    parser.add_argument("--no-funding", action="store_true", help="skip funding detection")
    parser.add_argument("--apply-funding", action="store_true",
                        help="opt in to auto-applying high-confidence round numbers "
                             "(off by default: every candidate is queued for review)")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    def log(message: str) -> None:
        if not args.quiet:
            print(message, file=sys.stderr)

    config = load_config(args.config)
    companies = config.get("companies", [])
    only = list(args.only)
    if args.limit:
        # Selection, not truncation: the published file must stay complete.
        only = only or [company["_id"] for company in companies[: args.limit]]
    if args.reset_news and not only:
        only = []  # reset every company

    fetcher = Fetcher(
        cache_dir=None if args.no_cache else args.cache_dir,
        offline=args.offline,
    )

    existing_path = args.data
    existing = json.loads(existing_path.read_text(encoding="utf-8")) if existing_path.exists() else []

    log(f"refreshing {len(companies)} companies"
        + (" (offline)" if args.offline else "")
        + (f" [only: {', '.join(only)}]" if only else "")
        + (" [reset-news]" if args.reset_news else ""))
    report = run(
        config,
        existing_data=existing,
        fetcher=fetcher,
        only=only or None,
        max_news=args.max_news,
        detect_funding=not args.no_funding,
        apply_funding=args.apply_funding,
        reset_news=args.reset_news,
        log=log if args.verbose else None,
    )
    report = detect_changes(report, data_path=args.data, stats_path=args.stats)

    summary = (
        f"companies={report.companies} news={report.news_total} "
        f"(+{report.news_added}) funding_applied={len(report.funding_applied)} "
        f"queued={len(report.funding_queued)} failures={len(report.failures)} "
        f"data={'changed' if report.data_changed else 'same'} "
        f"stats={'changed' if report.stats_changed else 'same'}"
    )
    log(summary)
    if fetcher.stats["network"] or fetcher.stats["cache_hit"]:
        stats_line = fetcher.stats
        log(f"fetches: network={stats_line['network']} cache_hit={stats_line['cache_hit']} errors={stats_line['error']}")
    for failure in report.failures:
        log(f"  ! {failure}")

    if args.check:
        return 1 if report.changed else 0
    write_outputs(report, data_path=args.data, stats_path=args.stats,
                  review_path=args.review, dry_run=args.dry_run)
    if args.dry_run:
        log("dry run: nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
