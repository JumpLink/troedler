/**
 * Talking to `api.booklooker.de` — the token, the budget, the URL.
 *
 * Everything here goes through the shared `HttpClient`; there is no second
 * socket in this package. What this file adds on top is the one thing the
 * shared client cannot know: booklooker hands out a session token that dies
 * after ten minutes of silence, and it says so in the answer rather than in
 * the status line.
 */

import { RESULTS_PER_PROVIDER, clamp, type FilterKey, type Limit, type SearchQuery } from '@troedler/core';
import type { FetchOptions, HttpClient } from '@troedler/http';
import {
  TOKEN_CODES,
  type BooklookerEnvelope,
  type BooklookerMedium,
  type ShippingCountry,
} from './types.ts';
import { readToken } from './parse.ts';

export const API_BASE = 'https://api.booklooker.de/2.0';
export const API_HOST = 'api.booklooker.de';

/**
 * The two calls this adapter makes, as a port the shared client fills.
 *
 * An interface rather than `HttpClient` itself, for two reasons.
 *
 * `/authenticate` is **POST-only** — measured 2026-08-21: the same call as GET
 * answers `{"status":"NOK","returnValue":"INVALID_REQUEST_METHOD"}` — and the
 * shared client offers `get`/`getJson` only today. Naming the gap here rather
 * than opening a second way out keeps the compliance gate, the rate limiter
 * and the "403 ends it" rule on the path; `app` passes the real client and
 * this port disappears into it the moment `postJson` lands. eBay needs the
 * same verb for its OAuth token, so it belongs in the shared client, not in
 * either adapter.
 *
 * And `HttpClient` carries `#private` fields, which makes it NOMINALLY typed:
 * no fake can ever stand in for it. The token lifecycle below — expiry,
 * re-authentication, the bound on it — is the part of this adapter most worth
 * testing and least worth testing over a real socket.
 */
export interface BooklookerHttp {
  getJson<T>(url: string, options: FetchOptions): Promise<T>;
  postJson<T>(url: string, options: FetchOptions): Promise<T>;
  /** Requests spent against a host this process. Read by the fan-out on both the success and the failure path. */
  requestsUsed(host: string): number;
}

/**
 * Compile-time proof that the shared client still fits the half of the port it
 * already implements. If `HttpClient.getJson` ever changes shape this line
 * stops compiling here, in the adapter that depends on it, instead of failing
 * at run time in `app`.
 */
const _sharedClientFits: (c: HttpClient) => Pick<BooklookerHttp, 'getJson'> = (c) => c;

/**
 * booklooker's own ceiling: `limit` "maximal 150", default 150.
 *
 * Kept as a `Limit` so `clamp` from the kernel does the work — a caller asking
 * for 500 rows gets 150 and is told, which is the rule the whole limits module
 * exists for.
 */
export const BOOKLOOKER_RESULTS: Limit = { default: RESULTS_PER_PROVIDER.default, max: 150 };

/**
 * Ten minutes of inactivity, minus a minute.
 *
 * The documented figure is ten ("Sofern Sie 10 Minuten keine Schnittstelle
 * aufrufen, verfällt der Token"). Spending the last minute of it is how a
 * search turns into two round trips for no reason: we would send a token that
 * expired between the check and the request. The margin costs one extra
 * authentication per idle hour and removes the race.
 */
export const TOKEN_IDLE_MS = 9 * 60 * 1000;

export interface BooklookerConfig {
  readonly apiKey: string;
  /** Which of the five catalogues to search. booklooker's own default is `book`. */
  readonly medium: BooklookerMedium;
  /** Destination country for the postage figure. Only `de`, `at`, `ch` exist. */
  readonly shippingCountry: ShippingCountry;
  readonly enabled: boolean;
}

export interface SearchPlan {
  readonly params: URLSearchParams;
  /** Filters booklooker will apply itself — never more than it really does. */
  readonly applied: FilterKey[];
  readonly warnings: string[];
  /** False when this query has nothing booklooker can be asked about. */
  readonly answerable: boolean;
  readonly limit: number;
}

/** An ISBN in either width, once punctuation is gone. */
function isbnLike(gtin: string): boolean {
  const s = gtin.replace(/[^0-9Xx]/g, '');
  return /^\d{9}[\dXx]$/.test(s) || /^97[89]\d{10}$/.test(s);
}

