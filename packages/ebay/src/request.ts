/**
 * HTTP against eBay: one token, cached, and three GETs.
 *
 * **The token cache is the point of this file, not an optimisation.** eBay's
 * default tier allows 5 000 Browse calls a day but only **1 000
 * `client_credentials` token requests** a day. An adapter that fetches a token
 * per search therefore runs out of the *smaller* budget first and starts
 * failing at one fifth of the searches it was licensed for. An application
 * token is valid 7 200 s, so twelve of them cover a day; eBay's own
 * documentation says to *"store this token in a static variable and re-use the
 * token while it is valid."*
 *
 * Everything leaves through `@troedler/http` — the rate limiter, the
 * compliance gate and the "a 403 is a decision, not a hiccup" rule live there,
 * and a second way out of the process would bypass all three.
 */

import { ProviderError } from '@troedler/core';
import type { FetchOptions } from '@troedler/http';
import type { EbayRateLimitResponse, EbayTokenResponse } from './types.ts';

export const EBAY_API_HOST = 'api.ebay.com';
export const EBAY_SANDBOX_HOST = 'api.sandbox.ebay.com';

/** The base scope. There is no `buy.browse` scope — eBay support, Nov 2025. */
export const EBAY_SCOPE = 'https://api.ebay.com/oauth/api_scope';

const PROVIDER = 'ebay';

/**
 * The slice of `HttpClient` this adapter needs.
 *
 * Structural rather than the class itself for one reason: eBay's token
 * endpoint is a **POST**, and `HttpClient` exposes only `get`/`getJson` today.
 * `postForm` is the method it has to grow — see the note in
 * `docs/quellen/ebay.de.md`. Typing against the shape rather than the class
 * keeps this package honest (it names exactly what it uses) and lets a real
 * `HttpClient` satisfy it with no cast the moment the method lands.
 */
export interface EbayHttp {
  getJson<T>(url: string, options: FetchOptions): Promise<T>;
  postForm<T>(url: string, form: Record<string, string>, options: FetchOptions): Promise<T>;
}

export interface EbayClientOptions {
  readonly http: EbayHttp;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly marketplaceId: string;
  readonly enabled: boolean;
  /** `api.ebay.com`, or the sandbox host. */
  readonly host?: string;
  /** Injected so the token-expiry tests do not have to wait two hours. */
  readonly now?: () => number;
}

interface CachedToken {
  readonly value: string;
  readonly expiresAtMs: number;
}

/**
 * Refresh this many seconds before eBay says the token dies.
 *
 * A token that expires mid-flight comes back as a 401, and a 401 is a stop
 * sign this project does not retry — so the margin is what keeps a legitimate
 * search from ending in "eBay verweigert den Zugriff".
 */
const EXPIRY_MARGIN_SECONDS = 60;

/**
 * `Authorization: Basic` for the token call.
 *
 * `btoa` is Latin-1 only, which is correct here and nowhere else: an eBay
 * client id and secret are ASCII by construction. gjsify polyfills `btoa` over
 * GLib's base64 encoder, so this is the one spelling that works unchanged on
 * Node and GJS.
 */
