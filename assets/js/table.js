/**
 * The comparison table: filters, sorting and rendering.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { escapeHtml, fmtUSD } from './format.js';
import { scrollToAnchor } from './ui.js';

export function renderCategoryButtons() {
    const cats = uniqueCategories();
    // aria-pressed exposes the filter state to assistive tech, which the
    // .active class alone does not.
    document.getElementById('company-categories').innerHTML = cats.map(c =>
      `<button type="button" class="filter-btn ${c === state.categoryFilter ? 'active' : ''}" data-cat="${escapeHtml(c)}" aria-pressed="${c === state.categoryFilter}">${escapeHtml(c)}</button>`
    ).join('');
    document.querySelectorAll('#company-categories .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.categoryFilter = btn.dataset.cat;
        renderCategoryButtons();
        applyFilters();
      });
    });
  }

export function applyFilters() {
    const q = (state.search || '').toLowerCase();
    const rows = document.querySelectorAll('#cmp-table tbody tr');
    const details = document.querySelectorAll('#company-details-list .detail-card');
    const navItems = document.querySelectorAll('#nav-companies .nav-item');
    let visibleCount = 0;
    const totalRows = rows.length;

    rows.forEach((r, i) => {
      const c = state.companies[i];
      const catOk = state.categoryFilter === 'All' || c.category === state.categoryFilter;
      const text = (c.name + ' ' + c.category + ' ' + c.hq + ' ' + (c.intro || '')).toLowerCase();
      const searchOk = !q || text.includes(q);
      const show = catOk && searchOk;
      r.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });
    details.forEach((d) => {
      const id = d.id;
      const c = state.companies.find(x => 'co-' + (x._id || x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) === id);
      if (!c) return;
      const catOk = state.categoryFilter === 'All' || c.category === state.categoryFilter;
      const text = (c.name + ' ' + c.category + ' ' + c.hq).toLowerCase();
      const searchOk = !q || text.includes(q);
      d.style.display = (catOk && searchOk) ? '' : 'none';
    });
    navItems.forEach(n => {
      const c = state.companies.find(x => 'co-' + (x._id || x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) === n.dataset.anchor);
      if (!c) return;
      const catOk = state.categoryFilter === 'All' || c.category === state.categoryFilter;
      const searchOk = !q || c.name.toLowerCase().includes(q);
      n.style.display = (catOk && searchOk) ? '' : 'none';
    });

    // Update meta + clear button
    const meta = document.getElementById('table-meta');
    if (meta) {
      const filtersActive = q || state.categoryFilter !== 'All';
      meta.textContent = filtersActive
        ? `Showing ${visibleCount} of ${totalRows} companies`
        : `${totalRows} companies`;
    }
    const clear = document.getElementById('filter-clear');
    if (clear) clear.style.display = (q || state.categoryFilter !== 'All') ? 'inline-block' : 'none';
  }

export function renderTable() {
    const cols = [
      { key: 'name', label: 'Company', type: 'text', colClass: 'col-name' },
      { key: 'category', label: 'Category', type: 'text', colClass: 'col-cat' },
      { key: 'hq', label: 'HQ', type: 'text', colClass: 'col-hq' },
      { key: 'total_raised_usd', label: 'Raised', type: 'usd', colClass: 'col-num', from: c => c.funding?.total_raised_usd || c.funding?.amount_usd },
      { key: 'arr_usd', label: 'ARR', type: 'usd', colClass: 'col-num', from: c => c.arr_usd },
      { key: 'post_money_valuation_usd', label: 'Valuation', type: 'usd', colClass: 'col-num', from: c => c.funding?.post_money_valuation_usd },
    ];
    let list = state.companies.slice();
    list.sort((a, b) => {
      const av = cols.find(c => c.key === state.sortKey)?.from ? cols.find(c => c.key === state.sortKey).from(a) : a[state.sortKey];
      const bv = cols.find(c => c.key === state.sortKey)?.from ? cols.find(c => c.key === state.sortKey).from(b) : b[state.sortKey];
      const an = av == null ? -Infinity : (typeof av === 'string' ? av : Number(av));
      const bn = bv == null ? -Infinity : (typeof bv === 'string' ? bv : Number(bv));
      if (an < bn) return state.sortAsc ? -1 : 1;
      if (an > bn) return state.sortAsc ? 1 : -1;
      return 0;
    });

    const head = cols.map(c => {
      const isSorted = c.key === state.sortKey;
      const numCls = c.type === 'usd' || c.type === 'num' ? 'num' : '';
      const cls = isSorted ? `sorted ${state.sortAsc ? 'asc' : ''} ${numCls}` : numCls;
      // aria-sort conveys the sort state to assistive tech; the arrow glyph in
      // the class name is purely visual. A <th> is not a button, so it is also
      // made focusable and activatable by keyboard below.
      const ariaSort = isSorted ? ` aria-sort="${state.sortAsc ? 'ascending' : 'descending'}"` : '';
      return `<th class="${cls} ${c.colClass || ''}" data-key="${c.key}" scope="col" tabindex="0"${ariaSort}>${c.label}</th>`;
    }).join('');

    const colgroup = `<colgroup>
      <col class="col-name">
      <col class="col-cat">
      <col class="col-hq">
      <col class="col-num">
      <col class="col-num">
      <col class="col-num">
    </colgroup>`;

    const body = list.map(c => {
      const anchor = 'co-' + (c._id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      const totalRaised = c.funding?.total_raised_usd || c.funding?.amount_usd;
      const arr = c.arr_usd;
      const valuation = c.funding?.post_money_valuation_usd;
      const flagArr = arr && totalRaised && arr > totalRaised;
      const flagVal = valuation && totalRaised && valuation < totalRaised && valuation < arr;
      return `<tr data-anchor="${anchor}">
        <td class="col-name">
          <div class="cmp-name">${escapeHtml(c.name)}</div>
          <a class="cmp-co-link" href="${escapeHtml(c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website.replace(/^https?:\/\//, ''))} ↗</a>
        </td>
        <td class="col-cat"><span class="badge badge-cat cmp-cat">${escapeHtml(c.category)}</span></td>
        <td class="col-hq">${escapeHtml(c.hq || '—')}</td>
        <td class="num col-num cmp-num capital">${fmtUSD(totalRaised)}</td>
        <td class="num col-num cmp-num arr ${flagArr ? 'flagged' : ''}" title="${flagArr ? 'ARR exceeds total capital raised' : ''}">${fmtUSD(arr)}${flagArr ? '<span class="arr-flag">⚠</span>' : ''}</td>
        <td class="num col-num cmp-num valuation">${fmtUSD(valuation)}</td>
      </tr>`;
    }).join('');

    document.getElementById('cmp-table').innerHTML = `${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;

    document.querySelectorAll('#cmp-table thead th').forEach(th => {
      const sortBy = () => {
        const key = th.dataset.key;
        if (state.sortKey === key) state.sortAsc = !state.sortAsc;
        else { state.sortKey = key; state.sortAsc = false; }
        renderTable();
      };
      th.addEventListener('click', sortBy);
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          sortBy();
        }
      });
    });
    document.querySelectorAll('#cmp-table tbody tr').forEach(tr => {
      tr.addEventListener('click', e => {
        // Don't trigger row click when clicking the website link
        if (e.target.tagName === 'A') return;
        scrollToAnchor(tr.dataset.anchor);
      });
    });
  }

  // ============ Categories (filter) ============

export function uniqueCategories() {
    const set = new Set(state.companies.map(c => c.category));
    return ['All', ...Array.from(set).sort()];
  }

  // ============ Map ============
  // The underlying SVG is a hand-drawn simplified world map (Al MacDonald), not a
  // clean projection, so we use a fitted Mercator formula as the base AND apply
  // per-HQ overrides for known cities (which is how v3.7 placed pins correctly).
  // The projection alone puts Pacific-coast cities a bit too far west because the
  // SVG is a hand-drawn Robinson-style and the US west coast is irregular.
  // Per-city overrides (visually verified) correct this for known cities; new
  // cities without an override fall back to the projection.
  // ============ Map ============
  // The underlying SVG is a hand-drawn simplified world map (Al MacDonald), not a
  // clean projection, so we use a fitted Robinson projection as the base AND apply
  // per-HQ overrides for known cities. The Robinson fit alone puts cities within
  // ~8px mean error of the actual country positions; the overrides snap the
  // current 23 cities to their visually-verified positions on the country shapes.
  // For new cities without an override, the projection lands them on the right
  // continent (within ~10-20px).
