/**
 * The eBay `MarketProvider`.
 *
 * eBay is the one source in troedler reached through an API the operator
 * publishes and licenses, which is why it is the only one on by default. The
 * price of that licence is a set of obligations the rest of the code cannot
 * see, so they are declared here as data:
 *
 *   - `cache.ttlSeconds` is **contractual**, not a performance knob. The API
 *     License Agreement: *"Displayed item listing information may not be more
 *     than six (6) hours older than information displayed on the eBay Site."*
 *   - `disclaimer` carries the co-mingling rule — *"eBay Content in a Public
 *     Display may not be co-mingled or combined with non-eBay Content"* — which
 *     is why `@troedler/core` makes grouped-by-provider the primary shape and
 *     the merged list opt-in.
 *   - No seller identity is ever mapped. Same agreement: *"You will not under
 *     any circumstances collect, store or share any eBay User' User IDs."*
 */

import {
  DESCRIPTION_CHARS,
  ProviderError,
  RESULTS_PER_PROVIDER,
  clamp,
  type FilterKey,
  type Listing,
  type MarketProvider,
  type ProviderCapabilities,
  type ProviderResult,
  type ProviderStatus,
  type SearchQuery,
} from '@troedler/core';
import { planSearch } from './filter.ts';
import { attributeWarnings, parseItemResponse, parseSearchResponse, PROVIDER_ID } from './parse.ts';
import { EBAY_API_HOST, EBAY_SANDBOX_HOST, EbayClient, type EbayHttp } from './request.ts';
import type { EbayRateLimitResponse } from './types.ts';

export const DEFAULT_MARKETPLACE_ID = 'EBAY_DE';

/** Six hours. Not ours to choose — see the class comment. */
export const LICENCE_MAX_AGE_SECONDS = 6 * 3600;

export interface EbayDeps {
  readonly http: EbayHttp;
  readonly env: Record<string, string | undefined>;
  readonly enabled: boolean;
  /** Injected so tests can pin token expiry and `fetchedAt`. */
  readonly now?: () => number;
}

const CAPABILITIES: ProviderCapabilities = {
  id: PROVIDER_ID,
  label: 'eBay',
  // The API host, not `ebay.de`: that is the host the source record and the
  // licence hang off, and the website is never touched.
  host: EBAY_API_HOST,
  access: 'official-api',
  freshness: 'live',
  // `delivery` is deliberately absent: eBay has no "ships to me" filter that
  // means what our query means, and the pickup filter set narrows to local
  // pickup only as a by-product of a radius search. Declaring it would promise
  // something no request actually delivers.
  serverFilters: ['minPrice', 'maxPrice', 'condition', 'sellerType', 'radius', 'since', 'gtin', 'sort'],
  serverSorts: ['relevance', 'price-asc', 'price-desc', 'newest', 'ending-soonest'],
  // One request per search: eBay caps `limit` at 200 and the kernel never asks
  // one provider for more. The API's own paging ceiling is 10 000 rows, which
  // this adapter has no reason to walk.
  maxResults: RESULTS_PER_PROVIDER.max,
  cache: { ttlSeconds: LICENCE_MAX_AGE_SECONDS, memoryOnly: false },
  enabledByDefault: true,
  termsDoc: 'docs/quellen/ebay.de.md',
  disclaimer:
    'Angebotsdaten von eBay, abgerufen über die eBay Browse API. Die eBay-API-Lizenz verlangt, dass sie getrennt von Nicht-eBay-Inhalten dargestellt werden und höchstens sechs Stunden alt sind.',
  note: 'Braucht EBAY_CLIENT_ID und EBAY_CLIENT_SECRET (kostenloses Production-Keyset auf developer.ebay.com). Vor dem ersten Production-Call müssen die Marketplace-Account-Deletion-Benachrichtigungen abonniert oder abgewählt werden — troedler speichert keine eBay-Nutzerdaten, deshalb ist Abwählen hier das Richtige.',
  // eBay API Licence 4.2: eBay listings shown alongside others must be
  // "visually isolated from third-party listings". The kernel keeps these
  // rows out of the interleaved `--merge` list; `grouped` still has them.
  noCoMingling: true,
};

