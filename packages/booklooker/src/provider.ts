/**
 * The `MarketProvider` for booklooker.de — Germany's second-hand book market.
 *
 * Why it is on by default while kleinanzeigen is not: booklooker publishes a
 * REST API, hands out a free key to anyone with an account, and documents the
 * search interface down to the call budget. Reading it with a key is the use
 * the operator built it for. The `docs/quellen/booklooker.de.md` record holds
 * the measurements this file's constants come from.
 *
 * Its real value to a meta-search is not the books. It is the **ISBN**: with
 * eBay it is one of only two sources here that return a GTIN, and a GTIN is
 * the only identity `identityKey` in the kernel will group two marketplaces
 * on. Without this adapter, cross-provider grouping is title-plus-price
 * guesswork.
 */

import {
  PROVIDER_LABEL,
  ProviderError,
  type MarketProvider,
  type ProviderCapabilities,
  type ProviderResult,
  type ProviderStatus,
  type SearchQuery,
} from '@troedler/core';
import { MEDIA, SHIPPING_COUNTRIES, type BooklookerMedium, type ShippingCountry } from './types.ts';
import {
  API_HOST,
  BOOKLOOKER_RESULTS,
  BooklookerSession,
  buildSearchParams,
  type BooklookerConfig,
  type BooklookerHttp,
} from './request.ts';
import { PROVIDER, parseSearchResponse } from './parse.ts';

export interface BooklookerDeps {
  readonly http: BooklookerHttp;
  /** Injected rather than read from a global, so a test needs no environment. */
  readonly env: Record<string, string | undefined>;
  /** Whether the user switched this source on. The gate refuses when false. */
  readonly enabled: boolean;
  /** Injected clock — the token's idle window and `fetchedAt` both hang off it. */
  readonly now?: () => number;
}

const TERMS_DOC = 'docs/quellen/booklooker.de.md';

interface Settings {
  readonly apiKey: string;
  readonly medium: BooklookerMedium;
  readonly shippingCountry: ShippingCountry;
  /** A misconfiguration, phrased for the person who typed it. `null` when fine. */
  readonly problem: string | null;
}

/**
 * Read the three environment variables.
 *
 * A bad value is a stated problem rather than a silent fallback: falling back
 * to `book` when someone wrote `BOOKLOOKER_MEDIUM=vinyl` would search the
 * wrong catalogue and look like "booklooker has no records".
 */
function readSettings(env: Record<string, string | undefined>): Settings {
  const apiKey = (env.BOOKLOOKER_API_KEY ?? '').trim();
  const rawMedium = (env.BOOKLOOKER_MEDIUM ?? 'book').trim().toLowerCase();
  const rawCountry = (env.BOOKLOOKER_SHIPPING_COUNTRY ?? 'de').trim().toLowerCase();

  const medium = MEDIA.find((m) => m === rawMedium);
  const shippingCountry = SHIPPING_COUNTRIES.find((c) => c === rawCountry);

  const problem = !medium
    ? `BOOKLOOKER_MEDIUM="${rawMedium}" ist kein Medientyp von Booklooker (${MEDIA.join(', ')}).`
    : !shippingCountry
      ? `BOOKLOOKER_SHIPPING_COUNTRY="${rawCountry}" wird nicht unterstützt (${SHIPPING_COUNTRIES.join(', ')}).`
      : null;

  return { apiKey, medium: medium ?? 'book', shippingCountry: shippingCountry ?? 'de', problem };
}

