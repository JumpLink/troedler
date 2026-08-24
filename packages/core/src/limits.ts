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

/**
 * Barcodes a `--compare` run puts back to the sources that can search by one.
 *
 * A cap, not a preference. Each barcode costs one request per source that does
 * not already have it, so six barcodes across three barcode-capable sources is
 * up to twelve extra requests — already more than most searches spend in total.
 * The cross-check report names what the cap left out.
 */
export const CROSS_CHECK_GTINS = 6;

/**
 * Rows to ask for per (source, barcode) lookup.
 *
 * Grouping needs to know THAT a source carries the barcode and at what price;
 * a fourth copy of the same pressing from the same source adds nothing a group
 * can show.
 */
export const CROSS_CHECK_ROWS = 3;
