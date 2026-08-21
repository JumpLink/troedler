/**
 * The one way out of this process.
 *
 * Every adapter fetches through `HttpClient`, and it refuses rather than asks
 * politely: the compliance gate runs before the socket opens, the rate limiter
 * paces what survives, and a refusal from the remote ends the attempt instead
 * of starting a retry.
 *
 * That last one is the rule worth stating plainly: **a 403 is a decision, not
 * a hiccup.** Retrying it — especially with anything about the request changed
 * — is the definition of circumventing an access restriction. So there is no
 * retry-with-different-headers path in this file, and there is no place to add
 * one without deleting this comment first.
 */

import { DEFAULT_DELAY_SECONDS, evaluate, parseRobots, type Robots } from '@troedler/compliance';
import { ProviderError } from '@troedler/core';
import { baseHeaders } from './agent.ts';
import { RateLimitExceeded, RateLimiter, type HostBudget } from './ratelimit.ts';

export interface HttpClientOptions {
  readonly version: string;
  /** Seconds before an in-flight request is abandoned. */
  readonly timeoutSeconds?: number;
  /** Requests one provider may spend per run. Guards against a paging loop. */
  readonly maxRequestsPerHost?: number | null;
  readonly limiter?: RateLimiter;
  /** Injected for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface FetchOptions {
  /** Provider id, for error attribution. */
  readonly provider: string;
  /** Whether the user enabled this source. The gate refuses when false. */
  readonly enabled: boolean;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  /**
   * Skip the robots.txt check. Legal only for a documented API host, where
   * robots.txt governs the website and not the API we are licensed to call.
   * Every use of this flag names the licence in a comment at the call site.
   */
  readonly apiHost?: boolean;
}

export class HttpClient {
  readonly #version: string;
  readonly #timeoutMs: number;
  readonly #maxPerHost: number | null;
  readonly #limiter: RateLimiter;
  readonly #fetch: typeof fetch;
  readonly #robots = new Map<string, Robots | null>();

