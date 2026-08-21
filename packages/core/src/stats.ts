/**
 * Price statistics over a result set — the "is this a good price?" half.
 *
 * Median, not mean: second-hand price distributions have a long right tail
 * (one mint collector's item among forty used ones) and a mean chases it.
 * The p25/p75 band is what actually tells you whether an offer is cheap.
 *
 * Scope note, and it is a real constraint rather than caution: eBay's API
 * licence forbids using eBay content "to suggest or model prices for items
 * listed on eBay". So this describes the offers currently in front of the
 * user — it does not estimate what a thing is worth, and it must not grow into
 * a valuation feature.
 */

import { money, type Money } from './money.ts';
import type { Listing } from './listing.ts';

export interface PriceStats {
  readonly count: number;
  readonly currency: string;
  readonly min: Money;
  readonly p25: Money;
  readonly median: Money;
  readonly p75: Money;
  readonly max: Money;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Statistics over the priced rows sharing the majority currency.
 *
 * Rows without a price are excluded rather than counted as zero, and mixed
 * currencies are not converted — a made-up exchange rate would make the median
 * quietly wrong instead of visibly absent. `null` when fewer than three prices
 * remain, because a "median" of two numbers is theatre.
 */
export function priceStats(listings: readonly Listing[]): PriceStats | null {
  const priced = listings
    .map((l) => l.totalPrice ?? l.price)
    .filter((p): p is Money => p !== null && p.minor > 0);
  if (priced.length < 3) return null;

  const byCurrency = new Map<string, number[]>();
  for (const p of priced) {
    const bucket = byCurrency.get(p.currency);
    if (bucket) bucket.push(p.minor);
    else byCurrency.set(p.currency, [p.minor]);
  }
  const [currency, values] = [...byCurrency].sort((a, b) => b[1].length - a[1].length)[0];
  if (values.length < 3) return null;

  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    currency,
    min: money(sorted[0], currency),
    p25: money(quantile(sorted, 0.25), currency),
    median: money(quantile(sorted, 0.5), currency),
    p75: money(quantile(sorted, 0.75), currency),
    max: money(sorted[sorted.length - 1], currency),
  };
}

export type PriceVerdict = 'bargain' | 'below' | 'typical' | 'above' | 'expensive' | 'unknown';

/**
 * Where one offer sits in the current field. Descriptive, deliberately coarse:
 * five buckets you could read off the band yourself, not a score that implies
 * more precision than a few dozen listings can carry.
 */
export function verdictFor(listing: Listing, stats: PriceStats | null): PriceVerdict {
  const p = listing.totalPrice ?? listing.price;
  if (!stats || !p || p.currency !== stats.currency || p.minor <= 0) return 'unknown';
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
