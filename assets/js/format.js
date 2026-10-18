/**
 * Pure formatting and display helpers.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */

// `s == null ? '' : String(s)` rather than `String(s || '')`: the latter also
// swallows legitimate falsy values such as the number 0.
const asText = s => (s === null || s === undefined ? '' : String(s));

export const escapeHtml = s => asText(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const escapeAttr = s => asText(s).replace(/[^A-Za-z0-9_\- .\/]/g, '');

const normalizeText = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The summary to show for a news item, or '' when it adds nothing.
 *
 * Google News supplies only the headline plus the publisher as its description,
 * and the upstream data often duplicated the headline outright, so rendering
 * both printed every story twice. Anything that merely restates the headline is
 * suppressed; a real summary from a publisher's own feed is kept.
 */
export function displaySummary(headline, summary) {
  const text = String(summary || '').trim();
  if (!text) return '';
  const normalizedSummary = normalizeText(text);
  const normalizedHeadline = normalizeText(headline);
  if (!normalizedSummary) return '';
  if (normalizedSummary === normalizedHeadline) return '';
  if (normalizedHeadline && normalizedSummary.startsWith(normalizedHeadline)) return '';
  return text;
}

/** Escaped `.timeline-summary` block, or '' when the summary is redundant. */
export function summaryHtml(headline, summary) {
  const text = displaySummary(headline, summary);
  return text ? `<div class="timeline-summary">${escapeHtml(text)}</div>` : '';
}

export const fmtUSD = n => {
    if (n == null) return '—';
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9)  return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6)  return '$' + (n / 1e6).toFixed(0) + 'M';
    if (n >= 1e3)  return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  };

export const fmtDate = s => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

export const fmtDateShort = s => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

export const fmtMonth = s => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

export function fmtLastUpdated(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const ms = Date.now() - d.getTime();
      const min = Math.floor(ms / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return `${min}m ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ago`;
      const day = Math.floor(hr / 24);
      return `${day}d ago`;
    } catch { return ''; }
  }
