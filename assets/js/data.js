/**
 * Loading data.json / stats.json and the aggregate fallback.
 *
 * Extracted from the original single-file index.html (Phase 2).
 */
import { state } from './state.js';

/**
 * Whether a company's valuation is a public market cap rather than a private
 * post-money mark.
 *
 * The `is_public` flag is published by the pipeline, so the browser, the
 * sidecar and the pipeline all share one definition. (This used to be a
 * hardcoded set of four names here, with a comment warning that it had to stay
 * in sync with `build/compute_stats.py` by hand.)
 *
 * The fallback covers data published before the flag existed: a numeric market
 * cap is the same signal, and the contract test asserts the two always agree.
 */
function isPublicCompany(company) {
  if (typeof company.is_public === 'boolean') return company.is_public;
  const cap = (company.funding || {}).current_market_cap_usd;
  return typeof cap === 'number' && cap > 0;
}

/**
 * Recompute the aggregate blocks from the loaded companies.
 *
 * Used as a fallback when stats.json is missing or not yet loaded, so a failed
 * sidecar fetch degrades to correct numbers rather than blank ones.
 */
export function computeStatsFromCompanies() {
    const n = state.companies.length;
    // Capital raised: ONLY lifetime total_raised_usd, never fall back to
    // amount_usd (which is the latest round amount, not lifetime).
    let capitalTotal = 0, capitalDisclosed = 0;
    let latestRoundTotal = 0, latestRoundCount = 0;
    // Valuation: private post-money + public market cap.
    let privateVal = 0, privateCount = 0;
    let publicVal = 0, publicCount = 0;
    // ARR: only count disclosed.
    let arrTotal = 0, arrDisclosed = 0;
    for (const c of state.companies) {
      const f = c.funding || {};
      const tr = f.total_raised_usd;
      if (typeof tr === 'number' && tr > 0) { capitalTotal += tr; capitalDisclosed += 1; }
      const amt = f.amount_usd;
      if (typeof amt === 'number' && amt > 0) { latestRoundTotal += amt; latestRoundCount += 1; }
      if (isPublicCompany(c)) {
        const cap = f.current_market_cap_usd;
        if (typeof cap === 'number' && cap > 0) { publicVal += cap; publicCount += 1; }
      } else {
        const pm = f.post_money_valuation_usd;
        if (typeof pm === 'number' && pm > 0) { privateVal += pm; privateCount += 1; }
      }
      const a = c.arr_usd;
      if (typeof a === 'number' && a > 0) { arrTotal += a; arrDisclosed += 1; }
    }
    const newsTotal = state.companies.reduce((s, c) => s + (c.latest_news?.length || 0), 0);
    const catSet = new Set(state.companies.map(c => c.category).filter(Boolean));
    return {
      companies_tracked: n,
      categories: catSet.size,
      news_items: newsTotal,
      capital_raised: { total_usd: capitalTotal, disclosed_count: capitalDisclosed, total_count: n, latest_round_total_usd: latestRoundTotal, latest_round_count: latestRoundCount },
      combined_arr:    { total_usd: arrTotal, disclosed_count: arrDisclosed, total_count: n },
      combined_valuation: { total_usd: privateVal + publicVal, private_post_money_usd: privateVal, private_count: privateCount, public_market_cap_usd: publicVal, public_count: publicCount },
      last_updated: null,
    };
  }

const DATA_URL = './data.json';
const STATS_URL = './stats.json';

/** Fetch the published dataset and store it. Shows a banner and logs on failure. */
export function loadData(url = DATA_URL) {
  return fetch(url, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error('Failed to load data.json: ' + r.status);
      return r.json();
    })
    .then(data => {
      state.companies = data;
      window.COMPANIES = data;
      return data;
    })
    .catch(err => {
      console.error('Dashboard data load failed:', err);
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="position:fixed;top:0;left:0;right:0;background: var(--red-bg); color: var(--red);padding:12px;text-align:center;z-index:99999;font-family:sans-serif;">' +
        '\u26a0 Could not load data.json. <a href="./data.json" target="_blank">View raw</a> or <button onclick="location.reload()">retry</button>.' +
        '</div>');
      return null;
    });
}

/** Fetch the precomputed stats sidecar. Resolves to null when it is unavailable. */
export function loadStats(url = STATS_URL) {
  return fetch(url, { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(() => null);
}

