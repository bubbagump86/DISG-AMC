/**
 * Per-company detail sections and the company modal.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { escapeHtml, fmtDate, fmtUSD, summaryHtml } from './format.js';

export function renderDetailSections() {
    const html = state.companies.map(c => {
      const anchor = 'co-' + (c._id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      const news = c.latest_news || [];
      return `
        <div class="detail-card" id="${anchor}">
          <div class="detail-head">
            <div class="detail-title-block">
              <h3>${escapeHtml(c.name)}</h3>
              <div class="detail-meta">
                <span class="badge badge-cat">${escapeHtml(c.category)}</span>
                <span>Founded ${escapeHtml(c.founded || '—')}</span>
                <span>·</span>
                <span>${escapeHtml(c.hq || '—')}</span>
                <span>·</span>
                <a href="${escapeHtml(c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website.replace(/^https?:\/\//, ''))} ↗</a>
              </div>
            </div>
            <div class="detail-actions">
              <span class="badge badge-conf-${c.confidence}">${escapeHtml(c.confidence)} conf</span>
            </div>
          </div>

          <div class="detail-grid">
            <div>
              <div class="detail-section">
                <div class="section-title">Overview</div>
                <div class="section-text">${escapeHtml(c.intro)}</div>
              </div>
              <div class="detail-section">
                <div class="section-title">Product</div>
                <div class="section-text">${escapeHtml(c.product)}</div>
              </div>
            </div>
            <div>
              <div class="detail-kpis">
                <div class="detail-kpi">
                  <div class="label">Total Raised</div>
                  <div class="value green">${fmtUSD(c.funding?.total_raised_usd || c.funding?.amount_usd)}</div>
                  ${c.funding?.latest_round ? `<div class="sub">${escapeHtml(c.funding.latest_round)}</div>` : ''}
                </div>
                <div class="detail-kpi">
                  <div class="label">Valuation</div>
                  <div class="value">${fmtUSD(c.funding?.post_money_valuation_usd)}</div>
                  ${c.funding?.date ? `<div class="sub">${fmtDate(c.funding.date)}</div>` : ''}
                </div>
                <div class="detail-kpi">
                  <div class="label">ARR</div>
                  <div class="value purple">${fmtUSD(c.arr_usd)}</div>
                  ${c.arr_source_note ? `<div class="sub">${escapeHtml(c.arr_source_note)}</div>` : ''}
                </div>
                <div class="detail-kpi">
                  <div class="label">Last Update</div>
                  <div class="value" style="font-size: 13px;">${news.length > 0 ? fmtDate(news[0].date) : '—'}</div>
                  <div class="sub">Founded ${escapeHtml(c.founded || '—')} · ${escapeHtml((c.hq || '').split(',')[0] || '—')}</div>
                </div>
              </div>
              ${c.funding?.lead_investors?.length ? `
              <div class="detail-section">
                <div class="section-title">Lead Investors (latest round)</div>
                <div class="section-text" style="font-size: 12px;">${c.funding.lead_investors.map(escapeHtml).join(' · ')}</div>
              </div>
              ` : ''}
            </div>
          </div>

          ${news.length > 0 ? `
            <div class="detail-section">
              <div class="section-title">Development Timeline</div>
              <div class="modal-timeline">
                ${news.map(n => `
                  <div class="timeline-item">
                    <div class="timeline-content">
                      <div class="timeline-date" style="display: block; margin-bottom: 4px;">${fmtDate(n.date)}</div>
                      <div class="timeline-headline">${escapeHtml(n.headline)}</div>
                      ${summaryHtml(n.headline, n.summary)}
                      ${n.source ? `<a class="source-link" href="${escapeHtml(n.source)}" target="_blank" rel="noopener" style="margin-top: 6px; display: inline-block;">View source ↗</a>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${c.sources?.length > 0 ? `
            <div class="detail-section">
              <div class="section-title">Sources</div>
              <div class="source-links">
                ${c.sources.map(s => `
                  <a class="source-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
                    <span class="source-type">${escapeHtml(s.type)}</span>
                    <span>${escapeHtml(s.url)}</span>
                  </a>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
    document.getElementById('company-details-list').innerHTML = html;
  }

  // ============ Modal ============

/**
 * The element focused before the dialog opened, so focus can be returned to it.
 * Restoring focus is what stops keyboard users being dumped back at the top of
 * the document after closing.
 */