/** The Browse-search budget out of the analytics answer, ignoring `getItems`. */
function browseRate(body: EbayRateLimitResponse): {
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
} {
  const candidates: { name: string; remaining: number | null; limit: number | null; reset: string | null }[] =
    [];
  for (const api of body.rateLimits ?? []) {
    for (const resource of api.resources ?? []) {
      for (const rate of resource.rates ?? []) {
        candidates.push({
          name: (resource.name ?? '').toLowerCase(),
          remaining: typeof rate.remaining === 'number' ? rate.remaining : null,
          limit: typeof rate.limit === 'number' ? rate.limit : null,
          reset: rate.reset ?? null,
        });
      }
    }
  }
  // `getItems` has its own 5 000/day pool and is not the one a search spends.
  const pick = candidates.find((c) => !c.name.includes('getitems')) ?? candidates[0];
  if (!pick) return { remaining: null, limit: null, resetAt: null };
  return { remaining: pick.remaining, limit: pick.limit, resetAt: pick.reset };
}

/**
 * eBay's own two hosts, and nothing else.
 *
 * `EBAY_API_HOST` exists so the sandbox can be pointed at while testing the
 * auth flow, and it is a closed list rather than a free field on purpose: the
 * client sends `apiHost: true`, which switches the robots gate off on the
 * strength of eBay's API licence. A free-form host would mean posting a keyset
 * to somewhere unlicensed with that gate disabled — an odd way to lose
 * credentials, but a cheap one to make impossible.
 */
function allowedHost(raw: string | undefined): string {
  const host = raw?.trim();
  return host === EBAY_SANDBOX_HOST || host === EBAY_API_HOST ? host : EBAY_API_HOST;
}

class EbayProvider implements MarketProvider {
  readonly capabilities = CAPABILITIES;

  readonly #deps: EbayDeps;
  readonly #marketplaceId: string;
  readonly #client: EbayClient | null;
  readonly #now: () => number;

  constructor(deps: EbayDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => Date.now());
    this.#marketplaceId = deps.env.EBAY_MARKETPLACE_ID?.trim() || DEFAULT_MARKETPLACE_ID;

