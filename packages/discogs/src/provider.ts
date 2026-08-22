/**
 * The Discogs adapter.
 *
 * It is the one source in this project that works the moment you install the
 * tool — no key, no OAuth, no waiting for approval. It is also the one whose
 * shape does NOT match the others, and pretending otherwise would be the whole
 * bug: **Discogs' public API has no offers in it.**
 *
 * `/database/search` returns catalogue releases and carries no price at all;
 * `/marketplace/stats/{id}` returns one aggregate per release — "66 copies from
 * 64,00 €". The endpoint that once returned individual marketplace listings was
 * internal, undocumented, and is gone: `/marketplace/search` answers 401 today
 * (measured 2026-08-21). So a Discogs row here is a release with a FROM-price
 * and a link to where the actual offers live, `priceKind` says `from`, and
 * `capabilities.note` says it in words. A user comparing "40 € on
 * kleinanzeigen" with "ab 17,67 € on Discogs" has to be able to see that those
 * are not the same kind of number.
 *
 * The second consequence is arithmetic. Each priced row costs its own request
 * against a budget of 25 per minute without a token (60 with one), so the
 * number of results is bounded by the rate limit rather than by paging — which
 * is why this adapter fetches exactly one search page and never more.
 */

import {
  clamp,
  listingKey,
  ProviderError,
  RESULTS_PER_PROVIDER,
  type FilterKey,
  type Listing,
  type MarketProvider,
  type ProviderCapabilities,
  type ProviderResult,
  type ProviderStatus,
  type SearchQuery,
} from '@troedler/core';
import type { HttpClient } from '@troedler/http';
import { mapReleases, parseSearchResponse, releaseToRow, sellUrl } from './parse.ts';
import {
  buildReleaseUrl,
  buildSearchUrl,
  buildStatsUrl,
  DISCOGS_HOST,
  MAX_PER_PAGE,
  normalizeCurrency,
  PROVIDER_ID,
  requestJson,
  type RequestContext,
} from './request.ts';
import type {
  DiscogsMarketplaceStats,
  DiscogsRateLimit,
  DiscogsRelease,
  DiscogsSearchResponse,
} from './types.ts';

/** Discogs' published limits for its moving 60-second window. Both measured on 2026-08-21. */
const UNAUTHENTICATED_PER_MINUTE = 25;
const AUTHENTICATED_PER_MINUTE = 60;

/**
 * Requests held back from the window on every search.
 *
 * Three, and each one is accounted for. One covers an off-by-one that is real
 * and measured: the first response of a fresh window reports
 * `remaining: 25, used: 0`, i.e. the headers describe the window BEFORE this
 * request was counted, so acting on `remaining` at face value overspends by
 * exactly one. One leaves room for a following `quota()`. One is margin,
 * because the window is a moving average shared with anything else on this
 * machine using the same token.
 */
const BUDGET_RESERVE = 3;

/**
 * Discogs' window is documented as resetting 60 s after the last request
 * ("If no requests are made in 60 seconds, your window will reset"). There is
 * no reset header, so this is computed from that rule rather than invented.
 */
const WINDOW_SECONDS = 60;

/** How stale Discogs data may be shown — a contractual number, not a tuning knob. */
const TTL_SECONDS = 6 * 60 * 60;

export interface DiscogsDeps {
  readonly http: HttpClient;
  /** Process environment. `DISCOGS_TOKEN` is read from here and nowhere else. */
  readonly env: Record<string, string | undefined>;
  /** Whether the user has this source switched on. */
  readonly enabled: boolean;
  /** Injected so a test can pin `fetchedAt` and the rate-limit window. */
  readonly now?: () => Date;
}

export class DiscogsProvider implements MarketProvider {
  readonly capabilities: ProviderCapabilities;

  readonly #http: HttpClient;
  readonly #enabled: boolean;
  readonly #token: string | undefined;
  readonly #now: () => Date;

  /** Last reading of `X-Discogs-Ratelimit*`, and when we took it. */
  #rateLimit: DiscogsRateLimit = { limit: null, remaining: null, used: null };
  #rateLimitAt: number | null = null;