/**
 * `SearchQuery` → booklooker's query string.
 *
 * Three of this source's documented rules decide the shape and all three are
 * quoted in `docs/quellen/booklooker.de.md`:
 *
 *   - **Every search parameter is AND-ed**, and there is no field that spans
 *     them: "Soll nach einem Suchbegriff in allen Feldern gesucht werden, so
 *     muss die Schnittstelle mehrmals hintereinander aufgerufen werden." One
 *     free-text box therefore maps to ONE field, and the user is told which.
 *   - **An ISBN or EAN wins outright**: "Wenn Sie als Such-Parameter isbn oder
 *     ean angeben, werden alle anderen Parameter ignoriert!" So when a GTIN is
 *     in play we send nothing else to be ignored, and we claim `gtin` alone.
 *   - **Condition and date are coarser here than in the query.** booklooker
 *     knows new-versus-used and whole days; `SearchQuery` knows ten conditions
 *     and a timestamp. Both are still pushed down, because a narrower request
 *     wastes fewer of the 150 rows — but neither is REPORTED as applied, so
 *     the kernel finishes the job. Claiming them would drop the difference on
 *     the floor silently.
 */
export function buildSearchParams(query: SearchQuery, config: BooklookerConfig): SearchPlan {
  const params = new URLSearchParams();
  const applied: FilterKey[] = [];
  const warnings: string[] = [];
  const limit = clamp(query.limit, BOOKLOOKER_RESULTS);

  const gtin = query.gtin && isbnLike(query.gtin) ? query.gtin.replace(/[^0-9Xx]/g, '') : null;

  // `isbn` is a search parameter of the book catalogues only; asking for it
  // under `film` would be quietly dropped and return the whole catalogue.
  const medium: BooklookerMedium = gtin && config.medium !== 'abook' ? 'book' : config.medium;
  params.set('medium', medium);
  params.set('limit', String(limit));
  params.set('showShippingPrice', config.shippingCountry);

  if (gtin) {
    params.set('isbn', gtin);
    applied.push('gtin');
    if (query.text.trim() !== '') {
      warnings.push(
        'Booklooker ignoriert bei einer ISBN-Suche alle weiteren Suchkriterien; der Suchtext wurde nicht mitgeschickt.',
      );
    }
    return { params, applied, warnings, answerable: true, limit };
  }

  const text = query.text.trim();
  if (text === '') {
    warnings.push(
      query.gtin
        ? `Booklooker kann „${query.gtin}" nicht suchen: die Schnittstelle kennt nur ISBN (Bücher) und EAN je Medientyp.`
        : 'Booklooker braucht einen Suchtext oder eine ISBN.',
    );
    return { params, applied, warnings, answerable: false, limit };
  }

  params.set('title', text);
  warnings.push(
    'Booklooker sucht hier nur im Titel — Autor und Stichwort wären je ein weiterer Aufruf gegen dasselbe Kontingent.',
  );

  if (query.sellerType === 'private') {
    params.set('privOnly', '1');
    applied.push('sellerType');
  } else if (query.sellerType === 'commercial') {
    params.set('profOnly', '1');
    applied.push('sellerType');
  }

  const wanted = query.condition ?? [];
  if (wanted.length > 0) {
    const wantsNew = wanted.some((c) => c === 'new' || c === 'new-other');
    const wantsUsed = wanted.some((c) => c !== 'new' && c !== 'new-other');
    if (wantsNew && !wantsUsed) params.set('newOnly', '1');
    else if (wantsUsed && !wantsNew) params.set('usedOnly', '1');
  }

  if (query.since) {
    const day = query.since.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) params.set('dateFrom', day);
  }

  // `pricePlusShipping`, not `price`: the kernel ranks on `totalPrice ?? price`,
  // and asking the remote to order by the bare article price would hand back a
  // different 150 rows than the ones the user is about to be shown first.
  if (query.sort === 'price-asc' || query.sort === 'price-desc') {
    params.set('sortOrder', 'pricePlusShipping');
    params.set('sortDir', query.sort === 'price-asc' ? 'asc' : 'desc');
    applied.push('sort');
  }

  return { params, applied, warnings, answerable: true, limit };
}

