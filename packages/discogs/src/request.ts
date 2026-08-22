/**
 * Talking to `api.discogs.com`: URLs in, parsed JSON plus the rate-limit
 * headers out.
 *
 * It goes through `HttpClient` like everything else, but it deliberately uses
 * `get()` rather than `getJson()`, because the headers ARE part of the answer
 * here. Discogs publishes the remaining budget of its moving 60-second window
 * on every response and asks callers to throttle locally against it
 * ("Your application should take our global limit into account and throttle its
 * requests locally"). Throwing the headers away and finding out about the limit
 * from a 429 would be doing exactly what they ask us not to.
 */

import { ProviderError } from '@troedler/core';
import type { HttpClient } from '@troedler/http';
import type { DiscogsRateLimit } from './types.ts';

export const DISCOGS_HOST = 'api.discogs.com';
export const PROVIDER_ID = 'discogs';

/**
 * Pin the media type to v2.
 *
 * Documented by Discogs as the way to "guarantee your requests will receive
 * data from the correct version you develop your app on", and measured working
 * on 2026-08-21 (`x-discogs-media-type: discogs.v2`). Against a project whose
 * worst failure mode is a silently changed shape, an explicit version is worth
 * the header.
 */
const ACCEPT = 'application/vnd.discogs.v2.discogs+json';

/** Discogs' documented `curr_abbr` values. EUR and GBP measured on 2026-08-21. */
const CURRENCIES = new Set([
  'USD',
  'GBP',
  'EUR',
  'CAD',
  'AUD',
  'JPY',
  'CHF',
  'MXN',
  'BRL',
  'NZD',
  'SEK',
  'ZAR',
]);

/** Discogs' documented maximum for `per_page`. Asking for 250 silently yields 100 — measured. */
export const MAX_PER_PAGE = 100;

export function normalizeCurrency(requested: string | undefined): { currency: string; fallback: boolean } {
  const upper = (requested ?? 'EUR').toUpperCase();
  if (CURRENCIES.has(upper)) return { currency: upper, fallback: false };
  return { currency: 'EUR', fallback: true };
}

export interface SearchUrlInput {
  /** Free text. Omitted when empty — legal, because a barcode search needs no text. */
  readonly text: string;
  /** A GTIN, pushed down as Discogs' `barcode` parameter. */
  readonly gtin?: string;
  readonly perPage: number;
}

/**
 * Build the `/database/search` URL.
 *
 * `type=release` and nothing else: masters, artists and labels are catalogue
 * abstractions with no marketplace behind them, and returning them would be
 * returning things that cannot be bought.
 *
 * The query is assembled as a standalone `URLSearchParams` and concatenated
 * rather than mutated through `url.searchParams`. That began as a workaround —
 * under gjsify ≤ 0.41.0 a `URL` was immutable, every setter threw "setting
 * getter-only property", and `url.searchParams` handed back a DETACHED copy
 * whose `set`/`append`/`delete` reported success and were silently discarded.
 * This very URL therefore went out without a query string on the one runtime
 * troedler ships on, and `/database/search` answered with 34.7 million rows of
 * everything, while Node stayed green.
 *
 * Fixed at the core (gjsify PR #1245, released in 0.42.0) and re-measured here
 * at the bump — 13 of 13 checks green on 0.42.0, 6 of them red on 0.41.0. The
 * shape stays anyway: building a query explicitly is what it should have been,
 * and it needs no mutation to be correct.
 */
export function buildSearchUrl(input: SearchUrlInput): string {
  const params = new URLSearchParams();
  const text = input.text.trim();
  if (text) params.set('q', text);
  if (input.gtin) params.set('barcode', input.gtin);
  params.set('type', 'release');
  params.set('per_page', String(Math.max(1, Math.min(input.perPage, MAX_PER_PAGE))));
  params.set('page', '1');
  return `https://${DISCOGS_HOST}/database/search?${params.toString()}`;
}

/** `curr_abbr` is what makes the price a euro price; without it Discogs answers in USD. */
export function buildStatsUrl(releaseId: number, currency: string): string {
  return `https://${DISCOGS_HOST}/marketplace/stats/${releaseId}?curr_abbr=${encodeURIComponent(currency)}`;
}

/**
 * The catalogue entry, for detail views only.
 *
 * No `curr_abbr`: this endpoint ignores it. Sending one would suggest the price
 * field it returns is in that currency, and the whole point of not reading that
 * field is that it is not.
 */
