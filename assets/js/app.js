/**
 * Entry point: shared helpers, theme and chrome wiring, and init().
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { loadData, loadStats } from './data.js';
import { renderSidebarCompanies, renderStats, scrollToAnchor, setupScrollSpy, toggleSidebar } from './ui.js';
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

    // One delegated listener for every sidebar link, static or generated, with
    // keyboard activation. This replaced 40+ per-item listeners that were
    // re-attached on every re-render and were mouse-only.
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const activate = target => {
      const item = target && target.closest ? target.closest('.nav-item') : null;
      if (item && item.dataset.anchor) scrollToAnchor(item.dataset.anchor);
    };
    sidebar.addEventListener('click', e => activate(e.target));
    sidebar.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target && e.target.closest ? e.target.closest('.nav-item') : null;
      if (item) {
        e.preventDefault();
        activate(e.target);
      }
    });
  }

  // ============ Modal focus trap ============
  // Keeps Tab inside the dialog while it is open, so focus cannot wander into
  // the page behind it.
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
      else if (e.key === 'Tab') trapFocus(e);
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
