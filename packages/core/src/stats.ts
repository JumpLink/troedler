/**
 * Price statistics over a result set — the "is this a good price?" half.
 *
 * Median, not mean: second-hand price distributions have a long right tail
 * (one mint collector's item among forty used ones) and a mean chases it.
 * The p25/p75 band is what actually tells you whether an offer is cheap.
 *
 * **A band is only worth printing over comparable numbers, and that is the part
 * this file gets wrong easily.** Measured on a real four-source run: the band
 * ran from 0,40 € to 43.800,00 €, where the minimum was a Discogs *aggregate*
 * ("cheapest of 191 copies worldwide, converted by Discogs"), the median a Quoka
 * asking price, the maximum the current *bid* on a VW in a customs auction, and
 * the Booklooker rows in between were the only ones that included postage. Every
 * quantile was arithmetically exact — checked by hand, four bands, no error —
 * and the result was meaningless. "deutlich über dem Feld" was then printed on
 * top of it, which reads like a statement about a market.
 *
 * So the band now refuses more than it computes: one basis, one currency, one
 * notion of money, and it says out loud what it covered and what it left out.
 * The caller is expected to build one band per source, because across sources
 * these things practically never agree.
 *
 * Scope note, and it is a real constraint rather than caution: eBay's API
 * licence forbids using eBay content "to suggest or model prices for items
 * listed on eBay". So this describes the offers currently in front of the
 * user — it does not estimate what a thing is worth, and it must not grow into
 * a valuation feature.
 */

import { money, type Money } from './money.ts';
import type { Listing, PriceKind } from './listing.ts';

/**
 * What the numbers in a band mean. A band over two of these is not a band.
 *
 *   - `asking` — what the seller wants for this one item.
 *   - `auction` — the current highest bid, which only ever goes up.
 *   - `from`   — the cheapest of N copies, aggregated by the source. Not an
 *     offer: on Discogs the linked page can start at three times the number.
 */
export type PriceBasis = 'asking' | 'auction' | 'from';

// Not exported: surfaces display `BASIS_LABEL[stats.basis]` and never need to
// classify a row themselves. An export with no caller is a claim nobody checks.
function basisOf(kind: PriceKind): PriceBasis {
  if (kind === 'auction') return 'auction';
  if (kind === 'from') return 'from';
  return 'asking';
}

export const BASIS_LABEL: Record<PriceBasis, string> = {
  asking: 'Forderungspreise',
  auction: 'aktuelle Gebote',
  from: 'Ab-Preise (günstigstes von mehreren Exemplaren)',
};

export interface PriceStats {
  /** Rows in the band. */
  readonly count: number;
  /** Rows offered to it — `count` plus everything the caveats explain away. */
  readonly considered: number;
  readonly currency: string;
  /** What the numbers mean. Never mixed. */
  readonly basis: PriceBasis;
  /**
   * Whether the band is over prices INCLUDING shipping.
   *
   * All-or-nothing on purpose: `totalPrice ?? price` silently compared
   * Booklooker end prices against Discogs prices without postage. When not
   * every row knows its shipping, the band drops back to the bare price for
   * all of them and says so.
   */
  readonly shippingIncluded: boolean;
  readonly min: Money;
  readonly p25: Money;
  readonly median: Money;
  readonly p75: Money;
  readonly max: Money;
  /** What was left out and why. Belongs next to the band, never dropped. */
  readonly caveats: readonly string[];
}

/** A band, or the reason there is none. Never a silent absence. */
export type PriceBand =
  | { readonly kind: 'band'; readonly stats: PriceStats }
  | { readonly kind: 'none'; readonly reason: string };

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function majority<T>(items: readonly T[], keyOf: (item: T) => string): { key: string; kept: T[] } {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(item);
    else buckets.set(k, [item]);
  }
  const [key, kept] = [...buckets].sort((a, b) => b[1].length - a[1].length)[0];
  return { key, kept };
}

/** Minimum rows for a band. A "median" of two numbers is theatre. */
const MIN_ROWS = 3;

/**
 * The band over one comparable set of offers — or the reason there is none.
 *
 * Build one per source. Handing this the flat cross-provider list is how the
 * meaningless band above came about, and it is why the reason string exists:
 * a missing band must be explainable, not just absent.
 */
