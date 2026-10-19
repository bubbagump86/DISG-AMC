/**
 * The company profile: one renderer, two surfaces.
 *
 * This used to be duplicated -- `renderDetailSections` drew every company as a
 * card in the main document, and `openModal` drew almost the same fields again
 * in a dialog. They had drifted apart (different KPI layouts, different source
 * lists), so both are replaced by `profileBodyHtml`, which the routed profile
 * view and the quick-peek modal now share.
 *
 * Profiles are no longer all rendered up front: 40 companies x their news was
 * the bulk of the DOM on a 360 KB payload. They are rendered on demand by the
 * router instead.
 */

import { escapeHtml, fmtDate, fmtUSD, summaryHtml } from './format.js';

/** Stable deep-link id for a company: `#co-<slug>`. */
export function companyAnchor(company) {
  return 'co-' + (company._id || company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}

/** The slug part of a company's anchor, i.e. without the `co-` prefix. */
export function companySlug(company) {
  return companyAnchor(company).slice(3);
}

function timelineHtml(news) {
  if (!news.length) {
    return '<div class="section-text muted">No major public developments tracked in the last 6 months.</div>';
  }
  return news.map(item => `
    <div class="timeline-item">
      <div class="timeline-content">
        <div class="timeline-date">${fmtDate(item.date)}</div>
        <div class="timeline-headline">${escapeHtml(item.headline)}</div>
        ${summaryHtml(item.headline, item.summary)}
        ${item.source ? `<a class="source-link" href="${escapeHtml(item.source)}" target="_blank" rel="noopener noreferrer">View source ↗</a>` : ''}
      </div>
    </div>
  `).join('');
}

function sourcesHtml(sources) {
  if (!sources.length) return '';
  return `
    <div class="detail-section">
      <div class="section-title">Sources</div>
      <div class="source-links">
        ${sources.map(source => `
          <a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
            <span class="source-type">${escapeHtml(source.type)}</span>
            <span>${escapeHtml(source.url)}</span>
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

function fundingNoteHtml(funding) {
  if (!funding || !funding.source_note) return '';
  return `
    <div class="detail-section">
      <div class="section-title">Funding note</div>
      <div class="section-text">${escapeHtml(funding.source_note)}</div>
    </div>
  `;
}

function kpisHtml(c) {
  const funding = c.funding || {};
  const news = c.latest_news || [];
  const valuation = c.is_public
    ? (funding.current_market_cap_usd ?? funding.post_money_valuation_usd)
    : funding.post_money_valuation_usd;
  return `
    <div class="detail-kpis">
      <div class="detail-kpi">
        <div class="label">Total raised</div>
        <div class="value">${fmtUSD(funding.total_raised_usd || funding.amount_usd)}</div>
        ${funding.latest_round ? `<div class="sub">${escapeHtml(funding.latest_round)}</div>` : ''}
      </div>
      <div class="detail-kpi">
        <div class="label">${c.is_public ? 'Market cap' : 'Valuation'}</div>
        <div class="value">${fmtUSD(valuation)}</div>
        ${funding.date ? `<div class="sub">${fmtDate(funding.date)}</div>` : ''}
      </div>
      <div class="detail-kpi">
        <div class="label">ARR</div>
        <div class="value">${fmtUSD(c.arr_usd)}</div>
        ${c.arr_source_note ? `<div class="sub">${escapeHtml(c.arr_source_note)}</div>` : ''}
      </div>
      <div class="detail-kpi">
        <div class="label">Last update</div>
        <div class="value value-sm">${news.length ? fmtDate(news[0].date) : '—'}</div>
        <div class="sub">${news.length} tracked item${news.length === 1 ? '' : 's'}</div>
      </div>
    </div>
  `;
}

/**
 * The profile body, shared by the routed view and the modal.
 * Everything in here is escaped; `summaryHtml` escapes its own text.
 */
export function profileBodyHtml(c) {
  const news = c.latest_news || [];
  const sources = c.sources || [];
  const funding = c.funding || {};
  return `
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
        ${fundingNoteHtml(funding)}
      </div>
      <div>
        ${kpisHtml(c)}
        ${funding.lead_investors && funding.lead_investors.length ? `
          <div class="detail-section">
            <div class="section-title">Lead investors (latest round)</div>
            <div class="section-text">${funding.lead_investors.map(escapeHtml).join(' · ')}</div>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="detail-section">
      <div class="section-title">Development timeline</div>
      <div class="modal-timeline">${timelineHtml(news)}</div>
    </div>

    ${sourcesHtml(sources)}
  `;
}

/** Header used by both surfaces: name, category, founded, HQ, website. */
export function profileHeaderHtml(c, { heading = 'h1' } = {}) {
  const tag = heading === 'h1' ? 'h1' : 'h2';
  const titleId = heading === 'h1' ? 'profile-title' : 'modal-title';
  return `
    <div class="profile-header">
      <div class="profile-title-block">
        <${tag} id="${titleId}">${escapeHtml(c.name)}</${tag}>
        <div class="detail-meta">
          <span class="badge badge-cat">${escapeHtml(c.category)}</span>
          <span>Founded ${escapeHtml(c.founded || '—')}</span>
          <span aria-hidden="true">·</span>
          <span>${escapeHtml(c.hq || '—')}</span>
          <span aria-hidden="true">·</span>
          <a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(c.website || '').replace(/^https?:\/\//, ''))} ↗</a>
        </div>
      </div>
      <span class="badge badge-conf-${escapeHtml(c.confidence)}">${escapeHtml(c.confidence)} confidence</span>
    </div>
  `;
}

/** The routed profile page. */
export function profileViewHtml(c) {
  return `
    <a class="back-link" href="#top">← All companies</a>
    <article class="detail-card profile-view" aria-labelledby="profile-title">
      ${profileHeaderHtml(c, { heading: 'h1' })}
      ${profileBodyHtml(c)}
    </article>
  `;
}
