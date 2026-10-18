# AI Intel Dashboard

Strategic intelligence on 40 of the most important AI companies in 2026.

Static site: `index.html` + `data.json` + `stats.json`, served over GitHub Pages.
No build step, no framework, no CDN, **no third-party Python dependencies**.

## Repo status

This repo (`DISG-AMC`) is the working rebuild of the original
[`ai-dashboard`](https://github.com/bubbagump86/ai-dashboard), which stays as-is
as a permanent URL.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Golden fixtures + dataset contract suite | done |
| 1 | Rebuild the `refresh.py` pipeline | **done** |
| 2 | Split the 2792-line `index.html` into ES modules | not started |
| 3 | GitHub Actions cron + enable Pages | not started |

Two things were missing from the original and have been replaced here: the daily
generator (which lived in a private workspace and is in neither repo) and the
monolithic `index.html`.

## Layout

```
index.html                    served page (fetches ./data.json, ./stats.json)
data.json                     published dataset -- generated, do not hand-edit
stats.json                    published aggregates -- generated
pipeline/
  refresh.py                  CLI entry point
  seed.py                     builds the curated seed from data.json
  sources.py                  feed collection, dedupe, history merge
  rss.py                      RSS 2.0 / Atom / RDF parser
  funding.py                  funding detection + review queue
  stats.py                    aggregate rules (single source of truth)
  httpio.py                   fetch with retries and an on-disk cache
  config/companies.json       curated seed -- the only place facts are edited
  .cache/                     fetch cache (gitignored)
  review/funding_queue.json   funding candidates awaiting review (gitignored)
tests/
  test_contract.py            published-data contract, snapshot and drift guards
  test_rss.py  test_sources.py  test_stats.py  test_funding.py  test_refresh.py
  fixtures/                   frozen snapshots + captured real feeds
```

Files sit at the repo root because the live page fetches `./data.json`. Phase 2
moves them under `data/`; the tests already resolve both locations.

## The pipeline

`pipeline/config/companies.json` holds the **curated** facts (identity, copy,
funding baseline, coordinates, feed list). `pipeline/refresh.py` rewrites only
`latest_news`, merges it with history, and regenerates `stats.json`. A bad run
cannot corrupt a company's curated data.

```bash
python -m pipeline.refresh                       # live: fetch, merge, write
python -m pipeline.refresh --dry-run             # fetch and report, write nothing
python -m pipeline.refresh --check               # exit 1 if files would change
python -m pipeline.refresh --only "AI21 Labs"    # one company
python -m pipeline.refresh --offline             # cache only, never the network
python -m pipeline.refresh --apply-funding       # opt in to numeric auto-apply
python -m pipeline.seed --check                  # verify the seed is in sync
```

Behaviour worth knowing:

- **News** is merged with existing history (never replaced), deduplicated across
  feeds by canonical URL *and* normalized headline, sorted newest-first and
  capped at 10. Merging is what repaired the out-of-order history.
- **Feeds**: a Google News query per company plus verified official/PR feeds
  (OpenAI, Google DeepMind, Databricks, Snowflake, ElevenLabs, Workato). Most
  tracked companies publish no feed; coverage is deliberately partial rather
  than guessed. Queries are tuned where a bare name matches unrelated news
  (`Snowflake` was surfacing an Arizona police blotter).
- **Funding candidates are detected and queued, never written by default.**
  `--apply-funding` opts in, and even then only high-confidence priced rounds
  (Seed / Series A-K) apply — and at most one per company per run.
- **No-op runs write nothing.** Change detection ignores the `last_updated`
  heartbeat, so a run with no new information does not touch either file.
  Writes are atomic, so a reader never sees a half-written `data.json`.
- Fetching uses a polite user-agent, retries, rate limiting and a disk cache.

### Why funding auto-apply is off by default

The agreed policy was "numeric fields auto-apply, prose goes to review". Testing
against the live dataset changed the default. Regex extraction produced
*confidently wrong* edits: a headline about an Anthropic **$22 trillion IPO** was
read as a new round and overwrote the curated `Series H` label; `Series B
Funding` (stored) did not match `Series B` (detected) so a known round looked
new; one company was applied twice in a single run. Every candidate is now
queued, and `funding.py` documents the guard rails.

A signal is **high confidence** only when a round label *and* a raise-verb amount
are present from an official feed, or from two or more outlets. Hedged wording
("possible", "could", "reportedly", "targets") disqualifies the amount outright —
the rule that stops the $2T IPO case. 121 candidates were queued on the first
live run, 28 of them high or medium confidence.

## Tests

Stdlib only — nothing to install:

```bash
python -m unittest discover -s tests -v     # 146 tests
pytest tests -v                             # also works, if installed
```

Expected result: **OK**.

| Suite | Guards |
| --- | --- |
| `test_contract` | Published shape, `stats.json` == recompute from `data.json`, golden-snapshot identity, retired fields absent |
| `test_rss` | RSS 2.0 / Atom / RDF, date normalization, HTML stripping, malformed input |
| `test_sources` | URL building, cross-source dedupe, history merge, cap, future-dated rejection |
| `test_stats` | Aggregate rules, public vs private, disclosure counts |
| `test_funding` | Amount/round/valuation parsing, speculation rejection, churn threshold, guard rails |
| `test_refresh` | End-to-end offline runs, idempotency, `--check`/`--dry-run`, curated data safety |

`tests/fixtures/*.snapshot.json` freeze the published data. Any intended change
means updating the snapshot deliberately in the same commit; unexpected drift
fails the suite. `AIIDASH_DATA_DIR` points the contract suite at a candidate
build so generated output can be validated before publishing.

## Defects fixed in Phase 1

- `latest_news` was unsorted for 29/40 companies — the merge now re-sorts.
- `"A21 Labs"` → **AI21 Labs**.
- `cursor---anysphere` → `cursor-anysphere`.
- `Enigma AI Labs` had `founded: "2025-01"` → `"2025"`.
- `xAI` was missing the `arr_usd` key entirely.
- Retired `_refresh_note` (stamped on 1/40, read by nothing) and `_founders`
  (one company, never rendered).
- `PUBLIC_COMPANIES` moved out of the JavaScript into the data as `is_public`,
  so the sidecar, the browser fallback and the pipeline share one definition.
- Added `source_name` / `source_url` / `feed` to news items; history was
  backfilled from the headline's publisher suffix.

## Open questions

- `Enigma AI Labs` (website `enigma.inc`, a robotics lab) carries the `_id`
  `enigma-aerospace`. Renaming either would break existing deep links, and the
  data does not say which is authoritative — left alone deliberately. See
  `KNOWN_ID_MISMATCHES` in `pipeline/seed.py`.
- Google News no longer redirects to the publisher, so its "canonical URL" is
  behind an obfuscated JS call. Items keep the Google permalink (which works in
  a browser) and carry the publisher's name and homepage from the feed's
  `<source>` element. Official-feed items carry true canonical links.

## Update workflow (target, Phase 3)

1. GitHub Actions runs `pipeline/refresh.py` daily
2. it writes `data.json` + `stats.json` only when something actually changed
3. the funding queue is attached to the run as an artifact for review
4. `git push` → Pages redeploys in ~30s

No HTML rebuild, no CDN redeploy, no URL change.