export function createBooklookerProvider(deps: BooklookerDeps): MarketProvider {
  const settings = readSettings(deps.env);
  const config: BooklookerConfig = {
    apiKey: settings.apiKey,
    medium: settings.medium,
    shippingCountry: settings.shippingCountry,
    enabled: deps.enabled,
  };
  const now = deps.now ?? (() => Date.now());
  const session = new BooklookerSession(deps.http, config, now);

  const capabilities: ProviderCapabilities = {
    id: PROVIDER,
    label: PROVIDER_LABEL.booklooker,
    host: API_HOST,
    access: 'official-api',
    freshness: 'live',
    // Only what booklooker really does itself, and only at the granularity the
    // query means it. `condition` and `since` are pushed down as a narrowing
    // hint but stay off this list, because booklooker's new/used flag and its
    // whole-day `dateFrom` are coarser than the query — the kernel has to
    // finish both. See the note in `buildSearchParams`.
    serverFilters: ['sellerType', 'gtin', 'sort'],
    serverSorts: ['price-asc', 'price-desc'],
    // "limit … maximal 150", and there is no paging on this interface: 150 is
    // the entire ceiling for one search, not one page of it.
    maxResults: BOOKLOOKER_RESULTS.max,
    cache: {
      // No licence term caps this — booklooker's AGB say nothing about
      // automated access or reuse (read 2026-08-21), so the number comes from
      // the call budget instead: 50 searches per ten minutes is not a budget
      // to spend on repeating the same question.
      ttlSeconds: 900,
      memoryOnly: false,
    },
    enabledByDefault: true,
    termsDoc: TERMS_DOC,
    disclaimer: null,
    note:
      `Freier API-Key im Booklooker-Konto unter „Persönliche Daten → API Key"; ohne BOOKLOOKER_API_KEY bleibt die Quelle stumm. ` +
      `Durchsucht den Medientyp „${settings.medium}" (BOOKLOOKER_MEDIUM) und dabei nur Titel bzw. ISBN — die Schnittstelle verknüpft alle Suchfelder mit UND. ` +
      `Kostenlos sind 50 Suchen je 10 Minuten.`,
  };

  async function status(): Promise<ProviderStatus> {
    // Deliberately offline. `searchAll` calls this before every search, and an
    // authentication round trip here would spend a tenth of the ten-minute
    // budget on finding out whether the budget exists.
    if (!deps.enabled) {
      return {
        configured: settings.apiKey !== '',
        problem: { kind: 'blocked-by-policy', message: 'Booklooker ist in der Konfiguration abgeschaltet.' },
      };
    }
    if (settings.apiKey === '') {
      return {
        configured: false,
        problem: {
          kind: 'not-configured',
          message: `Kein BOOKLOOKER_API_KEY gesetzt. Der Schlüssel ist kostenlos — siehe ${TERMS_DOC}.`,
        },
      };
    }
    if (settings.problem) {
      return { configured: true, problem: { kind: 'not-configured', message: settings.problem } };
    }
    return { configured: true, problem: null };
  }

  async function search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
    const state = await status();
    if (state.problem) throw new ProviderError(PROVIDER, state.problem.kind, state.problem.message);

    const plan = buildSearchParams(query, config);
    if (!plan.answerable) {
      // Zero rows WITHOUT a request, and the reason travels with them. This is
      // the one honest empty result this adapter can produce: nothing was
      // asked, so nothing was found, and `requests: 0` says so in `--explain`.
      return {
        provider: PROVIDER,
        listings: [],
        applied: [],
        truncated: false,
        totalEstimate: null,
        requests: 0,
        warnings: plan.warnings,
      };
    }

    const { envelope, requests } = await session.search(plan.params, signal);
    const { listings, warnings } = parseSearchResponse(envelope, {
      now: new Date(now()),
      currency: 'EUR',
    });

    return {
      provider: PROVIDER,
      listings,
      applied: plan.applied,
      // No paging here: a full page IS the ceiling, so anything more the shop
      // holds is out of reach rather than one request away.
      truncated: listings.length >= plan.limit,
      // booklooker publishes no match count, and inventing one from the row
      // count would make `truncated` and `totalEstimate` contradict each other.
      totalEstimate: null,
      requests,
      warnings: [...plan.warnings, ...warnings],
    };
  }

  // No `getListing`: the search interface has no by-id lookup, and the only
  // per-offer handles it documents are the seller's own running number and the
  // seller id — one is not unique, the other is a person.
  return { capabilities, status, search };
}
