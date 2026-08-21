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
  priceStats,
  searchAll,
  verdictFor,
  type Listing,
  type PriceStats,
  type PriceVerdict,
  type ProviderId,
  type SearchOutcome,
  type SearchQuery,
} from '@troedler/core';

import { selectProviders, type Context } from '../context.ts';

export interface SearchInput extends SearchQuery {
  readonly providers?: readonly ProviderId[];
  readonly merge?: boolean;
  readonly total?: number;
  readonly signal?: AbortSignal;
}

export interface SearchResult {
  readonly outcome: SearchOutcome;
  /** Statistics over everything that came back, across providers. */
  readonly stats: PriceStats | null;
  /** Per-listing verdict, keyed by `Listing.key`. */
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
    totalLimit: clamp(input.total, RESULTS_TOTAL),
    signal: input.signal,
  });

  const all: Listing[] = [...outcome.grouped.values()].flat();
  const stats = priceStats(all);
  const verdicts = new Map<string, PriceVerdict>();
  for (const listing of all) verdicts.set(listing.key, verdictFor(listing, stats));

  return { outcome, stats, verdicts, noSourceAnswered: allSourcesUnavailable(outcome) };
}

/** Flatten an outcome for callers that want one list regardless of grouping. */
export function allListings(outcome: SearchOutcome): Listing[] {
  return outcome.merged ? [...outcome.merged] : [...outcome.grouped.values()].flat();
}
