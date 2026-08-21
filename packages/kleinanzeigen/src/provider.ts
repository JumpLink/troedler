/**
 * The kleinanzeigen.de adapter — off by default, and it stays that way.
 *
 * This is the one source in troedler whose operator has said no in writing.
 * § 5 of their Nutzungsbedingungen forbids "Crawler, Spider, Scraper oder
 * andere automatisierte Mechanismen … um auf die Kleinanzeigen-Dienste
 * zuzugreifen und Inhalte zu sammeln" without their express written consent,
 * and robots.txt shuts off the price, radius, sort, seller-type and shipping
 * filters on top of that. Neither of those is a puzzle to solve. So:
 *
 *  - `enabledByDefault` is `false` and there is no code path that flips it.
 *    The user switches this on, having been shown the source record, and the
 *    kernel additionally requires an acknowledgement (`Context.isEnabled`).
 *  - `serverFilters` is empty. Not "not implemented yet" — every filter this
 *    source offers lives behind a disallowed URL, so the kernel finishes the
 *    job and `--explain` says so out loud.
 *  - There is no session, no cookie jar, no browser user agent, no retry with
 *    changed headers. A 403 ends the run with a sentence, which is what the
 *    HttpClient already does.
 *
 * What is left is small on purpose: a keyword, optionally narrowed to a
 * category and a place, five pages deep, at the honest user agent's pace.
 */

import {
  PAGE_DEPTH,
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
  type SortKey,
} from '@troedler/core';
import type { HttpClient } from '@troedler/http';

import { parseListingPage, parseSearchPage } from './parse.ts';
import { resolveCategory, type KleinanzeigenCategory } from './categories.ts';
import {
  ADS_PER_PAGE,
  HOST,
  MAX_PAGE,
  UrlError,
  listingUrl,
  searchPath,
  searchUrl,
  type KleinanzeigenLocation,
  type KleinanzeigenScope,
} from './url.ts';

const PROVIDER = 'kleinanzeigen' as const;
export const TERMS_DOC = 'docs/quellen/kleinanzeigen.de.md';

export interface KleinanzeigenDeps {
  readonly http: HttpClient;
  readonly env: Record<string, string | undefined>;
  /** Whether the user switched this source on. Never defaulted to true anywhere. */
  readonly enabled: boolean;
  /** Injected so the "Heute, 18:20" parser and `fetchedAt` can be pinned in tests. */
  readonly now?: () => Date;
}

/**
 * Everything the user may narrow a search to, read from the environment.
 *
 * `TROEDLER_KLEINANZEIGEN_CATEGORY` takes a slug or a number (`fahrraeder`,
 * `c217`, `217`) and is resolved against the checked-in table, so a typo is an
 * error at start-up rather than a query that quietly searches the whole site.
 *
 * `TROEDLER_KLEINANZEIGEN_LOCATION` takes `<slug>/<id>` — `hamburg/9409` —
 * because troedler ships no place table (see `categories.ts` for why) and
 * because `SearchQuery` only ever carries a postal code, which this source's
 * URL grammar cannot use. A user who wants their own region pins it once here.
 * **No radius**: every `…r<km>` path is disallowed in robots.txt, so a radius
 * is the kernel's problem and openly reported as unenforced.
 */
export function scopeFromEnv(env: Record<string, string | undefined>): KleinanzeigenScope {
  let category: KleinanzeigenCategory | null = null;
  const rawCategory = env.TROEDLER_KLEINANZEIGEN_CATEGORY?.trim();
  if (rawCategory) category = resolveCategory(rawCategory);

  let location: KleinanzeigenLocation | null = null;
  const rawLocation = env.TROEDLER_KLEINANZEIGEN_LOCATION?.trim();
  if (rawLocation) {
    const match = rawLocation.match(/^([\p{L}\p{N}-]+)\/l?(\d+)$/u);
    if (!match) {
      throw new ProviderError(
        PROVIDER,
        'not-configured',
        `TROEDLER_KLEINANZEIGEN_LOCATION muss "<ortsslug>/<id>" sein, z. B. "hamburg/9409" — "${rawLocation}" passt nicht. Slug und ID stehen in https://www.kleinanzeigen.de/sitemap_cities.xml.`,
      );
    }
    location = { slug: match[1].toLowerCase(), id: Number.parseInt(match[2], 10) };
  }

  return { category, location };
}

