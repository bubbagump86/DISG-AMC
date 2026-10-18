# AI Intel Dashboard

Strategic intelligence on 40 of the most important AI companies in 2026.

Static site: `index.html` + `assets/` + `data.json` + `stats.json`, served over
GitHub Pages. No build step, no bundler, no framework, no CDN, and **no
third-party dependencies** -- neither Python nor JS.

## Repo status

This repo (`DISG-AMC`) is the working rebuild of the original
[`ai-dashboard`](https://github.com/bubbagump86/ai-dashboard), which stays as-is
as a permanent URL.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Golden fixtures + dataset contract suite | done |
| 1 | Rebuild the `refresh.py` pipeline | **done** |
| 2 | Split the 2792-line `index.html` into ES modules | **done** |
| 3 | GitHub Actions cron + enable Pages | **code done, Pages needs enabling** |

Two things were missing from the original and have been replaced here: the daily
generator (which lived in a private workspace and is in neither repo) and the
monolithic `index.html`.

## Layout

```
index.html                    markup only (196 lines, down from 2792)
assets/css/app.css            styles
assets/js/                    ES modules, loaded natively (no bundler)
  app.js                      entry point: theme/chrome wiring, init, bootstrap
  state.js                    shared mutable state
  data.js                     data.json / stats.json loading + aggregate fallback
  format.js                   formatting, escaping, summary suppression
  ui.js                       scrolling, sidebar, skip-to-content, key-stats row
  table.js                    filters, sorting, comparison table
  charts.js                   SVG bar charts and the donut
  map.js                      Robinson projection, markers, zoom, fan-out
  timeline.js                 recent developments
  detail.js                   company sections and the modal
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
  web/
    dom.mjs                   minimal DOM shim (no jsdom available here)
    smoke.mjs                 runs the page's own JS and asserts it rendered
    unit.mjs                  unit tests for the pure modules
package.json                  type: module, so Node can run the ES modules
                              under test. No dependencies.
```

`data.json` / `stats.json` stay at the repo root: that is the path the live page
already fetches, so the deployed original and this rebuild behave identically.
(The earlier plan to move them under `data/` was dropped as pure churn -- the
Python tests still resolve either location, so the move remains cheap later.)

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
python -m pipeline.refresh --only Enigma --reset-news   # rebuild one company's news
python -m pipeline.seed --check                  # verify the seed is in sync
```

Behaviour worth knowing:

- **News** is merged with existing history (never replaced), deduplicated across
  feeds by canonical URL *and* normalized headline, sorted newest-first and
  capped at 10. Merging is what repaired the out-of-order history.
- **Feeds**: a Google News query per company plus verified official/PR feeds
  (OpenAI, Google DeepMind, Databricks, Snowflake, ElevenLabs, Workato). Most
  tracked companies publish no feed; coverage is deliberately partial rather
  than guessed.
- **Relevance is opt-in per company.** Google News honours a query loosely, so
  `MATCH_TERMS` / `EXCLUDE_TERMS` in `pipeline/seed.py` pin down the companies
  that need it (currently Enigma). Companies without terms are unfiltered, so
  nothing is silently dropped for a company nobody has tuned. A match term
  costs recall — keep it to the company's own name.
- **Funding candidates are detected and queued, never written by default.**
  `--apply-funding` opts in, and even then only high-confidence priced rounds
  (Seed / Series A-K) apply — and at most one per company per run.
- **`--only` refreshes a subset; it never publishes a subset.** Companies outside
  the selection are carried through untouched, so a partial run cannot shrink
  `data.json` (a regression test covers this).
- **`--reset-news`** ignores stored history for the selected companies, for use
  after changing a news query.
- **Renames keep their archive.** A correction that changes `_id` records the old
  value in `previous_ids`, and the refresh follows it instead of silently
  starting that company's news from scratch.
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
python -m unittest discover -s tests -v     # 154 tests (data + pipeline)
npm test                                    # 19 unit + 29 smoke (browser code)
pytest tests -v                             # also works, if installed
```

Expected result: **OK** from each.

| Suite | Guards |
| --- | --- |
| `test_contract` | Published shape, `stats.json` == recompute from `data.json`, golden-snapshot identity, retired fields absent |
| `test_rss` | RSS 2.0 / Atom / RDF, date normalization, HTML stripping, malformed input |
| `test_sources` | URL building, cross-source dedupe, history merge, cap, future-dated rejection |
| `test_stats` | Aggregate rules, public vs private, disclosure counts |
| `test_funding` | Amount/round/valuation parsing, speculation rejection, churn threshold, guard rails |
| `test_refresh` | End-to-end offline runs, idempotency, `--check`/`--dry-run`, curated data safety |
| `unit.mjs` | Formatters, escaping, summary suppression, aggregate rules, map projection |
| `smoke.mjs` | Runs the real modules against a DOM shim: data fetched, every render produced content, a row per company, accessibility attributes present, and **no swallowed console errors** |

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

## Defects fixed in Phase 2

- The inline `onclick` handlers stopped working the moment the script became a
  module (module scope is not global scope). Rewired in JS, with a smoke check
  that fails if markup reintroduces one.
- `PUBLIC_COMPANIES` was a hardcoded set of four names in the browser, carrying a
  comment telling the reader to keep it in sync with `build/compute_stats.py` by
  hand. Removed: the browser now reads `is_public` from the data.
- Every news summary was printed twice. Google News supplies only
  "headline + publisher" as its description, and the old data duplicated the
  headline outright; redundant summaries are now suppressed.
- `escapeHtml(0)` returned an empty string, because the guard was
  `String(s || '')` and `0` is falsy.
- Accessibility: the map's SVG markers were mouse-only (now focusable, labelled,
  and activated with Enter/Space); the modal had no dialog semantics, focus
  management or focus trap; filters had no `aria-pressed`; table headers had no
  `aria-sort` or keyboard activation; the search input had no accessible name;
  and there was no skip link or `main` landmark. The 40+ per-item sidebar
  listeners were replaced with one delegated handler that also handles the
  keyboard.
