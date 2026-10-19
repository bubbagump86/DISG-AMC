/**
 * Browser smoke test for the dashboard.
 *
 * Runs the page's own JavaScript against a DOM shim (no browser, no jsdom --
 * the npm registry is unreachable in this environment) and asserts that the
 * render pipeline and the hash router both work.
 *
 * The strongest assertion is "no console errors": every render is routed
 * through the app's `safeCall` helper, which swallows failures into
 * `console.error`. A silently broken render therefore fails this test.
 *
 * The shim models `location.hash` and `hashchange`, so the company route is
 * exercised for real rather than assumed.
 *
 * Usage:  node tests/web/smoke.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createDom } from './dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const INDEX = path.join(ROOT, 'index.html');

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
  const dataset = JSON.parse(readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const expected = dataset.length;

  const script = findAppScript(html);
  const dom = createDom({ width: 1440 });
  const fetchImpl = makeFetch(dom.fetchCalls);
  Object.assign(globalThis, globalsFor(dom, fetchImpl));

  out('# dashboard smoke test');
  out(`# app script: ${script.kind}${script.src ? ` (${script.src})` : ''}`);

  if (script.kind === 'module') {
    await import(pathToFileURL(path.resolve(ROOT, script.src)).href);
    await sleep(250);
  } else {
    vm.runInContext(script.code, vm.createContext(globalsFor(dom, fetchImpl)), {
      filename: 'index-inline.js',
    });
    await sleep(250);
  }

  const el = (id) => dom.document.getElementById(id);
  const dashboard = el('dashboard-view');
  const profile = el('profile-view');

  // ---- the page fetched its data -------------------------------------------
  check('data.json was fetched', dom.fetchCalls.some((url) => url.includes('data.json')),
    `calls: ${dom.fetchCalls.join(', ') || 'none'}`);
  check('stats.json was fetched', dom.fetchCalls.some((url) => url.includes('stats.json')),
    `calls: ${dom.fetchCalls.join(', ') || 'none'}`);

  // ---- the dashboard view rendered -----------------------------------------
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
  };
  const rendered = {};
  for (const [label, id] of Object.entries(containers)) {
    rendered[label] = el(id).innerHTML;
    check(`${label} rendered content`, rendered[label].trim().length > 0, `#${id} is empty`);
  }
  check('last-updated was stamped', el('last-updated').textContent.trim().length > 0);

  // ---- the two views start in the right state ------------------------------
  check('dashboard is visible on load', dashboard.hidden !== true);
  check('profile view starts hidden and empty',
    profile.hidden === true && profile.innerHTML === '');

  // ---- sidebar index --------------------------------------------------------
  const companyLinks = rendered.sidebar.match(/class="nav-item nav-company"/g) || [];
  check('sidebar lists every company', companyLinks.length === expected,
    `expected ${expected} links, found ${companyLinks.length}`);

  const groupLabels = (rendered.sidebar.match(/class="nav-group-label"/g) || []).length;
  const categoriesInData = new Set(dataset.map((c) => c.category)).size;
  check('sidebar is grouped by category', groupLabels === categoriesInData,
    `expected ${categoriesInData} groups, found ${groupLabels}`);

  const counts = [...rendered.sidebar.matchAll(/class="nav-count">(\d+)</g)].map((m) => Number(m[1]));
  check('group counts add up to every company',
    counts.reduce((a, b) => a + b, 0) === expected,
    `counts sum to ${counts.reduce((a, b) => a + b, 0)}`);

  check('company links are anchors with a route', rendered.sidebar.includes('href="#co-'));
  check('a known company appears in the sidebar', rendered.sidebar.includes('Anthropic'));

  // ---- content is real, not merely non-empty -------------------------------
  const tableRows = (rendered.table.match(/<tr\b/g) || []).length;
  check('comparison table has a row per company', tableRows >= expected,
    `expected >= ${expected} rows, found ${tableRows}`);

  const timelineItems = (rendered.timeline.match(/class="timeline-item/g) || []).length;
  check('timeline has entries', timelineItems > 0, 'no .timeline-item rendered');

  // ---- accessibility --------------------------------------------------------
  const markerTags = rendered.map.match(/<circle class="map-dot[^>]*>/g) || [];
  const covered = markerTags.filter(
    (tag) => /aria-label="/.test(tag) || /aria-hidden="true"/.test(tag),
  ).length;
  check('every map marker is labelled or marked decorative',
    markerTags.length > 0 && covered === markerTags.length,
    `${covered} of ${markerTags.length} markers covered`);

  const categoryButtons = (rendered.categories.match(/class="filter-btn/g) || []).length;
  const pressed = (rendered.categories.match(/aria-pressed="(true|false)"/g) || []).length;
  check('category filters expose aria-pressed',
    categoryButtons > 0 && pressed === categoryButtons,
    `${pressed} of ${categoryButtons} buttons`);

  check('the modal is a labelled dialog', /role="dialog"/.test(html) && /aria-modal="true"/.test(html));
  check('the search input has an accessible name', /id="company-search"[^>]*aria-label="/.test(html));
  check('the sidebar filter has an accessible name', /id="sidebar-search"[^>]*aria-label="/.test(html));
  check('a skip link is present', /class="skip-link"/.test(html));
  check('the main landmark is identified', /<main[^>]*id="main"/.test(html));

  const inlineHandlers = [...html.matchAll(/\son(?:click|change|input|submit|keydown|keyup)\s*=\s*"([^"]*)"/gi)]
    .map((match) => match[1])
    .filter((handler) => !/^location\.reload\(\)$/.test(handler.trim()));
  check('no inline event handlers in index.html', inlineHandlers.length === 0, inlineHandlers.join(', '));

  // ---- sidebar search -------------------------------------------------------
  const sidebarSearch = el('sidebar-search');
  const always = el('nav-companies').innerHTML;
  sidebarSearch.value = 'anthropic';
  sidebarSearch.dispatch('input');
  const filtered = el('nav-companies').innerHTML;
  const filteredLinks = (filtered.match(/class="nav-item nav-company"/g) || []).length;
  check('sidebar search narrows the list', filteredLinks === 1,
    `expected 1 match for "anthropic", found ${filteredLinks}`);
  sidebarSearch.value = '';
  sidebarSearch.dispatch('input');
  check('clearing the search restores the list', el('nav-companies').innerHTML === always);

  // ---- routing: company profile --------------------------------------------
  const anthropic = dataset.find((c) => c.name === 'Anthropic');
  dom.location.hash = `#co-${anthropic._id}`;
  const profileHtml = el('profile-view').innerHTML;
  check('navigating to a company renders the profile view',
    el('profile-view').hidden === false && profileHtml.length > 0,
    'profile view did not render');
  check('the profile shows that company', profileHtml.includes(anthropic.name));
  check('the profile has its own h1', /<h1[^>]*>Anthropic<\/h1>/.test(profileHtml));
  check('the dashboard is hidden while viewing a profile', el('dashboard-view').hidden === true);
  check('the document title follows the route',
    dom.document.title.startsWith('Anthropic'), `title is "${dom.document.title}"`);
  check('the profile links back to the dashboard', /class="back-link"[^>]*href="#top"/.test(profileHtml));
  check('the profile renders the company news', profileHtml.includes('timeline-item'));

  const activeLink = el('nav-companies').innerHTML;
  check('the sidebar marks the active company', activeLink.includes('nav-company active'));

  // ---- routing: back to the dashboard --------------------------------------
  dom.location.hash = '#top';
  check('returning to #top shows the dashboard again',
    el('dashboard-view').hidden === false && el('profile-view').hidden === true);
  check('the document title is restored',
    dom.document.title.startsWith('AI Intel Dashboard'), `title is "${dom.document.title}"`);

  // ---- routing: unknown slug degrades, not crashes -------------------------
  dom.location.hash = '#co-not-a-real-company';
  check('an unknown company slug falls back to the dashboard',
    el('dashboard-view').hidden === false && el('profile-view').hidden === true);

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
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    out(`\nSMOKE TEST CRASHED: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  });
