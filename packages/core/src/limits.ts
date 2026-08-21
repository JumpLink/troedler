/**
 * Bounds, in one place, with a default and a maximum each.
 *
 * Every one of these CLAMPS rather than rejects. A caller — an MCP client
 * especially — asking for 5000 rows should get 200 and be told, not get an
 * error and retry blind. Rejecting turns a bounded answer into no answer.
 */

export interface Limit {
  readonly default: number;
  readonly max: number;
}

/** Rows asked of ONE provider before merging. */
export const RESULTS_PER_PROVIDER: Limit = { default: 25, max: 200 };
/** Rows returned after merging across providers. */
export const RESULTS_TOTAL: Limit = { default: 50, max: 500 };
/** Description characters kept per listing. Enough to judge, not enough to mirror the ad. */
export const DESCRIPTION_CHARS: Limit = { default: 600, max: 4000 };
/** Result pages fetched per provider per search. */
export const PAGE_DEPTH: Limit = { default: 2, max: 5 };

export function clamp(value: number | undefined, limit: Limit): number {
  if (value === undefined || !Number.isFinite(value)) return limit.default;
  return Math.max(1, Math.min(Math.floor(value), limit.max));
}
