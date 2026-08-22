/**
 * Dedup, grouping and ranking — the part of this project that is actually new.
 *
 * `grouped` is the primary shape and `merged` is optional, which is the
 * opposite of what a meta-search usually does. Two reasons, and the first is
 * not aesthetic: eBay's API licence requires eBay rows in a public display to
 * be "visually isolated from third-party listings", so a permanently
 * interleaved list is the one layout that is not allowed to ship. The second
 * is that it is simply more useful — knowing a thing costs 40 € on
 * kleinanzeigen and 120 € on eBay is the answer; a single list sorted by price
 * hides which market you are looking at.
 */

import { conditionRank } from './normalize.ts';
import { normalizeTitle } from './normalize.ts';
import type { Listing, ProviderId } from './listing.ts';
import type { SortKey } from './query.ts';

/**
 * Drop repeats WITHIN one provider.
 *
 * Needed because paged results overlap: kleinanzeigen repeats its "Top-Anzeige"
 * slots on every page, so a naive three-page fetch reports the same bicycle
 * three times and the user believes there are three of them.
 */
export function dedupeWithinProvider(listings: readonly Listing[]): Listing[] {
  const seen = new Set<string>();
  const out: Listing[] = [];
  for (const l of listings) {
    if (seen.has(l.key)) continue;
    seen.add(l.key);
    out.push(l);
  }
  return out;
}

/**
 * A GTIN reduced to what makes two of them the same number.
 *
 * `0190295272432` and `190295272432` are one barcode — UPC-A padded onto
 * EAN-13 — and both appear in the same Discogs `barcode[]` array. Nothing
 * normalised them, so `merge.ts` and `filter.ts` compared strings and a row
 * matched or missed depending on which spelling the source happened to print
 * first. Digits only, leading zeros dropped.
 */
