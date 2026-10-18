# AI Intel Dashboard

Strategic intelligence on 40 of the most important AI companies in 2026.

Static site: `index.html` + `data.json` + `stats.json`, served over GitHub Pages.
No build step, no framework, no CDN.

## Repo status

This repo (`DISG-AMC`) is the **working rebuild** of the original
[`ai-dashboard`](https://github.com/bubbagump86/ai-dashboard), which stays as-is
as a permanent URL.

Two things were missing from the original and are being replaced here:

- **`refresh.py`** -- the daily generator is not in either repo. The original
  README pointed at a private workspace, so the pipeline (RSS pull, funding
  detection, `stats.json` recompute) has to be rebuilt from the data's shape
  and behaviour.
- **`index.html`** -- a 2792-line monolith (inline CSS + vanilla JS + hand-rolled
  SVG charts + an inlined world-map SVG), to be split into build-free ES modules.

## Layout

```
index.html                  served page (fetches ./data.json, ./stats.json)
data.json                   published dataset -- 40 companies
stats.json                  precomputed aggregates (sidecar; JS can recompute)
tests/
  test_contract.py          shape, consistency and snapshot tests
  fixtures/
    data.snapshot.json      frozen dataset, as taken over
    stats.snapshot.json
```

Files sit at the repo root because the live page fetches `./data.json`. The
planned Phase 2 layout moves them under `data/`; the tests already resolve both
locations.

## Tests

Stdlib only -- no dependencies to install:

```bash
python -m unittest discover -s tests -v     # stdlib
pytest tests -v                             # also works, if installed
```

Expected result: **OK (expected failures=5)**.

What the suite guards:

| Layer | Purpose |
| --- | --- |
| `DatasetShapeContract` | Types, required/optional keys, ranges, encodings for every field `index.html` reads |
| `StatsShapeContract` | Every aggregate `renderStats()` consumes |
| `StatsMatchesDataContract` | `stats.json` must equal a fresh recompute from `data.json` -- the drift guard |
| `GoldenSnapshotContract` | Company set, category vocabulary and id mapping cannot change silently |
| `KnownIssues` | Defects recorded at takeover, marked `@expectedFailure` |

`KnownIssues` tests fail today on purpose. When the pipeline fixes one it turns
into an *unexpected success*, which is the signal to remove the marker and
promote the assertion into the contract.

## Known defects (from the takeover audit)

- **`latest_news` is unsorted for 29/40 companies.** The global timeline sorts
  before rendering, but per-company detail sections and the modal render stored
  order, so the newest headline can appear mid-list.
- **`"A21 Labs"`** should be **AI21 Labs** (website `ai21.com`, intro text says AI21).
- **`_refresh_note` is vestigial** -- stamped on 1/40 companies and read nowhere.
- **`xAI` omits the `arr_usd` key** entirely; the other 39 carry it (`null` = undisclosed).
- **`Enigma AI Labs` has `founded: "2025-01"`** rather than a year.
- **349/360 news `source` values are Google News RSS redirect URLs**, not canonical
  article links, so they rot.

## Update workflow (target, Phase 3)

1. `pipeline/refresh.py` pulls news from Google News RSS **plus per-company
   official blogs/PR feeds**
2. funding detection -- numeric fields auto-apply, prose `source_note` goes to a
   review queue
3. writes `data.json` + `stats.json`; exits without committing if nothing changed
4. GitHub Actions runs it daily; `git push` -> Pages redeploys in ~30s

No HTML rebuild, no CDN redeploy, no URL change.
