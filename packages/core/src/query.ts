/**
 * The `SearchQuery` — what the user asked for, independent of who can answer it.
 *
 * Every field here is a wish, not an instruction to the provider. A provider
 * applies what it can server-side and reports which ones (`applied`); the
 * kernel then applies the rest to the returned rows. That split is not a
 * nicety, it is forced: on kleinanzeigen.de the robots.txt disallows the price
 * filter, the radius filter, the sort order and the private/commercial filter
 * outright, so a robots-respecting adapter *cannot* push them down and the
 * kernel must finish the job.
 *
 * The consequence is visible to the user and must stay visible: a client-side
 * "max 200 €" filters the ~125 rows that source will hand out, not its whole
 * inventory. `troedler search --explain` exists to say so.
 */

import type { Condition, Delivery, SellerType } from './listing.ts';

export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'ending-soonest';

/** Names a single filter so a provider can declare which ones it honours. */
export type FilterKey =
  | 'minPrice'
  | 'maxPrice'
  | 'condition'
  | 'sellerType'
  | 'delivery'
  | 'radius'
  | 'since'
  | 'gtin'
  | 'sort';

export interface SearchQuery {
  /** Free text. Empty is legal when `gtin` is set. */
  readonly text: string;
  readonly minPriceMinor?: number;
  readonly maxPriceMinor?: number;
  readonly currency?: string;
  readonly condition?: readonly Condition[];
  readonly sellerType?: SellerType;
  readonly delivery?: Delivery;
  /** Origin for a radius search. Both must be set or neither. */
  readonly postalCode?: string;
  readonly radiusKm?: number;
  /** Only offers listed at or after this ISO timestamp. */
  readonly since?: string;
  readonly gtin?: string;
  readonly sort?: SortKey;
  /** Rows to ask each provider for, before merging. Clamped by `limits.ts`. */
  readonly limit?: number;
}

/** The filters a query actually constrains — the ones a provider must account for. */
export function activeFilters(q: SearchQuery): FilterKey[] {
  const keys: FilterKey[] = [];
  if (q.minPriceMinor !== undefined) keys.push('minPrice');
  if (q.maxPriceMinor !== undefined) keys.push('maxPrice');
  if (q.condition?.length) keys.push('condition');
  if (q.sellerType && q.sellerType !== 'unknown') keys.push('sellerType');
  if (q.delivery && q.delivery !== 'unknown') keys.push('delivery');
  if (q.radiusKm !== undefined && q.postalCode) keys.push('radius');
  if (q.since) keys.push('since');
  if (q.gtin) keys.push('gtin');
  if (q.sort && q.sort !== 'relevance') keys.push('sort');
  return keys;
}