/**
 * The one sort this source does by itself — and only sometimes.
 *
 * `sortierung:` is disallowed in robots.txt, so no sort can be requested. But
 * § 1 of the operator's terms states the default: "Bei der Standard-Sortierung
 * werden ohne Eingabe eines Ortes die neuesten Anzeigen oben angezeigt."
 * Measured on a live keyword page: 25 rows running 18:20 → 18:19, strictly
 * descending. With a place pinned the ordering is the site's own mix and no
 * claim is made. Declaring `newest` unconditionally would be a capability the
 * `--explain` output then repeats as fact.
 */
function serverSorts(scope: KleinanzeigenScope): readonly SortKey[] {
  return scope.location ? [] : ['newest'];
}

export function capabilitiesFor(scope: KleinanzeigenScope): ProviderCapabilities {
  return {
    id: PROVIDER,
    label: 'Kleinanzeigen',
    host: HOST,
    access: 'html',
    freshness: 'live',
    // Empty, and it is the honest answer: price, radius, sort, seller type,
    // shipping and offers-versus-wanted are each behind a URL robots.txt
    // disallows. The kernel applies them to what comes back.
    serverFilters: [] as readonly FilterKey[],
    serverSorts: serverSorts(scope),
    // Five pages of 25 regular ads. The site itself links no further and
    // robots.txt disallows page six onward.
    maxResults: MAX_PAGE * ADS_PER_PAGE,
    cache: {
      // Short because classified ads are volatile — an ad sold at noon is
      // still on the page at 12:05 — and `memoryOnly` because § 5 forbids
      // reproducing their content. Keeping a copy on disk is the thing the
      // clause names; holding one for the length of a search is not.
      ttlSeconds: 300,
      memoryOnly: true,
    },
    enabledByDefault: false,
    termsDoc: TERMS_DOC,
    disclaimer:
      'Anzeigeninhalte von Kleinanzeigen: nur zur eigenen Ansicht. § 5 der Nutzungsbedingungen untersagt es, sie weiterzugeben oder zu veröffentlichen.',
    note:
      'Aus, weil die Nutzungsbedingungen von kleinanzeigen.de (§ 5) automatisierten Abruf ohne ausdrückliche schriftliche Zustimmung untersagen. ' +
      `Wer die Quelle trotzdem nutzen will, liest zuerst ${TERMS_DOC} und schaltet sie dann selbst frei ` +
      '(`troedler providers enable kleinanzeigen`). Diese Entscheidung trifft der Nutzer, nicht die Software. ' +
      'Preis-, Umkreis-, Sortier- und Anbieterfilter sind bei dieser Quelle laut robots.txt gesperrt und werden deshalb erst nach dem Abruf angewendet — höchstens 125 Treffer je Suche.',
  };
}

export class KleinanzeigenProvider implements MarketProvider {
  readonly capabilities: ProviderCapabilities;
  readonly #http: HttpClient;
  readonly #enabled: boolean;
  readonly #scope: KleinanzeigenScope;
  readonly #now: () => Date;
  /** A configuration mistake, kept rather than thrown at construction time. */
  readonly #configError: ProviderError | null;

  constructor(deps: KleinanzeigenDeps) {
    this.#http = deps.http;
    this.#enabled = deps.enabled;
    this.#now = deps.now ?? (() => new Date());

    let scope: KleinanzeigenScope = { category: null, location: null };
    let configError: ProviderError | null = null;
    try {
      scope = scopeFromEnv(deps.env);
    } catch (err) {
      // A bad category slug must not stop troedler from starting — the other
      // five marketplaces have nothing to do with it. It surfaces through
      // `status()`, which is the channel built for exactly this.
      configError =
        err instanceof ProviderError
          ? err
          : new ProviderError(PROVIDER, 'not-configured', err instanceof Error ? err.message : String(err));
    }
    this.#scope = scope;
    this.#configError = configError;
    this.capabilities = capabilitiesFor(scope);
  }

