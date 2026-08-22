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
  parseListingKey,
  priceBand,
  queryGaps,
  searchAll,
  verdictFor,
  type Listing,
  type PriceBand,
  type PriceVerdict,
  type ProviderId,
  type ProviderReport,
  type SearchOutcome,
  type SearchQuery,
} from '@troedler/core';

import { selectProviders, type Context } from '../context.ts';

/**
 * One source's finished work, complete enough to render on its own.
 *
 * Handed to `onSource` as it settles, and built by the SAME code that fills the
 * maps in `SearchResult` — not a second computation that happens to agree. A
 * surface that draws a panel from this and then redraws it from the returned
 * result must not be able to see the band change.
 */
export interface SourceResult {
  readonly report: ProviderReport;
  readonly listings: readonly Listing[];
  /** `null` unless this source answered `ok` — the kernel bands only what it grouped. */
  readonly band: PriceBand | null;
  readonly verdicts: ReadonlyMap<string, PriceVerdict>;
}

export interface SearchInput extends SearchQuery {
  readonly providers?: readonly ProviderId[];
  readonly merge?: boolean;
  /** Group the rows by product identity across sources. */
  readonly compare?: boolean;
  readonly total?: number;
  readonly signal?: AbortSignal;
  /**
   * Announced for every source before any of them is asked, in list order.
   *
   * A window lays out one pending panel per source from this, so a result area
   * can never appear without the explanation that belongs beside it.
   */
  readonly onSourceStarted?: (provider: ProviderId, label: string) => void;
  /** One source's work, as it lands. Completion order, not list order. */
  readonly onSource?: (result: SourceResult) => void;
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
  /**
   * What the query asked for that cannot take effect — a postcode without a
   * radius, say. Empty when the query is coherent. Every surface must show it:
   * a wish that is silently dropped is worse than one that is refused.
   */
  readonly gaps: readonly string[];
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

  const bands = new Map<ProviderId, PriceBand>();
  const verdicts = new Map<string, PriceVerdict>();

  const outcome = await searchAll(providers, query, {
    merge: input.merge,
    group: input.compare,
    totalLimit: clamp(input.total, RESULTS_TOTAL),
    signal: input.signal,
    onStarted: input.onSourceStarted,
    // The band is computed HERE and stored into the very maps this function
    // returns, so the panel a surface paints as a source lands and the panel it
    // paints from the final result are the same numbers by construction rather
    // than by two code paths agreeing. The `ok` guard is the kernel's own rule:
    // only `ok` providers reach `outcome.grouped`, and banding the rest would
    // print "kein Preisband — zu wenige Angebote" about a source that never
    // answered at all.
    onSettled: ({ report, listings }) => {
      let band: PriceBand | null = null;
      const mine = new Map<string, PriceVerdict>();
      if (report.outcome === 'ok') {
        band = priceBand(listings);
        bands.set(report.provider, band);
        const stats = band.kind === 'band' ? band.stats : null;
        for (const listing of listings) {
          const verdict = verdictFor(listing, stats);
          verdicts.set(listing.key, verdict);
          mine.set(listing.key, verdict);
        }
      }
      input.onSource?.({ report, listings, band, verdicts: mine });
    },
  });

  return {
    outcome,
    bands,
    verdicts,
    noSourceAnswered: allSourcesUnavailable(outcome),
    gaps: queryGaps(query),
  };
}

/** Flatten an outcome for callers that want one list regardless of grouping. */
export function allListings(outcome: SearchOutcome): Listing[] {
  return outcome.merged ? [...outcome.merged] : [...outcome.grouped.values()].flat();
}

export interface ListingLookup {
  readonly listing: Listing | null;
  /** Required notice for this source's rows, when it has one. */
  readonly disclaimer: string | null;
  /** Set when the key could not be looked up at all — a different fact from "gone". */
  readonly problem: string | null;
}

/**
 * One offer by its key — read-only, and the only read-only route to it.
 *
 * It existed only inside the MCP tool. The CLI's route to a single offer was
 * `item watch`, which WRITES to the store, while the Justiz-Auktion adapter —
 * the one source that cannot be searched at all — printed
 * "Einzelne Auktionen sind abrufbar: `troedler show justiz-auktion:<id>`" under
 * every single search. That command did not exist. The one escape hatch offered
 * for the one unsearchable source was a sentence.
 *
 * `listing: null` with no problem means the offer is gone, which is an answer.
 */
export async function getListing(
  context: Context,
  key: string,
  signal?: AbortSignal,
): Promise<ListingLookup> {
  const parsed = parseListingKey(key);
  if (!parsed) {
    return {
      listing: null,
      disclaimer: null,
      problem: `"${key}" ist kein gültiger Schlüssel — erwartet wird <quelle>:<id>.`,
    };
  }
  const provider = context.providers.find((p) => p.capabilities.id === parsed.provider);
  if (!provider) {
    return { listing: null, disclaimer: null, problem: `Unbekannte Quelle in "${key}".` };
  }
  if (!provider.getListing) {
    return {
      listing: null,
      disclaimer: provider.capabilities.disclaimer,
      problem: `${provider.capabilities.label} kann einzelne Angebote nicht nachschlagen.`,
    };
  }
  return {
    listing: await provider.getListing(parsed.id, signal),
    disclaimer: provider.capabilities.disclaimer,
    problem: null,
  };
}