let focusBeforeModal = null;

export function openModal(c) {
    const news = c.latest_news || [];
    const sources = c.sources || [];
    const overlay = document.getElementById('modal');
    focusBeforeModal = document.activeElement || null;
    document.getElementById('modal-content').innerHTML = `
      <div class="modal-header">
        <div class="modal-title">
          <h2 id="modal-title">${escapeHtml(c.name)}</h2>
          <div class="modal-subtitle">
            <span class="badge badge-cat">${escapeHtml(c.category)}</span>
            <span>Founded ${escapeHtml(c.founded || '—')}</span>
            <span>·</span>
            <span>${escapeHtml(c.hq || '—')}</span>
            <span>·</span>
            <a href="${escapeHtml(c.website)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none;">${escapeHtml(c.website)}</a>
          </div>
        </div>
        <button class="close-btn" type="button" data-action="close-modal" aria-label="Close dialog">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-section">
          <div class="section-title">Overview</div>
          <div class="section-text">${escapeHtml(c.intro)}</div>
        </div>
        <div class="modal-section">
          <div class="section-title">Product</div>
          <div class="section-text">${escapeHtml(c.product)}</div>
        </div>
        ${c.funding && (c.funding.latest_round || c.funding.amount_usd) ? `
        <div class="modal-section">
          <div class="section-title">Latest Funding</div>
          <div class="funding-detail">
            <div class="funding-row"><div class="label">Round</div><div class="value">${escapeHtml(c.funding.latest_round || '—')}</div></div>
            <div class="funding-row"><div class="label">Amount</div><div class="value amount">${fmtUSD(c.funding.amount_usd)}</div></div>
            <div class="funding-row"><div class="label">Date</div><div class="value">${fmtDate(c.funding.date)}</div></div>
            <div class="funding-row"><div class="label">Valuation</div><div class="value">${fmtUSD(c.funding.post_money_valuation_usd)}</div></div>
            <div class="funding-row" style="grid-column: 1 / -1;">
              <div class="label">Lead Investors</div>
              <div class="value" style="font-size: 13px; font-weight: 500;">${(c.funding.lead_investors || []).map(escapeHtml).join(', ') || '—'}</div>
            </div>
            ${c.funding.source_note ? `<div class="funding-row" style="grid-column: 1 / -1;">
              <div class="label">Source Note</div>
              <div class="value" style="font-size: 12px; font-weight: 400; color: var(--text-2);">${escapeHtml(c.funding.source_note)}</div>
            </div>` : ''}
          </div>
        </div>
        ` : ''}
        <div class="modal-section">
          <div class="section-title">Development Timeline</div>
          <div class="modal-timeline">
            ${news.length === 0 ? '<div class="section-text" style="color: var(--text-2);">No major public developments tracked in the last 6 months.</div>' :
              news.map(n => `
                <div class="timeline-item">
                  <div class="timeline-content">
                    <div class="timeline-date" style="display: block; margin-bottom: 4px;">${fmtDate(n.date)}</div>
                    <div class="timeline-headline">${escapeHtml(n.headline)}</div>
                    ${summaryHtml(n.headline, n.summary)}
                    ${n.source ? `<a class="source-link" href="${escapeHtml(n.source)}" target="_blank" rel="noopener" style="margin-top: 6px; display: inline-block;">View source →</a>` : ''}
                  </div>
                </div>
              `).join('')}
          </div>
        </div>
        <div class="modal-section">
          <div class="section-title">Sources</div>
          <div class="source-links">
            ${sources.map(s => `
              <a class="source-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
                <span class="source-type">${escapeHtml(s.type)}</span>
                <span>${escapeHtml(s.url)}</span>
              </a>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    overlay.classList.add('open');
    overlay.removeAttribute('hidden');
    // Move focus into the dialog so the next Tab press stays inside it and
    // screen readers announce it.
    const dialog = document.getElementById('modal-content');
    dialog.setAttribute('tabindex', '-1');
    if (typeof dialog.focus === 'function') dialog.focus();
  }

export function closeModal() {
    const overlay = document.getElementById('modal');
    overlay.classList.remove('open');
    overlay.setAttribute('hidden', '');
    if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') {
      focusBeforeModal.focus();
    }
    focusBeforeModal = null;
  }

  // ============ Init ============
