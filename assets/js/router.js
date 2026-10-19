/**
 * Hash router for the two views: the dashboard and a company profile.
 *
 * Route shape is `#co-<slug>`, which is what the sidebar, table and chart rows
 * already used as an anchor. Keeping that shape means existing deep links keep
 * working while the profiles move out of the one long document and become a
 * real, shareable page.
 *
 * Anything else (`#stats`, `#table`, `#top`, or no hash) is the dashboard, so
 * the section anchors behave exactly as before.
 */

import { state } from './state.js';
import { companySlug, profileViewHtml } from './profile.js';
import { renderSidebarCompanies } from './ui.js';

const BASE_TITLE = 'AI Intel Dashboard · Strategic AI Company Tracker';
const DASHBOARD_SECTIONS = new Set(['top', 'stats', 'table', 'charts', 'map', 'timeline', 'main']);

/** `#co-anthropic` -> { view: 'company', slug: 'anthropic' } */
export function parseRoute(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const match = /^co-(.+)$/.exec(raw);
  return match ? { view: 'company', slug: match[1] } : { view: 'dashboard', anchor: raw };
}

export function companyBySlug(slug) {
  return state.companies.find(company => companySlug(company) === slug) || null;
}

/** Navigate to a company's profile page. */
export function navigateToCompany(company) {
  const target = `#${'co-' + companySlug(company)}`;
  if (window.location.hash === target) {
    applyRoute({ announce: true });
  } else {
    window.location.hash = target;
  }
}

function showDashboard() {
  const dashboard = document.getElementById('dashboard-view');
  const profile = document.getElementById('profile-view');
  if (!dashboard || !profile) return;
  profile.hidden = true;
  profile.innerHTML = '';
  dashboard.hidden = false;
  document.title = BASE_TITLE;
  state.activeCompany = null;
  renderSidebarCompanies();
}

function showCompany(company, { announce } = {}) {
  const dashboard = document.getElementById('dashboard-view');
  const profile = document.getElementById('profile-view');
  if (!dashboard || !profile) return;
  profile.innerHTML = profileViewHtml(company);
  profile.hidden = false;
  dashboard.hidden = true;
  document.title = `${company.name} · AI Intel Dashboard`;
  state.activeCompany = companySlug(company);
  renderSidebarCompanies();
  if (announce) {
    // The view changed without a page load, so move focus to the new content
    // (and therefore the screen reader) deliberately.
    window.scrollTo({ top: 0, behavior: 'auto' });
    const main = document.getElementById('main');
    if (main && typeof main.focus === 'function') main.focus();
  }
}

/**
 * Render whatever the current hash asks for.
 *
 * `announce` is true for hash changes and false for the first paint, so an
 * ordinary page load does not steal focus.
 */
export function applyRoute({ announce = true } = {}) {
  const route = parseRoute();
  if (route.view === 'company') {
    const company = companyBySlug(route.slug);
    if (company) {
      showCompany(company, { announce });
      return;
    }
    // Unknown or stale slug: fall back to the dashboard rather than a blank page.
  }
  showDashboard();
  if (route.anchor && DASHBOARD_SECTIONS.has(route.anchor)) {
    const target = document.getElementById(route.anchor);
    if (target) {
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduced || !announce ? 'auto' : 'smooth', block: 'start' });
    }
  }
}

/** Start routing. Call once the data has loaded. */
export function startRouter() {
  window.addEventListener('hashchange', () => applyRoute({ announce: true }));
  applyRoute({ announce: false });
}
