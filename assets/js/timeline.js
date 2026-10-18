/**
 * The recent-developments timeline.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';
import { escapeHtml, fmtDateShort, fmtMonth, summaryHtml } from './format.js';

export function renderTimeline(containerId, allNews = false) {
    const allItems = [];
    state.companies.forEach(c => {
      (c.latest_news || []).forEach(n => {
        allItems.push({ ...n, company: c.name, category: c.category });
      });
    });
    allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
    const list = allNews ? allItems : allItems.slice(0, 8);

    // Group by month
    const byMonth = {};
    list.forEach(item => {
      const key = fmtMonth(item.date);
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(item);
    });

    const html = Object.entries(byMonth).map(([month, items]) => `
      <div class="timeline-month">
        <div class="timeline-month-label">${escapeHtml(month)}</div>
        ${items.map(item => `
          <div class="timeline-item">
            <div class="timeline-bullet"></div>
            <div class="timeline-content">
              <div class="timeline-co">${escapeHtml(item.company)} · ${escapeHtml(item.category)}</div>
              <div class="timeline-headline">${escapeHtml(item.headline)}</div>
              ${summaryHtml(item.headline, item.summary)}
            </div>
            <div class="timeline-date">${fmtDateShort(item.date)}</div>
          </div>
        `).join('')}
      </div>
    `).join('') || '<div class="empty"><h3>No news tracked yet</h3></div>';

    document.getElementById(containerId).innerHTML = html;
  }

  // ============ Detail sections (per-company) ============
