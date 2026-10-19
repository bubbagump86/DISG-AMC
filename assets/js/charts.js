/**
 * Hand-rolled SVG charts: bars and the category donut.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { escapeAttr, escapeHtml, fmtDate, fmtUSD } from './format.js';

export function renderBarChart(containerId, metaId, items, opts = {}) {
    // items: [{ c, value, sub, fillStyle, clickAnchor }]
    const withData = items.filter(x => x.value != null).sort((a, b) => b.value - a.value);
    const max = withData.length ? Math.max(...withData.map(x => x.value)) : 0;
    const total = withData.reduce((s, x) => s + x.value, 0);
    const container = document.getElementById(containerId);
    const metaEl = document.getElementById(metaId);
    if (metaEl) metaEl.textContent = `Combined: ${fmtUSD(total)} • ${withData.length} of ${state.companies.length} disclosed`;
    if (withData.length === 0) {
      container.innerHTML = '<div class="empty"><h3>No data yet</h3></div>';
      return;
    }
    container.innerHTML = withData.map(item => {
      const pct = max ? (item.value / max) * 100 : 0;
      const fillStyle = item.fillStyle || '';
      return `
        <div class="bar-row" data-anchor="${item.clickAnchor || ''}">
          <div class="bar-label">
            <span class="bar-name">${escapeHtml(item.c.name)}</span>
            <span class="bar-sub">${escapeHtml(item.sub || '')}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="${fillStyle} width: ${pct.toFixed(1)}%"></div></div>
          <div class="bar-value">${fmtUSD(item.value)}</div>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.bar-row').forEach(row => {
      row.addEventListener('click', () => {
        if (row.dataset.anchor) window.location.hash = '#' + row.dataset.anchor;
      });
    });
  }

  // ============ Funding bar chart (total raised) ============

export function renderFundingChart() {
    const items = state.companies.map(c => {
      const total = c.funding?.total_raised_usd || c.funding?.amount_usd;
      const isLatest = !c.funding?.total_raised_usd && c.funding?.amount_usd;
      const anchor = 'co-' + (c._id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      return {
        c, value: total,
        sub: isLatest ? `Latest round only (total undisclosed) · ${c.funding?.latest_round || '—'}` : `Cumulative · ${c.funding?.latest_round || '—'}`,
        clickAnchor: anchor
      };
    });
    renderBarChart('funding-chart', 'funding-meta', items);
  }

  // ============ ARR bar chart ============

export function renderArrChart() {
    const items = state.companies.map(c => {
      const anchor = 'co-' + (c._id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      return {
        c, value: c.arr_usd,
        sub: c.arr_source_note || 'Not publicly disclosed',
        fillStyle: 'background: var(--accent);',
        clickAnchor: anchor
      };
    });
    renderBarChart('arr-chart', 'arr-meta', items);
  }

  // ============ Valuation chart ============

export function renderValuationChart() {
    const items = state.companies.map(c => {
      const anchor = 'co-' + (c._id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      return {
        c, value: c.funding?.post_money_valuation_usd,
        sub: `${c.funding?.latest_round || '—'} · ${fmtDate(c.funding?.date)}`,
        fillStyle: 'background: var(--accent);',
        clickAnchor: anchor
      };
    });
    renderBarChart('valuation-chart', 'val-meta', items);
  }

  // ============ Categories donut ============

export function renderDonut() {
    const counts = {};
    state.companies.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
    const total = state.companies.length;
    // Colours come from CSS custom properties, so the chart follows the theme
    // and the palette lives in one place. `style` rather than `fill="..."`:
    // var() does not resolve reliably in presentation attributes.
    const colors = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `var(--cat-${n})`);
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const cx = 140, cy = 140, rOuter = 110, rInner = 70;
    let cumAngle = -Math.PI / 2; // start at top
    let arcs = '';
    entries.forEach(([cat, n], i) => {
      const angle = (n / total) * 2 * Math.PI;
      const a1 = cumAngle, a2 = cumAngle + angle;
      const large = angle > Math.PI ? 1 : 0;
      const x1 = cx + rOuter * Math.cos(a1), y1 = cy + rOuter * Math.sin(a1);
      const x2 = cx + rOuter * Math.cos(a2), y2 = cy + rOuter * Math.sin(a2);
      const x3 = cx + rInner * Math.cos(a2), y3 = cy + rInner * Math.sin(a2);
      const x4 = cx + rInner * Math.cos(a1), y4 = cy + rInner * Math.sin(a1);
      const pct = ((n / total) * 100).toFixed(0);
      arcs += `<path class="donut-arc" data-cat="${escapeAttr(cat)}" data-count="${n}" data-pct="${pct}" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z" style="fill: ${colors[i % colors.length]}; stroke: var(--bg-1)" stroke-width="2"/>`;
      cumAngle = a2;
    });
    const donut = `<svg viewBox="0 0 280 280" width="100%" style="max-width: 280px;">
      ${arcs}
      <text x="140" y="135" text-anchor="middle" style="fill: var(--text-0)" font-size="36" font-weight="700">${total}</text>
      <text x="140" y="160" text-anchor="middle" style="fill: var(--text-2)" font-size="11" font-weight="500" text-transform="uppercase">state.companies</text>
    </svg>`;
    document.getElementById('donut-wrap').innerHTML = `
      <div style="position:relative;">
        ${donut}
        <div class="donut-tooltip" id="donut-tooltip"></div>
      </div>
      <div class="donut-legend">
        ${entries.map(([cat, n], i) => `
          <div class="donut-legend-item" data-cat="${escapeAttr(cat)}">
            <div class="donut-swatch" style="background: ${colors[i % colors.length]}"></div>
            <span>${escapeHtml(cat)}</span>
            <span class="donut-legend-count">${n} · ${((n / total) * 100).toFixed(0)}%</span>
          </div>
        `).join('')}
      </div>
    `;
    wireDonutHover();
  }

export function wireDonutHover() {
    const wrap = document.getElementById('donut-wrap');
    const tooltip = document.getElementById('donut-tooltip');
    if (!wrap || !tooltip) return;
    const arcs = wrap.querySelectorAll('.donut-arc');
    const legendItems = wrap.querySelectorAll('.donut-legend-item');

    const showTooltip = (cat, count, pct, evt) => {
      tooltip.innerHTML = `<div class="donut-tooltip-cat" style="color: var(--accent);">${escapeHtml(cat)}</div><div class="donut-tooltip-count">${count} companies · ${pct}%</div>`;
      tooltip.classList.add('is-visible');
      const wrapRect = wrap.getBoundingClientRect();
      const x = (evt.clientX - wrapRect.left) + 14;
      const y = (evt.clientY - wrapRect.top) - 10;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
      requestAnimationFrame(() => {
        const tRect = tooltip.getBoundingClientRect();
        if (tRect.right > wrapRect.right - 4) {
          tooltip.style.left = (wrapRect.width - tRect.width - 8) + 'px';
        }
        if (tRect.left < wrapRect.left + 4) {
          tooltip.style.left = '8px';
        }
      });
    };

    const hideTooltip = () => { tooltip.classList.remove('is-visible'); };

    const setActive = (cat) => {
      arcs.forEach(a => {
        if (a.dataset.cat === cat) { a.classList.add('is-active'); a.classList.remove('is-dim'); }
        else { a.classList.add('is-dim'); a.classList.remove('is-active'); }
      });
      legendItems.forEach(li => { li.classList.toggle('is-active', li.dataset.cat === cat); });
    };

    const clearActive = () => {
      arcs.forEach(a => a.classList.remove('is-active', 'is-dim'));
      legendItems.forEach(li => li.classList.remove('is-active'));
    };

    arcs.forEach(arc => {
      arc.addEventListener('mouseenter', (e) => { setActive(arc.dataset.cat); showTooltip(arc.dataset.cat, arc.dataset.count, arc.dataset.pct, e); });
      arc.addEventListener('mousemove', (e) => { showTooltip(arc.dataset.cat, arc.dataset.count, arc.dataset.pct, e); });
      arc.addEventListener('mouseleave', () => { clearActive(); hideTooltip(); });
    });

    legendItems.forEach(li => {
      li.addEventListener('mouseenter', () => setActive(li.dataset.cat));
      li.addEventListener('mouseleave', () => clearActive());
    });
  }

  // ============ Timeline (overview + full) ============