- The map projection was audited rather than assumed correct: all 40 markers
  fall inside the SVG viewBox and known cities land in the right relative
  positions. Now covered by a unit test.

## Open questions

- **News relevance is poor for several companies and needs curation.** A survey
  of the published data found off-topic items in roughly 25 of 40 companies.
  Clear cases: Openmind Research Institute is collecting a Broadway actor named
  Richard Sutton; Workato is collecting generic "AI automation" listicles; xAI
  items are about Grok, and Safe Superintelligence about SSI, so a naive
  name-match flags them wrongly. The mechanism to fix this exists
  (`MATCH_TERMS` / `EXCLUDE_TERMS`), but choosing terms per company needs
  judgement, and a crude bulk heuristic would silently drop real news. Only
  Enigma has been tuned so far.
- Google News no longer redirects to the publisher, so its "canonical URL" is
  behind an obfuscated JS call. Items keep the Google permalink (which works in
  a browser) and carry the publisher's name and homepage from the feed's
  `<source>` element. Official-feed items carry true canonical links.

## CI and deployment

Two workflows, both in `.github/workflows/`:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `refresh.yml` | daily 06:17 UTC, or manual dispatch | refreshes the data, validates it, commits only if it changed |
| `tests.yml` | push to `main`, pull requests | runs all three suites |

`refresh.yml` validates *before* committing: it regenerates the data, then runs
the Python contract suite and both JS suites against the **regenerated** files. A
refresh that produces data the page cannot render fails the job, and the commit
step never runs. The funding review queue is uploaded as a run artifact (it is
gitignored, so this is how a human sees it).

Neither workflow installs anything: the pipeline is stdlib Python and the JS has
no dependencies. `actions/setup-python` and the runner's own Node are enough.

### Enabling Pages

The repo is not published yet. `https://bubbagump86.github.io/DISG-AMC/` returns
404 until Pages is switched on:

1. Repo **Settings → Pages**
2. **Source**: *Deploy from a branch*
3. **Branch**: `main`, folder `/ (root)` → **Save**

Redeploy takes about a minute. `.nojekyll` is committed so Pages serves the files
verbatim instead of running them through Jekyll.

Once live, the daily loop is: Actions refreshes `data.json` → commits → Pages
redeploys in ~30s → readers see new data on their next page load. No HTML
rebuild, no CDN redeploy, no URL change.

### Linting the workflows

Workflows only run in CI, so a mistake costs a failed run to discover:

```bash
npm run lint:workflows
```

Checks the YAML parses, job/step shape, version-pinned actions, that the refresh
workflow keeps its cron and `contents: write`, that every referenced path exists,
and that each inline shell snippet is valid bash. It needs a YAML parser and
reports a clear skip if none is installed (this environment has no pyyaml or
js-yaml; it falls back to a copy vendored inside a globally installed npm
package when one is present).
