/**
 * Unit tests for the dashboard's pure modules.
 *
 * These import the real modules directly (no DOM needed), so they are fast and
 * catch logic regressions that the smoke test -- which only checks that things
 * rendered -- would miss.
 *
 * Usage: node tests/web/unit.mjs
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  displaySummary,
  escapeAttr,
  escapeHtml,
  fmtDate,
  fmtDateShort,
  fmtMonth,
  fmtUSD,
  summaryHtml,
} from '../../assets/js/format.js';
import { computeStatsFromCompanies } from '../../assets/js/data.js';
import { latLngToSVG } from '../../assets/js/map.js';
import { state } from '../../assets/js/state.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`  FAIL ${name}\n        ${error.message.split('\n')[0]}`);
  }
}

const eq = (actual, expected, label = '') =>
  assert.equal(actual, expected, `${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ---- escaping --------------------------------------------------------------

test('escapeHtml escapes the dangerous five', () => {
  eq(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('escapeHtml tolerates null and undefined', () => {
  eq(escapeHtml(null), '');
  eq(escapeHtml(undefined), '');
  eq(escapeHtml(0), '0');
});

test('escapeAttr strips quotes and angle brackets', () => {
  eq(escapeAttr('"><script>'), 'script');
});

// ---- money -----------------------------------------------------------------

test('fmtUSD uses sensible magnitudes', () => {
  eq(fmtUSD(2_860_260_000_000), '$2.86T');
  eq(fmtUSD(240_481_600_000), '$240.5B');
  eq(fmtUSD(150_000_000), '$150M');
  eq(fmtUSD(9_500), '$10K');
});

test('fmtUSD renders undisclosed as an em dash', () => {
  eq(fmtUSD(null), '—');
  eq(fmtUSD(undefined), '—');
});

// ---- dates -----------------------------------------------------------------

test('fmtDate handles iso, missing and invalid input', () => {
  eq(fmtDate('2026-10-17'), 'Oct 17, 2026');
  eq(fmtDate(null), '—');
  eq(fmtDate('not-a-date'), 'not-a-date');
});

test('fmtDateShort and fmtMonth', () => {
  eq(fmtDateShort('2026-10-17'), 'Oct 26');
  eq(fmtMonth('2026-10-17'), 'October 2026');
});

// ---- summary suppression ---------------------------------------------------

test('summary is dropped when it just repeats the headline', () => {
  const headline = 'Anthropic raises $500M Series B - Reuters';
  eq(displaySummary(headline, headline), '');
});

test('summary is dropped when it is the headline plus publisher', () => {
  // This is what Google News supplies as <description>.
  eq(
    displaySummary('Enigma raises $71M seed - TechCrunch', 'Enigma raises $71M seed TechCrunch'),
    '',
  );
});

test('a genuine summary is kept', () => {
  const summary = '13-month-old company. $280M+ total raised. Plans to scale to 900 employees.';
  eq(displaySummary('Wonderful raises $150M Series B at $2B valuation', summary), summary);
});

test('empty or missing summaries yield an empty string', () => {
  eq(displaySummary('Headline', ''), '');
  eq(displaySummary('Headline', null), '');
  eq(displaySummary('Headline', '   '), '');
});

test('summaryHtml omits the block entirely when redundant', () => {
  eq(summaryHtml('Same text', 'Same text'), '');
  eq(
    summaryHtml('Headline', 'A real detail about the story'),
    '<div class="timeline-summary">A real detail about the story</div>',
  );
});

test('summaryHtml escapes its content', () => {
  eq(
    summaryHtml('Headline', 'A <script> alert'),
    '<div class="timeline-summary">A &lt;script&gt; alert</div>',
  );
});

// ---- aggregates ------------------------------------------------------------

const company = (overrides) => ({
  name: 'X',
  category: 'Cat',
  is_public: false,
  arr_usd: null,
  funding: {},
  latest_news: [],
  ...overrides,
});

test('aggregates honour is_public rather than a name list', () => {
  const saved = state.companies;
  try {
    state.companies = [
      // Named like a public issuer but flagged private: the flag must win.
      company({ name: 'Snowflake', is_public: false, funding: { post_money_valuation_usd: 5_000 } }),
      company({ name: 'Nobody', is_public: true, funding: { current_market_cap_usd: 7_000 } }),
    ];
    const stats = computeStatsFromCompanies();
    eq(stats.combined_valuation.private_post_money_usd, 5_000, 'private total');
    eq(stats.combined_valuation.public_market_cap_usd, 7_000, 'public total');
    eq(stats.combined_valuation.total_usd, 12_000, 'combined total');
  } finally {
    state.companies = saved;
  }
});

test('aggregates fall back to the market cap signal when the flag is absent', () => {
  const saved = state.companies;
  try {
    // Built without the helper, which injects an explicit is_public flag.
    state.companies = [{ name: 'Legacy', category: 'Cat', funding: { current_market_cap_usd: 42 } }];
    const stats = computeStatsFromCompanies();
    eq(stats.combined_valuation.public_market_cap_usd, 42);
  } finally {
    state.companies = saved;
  }
});

test('capital raised sums lifetime funding, not the latest round', () => {
  const saved = state.companies;
  try {
    state.companies = [
      company({ funding: { total_raised_usd: 1_000, amount_usd: 10 } }),
      company({ funding: { total_raised_usd: 2_000, amount_usd: 20 } }),
    ];
    const stats = computeStatsFromCompanies();
    eq(stats.capital_raised.total_usd, 3_000);
    eq(stats.capital_raised.latest_round_total_usd, 30);
  } finally {
    state.companies = saved;
  }
});

test('undisclosed values are excluded and counted', () => {
  const saved = state.companies;
  try {
    state.companies = [
      company({ funding: { total_raised_usd: 100 }, arr_usd: 50 }),
      company({ funding: { total_raised_usd: null }, arr_usd: null }),
    ];
    const stats = computeStatsFromCompanies();
    eq(stats.capital_raised.disclosed_count, 1);
    eq(stats.capital_raised.total_count, 2);
    eq(stats.combined_arr.disclosed_count, 1);
  } finally {
    state.companies = saved;
  }
});

// ---- map projection --------------------------------------------------------

test('every tracked company projects inside the map viewBox', () => {
  const dataset = JSON.parse(readFileSync(new URL('../../data.json', import.meta.url), 'utf8'));
  const mapSource = readFileSync(new URL('../../assets/js/map.js', import.meta.url), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(mapSource.slice(mapSource.indexOf('WORLD_MAP_SVG')));
  assert.ok(viewBox, 'could not read the world map viewBox');
  const [vx, vy, vw, vh] = viewBox[1].trim().split(/\s+/).map(Number);

  const outside = [];
  for (const company of dataset) {
    const [x, y] = latLngToSVG(company.lat, company.lng);
    if (!(x >= vx && x <= vx + vw && y >= vy && y <= vy + vh)) {
      outside.push(`${company.name} -> ${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  eq(outside.join('; '), '', 'markers outside the map');
});

test('the projection places known cities in the right relative positions', () => {
  const [lonX, lonY] = latLngToSVG(51.5, -0.1);      // London
  const [sgX, sgY] = latLngToSVG(1.35, 103.8);       // Singapore
  const [sydX, sydY] = latLngToSVG(-33.9, 151.2);    // Sydney
  const [spX, spY] = latLngToSVG(-23.5, -46.6);      // Sao Paulo

  assert.ok(spX < lonX, 'Sao Paulo should be west of London');
  assert.ok(lonX < sgX && sgX < sydX, 'longitude should increase west to east');
  assert.ok(lonY < sgY, 'the southern hemisphere should sit lower');
  assert.ok(sgY < sydY, 'Sydney should be further south than Singapore');
});

// ---- report ----------------------------------------------------------------

if (failures.length) {
  process.stdout.write(failures.join('\n') + '\n');
  process.stdout.write(`\nFAILED: ${failures.length} of ${passed + failures.length} unit tests\n`);
  process.exit(1);
}
process.stdout.write(`# unit tests\n  ok   ${passed} checks passed\n`);
