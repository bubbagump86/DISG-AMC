/**
 * Sidebar, scrolling, theme-independent chrome and the key-stats row.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { escapeHtml, fmtLastUpdated, fmtUSD } from './format.js';
import { PUBLIC_COMPANIES, computeStatsFromCompanies } from './data.js';

export function scrollToAnchor(id) {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.pageYOffset - 20;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    document.getElementById('sidebar').classList.remove('open');
  }

export function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    const open = sb.classList.toggle('open');
    if (bd) bd.classList.toggle('show', open);
    const toggle = document.getElementById('menu-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const anchor = item.dataset.anchor;
      if (anchor) scrollToAnchor(anchor);
    });
  });

  // Track which section is in view for nav highlight

export function setupScrollSpy() {
    const sections = ['stats', 'table', 'charts', 'map', 'timeline', 'company-details'];
    const navItems = document.querySelectorAll('.nav-item[data-anchor]');
    window.addEventListener('scroll', () => {
      const y = window.scrollY + 100;
      let active = 'top';
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= y) active = id;
      }
      navItems.forEach(n => n.classList.toggle('active', n.dataset.anchor === active));
    });
  }

  // ============ Stats (key stats row) ============
  // Public companies are valued at market cap, not post-money (which is
  // historically set once at IPO and goes stale). Keep this list in sync
  // with build/compute_stats.py:PUBLIC_COMPANIES.

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
    const valSub  = val.private_count != null && val.public_count != null
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

export function renderSidebarCompanies() {
    document.getElementById('nav-companies').innerHTML = state.companies.map(c => {
      const anchor = 'co-' + (c._id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      return `<div class="nav-item" data-anchor="${anchor}">
        <span class="nav-icon" style="width:6px; height:6px; border-radius:50%; background:var(--accent); margin: 5px 5px 5px 5px;"></span>
        <span style="font-size: 12px;">${escapeHtml(c.name)}</span>
      </div>`;
    }).join('');
    document.querySelectorAll('#nav-companies .nav-item').forEach(item => {
      item.addEventListener('click', () => scrollToAnchor(item.dataset.anchor));
    });
  }

  // ============ Comparison table ============
