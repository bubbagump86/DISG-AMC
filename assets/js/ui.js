/**
 * Sidebar, scrollspy and the key-stats row.
 *
 * The company list is grouped by category with counts and filtered by the
 * sidebar search, and each entry is a real link to its profile route rather
 * than a click-handled div. Activation is still delegated: one listener on the
 * sidebar covers the static dashboard links and every generated company link,
 * and survives re-renders.
 */

import { state } from './state.js';
import { escapeHtml, fmtLastUpdated, fmtUSD } from './format.js';
import { computeStatsFromCompanies } from './data.js';
import { companyAnchor, companySlug } from './profile.js';

export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.classList.remove('show');
  const toggle = document.getElementById('menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

export function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const open = sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('show', open);
  const toggle = document.getElementById('menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/** Highlight the section the reader is looking at, but only on the dashboard. */
export function setupScrollSpy() {
  const sections = ['stats', 'table', 'charts', 'map', 'timeline'];
  const navItems = document.querySelectorAll('.nav-item[data-anchor]');
  window.addEventListener('scroll', () => {
    const dashboard = document.getElementById('dashboard-view');
    if (dashboard && dashboard.hidden) return;
    const y = window.scrollY + 100;
    let active = 'top';
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el && el.offsetTop <= y) active = id;
    }
    navItems.forEach(item => item.classList.toggle('active', item.dataset.anchor === active));
  });
}

// ============ Stats (key stats row) ============
// Prefers the published stats.json sidecar and falls back to computing the same
// aggregates locally, so a missing sidecar still shows correct numbers.

export function renderStats() {
  const s = state.stats || computeStatsFromCompanies();
  const cap = s.capital_raised || {};
  const arr = s.combined_arr || {};
  const val = s.combined_valuation || {};
  const total = s.companies_tracked ?? state.companies.length;
  const catSet = new Set(state.companies.map(c => c.category).filter(Boolean));
  const cats = s.categories ?? catSet.size;
  const news = s.news_items ?? state.companies.reduce((sum, c) => sum + (c.latest_news?.length || 0), 0);
  const capDisc = cap.disclosed_count != null ? `${cap.disclosed_count}/${cap.total_count || total} disclosed` : 'cumulative across disclosed rounds';
  const arrDisc = arr.disclosed_count != null ? `${arr.disclosed_count}/${arr.total_count || total} disclosed` : 'annualized recurring revenue';
  const valSub = val.private_count != null && val.public_count != null
    ? `${val.private_count} private + ${val.public_count} public`
    : `${news} developments tracked`;
  const lastUpdated = s.last_updated ? `updated ${fmtLastUpdated(s.last_updated)}` : '';
  document.getElementById('stats-row').innerHTML = `
    <div class="stat">
      <div class="stat-label">Companies Tracked</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">across ${cats} categories${lastUpdated ? ' &middot; ' + lastUpdated : ''}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total Capital Raised</div>
      <div class="stat-value">${fmtUSD(cap.total_usd)}</div>
      <div class="stat-sub">${capDisc}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Combined ARR</div>
      <div class="stat-value">${fmtUSD(arr.total_usd)}</div>
      <div class="stat-sub">${arrDisc}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Combined Valuation</div>
      <div class="stat-value">${fmtUSD(val.total_usd)}</div>
      <div class="stat-sub">${valSub}</div>
    </div>
  `;
}

// ============ Sidebar company list ============

function matchesQuery(company, query) {
  const haystack = `${company.name} ${company.category || ''} ${company.hq || ''}`.toLowerCase();
  return haystack.includes(query);
}

export function renderSidebarCompanies() {
  const query = (state.sidebarSearch || '').trim().toLowerCase();
  const groups = new Map();
  for (const company of state.companies) {
    if (query && !matchesQuery(company, query)) continue;
    const category = company.category || 'Uncategorised';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(company);
  }

  const html = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, companies]) => `
      <div class="nav-group">
        <div class="nav-group-label">
          <span>${escapeHtml(category)}</span>
          <span class="nav-count">${companies.length}</span>
        </div>
        ${companies.map(company => {
          const slug = companySlug(company);
          const active = state.activeCompany === slug;
          return `
          <a class="nav-item nav-company${active ? ' active' : ''}" href="#${companyAnchor(company)}"
             data-slug="${slug}"${active ? ' aria-current="page"' : ''}>
            <span class="nav-dot" aria-hidden="true"></span>
            <span class="nav-company-name">${escapeHtml(company.name)}</span>
          </a>`;
        }).join('')}
      </div>
    `).join('');

  document.getElementById('nav-companies').innerHTML = html
    || '<div class="nav-empty">No companies match that filter.</div>';
}
