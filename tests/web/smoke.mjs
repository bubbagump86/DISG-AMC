/**
 * Browser smoke test for the dashboard.
 *
 * Runs the page's own JavaScript against a DOM shim (no browser, no jsdom --
 * the npm registry is unreachable in this environment) and asserts that the
 * whole render pipeline succeeded.  This is the safety net for refactoring
 * `index.html`: it works identically before and after the page stops carrying
 * an inline script, because it discovers whichever form the page currently uses.
 *
 * The strongest assertion is "no console errors": every render is routed
 * through the app's `safeCall` helper, which swallows failures into
 * `console.error`.  A silently broken render therefore fails this test.
 *
 * Usage:  node tests/web/smoke.mjs
 * Exit:   0 on success, 1 on failure.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createDom } from './dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const INDEX = path.join(ROOT, 'index.html');

/** Harness output. Uses process.stdout directly so swapping global console (needed to
 *  capture the app's own errors) can never swallow the report. */
const out = (line = '') => process.stdout.write(`${line}\n`);

const failures = [];
const notes = [];

function check(label, condition, detail = '') {
  if (condition) notes.push(`  ok   ${label}`);
  else failures.push(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
}

/** Serve files from disk for the page's `fetch('./data.json')` calls. */
function makeFetch(fetchCalls) {
  return async (url) => {
    const requested = String(url);
    fetchCalls.push(requested);
    const clean = requested.replace(/^\.\//, '').replace(/^\/+/, '');
    for (const candidate of [path.join(ROOT, clean), path.join(ROOT, 'data', clean)]) {
      try {
        const text = readFileSync(candidate, 'utf8');
        return {
          ok: true,
          status: 200,
          url: requested,
          text: async () => text,
          json: async () => JSON.parse(text),
          headers: { get: () => null },
        };
      } catch {
        // try the next candidate
      }
    }
    throw new Error(`smoke: no local file for fetch(${requested})`);
  };
}

/** Pull the app script out of index.html, in either form. */
function findAppScript(html) {
  const moduleTag = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  if (moduleTag) return { kind: 'module', src: moduleTag[1] };
  const inline = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (inline) return { kind: 'inline', code: inline[1] };
  throw new Error('smoke: no app script found in index.html');
}

function globalsFor(dom, fetchImpl) {
  return {
    window: dom.window,
    document: dom.document,
    location: dom.location,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    matchMedia: dom.matchMedia,
    console: dom.console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    requestAnimationFrame: dom.window.requestAnimationFrame,
    cancelAnimationFrame: dom.window.cancelAnimationFrame,
    getComputedStyle: dom.window.getComputedStyle,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const html = readFileSync(INDEX, 'utf8');
  const script = findAppScript(html);
  const dom = createDom({ width: 1440 });
  const fetchImpl = makeFetch(dom.fetchCalls);

  Object.assign(globalThis, globalsFor(dom, fetchImpl));

  out('# dashboard smoke test');
  out(`# app script: ${script.kind}${script.src ? ` (${script.src})` : ''}`);

  if (script.kind === 'module') {
    await import(pathToFileURL(path.resolve(ROOT, script.src)).href);
    await sleep(200);
  } else {
    vm.runInContext(script.code, vm.createContext(globalsFor(dom, fetchImpl)), {
      filename: 'index-inline.js',
    });
    await sleep(200);
  }

  const dataset = JSON.parse(readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const expected = dataset.length;

  // ---- the page fetched its data -------------------------------------------
  check('data.json was fetched', dom.fetchCalls.some((url) => url.includes('data.json')),
    `calls: ${dom.fetchCalls.join(', ') || 'none'}`);
  check('stats.json was fetched', dom.fetchCalls.some((url) => url.includes('stats.json')),
    `calls: ${dom.fetchCalls.join(', ') || 'none'}`);

  // ---- every render produced output ----------------------------------------
  const containers = {
    stats: 'stats-row',
    sidebar: 'nav-companies',
    categories: 'company-categories',
    table: 'cmp-table',
    fundingChart: 'funding-chart',
    arrChart: 'arr-chart',
    valuationChart: 'valuation-chart',
    donut: 'donut-wrap',
    map: 'map-wrap',
    timeline: 'overview-timeline',
    details: 'company-details-list',
  };
  const rendered = {};
  for (const [label, id] of Object.entries(containers)) {
    const html = dom.document.getElementById(id).innerHTML;
    rendered[label] = html;
    check(`${label} rendered content`, html.trim().length > 0, `#${id} is empty`);
  }

  check('last-updated was stamped',
    dom.document.getElementById('last-updated').textContent.trim().length > 0);

  // ---- the content is real, not merely non-empty ---------------------------
  const sidebarAnchors = (rendered.sidebar.match(/data-anchor="co-/g) || []).length;
  check('sidebar lists every company', sidebarAnchors === expected,
    `expected ${expected} anchors, found ${sidebarAnchors}`);

  const tableRows = (rendered.table.match(/<tr\b/g) || []).length;
  check('comparison table has a row per company', tableRows >= expected,
    `expected >= ${expected} rows, found ${tableRows}`);

  const detailSections = (rendered.details.match(/class="[^"]*detail-section/g) || []).length;
  check('detail sections were built', detailSections >= expected,
    `expected >= ${expected} sections, found ${detailSections}`);

  const timelineItems = (rendered.timeline.match(/class="timeline-item/g) || []).length;
  check('timeline has entries', timelineItems > 0, 'no .timeline-item rendered');

  check('a known company appears in the sidebar', rendered.sidebar.includes('Anthropic'));

  // ---- markup hygiene -------------------------------------------------------
  // Inline handlers cannot see module scope, so markup must not rely on them.
  // `location.reload()` is the one allowed exception: it is a global.
  const inlineHandlers = [...html.matchAll(/\son(?:click|change|input|submit|keydown|keyup)\s*=\s*"([^"]*)"/gi)]
    .map((match) => match[1])
    .filter((handler) => !/^location\.reload\(\)$/.test(handler.trim()));
  check('no inline event handlers in index.html', inlineHandlers.length === 0,
    inlineHandlers.join(', '));

  // ---- nothing was swallowed ------------------------------------------------
  check('no console errors', dom.errors.length === 0, dom.errors.slice(0, 3).join(' | '));

  // ---- report ---------------------------------------------------------------
  out(notes.join('\n'));
  if (dom.warns.length) {
    out(`# warnings (${dom.warns.length}):`);
    for (const warning of dom.warns.slice(0, 5)) out(`  - ${warning}`);
  }
  if (failures.length) {
    out(failures.join('\n'));
    out(`\nFAILED: ${failures.length} check(s)`);
    return 1;
  }
  out(`\nOK: ${notes.length} checks passed`);
  return 0;
}

process.on('unhandledRejection', (reason) => {
  out(`\nUNHANDLED REJECTION: ${reason && reason.stack ? reason.stack : reason}`);
  process.exitCode = 1;
});

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    out(`\nSMOKE TEST CRASHED: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  });