  /**
   * Three states, never two.
   *
   * "Off" is reported as `not-configured` with the reason and the path of the
   * source record, so `troedler providers show` can explain itself without
   * knowing anything about this marketplace.
   */
  async status(): Promise<ProviderStatus> {
    if (this.#configError) {
      return {
        configured: false,
        problem: { kind: this.#configError.kind, message: this.#configError.message },
      };
    }
    if (!this.#enabled) {
      return {
        configured: false,
        problem: {
          kind: 'not-configured',
          message: `Kleinanzeigen ist abgeschaltet: die Nutzungsbedingungen (§ 5) untersagen automatisierten Abruf ohne schriftliche Zustimmung. Vor dem Freischalten ${TERMS_DOC} lesen.`,
        },
      };
    }
    return { configured: true, problem: null };
  }

  async search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
    if (this.#configError) throw this.#configError;

    const wanted = clamp(query.limit, RESULTS_PER_PROVIDER);
    const pages = Math.min(Math.max(1, Math.ceil(wanted / ADS_PER_PAGE)), PAGE_DEPTH.max, MAX_PAGE);
    const now = this.#now();

    const listings: Listing[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>();
    let totalEstimate: number | null = null;
    let requests = 0;
    let more = false;

    for (let page = 1; page <= pages; page += 1) {
      let url: string;
      try {
        url = searchUrl(query.text, this.#scope, page);
      } catch (err) {
        if (err instanceof UrlError) throw new ProviderError(PROVIDER, 'blocked-by-policy', err.message);
        throw err;
      }

      const res = await this.#http.get(url, { provider: PROVIDER, enabled: this.#enabled, signal });
      requests += 1;
      const parsed = parseSearchPage(await res.text(), { now });

      if (page === 1) totalEstimate = parsed.totalEstimate;

      for (const listing of parsed.listings) {
        // Top ads are already gone; this catches an ad that legitimately
        // appears twice across pages while the list shifts under us — which it
        // does, because the default order is "newest first" and new ads arrive
        // between two requests.
        if (seenIds.has(listing.id)) continue;
        seenIds.add(listing.id);
        listings.push(listing);
      }

      more = parsed.nextPath !== null;
      if (!more) break;

      // The site's own next link is the ground truth for the URL grammar. When
      // it disagrees with what this adapter would build, the grammar has moved
      // and the user hears about it — a silently wrong page URL answers 200
      // with the wrong query, which is this source's signature failure.
      if (page + 1 <= pages) {
        const expected = searchPath(query.text, this.#scope, page + 1);
        if (parsed.nextPath !== expected) {
          warnings.push(
            `Kleinanzeigen verlinkt Seite ${page + 1} als "${parsed.nextPath}", erwartet war "${expected}" — die URL-Grammatik hat sich geändert.`,
          );
        }
      }
    }

    return {
      provider: PROVIDER,
      listings: listings.slice(0, wanted),
      // Nothing was applied at the source. Saying so is the point: a "max
      // 200 €" the kernel applied searched these ~125 rows, not the 922 000
      // the site says it has.
      applied: [],
      truncated:
        more || listings.length > wanted || (totalEstimate !== null && totalEstimate > listings.length),
      totalEstimate,
      requests,
      warnings,
    };
  }

  /** One ad in full. `null` when it is gone — that is an answer, not an error. */
  async getListing(id: string, signal?: AbortSignal): Promise<Listing | null> {
    if (this.#configError) throw this.#configError;
    const res = await this.#http.get(listingUrl(id), { provider: PROVIDER, enabled: this.#enabled, signal });
    // `res.url` is where we ended up, not where we asked — an ad that is gone
    // is a redirect to the front page with a 200, never a 404.
    return parseListingPage(await res.text(), id, { now: this.#now(), finalUrl: res.url || listingUrl(id) });
  }
}
