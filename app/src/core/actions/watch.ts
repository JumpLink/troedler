/**
 * Saved searches and the watchlist — the "tell me when something turns up" half.
 *
 * The rule that makes alerts trustworthy: **only this file writes to the seen
 * index.** A plain `troedler search` must never mark anything as seen, because
 * then the next `watch run` would stay silent about offers the user never
 * actually laid eyes on. Alerts are only worth anything if "new" means what it
 * says.
 */

import type { Listing, ProviderId, SearchQuery } from '@troedler/core';
import { parseListingKey } from '@troedler/core';
import type { SavedSearch } from '@troedler/store';

import type { Context } from '../context.ts';
import { allListings, search } from './search.ts';

export interface WatchRunResult {
  readonly name: string;
  readonly fresh: readonly Listing[];
  readonly seenTotal: number;
  /** Provider reports of the underlying search, so a silent failure stays visible. */
  readonly reports: Awaited<ReturnType<typeof search>>['outcome']['reports'];
  readonly noSourceAnswered: boolean;
}

export function addSearch(
  context: Context,
  name: string,
  query: SearchQuery,
  providers: readonly ProviderId[],
  now = new Date(),
): SavedSearch {
  const store = context.store();
  store.saveSearch(name, query, providers, now.toISOString());
  return store.getSearch(name)!;
}

export function listSearches(context: Context): SavedSearch[] {
  return context.store().listSearches();
}

export function removeSearch(context: Context, name: string): boolean {
  return context.store().removeSearch(name);
}

/**
 * Run one saved search and report only what has not been seen before.
 *
 * When no provider answered at all, the run is NOT recorded. Otherwise the
 * first failed run would poison the index: everything found afterwards would
 * look "already seen" against an empty baseline, and the user would be told
 * about nothing, forever, with no error to show for it.
 */
export async function runSearch(context: Context, name: string, now = new Date()): Promise<WatchRunResult> {
  const store = context.store();
  const saved = store.getSearch(name);
  if (!saved) throw new Error(`Keine gespeicherte Suche namens "${name}".`);

  const result = await search(context, { ...saved.query, providers: saved.providers });
  const listings = allListings(result.outcome);

  if (result.noSourceAnswered) {
    return {
      name,
      fresh: [],
      seenTotal: store.stats().seen,
      reports: result.outcome.reports,
      noSourceAnswered: true,
    };
  }

  const fresh = store.recordRun(name, listings, now.toISOString());
  return {
    name,
    fresh,
    seenTotal: store.stats().seen,
    reports: result.outcome.reports,
    noSourceAnswered: false,
  };
}

export function watchListing(
  context: Context,
  listing: Listing,
  note: string | null,
  now = new Date(),
): void {
  context.store().watch(listing, note, now.toISOString());
}

export function unwatchListing(context: Context, key: string): boolean {
  const parsed = parseListingKey(key);
  if (!parsed) throw new Error(`"${key}" ist kein gültiger Angebots-Schlüssel (erwartet: <provider>:<id>).`);
  return context.store().unwatch(parsed.provider, parsed.id);
}

export interface WatchCheckRow {
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly previousMinor: number | null;
  readonly currentMinor: number | null;
  readonly currency: string | null;
  readonly gone: boolean;
  readonly changed: boolean;
  readonly error: string | null;
}

/**
 * Re-check every watched offer.
 *
 * A provider without `getListing` cannot answer this, and that is reported per
 * row rather than swallowed — "no change" and "could not look" are different
 * answers, and only one of them should let the user relax.
 */
export async function checkWatched(context: Context, now = new Date()): Promise<WatchCheckRow[]> {
  const store = context.store();
  const byId = new Map(context.providers.map((p) => [p.capabilities.id, p]));
  const rows: WatchCheckRow[] = [];

  for (const item of store.listWatched()) {
    const provider = byId.get(item.provider);
    const base = {
      key: `${item.provider}:${item.listingId}`,
      title: item.title,
      url: item.url,
      previousMinor: item.lastPriceMinor,
      currency: item.currency,
    };
    if (!provider?.getListing) {
      rows.push({
        ...base,
        currentMinor: null,
        gone: false,
        changed: false,
        error: 'Diese Quelle kann einzelne Angebote nicht nachschlagen.',
      });
      continue;
    }
    // Ask whether the source is usable before touching it. `searchAll` does
    // this for every provider; without it here, a watchlist entry left over
    // from a source the user has since switched off would still send a request
    // to that host — and the sources people switch off are the ones whose
    // operators asked not to be contacted automatically.
    const status = await provider.status();
    if (!status.configured || status.problem) {
      rows.push({
        ...base,
        currentMinor: null,
        gone: false,
        changed: false,
        error: status.problem?.message ?? 'Quelle ist nicht konfiguriert.',
      });
      continue;
    }
    try {
      const listing = await provider.getListing(item.listingId);
      const price = listing ? (listing.totalPrice ?? listing.price) : null;
      const gone = listing === null;
      store.recordCheck(
        item.provider,
        item.listingId,
        { minor: price?.minor ?? null, currency: price?.currency ?? item.currency, gone },
        now.toISOString(),
      );
      rows.push({
        ...base,
        currentMinor: price?.minor ?? null,
        currency: price?.currency ?? item.currency,
        gone,
        changed: price != null && item.lastPriceMinor != null && price.minor !== item.lastPriceMinor,
        error: null,
      });
    } catch (err) {
      rows.push({
        ...base,
        currentMinor: null,
        gone: false,
        changed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return rows;
}
