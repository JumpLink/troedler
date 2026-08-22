/**
 * The search action — what every surface calls.
 *
 * Thin on purpose: the fan-out, the isolation of a failing provider and the
 * post-filtering all live in `@troedler/core`, because they are the parts with
 * judgement in them and they must be testable without a network. What is left
 * here is turning CLI or MCP arguments into a `SearchQuery` and adding the
 * price statistics.
 */

import {
  RESULTS_TOTAL,
  allSourcesUnavailable,
  clamp,
  priceBand,
  searchAll,
  verdictFor,
  type Listing,
  type PriceBand,
  type PriceVerdict,
  type ProviderId,
  type SearchOutcome,
  type SearchQuery,
} from '@troedler/core';

import { selectProviders, type Context } from '../context.ts';

export interface SearchInput extends SearchQuery {
  readonly providers?: readonly ProviderId[];
  readonly merge?: boolean;
  /** Group the rows by product identity across sources. */
  readonly compare?: boolean;
  readonly total?: number;
  readonly signal?: AbortSignal;
}

export interface SearchResult {
  readonly outcome: SearchOutcome;
  /**
   * One price band PER SOURCE, keyed by provider — never one across all of them.
   *
   * The single cross-provider band was measured and it was nonsense: a Discogs
   * aggregate minimum, a Quoka asking price and the current bid on a car in the
   * same quartiles, with only the Booklooker rows carrying postage. Each source
   * speaks its own kind of number, so each gets its own band, and a source whose
   * rows are not comparable even among themselves gets a stated reason instead.
   */
  readonly bands: ReadonlyMap<ProviderId, PriceBand>;
  /** Per-listing verdict, keyed by `Listing.key`. Judged against that row's OWN source's band. */
  readonly verdicts: ReadonlyMap<string, PriceVerdict>;
  /**
   * True when not one provider answered. The caller must say so out loud
   * rather than printing "0 Treffer" — those are different facts and only one
   * of them means "this thing does not exist second-hand".
   */
  readonly noSourceAnswered: boolean;
}

export async function search(context: Context, input: SearchInput): Promise<SearchResult> {
  const providers = selectProviders(context, input.providers);
  const query: SearchQuery = {
    text: input.text,
    minPriceMinor: input.minPriceMinor,
    maxPriceMinor: input.maxPriceMinor,
    currency: input.currency ?? context.config.defaults.currency ?? 'EUR',
    condition: input.condition,
    sellerType: input.sellerType,
    delivery: input.delivery,
    postalCode: input.postalCode ?? context.config.defaults.postalCode,
    radiusKm: input.radiusKm ?? context.config.defaults.radiusKm,
    since: input.since,
    gtin: input.gtin,
    sort: input.sort,
    limit: input.limit,
  };

  const outcome = await searchAll(providers, query, {
    merge: input.merge,
    group: input.compare,
    totalLimit: clamp(input.total, RESULTS_TOTAL),
    signal: input.signal,
  });

  const bands = new Map<ProviderId, PriceBand>();
  const verdicts = new Map<string, PriceVerdict>();
  for (const [provider, listings] of outcome.grouped) {
    const band = priceBand(listings);
    bands.set(provider, band);
    const stats = band.kind === 'band' ? band.stats : null;
    for (const listing of listings) verdicts.set(listing.key, verdictFor(listing, stats));
  }

  return { outcome, bands, verdicts, noSourceAnswered: allSourcesUnavailable(outcome) };
}

/** Flatten an outcome for callers that want one list regardless of grouping. */
export function allListings(outcome: SearchOutcome): Listing[] {
  return outcome.merged ? [...outcome.merged] : [...outcome.grouped.values()].flat();
}