export function buildReleaseUrl(releaseId: number): string {
  return `https://${DISCOGS_HOST}/releases/${releaseId}`;
}

/**
 * The token header.
 *
 * `Discogs token=…` is the personal-access-token form — no OAuth dance, no
 * user account involved, and it is the only credential this adapter ever
 * carries. There is no cookie and no session anywhere in this package.
 */
export function authHeaders(token: string | undefined): Record<string, string> {
  const trimmed = (token ?? '').trim();
  return trimmed ? { Authorization: `Discogs token=${trimmed}` } : {};
}

/** Anything with a case-insensitive `get` — `Headers`, or a fake in a test. */
export interface HeaderBag {
  get(name: string): string | null;
}

function intHeader(headers: HeaderBag, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read `X-Discogs-Ratelimit*`.
 *
 * Worth knowing before trusting `limit`: an INVALID token still gets
 * `x-discogs-ratelimit: 60` alongside its 401 — measured. The header states the
 * tier the request claimed, not the one it was granted, so it is reported as
 * budget and never used to conclude that a token works.
 */
export function readRateLimit(headers: HeaderBag): DiscogsRateLimit {
  return {
    limit: intHeader(headers, 'x-discogs-ratelimit'),
    remaining: intHeader(headers, 'x-discogs-ratelimit-remaining'),
    used: intHeader(headers, 'x-discogs-ratelimit-used'),
  };
}

export interface DiscogsResponse<T> {
  readonly data: T;
  readonly rateLimit: DiscogsRateLimit;
}

export interface RequestContext {
  readonly http: HttpClient;
  readonly enabled: boolean;
  readonly token: string | undefined;
  readonly signal?: AbortSignal;
}

/**
 * One GET, one parsed body, one rate-limit reading.
 *
 * `apiHost: true` skips the robots.txt gate, and the reason is narrower than
 * "it is an API". Measured on 2026-08-21: `api.discogs.com/robots.txt` is
 * byte-identical to the website's, and under `User-agent: *` neither
 * `/database/search` nor `/marketplace/stats/` is disallowed — so both
 * endpoints would pass the gate on their own. What the flag actually drops is
 * the two-second politeness floor layered on top, which would turn twenty price
 * lookups into forty seconds of waiting for no benefit: Discogs publishes its
 * own limit and its own remaining budget, and `provider.ts` throttles against
 * those instead. (The same robots.txt does disallow `/users/`, which is one
 * more reason this adapter never touches seller inventories.)
 */
export async function requestJson<T>(url: string, ctx: RequestContext): Promise<DiscogsResponse<T>> {
  let res: Response;
  try {
    res = await ctx.http.get(url, {
      provider: PROVIDER_ID,
      enabled: ctx.enabled,
      apiHost: true,
      headers: { Accept: ACCEPT, ...authHeaders(ctx.token) },
      signal: ctx.signal,
    });
  } catch (err) {
    throw explain(err, ctx.token !== undefined && ctx.token.trim().length > 0);
  }

  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new ProviderError(
      PROVIDER_ID,
      'remote-error',
      `${DISCOGS_HOST} lieferte kein JSON (${text.slice(0, 80).replace(/\s+/g, ' ')}…).`,
    );
  }
  return { data, rateLimit: readRateLimit(res.headers) };
}

/**
 * Give a refusal a cause the reader can act on.
 *
 * The generic 401/403 message is right for a bot wall and misleading here:
 * Discogs answers a bad token with 401 and the text "Invalid consumer token"
 * (measured), which is a typo in a config file, not a decision by the operator.
 * The KIND stays `refused` — there is still nothing to retry, and nothing about
 * the request may be varied to get round it.
 */
function explain(err: unknown, hasToken: boolean): unknown {
  if (!(err instanceof ProviderError) || err.kind !== 'refused') return err;
  const message = hasToken
    ? `${DISCOGS_HOST} weist den Zugriff ab. Der gesetzte DISCOGS_TOKEN wird nicht akzeptiert — prüfe ihn unter discogs.com/settings/developers oder entferne ihn: ohne Token funktioniert die Suche weiter, mit 25 statt 60 Anfragen pro Minute.`
    : `${DISCOGS_HOST} weist den Zugriff ab. Kein erneuter Versuch — das ist eine Entscheidung des Anbieters, kein Fehler.`;
  return new ProviderError(PROVIDER_ID, 'refused', message, { cause: err });
}
