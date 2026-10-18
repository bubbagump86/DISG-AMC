/**
 * Entry point: shared helpers, theme and chrome wiring, and init().
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { loadData, loadStats } from './data.js';
import { renderSidebarCompanies, renderStats, setupScrollSpy, toggleSidebar } from './ui.js';
import { applyFilters, renderCategoryButtons, renderTable } from './table.js';
import { renderArrChart, renderDonut, renderFundingChart, renderValuationChart } from './charts.js';
import { renderMap } from './map.js';
import { renderTimeline } from './timeline.js';
import { closeModal, renderDetailSections } from './detail.js';

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
      // Re-render map and donut (they bake in colors at render time)
      safeCall(renderMap);
      safeCall(renderDonut);
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
  }

  function init() {
    document.getElementById('last-updated').textContent = 'Last refresh: ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    safeCall(setupChrome);
    safeCall(setupThemeToggle);
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
    safeCall(renderDetailSections);
    safeCall(setupScrollSpy);

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
    document.getElementById('modal').addEventListener('click', e => {
      const target = e.target;
      if (target.id === 'modal') closeModal();
      else if (target.closest && target.closest('[data-action="close-modal"]')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

// ---- bootstrap ------------------------------------------------------------
// Load the data first, then the stats sidecar, then render. The stats sidecar
// is optional: renderStats falls back to computing from the companies.
loadData().then(() => {
  safeCall(init);
  loadStats().then(loaded => {
    if (loaded) {
      state.stats = loaded;
      safeCall(renderStats);
    }
  });
});