    const clientId = deps.env.EBAY_CLIENT_ID?.trim();
    const clientSecret = deps.env.EBAY_CLIENT_SECRET?.trim();
    this.#client =
      clientId && clientSecret
        ? new EbayClient({
            http: deps.http,
            clientId,
            clientSecret,
            marketplaceId: this.#marketplaceId,
            enabled: deps.enabled,
            host: allowedHost(deps.env.EBAY_API_HOST),
            now: this.#now,
          })
        : null;
  }

  /**
   * Requests spent against this host in this process.
   *
   * Read from the socket layer, not from a counter this adapter maintains —
   * a `catch` path that forgets to book its requests is exactly how a failed
   * search reported "0 Anfragen, 1189 ms".
   */
  requestsUsed(): number {
    return this.#deps.http.requestsUsed(allowedHost(this.#deps.env.EBAY_API_HOST));
  }

  /**
   * Three states, never two.
   *
   * Switched off, missing credentials and "credentials present but eBay will
   * not issue a token" are three different things the user must do three
   * different things about, and a boolean would flatten them into "no results".
   * Fetching the token here is not waste: it lands in the client's cache and
   * the search that follows reuses it, so a full run still spends exactly one
   * of the 1 000 daily token requests.
   */
  async status(): Promise<ProviderStatus> {
    if (!this.#deps.enabled) {
      return {
        configured: false,
        problem: { kind: 'blocked-by-policy', message: 'eBay ist in dieser Konfiguration abgeschaltet.' },
      };
    }
    if (!this.#client) {
      return {
        configured: false,
        problem: {
          kind: 'not-configured',
          message: 'EBAY_CLIENT_ID und EBAY_CLIENT_SECRET fehlen — siehe .env.example.',
        },
      };
    }
    try {
      await this.#client.token();
      return { configured: true, problem: null };
    } catch (err) {
      const pe =
        err instanceof ProviderError
          ? err
          : new ProviderError(PROVIDER_ID, 'unreachable', err instanceof Error ? err.message : String(err));
      return { configured: true, problem: { kind: pe.kind, message: pe.message } };
    }
  }

  async search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
    const client = this.#requireClient();
    if (!query.text.trim() && !query.gtin) {
      // eBay answers this with 12001 after a round trip. Failing locally costs
      // no call and says it in German.
      throw new ProviderError(
        PROVIDER_ID,
        'remote-error',
        'eBay verlangt einen Suchbegriff oder eine GTIN — eine leere Suche beantwortet die API nicht.',
      );
    }

    const before = client.requests;
    const plan = planSearch(query, {
      marketplaceId: this.#marketplaceId,
      limit: clamp(query.limit, RESULTS_PER_PROVIDER),
    });
    const raw = await client.search(plan.search, plan.endUserCtx, signal);
    const parsed = parseSearchResponse(raw, {
      fetchedAt: new Date(this.#now()).toISOString(),
      descriptionChars: DESCRIPTION_CHARS.default,
    });

    const verdict = attributeWarnings(parsed.warnings, plan.filterOwners);
    // A filter eBay threw away must not stay in `applied`, or the kernel skips
    // its own pass and the user gets unfiltered rows presented as filtered.
    // An unattributable warning drops every claim: one extra local pass is
    // cheap, a silently ignored filter is not.
    const applied: readonly FilterKey[] = verdict.unattributed
      ? []
      : plan.claimed.filter((k) => !verdict.rejected.includes(k));

    const warnings = [...plan.notes, ...verdict.messages];
    if (verdict.unattributed) {
      warnings.push(
        'eBay hat gewarnt, ohne einen der gesendeten Filter zu benennen — alle Filter werden vorsichtshalber lokal nachgezogen.',
      );
    }
    if (parsed.correctedQuery) {
      warnings.push(`eBay hat die Suche zu „${parsed.correctedQuery}" korrigiert.`);
    }

    return {
      provider: PROVIDER_ID,
      listings: parsed.listings,
      applied,
      truncated: parsed.total !== null && parsed.total > parsed.listings.length,
      totalEstimate: parsed.total,
      requests: client.requests - before,
      warnings,
    };
  }

  /** `null` is an answer: the id is gone. Anything else is an error worth showing. */
  async getListing(id: string, signal?: AbortSignal): Promise<Listing | null> {
    const client = this.#requireClient();
    try {
      const raw = await client.item(id, signal);
      return parseItemResponse(raw, {
        fetchedAt: new Date(this.#now()).toISOString(),
        descriptionChars: DESCRIPTION_CHARS.default,
      });
    } catch (err) {
      // Shim, and it should not survive: `HttpClient` throws away the status
      // code and leaves only a German sentence, so "the item is gone" can only
      // be told from "the API broke" by reading that sentence. The fix belongs
      // in @troedler/core — `ProviderError` needs the HTTP status — and this
      // branch comes out with it. See docs/quellen/ebay.de.md.
      if (err instanceof ProviderError && err.kind === 'remote-error' && /HTTP 404\b/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  async quota(
    signal?: AbortSignal,
  ): Promise<{ remaining: number | null; limit: number | null; resetAt: string | null }> {
    const client = this.#requireClient();
    return browseRate(await client.rateLimits(signal));
  }

  #requireClient(): EbayClient {
    if (!this.#deps.enabled) {
      throw new ProviderError(
        PROVIDER_ID,
        'blocked-by-policy',
        'eBay ist in dieser Konfiguration abgeschaltet.',
      );
    }
    if (!this.#client) {
      throw new ProviderError(
        PROVIDER_ID,
        'not-configured',
        'EBAY_CLIENT_ID und EBAY_CLIENT_SECRET fehlen — siehe .env.example.',
      );
    }
    return this.#client;
  }
}

/** Dependencies injected, never reached for. One provider instance per process. */
export function createEbayProvider(deps: EbayDeps): MarketProvider {
  return new EbayProvider(deps);
}
