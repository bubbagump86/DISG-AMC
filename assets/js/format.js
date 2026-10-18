/**
 * Pure formatting and escaping helpers.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */

export const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const escapeAttr = s => String(s || '').replace(/[^A-Za-z0-9_\- .\/]/g, '');

  // ============ State ============

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