export function priceBand(listings: readonly Listing[]): PriceBand {
  const considered = listings.length;
  if (considered < MIN_ROWS) {
    return { kind: 'none', reason: `zu wenige Angebote für ein Preisband (${considered})` };
  }

  const caveats: string[] = [];

  // 1. One basis. A "from" price and a live bid are not the same kind of number.
  const byBasis = majority(listings, (l) => basisOf(l.priceKind));
  const basis = byBasis.key as PriceBasis;
  if (byBasis.kept.length < considered) {
    const other = considered - byBasis.kept.length;
    caveats.push(`${other} Zeile(n) mit anderer Preisart ausgelassen`);
  }

  // 2. Priced rows only. Unpriced rows are excluded, never counted as zero.
  const priced = byBasis.kept.filter((l) => (l.price?.minor ?? 0) > 0);
  if (priced.length < byBasis.kept.length) {
    caveats.push(`${byBasis.kept.length - priced.length} Zeile(n) ohne Preis ausgelassen`);
  }
  if (priced.length < MIN_ROWS) {
    return {
      kind: 'none',
      reason: `weniger als ${MIN_ROWS} vergleichbare Preise (${BASIS_LABEL[basis]})`,
    };
  }

  // 3. One currency. Converting with a made-up rate would make the median
  //    quietly wrong instead of visibly absent.
  const byCurrency = majority(priced, (l) => l.price?.currency ?? '');
  const currency = byCurrency.key;
  if (byCurrency.kept.length < priced.length) {
    caveats.push(`${priced.length - byCurrency.kept.length} Zeile(n) in anderer Währung ausgelassen`);
  }
  if (byCurrency.kept.length < MIN_ROWS) {
    return { kind: 'none', reason: 'die Preise stehen in verschiedenen Währungen' };
  }

  // 4. One notion of money for every row in the band.
  const rows = byCurrency.kept;
  const withShipping = rows.filter((l) => l.totalPrice !== null && l.totalPrice.currency === currency);
  const shippingIncluded = withShipping.length === rows.length;
  if (!shippingIncluded && withShipping.length > 0) {
    caveats.push(
      `ohne Versand gerechnet — nur ${withShipping.length} von ${rows.length} Zeilen nennen ihn`,
    );
  }

  const values = rows
    .map((l) => (shippingIncluded ? (l.totalPrice as Money).minor : (l.price as Money).minor))
    .sort((a, b) => a - b);

  return {
    kind: 'band',
    stats: {
      count: values.length,
      considered,
      currency,
      basis,
      shippingIncluded,
      min: money(values[0], currency),
      p25: money(quantile(values, 0.25), currency),
      median: money(quantile(values, 0.5), currency),
      p75: money(quantile(values, 0.75), currency),
      max: money(values[values.length - 1], currency),
      caveats,
    },
  };
}

export type PriceVerdict = 'bargain' | 'below' | 'typical' | 'above' | 'expensive' | 'unknown';

/**
 * Where one offer sits in the current field. Descriptive, deliberately coarse:
 * five buckets you could read off the band yourself, not a score that implies
 * more precision than a few dozen listings can carry.
 *
 * `unknown` whenever the row is not the same kind of number as the band. A
 * Discogs "from 7,68 €" measured against a field of asking prices comes out a
 * bargain every single time — not because it is cheap, but because a minimum
 * over 191 copies is competing in the wrong contest.
 */
export function verdictFor(listing: Listing, stats: PriceStats | null): PriceVerdict {
  if (!stats) return 'unknown';
  if (basisOf(listing.priceKind) !== stats.basis) return 'unknown';
  const p = stats.shippingIncluded ? listing.totalPrice : listing.price;
  if (!p || p.currency !== stats.currency || p.minor <= 0) return 'unknown';
  if (p.minor < stats.p25.minor - (stats.median.minor - stats.p25.minor)) return 'bargain';
  if (p.minor < stats.p25.minor) return 'below';
  if (p.minor <= stats.p75.minor) return 'typical';
  if (p.minor <= stats.p75.minor + (stats.p75.minor - stats.median.minor)) return 'above';
  return 'expensive';
}

export const VERDICT_LABEL: Record<PriceVerdict, string> = {
  bargain: 'deutlich unter dem Feld',
  below: 'unter dem Feld',
  typical: 'im üblichen Bereich',
  above: 'über dem Feld',
  expensive: 'deutlich über dem Feld',
  unknown: '—',
};