export function normalizeGtin(gtin: string | null): string | null {
  if (!gtin) return null;
  const digits = gtin.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * A key for "the same product, offered in more than one place".
 *
 * A GTIN is the only identity worth trusting across marketplaces; without one
 * we fall back to normalised title plus price, which is deliberately
 * conservative — it groups two listings of the same book at the same price and
 * nothing else. Fuzzy title matching is NOT done here: it is exactly the kind
 * of helpfulness that merges two different bicycles and then reports the wrong
 * one as the cheaper.
 *
 * The fallback keys on the BARE price, while ranking keys on what you actually
 * pay (`totalPrice ?? price`). That is deliberate and not an oversight: postage
 * varies per seller, so the same book at 5,50 € from two shops is one product
 * and two offers. Identity must not move when postage does.
 */
export function identityKey(l: Listing): string | null {
  const gtin = normalizeGtin(l.gtin);
  if (gtin) return `gtin:${gtin}`;
  const t = normalizeTitle(l.title);
  const p = l.price?.minor;
  return t.length >= 12 && p !== undefined ? `tp:${t}:${p}` : null;
}

export interface ListingGroup {
  /** What the rows have in common, when they were grouped at all. */
  readonly identity: string | null;
  readonly listings: readonly Listing[];
  /**
   * True when the shared identity is a code the rows happen to share rather
   * than one product seen more than once.
   *
   * The test is whether one source contributed several AGGREGATE rows —
   * `priceKind: 'from'`, i.e. rows that each already stand for many offers of
   * one catalogue entry. Measured on Discogs: barcode `5099996601419` covers
   * the 2009 UK pressing, the 2015 European one and a 2025 tour edition
   * carrying Ralf Hütter's signature. All three are that barcode; only one of
   * them is 11,18 €.
   *
   * Several rows from one source is NOT the test on its own, and the first
   * version of this rule got that wrong: three Booklooker sellers offering the
   * same ISBN are one product and three offers, and naming the cheapest is
   * exactly the answer wanted. The difference is whether a row is an offer or a
   * catalogue entry, and `from` is the marker the data already carries for the
   * second.
   *
   * An ambiguous group may be SHOWN — "three editions under one barcode" is
   * useful — but it must never be collapsed to a single representative row.
   */
  readonly ambiguous: boolean;
}

/**
 * Group equal offers across providers. Rows without a trustworthy identity
 * stay in a group of their own rather than being lumped together.
 */
export function groupByIdentity(listings: readonly Listing[]): ListingGroup[] {
  const groups = new Map<string, Listing[]>();
  const singles: ListingGroup[] = [];
  for (const l of listings) {
    const id = identityKey(l);
    if (id === null) {
      singles.push({ identity: null, listings: [l], ambiguous: false });
      continue;
    }
    const bucket = groups.get(id);
    if (bucket) bucket.push(l);
    else groups.set(id, [l]);
  }
  const grouped = [...groups].map(([identity, ls]) => {
    const aggregatesPerProvider = new Map<ProviderId, number>();
    for (const l of ls) {
      if (l.priceKind !== 'from') continue;
      aggregatesPerProvider.set(l.provider, (aggregatesPerProvider.get(l.provider) ?? 0) + 1);
    }
    return {
      identity,
      listings: ls,
      ambiguous: [...aggregatesPerProvider.values()].some((n) => n > 1),
    };
  });
  // Groups with something to compare first — that is the question this whole
  // shape exists to answer.
  grouped.sort((a, b) => b.listings.length - a.listings.length);
  return [...grouped, ...singles];
}

function priceOf(l: Listing): number {
  const p = l.totalPrice ?? l.price;
  // Unpriced rows sort last under every price order rather than first under
  // ascending and last under descending, which is what a plain `?? 0` does.
  return p ? p.minor : Number.MAX_SAFE_INTEGER;
}

export function sortListings(listings: readonly Listing[], sort: SortKey | undefined): Listing[] {
  const out = [...listings];
  switch (sort) {
    case 'price-asc':
      return out.sort((a, b) => priceOf(a) - priceOf(b));
    case 'price-desc':
      return out.sort((a, b) => {
        const pa = a.totalPrice ?? a.price;
        const pb = b.totalPrice ?? b.price;
        if (!pa && !pb) return 0;
        if (!pa) return 1;
        if (!pb) return -1;
        return pb.minor - pa.minor;
      });
    case 'newest':
      return out.sort((a, b) => (b.listedAt ?? '').localeCompare(a.listedAt ?? ''));
    case 'ending-soonest':
      return out.sort((a, b) => {
        // Only auctions really end. A fixed-price listing's end date rolls
        // forward forever, so sorting it in would put permanent listings above
        // an auction closing in ten minutes.
        const ea = a.priceKind === 'auction' ? a.endsAt : null;
        const eb = b.priceKind === 'auction' ? b.endsAt : null;
        if (!ea && !eb) return 0;
        if (!ea) return 1;
        if (!eb) return -1;
        return ea.localeCompare(eb);
      });
    default:
      // Relevance across marketplaces has no shared meaning — each source ranks
      // by its own opaque score. Keeping provider order and interleaving them
      // fairly is the honest answer; inventing a cross-provider score would
      // dress a guess up as a ranking.
      return out;
  }
}

/**
 * Interleave providers round-robin so no single fast, chatty source fills the
 * first screen. Only used for the relevance (default) order.
 */
export function interleaveByProvider(byProvider: ReadonlyMap<ProviderId, readonly Listing[]>): Listing[] {
  const queues = [...byProvider.values()].map((l) => [...l]);
  const out: Listing[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        out.push(next);
        progress = true;
      }
    }
  }
  return out;
}

/**
 * Best row in a group: cheapest, then better condition, then newer.
 *
 * `null` for an ambiguous group. Answering "11,18 €" for a bucket holding a
 * 31,00 € signed edition is not a rounding problem, it is the wrong answer to
 * "what does this cost" — and it is the answer the caller would print.
 */
export function bestOf(group: ListingGroup): Listing | null {
  if (group.ambiguous) return null;
  return (
    [...group.listings].sort(
      (a, b) =>
        priceOf(a) - priceOf(b) ||
        conditionRank(a.condition) - conditionRank(b.condition) ||
        (b.listedAt ?? '').localeCompare(a.listedAt ?? ''),
    )[0] ?? null
  );
}