  constructor(deps: DiscogsDeps) {
    this.#http = deps.http;
    this.#enabled = deps.enabled;
    this.#now = deps.now ?? (() => new Date());

    const raw = deps.env.DISCOGS_TOKEN?.trim();
    this.#token = raw && raw.length > 0 ? raw : undefined;
    this.capabilities = buildCapabilities(this.#token !== undefined);
  }

  /**
   * No network here, on purpose.
   *
   * `searchAll` calls `status()` before every single search, and a probe would
   * spend one of twenty-five requests per minute to learn something the search
   * is about to find out anyway. The one thing this method can answer without
   * asking — is this source switched on — it answers, and everything else is
   * reported by `search()` with the real error attached.
   *
   * A missing token is deliberately NOT a problem: unauthenticated access is
   * the normal, working mode of this adapter. Saying otherwise would put a
   * permanent warning next to a source that is doing its job.
   */
  /**
   * Requests spent against this host in this process.
   *
   * Read from the socket layer, not from a counter this adapter maintains —
   * a `catch` path that forgets to book its requests is exactly how a failed
   * search reported "0 Anfragen, 1189 ms".
   */
  requestsUsed(): number {
    return this.#http.requestsUsed(DISCOGS_HOST);
  }

  async status(): Promise<ProviderStatus> {
    if (!this.#enabled) {
      return {
        configured: true,
        problem: {
          kind: 'blocked-by-policy',
          message: `${DISCOGS_HOST} ist nicht aktiviert. Discogs braucht keine Zugangsdaten — es genügt, die Quelle einzuschalten.`,
        },
      };
    }
    return { configured: true, problem: null };
  }

  async search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
    const ctx: RequestContext = { http: this.#http, enabled: this.#enabled, token: this.#token, signal };
    const warnings: string[] = [];

    const { currency, fallback } = normalizeCurrency(query.currency);
    if (fallback && query.currency) {
      warnings.push(`Discogs rechnet nicht in ${query.currency} — die Preise stehen in EUR.`);
    }

    const wanted = Math.min(clamp(query.limit, RESULTS_PER_PROVIDER), this.capabilities.maxResults);
    const perPage = Math.min(wanted, MAX_PER_PAGE);
    const applied: FilterKey[] = query.gtin ? ['gtin'] : [];

    const first = await requestJson<DiscogsSearchResponse>(
      buildSearchUrl({ text: query.text, gtin: query.gtin, perPage }),
      ctx,
    );
    this.#noteRateLimit(first.rateLimit);
    let requests = 1;

    const parsed = parseSearchResponse(first.data);
    const stats = new Map<number, DiscogsMarketplaceStats>();
    let budget = this.#enrichmentBudget(first.rateLimit, wanted);

    // A budget of zero with rows waiting is not an empty result, it is a
    // result we were not able to fetch — and those two must never arrive at
    // the caller looking the same. `rate-limited` is transient, so the surfaces
    // can say "try again in a minute" instead of "nothing found".
    if (budget === 0 && parsed.rows.length > 0) {
      throw new ProviderError(
        PROVIDER_ID,
        'rate-limited',
        `Das Discogs-Anfragefenster ist ausgeschöpft (${this.#tierLimit()} pro Minute${
          this.#token ? '' : ', ohne Token'
        }). ${parsed.rows.length} Treffer stehen bereit, aber es ist keine Preisabfrage mehr frei — in einer Minute erneut versuchen.`,
        { retryAfterSeconds: WINDOW_SECONDS },
      );
    }
    let attempted = 0;
    let failed = 0;
    let throttled: string | null = null;

    for (const row of parsed.rows) {
      if (stats.size >= budget) break;
      if (typeof row.id !== 'number' || !Number.isFinite(row.id)) continue;

      attempted += 1;
      requests += 1;
      try {
        const priced = await requestJson<DiscogsMarketplaceStats>(buildStatsUrl(row.id, currency), ctx);
        this.#noteRateLimit(priced.rateLimit);
        stats.set(row.id, priced.data);
        // Re-read the budget from every response rather than trusting the one
        // computed up front: the window is a moving average and something else
        // may be spending it at the same time.
        budget = Math.min(budget, stats.size + this.#enrichmentBudget(priced.rateLimit, wanted));
      } catch (err) {
        if (err instanceof ProviderError && (err.kind === 'rate-limited' || err.kind === 'refused')) {
          // Real listings are already in hand. Discarding them because the next
          // price lookup was throttled would turn a partial answer into no
          // answer — but it is a warning, never silence, and `truncated` says
          // there was more.
          throttled = err.message;
          break;
        }
        // A single release can 404 ("Release not found." — measured). One bad
        // row is not a broken endpoint; all of them is, and that is checked
        // once the loop is done.
        failed += 1;
      }
    }

    if (attempted > 0 && stats.size === 0 && throttled === null) {
      throw new ProviderError(
        PROVIDER_ID,
        'remote-error',
        `Keine einzige der ${attempted} Preisabfragen an /marketplace/stats/ gelang — der Endpunkt antwortet nicht wie erwartet.`,
      );
    }

    const mapped = mapReleases(parsed.rows, (id) => stats.get(id), this.#now().toISOString());

    // The "green and empty" guard: rows arrived, and not one of them had the
    // shape this adapter reads. That is a changed response, not a miss.
    if (parsed.rows.length > 0 && mapped.unmappable === parsed.rows.length) {
      throw new ProviderError(
        PROVIDER_ID,
        'parse-failed',
        `Discogs lieferte ${parsed.rows.length} Zeilen, aber keine davon trägt id und title — die Struktur von /database/search hat sich geändert.`,
      );
    }
    if (mapped.unmappable > 0) {
      warnings.push(
        `${mapped.unmappable} von ${parsed.rows.length} Zeilen ohne id oder title übersprungen — möglicherweise eine Änderung an der Discogs-Antwort.`,
      );
    }

    if (failed > 0)
      warnings.push(`${failed} Preisabfragen schlugen fehl; diese Releases fehlen im Ergebnis.`);
    if (throttled !== null) warnings.push(`Preisabfragen abgebrochen: ${throttled}`);
    if (mapped.withoutOffers > 0) {
      warnings.push(
        `${mapped.withoutOffers} von ${stats.size} geprüften Releases werden derzeit auf dem Discogs-Marktplatz nicht angeboten.`,
      );
    }
    if (stats.size < parsed.rows.length) {
      warnings.push(
        `Von ${parsed.rows.length} Treffern wurden ${stats.size} mit Marktplatzpreisen versehen. Jeder Preis kostet eine eigene Anfrage, und Discogs erlaubt ${this.#tierLimit()} pro Minute${
          this.#token ? '' : ' — ein DISCOGS_TOKEN hebt das auf 60'
        }.`,
      );
    }

    return {
      provider: PROVIDER_ID,
      listings: mapped.listings,
      applied,
      truncated: stats.size < parsed.rows.length || (parsed.totalItems ?? 0) > parsed.rows.length,
      // Discogs' count of matching RELEASES, not of offers — the two differ by
      // however many copies each release has for sale. Shown, never computed with.
      totalEstimate: parsed.totalItems,
      requests,
      warnings,
    };
  }

  /**
   * One release, priced. Two requests, and both of them are necessary.
   *
   * The metadata comes from `/releases/{id}` and the price from
   * `/marketplace/stats/{id}` — never the `lowest_price` the release endpoint
   * also carries, which ignores `curr_abbr` and answers in dollars. Fetching
   * the same number twice would be cheaper by one request and wrong by a third.
   *
   * `null` for a release Discogs does not know and for one nobody is selling:
   * both are answers to "is there an offer", and neither is an error.
   */
  async getListing(id: string, signal?: AbortSignal): Promise<Listing | null> {
    const releaseId = Number.parseInt(id, 10);
    if (!Number.isFinite(releaseId) || releaseId <= 0 || String(releaseId) !== id.trim()) return null;

    const ctx: RequestContext = { http: this.#http, enabled: this.#enabled, token: this.#token, signal };

    const release = await this.#optional<DiscogsRelease>(buildReleaseUrl(releaseId), ctx);
    if (release === null) return null;
    const stats = await this.#optional<DiscogsMarketplaceStats>(buildStatsUrl(releaseId, 'EUR'), ctx);
    if (stats === null) return null;

    const mapped = mapReleases([releaseToRow(release)], () => stats, this.#now().toISOString());
    return mapped.listings[0] ?? null;
  }

  /**
   * A GET whose "not there" is an answer rather than a failure.
   *
   * Discogs says "Release not found." with a 404, which `HttpClient` reports as
   * `remote-error` — the status code does not survive, so a gone id has to be
   * inferred from the kind. Narrow on purpose: `refused`, `rate-limited` and
   * `parse-failed` still throw, because none of those means the id is gone.
   */
  async #optional<T>(url: string, ctx: RequestContext): Promise<T | null> {
    try {
      const res = await requestJson<T>(url, ctx);
      this.#noteRateLimit(res.rateLimit);
      return res.data;
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'remote-error') return null;
      throw err;
    }
  }

  /**
   * What is left of Discogs' window.
   *
   * Prefers the reading taken from the last real response; only when nothing
   * has been fetched yet does it spend one request of its own on the smallest
   * 200 the API has (92 bytes, measured). `resetAt` is derived from Discogs'
   * documented rule, not from a header — there is none.
   */
  async quota(
    signal?: AbortSignal,
  ): Promise<{ remaining: number | null; limit: number | null; resetAt: string | null }> {
    if (this.#rateLimit.limit === null) {
      const ctx: RequestContext = { http: this.#http, enabled: this.#enabled, token: this.#token, signal };
      const res = await requestJson<DiscogsMarketplaceStats>(buildStatsUrl(1, 'EUR'), ctx);
      this.#noteRateLimit(res.rateLimit);
    }
    return {
      remaining: this.#rateLimit.remaining,
      limit: this.#rateLimit.limit,
      resetAt:
        this.#rateLimitAt === null ? null : new Date(this.#rateLimitAt + WINDOW_SECONDS * 1000).toISOString(),
    };
  }

  #tierLimit(): number {
    return this.#token ? AUTHENTICATED_PER_MINUTE : UNAUTHENTICATED_PER_MINUTE;
  }

  #noteRateLimit(reading: DiscogsRateLimit): void {
    // Keep whichever fields the response actually carried; a missing header
    // must not erase a number we already know.
    this.#rateLimit = {
      limit: reading.limit ?? this.#rateLimit.limit,
      remaining: reading.remaining ?? this.#rateLimit.remaining,
      used: reading.used ?? this.#rateLimit.used,
    };
    this.#rateLimitAt = this.#now().getTime();
  }

  /** How many price lookups this window still affords, never more than asked for. */
  #enrichmentBudget(reading: DiscogsRateLimit, wanted: number): number {
    const remaining = reading.remaining ?? this.#rateLimit.remaining ?? this.#tierLimit();
    return Math.max(0, Math.min(wanted, remaining - BUDGET_RESERVE));
  }
}