  constructor(options: HttpClientOptions) {
    this.#version = options.version;
    this.#timeoutMs = (options.timeoutSeconds ?? 20) * 1000;
    this.#maxPerHost = options.maxRequestsPerHost ?? 40;
    this.#limiter = options.limiter ?? new RateLimiter();
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  requestsUsed(host: string): number {
    return this.#limiter.used(host);
  }

  /**
   * Load and cache a host's robots.txt for the life of this client.
   *
   * A 404 means "no restrictions" and is cached as such — re-asking a host that
   * has no robots.txt on every request would be its own small rudeness. A
   * failure to reach it at all is treated as "no restrictions" too, because the
   * alternative — refusing to work when robots.txt is briefly unreachable —
   * turns a transient network blip into a broken tool.
   */
  async robotsFor(host: string, signal?: AbortSignal): Promise<Robots | null> {
    if (this.#robots.has(host)) return this.#robots.get(host) ?? null;

    let robots: Robots | null = null;
    try {
      const res = await this.#limiter.run(host, { delaySeconds: 0, maxRequests: null }, () =>
        this.#fetch(`https://${host}/robots.txt`, {
          headers: baseHeaders(this.#version),
          signal: signal ?? AbortSignal.timeout(this.#timeoutMs),
        }),
      );
      if (res.ok) robots = parseRobots(await res.text(), new Date().toISOString());
    } catch {
      robots = null;
    }
    this.#robots.set(host, robots);
    return robots;
  }

  /**
   * The single request path. Every method below funnels through it, which is
   * how "the gate runs before the socket opens" stays a fact rather than a
   * convention someone forgets on the next method.
   */
  async #request(
    url: string,
    options: FetchOptions,
    init: { method: 'GET' | 'POST'; body?: string; contentType?: string },
  ): Promise<Response> {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();

    // The "is this source even switched on" question is answered BEFORE any
    // socket opens, robots.txt included. Loading robots.txt first would mean a
    // disabled provider still contacted its host — and the sources that are
    // disabled are exactly the ones whose operators asked not to be contacted
    // automatically. A request for robots.txt is still a request.
    if (!options.enabled) {
      const refusal = evaluate({ url: parsed, userAgent: 'troedler', robots: null, enabled: false });
      throw new ProviderError(
        options.provider,
        'blocked-by-policy',
        refusal.detail ?? 'Quelle ist abgeschaltet.',
      );
    }

    const robots = options.apiHost ? null : await this.robotsFor(host, options.signal);
    const verdict = evaluate({
      url: parsed,
      userAgent: 'troedler',
      robots,
      enabled: true,
    });
    if (!verdict.allowed) {
      throw new ProviderError(
        options.provider,
        'blocked-by-policy',
        verdict.detail ?? 'Abruf nicht erlaubt.',
      );
    }

    const budget: HostBudget = {
      delaySeconds: options.apiHost ? 0 : verdict.delaySeconds,
      maxRequests: this.#maxPerHost,
    };

    let res: Response;
    try {
      res = await this.#limiter.run(host, budget, () =>
        this.#fetch(url, {
          method: init.method,
          headers: baseHeaders(
            this.#version,
            init.contentType ? { 'Content-Type': init.contentType, ...options.headers } : options.headers,
          ),
          body: init.body,
          redirect: 'follow',
          // gjsify's fetch has no `timeout` option — AbortSignal.timeout is the way.
          signal: options.signal ?? AbortSignal.timeout(this.#timeoutMs),
        }),
      );
    } catch (err) {
      if (err instanceof RateLimitExceeded) {
        throw new ProviderError(options.provider, 'rate-limited', err.message);
      }
      throw new ProviderError(
        options.provider,
        'unreachable',
        err instanceof Error ? err.message : String(err),
        { cause: err },
      );
    }

    if (res.status === 429 || res.status === 503) {
      const retry = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      throw new ProviderError(options.provider, 'rate-limited', `${host} drosselt (HTTP ${res.status}).`, {
        retryAfterSeconds: Number.isFinite(retry) ? retry : null,
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        options.provider,
        'refused',
        `${host} verweigert den Zugriff (HTTP ${res.status}). Kein erneuter Versuch — das ist eine Entscheidung des Anbieters, kein Fehler.`,
      );
    }
    if (!res.ok) {
      throw new ProviderError(options.provider, 'remote-error', `${host} antwortete mit HTTP ${res.status}.`);
    }
    return res;
  }

  async get(url: string, options: FetchOptions): Promise<Response> {
    return this.#request(url, options, { method: 'GET' });
  }

  /**
   * Parse a JSON body, or say plainly that it was not JSON.
   *
   * eBay's edge answers an unauthenticated call with an HTML error page rather
   * than JSON, and Booklooker's legacy interface answers HTTP 200 with an EMPTY
   * body when a required parameter is missing. Reporting "unexpected token <"
   * or "unexpected end of input" would send the reader hunting for a parser bug
   * instead of the missing credential.
   */
  async #json<T>(res: Response, url: string, provider: string): Promise<T> {
    const text = await res.text();
    if (text.trim() === '') {
      throw new ProviderError(
        provider,
        'remote-error',
        `${new URL(url).host} antwortete mit HTTP ${res.status} und leerem Körper — das ist keine leere Trefferliste, sondern eine unbeantwortete Anfrage.`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(
        provider,
        'remote-error',
        `${new URL(url).host} lieferte kein JSON (${text.slice(0, 80).replace(/\s+/g, ' ')}…).`,
      );
    }
  }

  async getJson<T>(url: string, options: FetchOptions): Promise<T> {
    const res = await this.#request(
      url,
      { ...options, headers: { Accept: 'application/json', ...options.headers } },
      { method: 'GET' },
    );
    return this.#json<T>(res, url, options.provider);
  }

  /**
   * POST a form-encoded body. Used for OAuth token endpoints, which is the only
   * reason it exists — it is not a general-purpose write path, and nothing in
   * this project posts to a marketplace to change anything.
   */
  async postForm<T>(url: string, form: Record<string, string>, options: FetchOptions): Promise<T> {
    const res = await this.#request(
      url,
      { ...options, headers: { Accept: 'application/json', ...options.headers } },
      {
        method: 'POST',
        body: new URLSearchParams(form).toString(),
        contentType: 'application/x-www-form-urlencoded',
      },
    );
    return this.#json<T>(res, url, options.provider);
  }

  /** POST with no body — some APIs take their parameters on the query string. */
  async postJson<T>(url: string, options: FetchOptions): Promise<T> {
    const res = await this.#request(
      url,
      { ...options, headers: { Accept: 'application/json', ...options.headers } },
      { method: 'POST' },
    );
    return this.#json<T>(res, url, options.provider);
  }
}

export { DEFAULT_DELAY_SECONDS };