function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export class EbayClient {
  readonly #http: EbayHttp;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #marketplaceId: string;
  readonly #enabled: boolean;
  readonly #host: string;
  readonly #now: () => number;

  #token: CachedToken | null = null;
  /** In-flight token request, so two concurrent searches spend one of the 1 000. */
  #pending: Promise<string> | null = null;
  #requests = 0;

  constructor(options: EbayClientOptions) {
    this.#http = options.http;
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#marketplaceId = options.marketplaceId;
    this.#enabled = options.enabled;
    this.#host = options.host ?? EBAY_API_HOST;
    this.#now = options.now ?? (() => Date.now());
  }

  /** HTTP calls this client has made. Feeds `ProviderResult.requests`. */
  get requests(): number {
    return this.#requests;
  }

  /**
   * `apiHost: true` — and the licence that justifies it.
   *
   * `ebay.de/robots.txt` governs the WEBSITE. `api.ebay.com` is a documented
   * API we call under the eBay API License Agreement with a keyset eBay issued
   * for exactly this, so the website's crawl rules are not the rule that
   * applies. Nothing in this adapter ever touches the website.
   */
  #fetchOptions(extra: Record<string, string>, signal?: AbortSignal): FetchOptions {
    return { provider: PROVIDER, enabled: this.#enabled, apiHost: true, headers: extra, signal };
  }

  /** A valid application token, from cache when there is one. */
  async token(signal?: AbortSignal): Promise<string> {
    const cached = this.#token;
    if (cached && cached.expiresAtMs > this.#now()) return cached.value;
    if (this.#pending) return this.#pending;

    const pending = this.#fetchToken(signal);
    this.#pending = pending;
    try {
      return await pending;
    } finally {
      // Cleared either way: a failed attempt must not pin a rejected promise
      // and turn one bad minute into a permanently broken provider.
      this.#pending = null;
    }
  }

  async #fetchToken(signal?: AbortSignal): Promise<string> {
    this.#requests += 1;
    let body: EbayTokenResponse;
    try {
      body = await this.#http.postForm<EbayTokenResponse>(
        `https://${this.#host}/identity/v1/oauth2/token`,
        { grant_type: 'client_credentials', scope: EBAY_SCOPE },
        this.#fetchOptions(
          {
            Authorization: basicAuth(this.#clientId, this.#clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          signal,
        ),
      );
    } catch (err) {
      if (err instanceof ProviderError) {
        // The kind stays whatever the transport decided; only the sentence
        // changes. A rejected token is almost always one of three things, and
        // naming them beats "HTTP 401".
        throw new ProviderError(
          PROVIDER,
          err.kind,
          `eBay lehnte den Token-Abruf ab: ${err.message} Prüfe EBAY_CLIENT_ID und EBAY_CLIENT_SECRET, dass es ein Production-Keyset ist, und dass für dieses Keyset die Marketplace-Account-Deletion-Benachrichtigungen abonniert ODER abgewählt sind — ohne das lehnt eBay den ersten Production-Call ab.`,
          { cause: err },
        );
      }
      throw err;
    }

    if (body.error || !body.access_token) {
      throw new ProviderError(
        PROVIDER,
        'not-configured',
        `eBay gab keinen Token aus (${body.error ?? 'ohne Fehlercode'}${
          body.error_description ? `: ${body.error_description}` : ''
        }).`,
      );
    }

    const lifetime = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 7200;
    this.#token = {
      value: body.access_token,
      expiresAtMs: this.#now() + Math.max(1, lifetime - EXPIRY_MARGIN_SECONDS) * 1000,
    };
    return body.access_token;
  }

  #authHeaders(token: string, endUserCtx: string | null): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      // MANDATORY. eBay's own words: "If the marketplace ID value is invalid or
      // missing, the default value of EBAY_US is used." No error, no warning —
      // just American results for a German search.
      'X-EBAY-C-MARKETPLACE-ID': this.#marketplaceId,
      ...(endUserCtx ? { 'X-EBAY-C-ENDUSERCTX': endUserCtx } : {}),
    };
  }

  async search(
    params: Record<string, string>,
    endUserCtx: string | null,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const token = await this.token(signal);
    const url = `https://${this.#host}/buy/browse/v1/item_summary/search?${new URLSearchParams(params).toString()}`;
    this.#requests += 1;
    return this.#http.getJson<unknown>(url, this.#fetchOptions(this.#authHeaders(token, endUserCtx), signal));
  }

  /** One item in full. The id carries pipes (`v1|123|0`) and must stay encoded. */
  async item(itemId: string, signal?: AbortSignal): Promise<unknown> {
    const token = await this.token(signal);
    const url = `https://${this.#host}/buy/browse/v1/item/${encodeURIComponent(itemId)}`;
    this.#requests += 1;
    return this.#http.getJson<unknown>(url, this.#fetchOptions(this.#authHeaders(token, null), signal));
  }

  /** What eBay says is left of today's budget. Same application token, no extra scope. */
  async rateLimits(signal?: AbortSignal): Promise<EbayRateLimitResponse> {
    const token = await this.token(signal);
    const url = `https://${this.#host}/developer/analytics/v1_beta/rate_limit/?${new URLSearchParams({
      api_context: 'buy',
      api_name: 'browse',
    }).toString()}`;
    this.#requests += 1;
    return this.#http.getJson<EbayRateLimitResponse>(
      url,
      this.#fetchOptions({ Authorization: `Bearer ${token}` }, signal),
    );
  }
}