function buildCapabilities(hasToken: boolean): ProviderCapabilities {
  const perMinute = hasToken ? AUTHENTICATED_PER_MINUTE : UNAUTHENTICATED_PER_MINUTE;
  return {
    id: PROVIDER_ID,
    label: 'Discogs',
    host: DISCOGS_HOST,
    access: 'official-api',
    freshness: 'live',
    // `barcode=` is a real server-side filter — measured: EAN 888837168618
    // narrows 6416 Kraftwerk hits to 9 pressings of one album. Price, condition
    // and seller type are absent from the search endpoint entirely, and sorting
    // only offers year/title/label/have/want, none of which is a SortKey this
    // project has. Claiming any of them would make `--explain` lie.
    serverFilters: ['gtin'],
    serverSorts: ['relevance'],
    // Bounded by the rate limit, not by paging: one search request plus one
    // price lookup per row, minus the reserve.
    maxResults: perMinute - BUDGET_RESERVE,
    cache: {
      // Discogs' API Terms of Use: "You may not display in any format or to any
      // audience the Content if it is more than six (6) hours older than the
      // information on Our online properties". The same six hours eBay imposes,
      // from a different contract.
      ttlSeconds: TTL_SECONDS,
      // The terms also say not to store Content "longer than is necessary to
      // provide a service to Your application's users", but they do not forbid
      // a disk cache within the six hours, and the TTL above enforces the limit
      // that does bind.
      memoryOnly: false,
    },
    enabledByDefault: true,
    termsDoc: 'docs/quellen/discogs.com.md',
    // Both notices Discogs' API terms require, verbatim and in the language
    // they are prescribed in. The first must appear "directly next to any data
    // You use from the Discogs API" together with a hyperlink to the
    // discogs.com page holding it — which is what `Listing.url` is. The second
    // is the trademark notice.
    disclaimer:
      'Data provided by Discogs. — This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.',
    note: hasToken
      ? `Liefert Releases mit Ab-Preis, keine Einzelangebote: Discogs' öffentliche API kennt nur das Aggregat „N Angebote ab X €" pro Release. Die einzelnen Angebote stehen hinter der verlinkten Seite. Mit Token 60 Anfragen/Minute; da jeder Treffer eine eigene Preisabfrage kostet, sind das bis zu ${AUTHENTICATED_PER_MINUTE - BUDGET_RESERVE} Treffer je Suche.`
      : `Liefert Releases mit Ab-Preis, keine Einzelangebote: Discogs' öffentliche API kennt nur das Aggregat „N Angebote ab X €" pro Release. Die einzelnen Angebote stehen hinter der verlinkten Seite. Ohne Token 25 Anfragen/Minute, und da jeder Treffer eine eigene Preisabfrage kostet, sind das bis zu ${UNAUTHENTICATED_PER_MINUTE - BUDGET_RESERVE} Treffer je Suche. Ein kostenloser Personal Access Token (discogs.com/settings/developers) in DISCOGS_TOKEN hebt das auf 60/Minute und liefert zusätzlich Coverbilder, die ohne Token leer bleiben.`,
    noCoMingling: false,
  };
}

/** Handy for surfaces that hold only a listing id. */
export { sellUrl, listingKey };
