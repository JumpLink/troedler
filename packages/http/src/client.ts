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

/**
 * What is known about a host's robots.txt.
 *
 * `absent` and `unreadable` both permit the request, and they are still
 * different facts: one is the operator saying nothing, the other is us not
 * having heard. Only a surface that can tell them apart can report honestly.
 */
export type RobotsState =
  | { readonly kind: 'parsed'; readonly robots: Robots }
  | { readonly kind: 'absent'; readonly robots: null }
  | { readonly kind: 'unreadable'; readonly robots: null; readonly detail: string };

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
  readonly #robots = new Map<string, RobotsState>();
  /** The scheme each host was first reached on, so robots.txt is fetched the same way. */
  readonly #schemes = new Map<string, string>();

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
   * Three outcomes, not two, and conflating them was a real defect: a host that
   * publishes no robots.txt genuinely imposes no restriction, while a host whose
   * robots.txt we could not READ has told us nothing at all. Both used to end up
   * as `null`, so a single 503 on `/robots.txt` at process start let the whole
   * run through ungated — and `troedler robots` printed "dieser Host liefert
   * keine robots.txt", a statement about a file nobody had seen.
   *
   * The fail-open itself stays: refusing to work while robots.txt is briefly
   * unreachable turns a network blip into a broken tool, and this project never
   * builds a URL a known rule would refuse anyway. What changes is that the
   * unreadable case is NOT cached — so the next request asks again instead of
   * inheriting one bad moment — and that the caller can tell the two apart.
   */
  async robotsFor(target: URL | string, signal?: AbortSignal): Promise<Robots | null> {
    return (await this.robotsStateFor(target, signal)).robots;
  }

  /**
   * `target` is a full URL wherever the caller has one — the scheme is part of
   * the question.
   *
   * A bare host was the only shape this took, and `troedler robots http://…`
   * therefore probed `https://…/robots.txt`: a different file may answer, so the
   * one caller that exists to verify the gate was verifying a different request
   * than the one it named. Passing the URL makes the scheme travel with it.
   */
  async robotsStateFor(target: URL | string, signal?: AbortSignal): Promise<RobotsState> {
    const url = typeof target === 'string' ? null : target;
    const host = (url?.host ?? String(target)).toLowerCase();
    if (url && !this.#schemes.has(host)) this.#schemes.set(host, url.protocol);

    const cached = this.#robots.get(host);
    if (cached) return cached;

    // The host's own scheme, not a hard-coded `https://`. Against a plain-text
    // listener the old line sent a TLS ClientHello — harmless for the sources
    // shipped today, and not what the code said it did.
    const scheme = this.#schemes.get(host) ?? 'https:';
    let state: RobotsState;
    try {
      const res = await this.#limiter.run(
        host,
        { delaySeconds: 0, maxRequests: null },
        () =>
          this.#fetch(`${scheme}//${host}/robots.txt`, {
            headers: baseHeaders(this.#version),
            signal: signal ?? AbortSignal.timeout(this.#timeoutMs),
          }),
        signal,
      );
      state = res.ok
        ? { kind: 'parsed', robots: parseRobots(await res.text(), new Date().toISOString()) }
        : res.status === 404
          ? { kind: 'absent', robots: null }
          : { kind: 'unreadable', robots: null, detail: `HTTP ${res.status}` };
    } catch (err) {
      state = { kind: 'unreadable', robots: null, detail: err instanceof Error ? err.message : String(err) };
    }

    // An unreadable robots.txt is a moment, not a fact about the host. Caching
    // it would let one 503 disable the gate for the rest of the process.
    if (state.kind !== 'unreadable') this.#robots.set(host, state);
    return state;
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
    if (!this.#schemes.has(host)) this.#schemes.set(host, parsed.protocol);

    // The "is this source even switched on" question is answered BEFORE any
    // socket opens, robots.txt included. Loading robots.txt first would mean a
    // disabled provider still contacted its host — and the sources that are
    // disabled are exactly the ones whose operators asked not to be contacted
    // automatically. A request for robots.txt is still a request.
    const apiHost = options.apiHost ?? false;

    // Everything the gate can decide WITHOUT robots.txt is decided first, and
    // that is not an optimisation. Two of the three refusals — the opt-out list
    // and a switched-off source — are about hosts whose operators asked not to
    // be contacted automatically, and a request for robots.txt is still a
    // request. The disabled case was already handled here; the opt-out case was
    // not, and fetched `/robots.txt` from a host on the list before refusing it.
    //
    // For an API host this preflight is also the final answer: the licence
    // governs, so robots.txt cannot change the verdict and is never asked for.
    const preflight = evaluate({
      url: parsed,
      userAgent: 'troedler',
      robots: null,
      enabled: options.enabled,
      apiHost,
    });
    if (!preflight.allowed) {
      throw new ProviderError(
        options.provider,
        'blocked-by-policy',
        preflight.detail ?? 'Abruf nicht erlaubt.',
      );
    }

    const verdict = apiHost
      ? preflight
      : evaluate({
          url: parsed,
          userAgent: 'troedler',
          robots: await this.robotsFor(parsed, options.signal),
          enabled: true,
          apiHost: false,
        });
    if (!verdict.allowed) {
      throw new ProviderError(
        options.provider,
        'blocked-by-policy',
        verdict.detail ?? 'Abruf nicht erlaubt.',
      );
    }

    const budget: HostBudget = {
      delaySeconds: verdict.delaySeconds,
      maxRequests: this.#maxPerHost,
    };

    let res: Response;
    try {
      res = await this.#limiter.run(
        host,
        budget,
        () =>
          this.#fetch(url, {
            method: init.method,
            headers: baseHeaders(
              this.#version,
              init.contentType
                ? { 'Content-Type': init.contentType, ...options.headers }
                : options.headers,
            ),
            body: init.body,
            redirect: 'follow',
            // gjsify's fetch has no `timeout` option — AbortSignal.timeout is the way.
            signal: options.signal ?? AbortSignal.timeout(this.#timeoutMs),
          }),
        // The queue wait honours the caller's cancellation too, not only the
        // socket: with a two-second floor per host, "stop" has to reach the
        // pause or it does not reach anything the user can see.
        options.signal,
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
