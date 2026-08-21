/**
 * Post-filtering: finishing what a provider could not do server-side.
 *
 * Forced by kleinanzeigen.de, where robots.txt disallows the price, radius,
 * sort and private/commercial filter paths outright — a robots-respecting
 * adapter cannot push them down, so the kernel applies them to the rows that
 * came back. It then has to SAY so, because the two are not equivalent: a
 * server-side "max 200 €" searches the whole inventory, a client-side one
 * searches the 125 rows that source was willing to hand over.
 */

import type { Listing } from './listing.ts';
import type { FilterKey, SearchQuery } from './query.ts';

/** One filter's verdict on one listing. */
function matches(listing: Listing, key: FilterKey, q: SearchQuery): boolean {
  switch (key) {
    case 'minPrice': {
      // A listing with no price cannot satisfy a price floor. Treating unknown
      // as "passes" is how "zu verschenken" and "Preis auf Anfrage" flood a
      // search for expensive things.
      const p = listing.totalPrice ?? listing.price;
      return p !== null && p.minor >= (q.minPriceMinor ?? 0);
    }
    case 'maxPrice': {
      const p = listing.totalPrice ?? listing.price;
      return p !== null && p.minor <= (q.maxPriceMinor ?? Number.MAX_SAFE_INTEGER);
    }
    case 'condition': {
      const wanted = q.condition ?? [];
      if (wanted.length === 0) return true;
      // `unknown` is kept: dropping it would silently hide every classified ad
      // that simply does not state a condition, which is most of them.
      return listing.condition === 'unknown' || wanted.includes(listing.condition);
    }
    case 'sellerType':
      return listing.sellerType === 'unknown' || listing.sellerType === q.sellerType;
    case 'delivery': {
      if (!q.delivery || q.delivery === 'unknown') return true;
      if (listing.delivery === 'unknown' || listing.delivery === 'both') return true;
      return listing.delivery === q.delivery;
    }
    case 'since':
      return listing.listedAt === null || listing.listedAt >= (q.since ?? '');
    case 'gtin':
      return listing.gtin === null || listing.gtin === q.gtin;
    case 'radius':
      // Only the source can answer this; it needs a geocoder we deliberately do
      // not have. When the provider did not apply it, the rows pass through and
      // `--explain` reports the filter as unenforced rather than pretending.
      return true;
    case 'sort':
      return true;
  }
}

export interface PostFilterReport {
  /** Filters the kernel had to apply itself. */
  readonly clientSide: readonly FilterKey[];
  /** Filters nobody could apply — the honest gap. */
  readonly unenforced: readonly FilterKey[];
  readonly before: number;
  readonly after: number;
}

export function applyPostFilters(
  listings: readonly Listing[],
  query: SearchQuery,
  appliedByProvider: readonly FilterKey[],
  activeKeys: readonly FilterKey[],
): { listings: Listing[]; report: PostFilterReport } {
  const todo = activeKeys.filter((k) => !appliedByProvider.includes(k));
  const enforceable = todo.filter((k) => k !== 'radius' && k !== 'sort');
  const unenforced = todo.filter((k) => k === 'radius');

  const out = listings.filter((l) => enforceable.every((k) => matches(l, k, query)));
  return {
    listings: out,
    report: { clientSide: enforceable, unenforced, before: listings.length, after: out.length },
  };
}
