/**
 * What the kernel does to the rows after a provider hands them over — and the
 * honest account of it.
 *
 * Three steps, in this order and no other: filter, sort, cut to the limit.
 *
 * The order is the whole point, and it was measured wrong before. When an
 * adapter cut to `--limit` itself, a search for the five CHEAPEST offers got
 * the five NEWEST, reordered by price afterwards; and `--max-price 100 --limit 5`
 * answered "keine Treffer" while five matching rows sat in the same HTTP
 * response, already paid for. Both were invisible from outside: the outcome was
 * `empty`, which is the same word the source uses when it really has nothing.
 * Providers therefore return everything they fetched and the cut happens HERE,
 * behind the filter and behind the sort.
 *
 * Post-filtering at all is forced by kleinanzeigen.de, where robots.txt
 * disallows the price, radius, sort and private/commercial filter paths
 * outright — a robots-respecting adapter cannot push them down. The kernel then
 * has to SAY so, because the two are not equivalent: a server-side "max 200 €"
 * searches the whole inventory, a client-side one searches the 125 rows that
 * source was willing to hand over.
 */

import { normalizeGtin, sortListings } from './merge.ts';
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
      // Normalised on both sides: `0190295272432` and `190295272432` are one
      // barcode, and comparing the strings made a row survive or not depending
      // on which spelling its source printed first.
      return listing.gtin === null || normalizeGtin(listing.gtin) === normalizeGtin(q.gtin ?? null);
    case 'radius':
      // Only the source can answer this; it needs a geocoder we deliberately do
      // not have. When the provider did not apply it, the rows pass through and
      // `--explain` reports the filter as unenforced rather than pretending.
      return true;
    case 'sort':
      return true;
  }
}

/**
 * Filters whose rule for a missing field is "keep the row".
 *
 * That rule is right — dropping every ad that does not state its condition
 * would hide most of a classifieds site. But it has a consequence the report
 * used to hide: on a source that never fills the field, such a filter cannot
 * remove anything. Not "found nothing today" — cannot, structurally.
 *
 * Measured: `--condition new --since <heute>` over four sources returned twelve
 * rows in and twelve rows out, among them three cars from a customs auction,
 * while `--explain` printed "Filter hier nachgezogen: condition, since". The
 * filters ran; `condition` was `unknown` on 46 of 46 rows and `listedAt` null
 * on 34, so every row was kept by the very rule above.
 *
 * Price filters are absent from this list on purpose: their rule for a missing
 * price is to DROP, so they act even on a source that prices nothing.
 */
const KEEPS_UNKNOWN: readonly FilterKey[] = ['condition', 'sellerType', 'delivery', 'since', 'gtin'];

/** Whether the field this filter reads carries a value on this row at all. */
function known(listing: Listing, key: FilterKey): boolean {
  switch (key) {
    case 'condition':
      return listing.condition !== 'unknown';
    case 'sellerType':
      return listing.sellerType !== 'unknown';
    case 'delivery':
      return listing.delivery !== 'unknown';
    case 'since':
      return listing.listedAt !== null;
    case 'gtin':
      return listing.gtin !== null;
    default:
      return true;
  }
}

export interface PostFilterReport {
  /** What the kernel had to do itself — filters, and `sort` when it sorted. */
  readonly clientSide: readonly FilterKey[];
  /** What nobody could apply — the honest gap. */
  readonly unenforced: readonly FilterKey[];
  /** Rows the provider handed over, after dedup. */
  readonly before: number;
  /** Rows that survived the filters. */
  readonly after: number;
  /**
   * Rows that survived the filters and still fell to `--limit`.
   *
   * The discriminator between "this source has five more for you" and "this is
   * all there was". Without it, a capped result and an exhausted source print
   * the same line.
   */
  readonly dropped: number;
}

export interface PostFilterOptions {
  /** Rows to keep. The cut happens last, after filtering and sorting. */
  readonly limit: number;
}

/**
 * Filter, sort, cut — and report which of the three the kernel did itself.
 */
export function applyPostFilters(
  listings: readonly Listing[],
  query: SearchQuery,
  appliedByProvider: readonly FilterKey[],
  activeKeys: readonly FilterKey[],
  options: PostFilterOptions,
): { listings: Listing[]; report: PostFilterReport } {
  const todo = activeKeys.filter((k) => !appliedByProvider.includes(k));

  // With no rows there is nothing to call structurally inert: "this source
  // never fills the field" is a statement about rows, and there are none.
  const inert =
    listings.length === 0
      ? []
      : todo.filter((k) => KEEPS_UNKNOWN.includes(k) && !listings.some((l) => known(l, k)));

  const enforceable = todo.filter(
    (k) => k !== 'radius' && k !== 'sort' && !inert.includes(k),
  );
  const unenforced = [...todo.filter((k) => k === 'radius'), ...inert];

  const kept = listings.filter((l) => enforceable.every((k) => matches(l, k, query)));

  // The kernel sorts exactly when the provider did not. Re-sorting a
  // server-ordered list by the same key is a no-op at best and, for
  // `relevance`, destroys the one ranking the source could give.
  const sortsHere =
    query.sort !== undefined && query.sort !== 'relevance' && !appliedByProvider.includes('sort');
  const ordered = sortsHere ? sortListings(kept, query.sort) : kept;

  const out = ordered.slice(0, Math.max(0, options.limit));

  return {
    listings: out,
    report: {
      clientSide: sortsHere ? [...enforceable, 'sort'] : enforceable,
      unenforced,
      before: listings.length,
      after: ordered.length,
      dropped: ordered.length - out.length,
    },
  };
}
