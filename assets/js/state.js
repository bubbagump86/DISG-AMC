/**
 * Shared mutable state.
 *
 * Exported as a single object rather than individual `let` bindings: ES module
 * imports are read-only views, so a binding imported and reassigned elsewhere
 * would throw. Property assignment on a shared object works everywhere.
 */

export const state = {
  /** The published dataset (data.json). */
  companies: [],
  /** Precomputed aggregates (stats.json); null falls back to live compute. */
  stats: null,
  /** Current table search text. */
  search: '',
  /** Table sort column and direction. */
  sortKey: 'arr_usd',
  sortAsc: false,
  /** Active category filter, or 'All'. */
  categoryFilter: 'All',
  /** Sidebar company filter text. */
  sidebarSearch: '',
  /** Slug of the company whose profile is open, or null on the dashboard. */
  activeCompany: null,
};