/** True when the answer says the token died — the one failure we are meant to fix ourselves. */
function isTokenFailure(envelope: unknown): boolean {
  if (typeof envelope !== 'object' || envelope === null) return false;
  const { status, returnValue } = envelope as BooklookerEnvelope;
  return status === 'NOK' && typeof returnValue === 'string' && TOKEN_CODES.includes(returnValue);
}

/**
 * Strip secrets out of a failure before anyone sees it.
 *
 * The API key and the session token travel in the QUERY STRING — that is what
 * the interface takes — so any error that quotes the URL quotes the key. A
 * transport error message ends up in CLI output, in an MCP response and in
 * whatever the user pastes into a bug report, and a key that has been pasted
 * once has to be rotated.
 */
function redact(err: unknown, ...secrets: readonly string[]): unknown {
  if (!(err instanceof Error)) return err;
  let message = err.message;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('«geheim»');
  }
  if (message === err.message) return err;
  const clone = Object.create(Object.getPrototypeOf(err) as object) as Error;
  Object.assign(clone, err, { message });
  return clone;
}

export interface SearchCall {
  readonly envelope: unknown;
  readonly requests: number;
}

/**
 * One process-wide session per provider instance.
 *
 * The token is cached because authenticating before every search would double
 * the request count against a budget of 50 calls per ten minutes — half the
 * budget spent on saying hello.
 */
export class BooklookerSession {
  readonly #http: BooklookerHttp;
  readonly #config: BooklookerConfig;
  readonly #now: () => number;
  #token: string | null = null;
  #lastUsed = 0;

  constructor(http: BooklookerHttp, config: BooklookerConfig, now: () => number = () => Date.now()) {
    this.#http = http;
    this.#config = config;
    this.#now = now;
  }

  /** Exposed for the tests: whether the cached token is still worth sending. */
  hasFreshToken(): boolean {
    return this.#token !== null && this.#now() - this.#lastUsed < TOKEN_IDLE_MS;
  }

  #options(signal?: AbortSignal): FetchOptions {
    return {
      provider: 'booklooker',
      enabled: this.#config.enabled,
      signal,
      // robots.txt is skipped deliberately. `api.booklooker.de` serves the
      // WEBSITE's robots.txt, which ends in `User-agent: * / Disallow: /`
      // (measured 2026-08-21, 68 KB, identical to www.booklooker.de). That
      // file governs crawling the shop; it is not the licence for the REST API
      // v2.0, which the operator documents publicly and hands out free keys
      // for. We are here as a key holder, not as a crawler.
      apiHost: true,
    };
  }

  async #authenticate(signal?: AbortSignal): Promise<string> {
    const url = `${API_BASE}/authenticate?apiKey=${encodeURIComponent(this.#config.apiKey)}`;
    try {
      const token = readToken(await this.#http.postJson<unknown>(url, this.#options(signal)));
      this.#token = token;
      this.#lastUsed = this.#now();
      return token;
    } catch (err) {
      throw redact(err, this.#config.apiKey);
    }
  }

  async #get(token: string, params: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
    const url = `${API_BASE}/search?token=${encodeURIComponent(token)}&${params.toString()}`;
    try {
      const envelope = await this.#http.getJson<unknown>(url, this.#options(signal));
      this.#lastUsed = this.#now();
      return envelope;
    } catch (err) {
      throw redact(err, token, this.#config.apiKey);
    }
  }

  /**
   * Search, re-authenticating at most once.
   *
   * That second authentication is NOT a retry against a refusal — the rule
   * that a 403 ends the attempt stands untouched. It is the documented
   * lifecycle of this API: "Der Token ist nicht mehr gültig, eine erneute
   * Authentifizierung ist notwendig." Bounded to one, so a server that keeps
   * rejecting fresh tokens produces an error instead of a loop.
   */
  async search(params: URLSearchParams, signal?: AbortSignal): Promise<SearchCall> {
    let requests = 0;
    let token = this.#token;
    if (!this.hasFreshToken()) {
      token = await this.#authenticate(signal);
      requests += 1;
    }

    let envelope = await this.#get(token as string, params, signal);
    requests += 1;

    if (isTokenFailure(envelope)) {
      this.#token = null;
      token = await this.#authenticate(signal);
      requests += 1;
      envelope = await this.#get(token, params, signal);
      requests += 1;
    }
    return { envelope, requests };
  }
}
