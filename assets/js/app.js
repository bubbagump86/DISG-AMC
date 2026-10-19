/**
 * Entry point: theme and chrome wiring, init(), and the bootstrap sequence.
 *
 * The page has two views -- the dashboard and a company profile -- selected by
 * the hash router. Everything renders from the dashboard's first paint; a
 * profile is rendered on demand.
 */

import { state } from './state.js';
import { loadData, loadStats } from './data.js';
import {
  closeSidebar,
  renderSidebarCompanies,
  renderStats,
  setupScrollSpy,
  toggleSidebar,
} from './ui.js';
import { applyFilters, renderCategoryButtons, renderTable } from './table.js';
import { renderArrChart, renderDonut, renderFundingChart, renderValuationChart } from './charts.js';
import { renderMap } from './map.js';
import { renderTimeline } from './timeline.js';
import { closeModal } from './detail.js';
import { startRouter } from './router.js';

function safeCall(fn) {
  try { fn(); }
  catch (e) { console.error('Render failed:', fn.name, e); }
}

// ============ Theme toggle ============

function setupThemeToggle() {
  // Restore from localStorage; otherwise respect system preference
  const saved = localStorage.getItem('ai-dashboard-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ai-dashboard-theme', next);
    // Re-render what bakes colours in at render time.
    safeCall(renderMap);
    safeCall(renderDonut);
  });
}

// ============ Density ============
// Compact by default (a scanning surface); comfortable is persisted because it
// is a reading preference, not a per-session one.
const DENSITY_KEY = 'ai-dashboard-density';

function applyDensity(density, { persist = true } = {}) {
  const next = density === 'comfortable' ? 'comfortable' : 'compact';
  state.density = next;
  document.documentElement.setAttribute('data-density', next);
  const button = document.getElementById('density-toggle');
  if (button) {
    const comfortable = next === 'comfortable';
    button.setAttribute('aria-pressed', comfortable ? 'true' : 'false');
    button.textContent = comfortable ? 'Compact' : 'Comfortable';
    button.setAttribute('aria-label', comfortable
      ? 'Switch the table to compact density'
      : 'Switch the table to comfortable density');
  }
  if (persist) localStorage.setItem(DENSITY_KEY, next);
}

function setupDensity() {
  applyDensity(localStorage.getItem(DENSITY_KEY) || 'compact', { persist: false });
  const button = document.getElementById('density-toggle');
  if (!button) return;
  button.addEventListener('click', () => {
    applyDensity(state.density === 'comfortable' ? 'compact' : 'comfortable');
  });
}

// ============ Sidebar chrome ============
// Bound in JS rather than inline `onclick`, which does not see module scope.

function setupChrome() {
  const toggle = document.getElementById('menu-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (toggle) {
    toggle.addEventListener('click', toggleSidebar);
    toggle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSidebar();
      }
    });
  }
  if (backdrop) backdrop.addEventListener('click', toggleSidebar);

  // One delegated listener for every sidebar entry, static or generated. The
  // company entries are real links, so the browser changes the hash and the
  // router takes over; this only has to close the mobile drawer.
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const activate = item => {
    if (!item) return;
    if (item.dataset.anchor) {
      window.location.hash = `#${item.dataset.anchor}`;
    }
    closeSidebar();
  };
  sidebar.addEventListener('click', e => {
    if (!e.target || !e.target.closest) return;
    activate(e.target.closest('.nav-item'));
  });
  sidebar.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target || !e.target.closest) return;
    const item = e.target.closest('.nav-item');
    if (item) {
      e.preventDefault();
      activate(item);
    }
  });
}

// ============ Modal focus trap ============
// Keeps Tab inside the dialog while it is open, so focus cannot wander into the
// page behind it.

function trapFocus(event) {
  const overlay = document.getElementById('modal');
  if (!overlay.classList.contains('open')) return;
  const focusable = overlay.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setupDashboardControls() {
  document.getElementById('company-search').addEventListener('input', e => {
    state.search = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-clear').addEventListener('click', () => {
    state.search = '';
    state.categoryFilter = 'All';
    document.getElementById('company-search').value = '';
    renderCategoryButtons();
    applyFilters();
  });

  const sidebarSearch = document.getElementById('sidebar-search');
  if (sidebarSearch) {
    sidebarSearch.addEventListener('input', e => {
      state.sidebarSearch = e.target.value;
      renderSidebarCompanies();
    });
  }

  document.getElementById('modal').addEventListener('click', e => {
    const target = e.target;
    if (!target) return;
    if (target.id === 'modal') closeModal();
    else if (target.closest && target.closest('[data-action="close-modal"]')) closeModal();
    else if (target.closest && target.closest('[data-action="open-profile"]')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'Tab') trapFocus(e);
  });
}

function init() {
  document.getElementById('last-updated').textContent =
    'Last refresh: ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  safeCall(setupChrome);
  safeCall(setupThemeToggle);
  safeCall(setupDensity);
  safeCall(setupDashboardControls);

  safeCall(renderStats);
  safeCall(renderSidebarCompanies);
  safeCall(renderCategoryButtons);
  safeCall(renderTable);
  safeCall(renderFundingChart);
  safeCall(renderArrChart);
  safeCall(renderValuationChart);
  safeCall(renderDonut);
  safeCall(renderMap);
  safeCall(() => renderTimeline('overview-timeline', true));
  safeCall(setupScrollSpy);
}

// ---- bootstrap ------------------------------------------------------------
// Load the data first, then render, then resolve the route. Routing last means
// a deep link into a profile has data to render.
loadData().then(() => {
  safeCall(init);
  safeCall(() => startRouter());
  loadStats().then(loaded => {
    if (loaded) {
      state.stats = loaded;
      safeCall(renderStats);
    }
  });
});
