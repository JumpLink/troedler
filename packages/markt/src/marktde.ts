/**
 * The markt.de adapter — off by default, and it stays that way.
 *
 * This source is the one the workspace's research map got backwards, so the
 * measurement is worth stating before the code:
 *
 *  - **robots.txt is open to us.** The `*` group disallows eleven paths, none
 *    of them a search: `*.ajx`, `*ajaxCall`, `*\/shop.htm`, `*\/kartensuche.htm`,
 *    `/admin/`, `/facebook/`, `/*?*contactFlow=` and three more. Every URL this
 *    file builds was run through `@troedler/compliance`'s own matcher on
 *    2026-08-21 and came back ALLOW.
 *  - **The `ClaudeBot` group is not ours.** markt.de does name ClaudeBot, with
 *    an empty `Disallow:` and `Crawl-delay: 1` — a deliberate, generous
 *    permission. It is granted to ClaudeBot. troedler sends `troedler/<v>`,
 *    `groupFor(robots, 'troedler')` therefore returns `*`, and the honest
 *    conclusion is that we get the `*` group and its (absent) crawl delay,
 *    which the gate floors at two seconds. Sending someone else's bot name to
 *    collect someone else's permission is precisely the impersonation this
 *    project refuses.
 *  - **The Nutzungsbedingungen forbid it anyway.** "Das automatische Auslesen
 *    oder Sammeln von Inhalten auf markt.de (z. B. durch Crawler, Spider oder
 *    Scraper) ist ohne ausdrückliche schriftliche Erlaubnis verboten."
 *    (https://www.markt.de/nutzungsbedingungen.htm, read 2026-08-21.)
 *
 * An open robots.txt and a closing clause is a real combination, and the clause
 * wins. So `enabledByDefault` is `false`, there is no code path that flips it,
 * results live in memory only, and the note names the sentence so the person
 * switching it on is deciding with the text in front of them.
 *
 * What survives is deliberately small: a keyword, optionally narrowed to a
 * category, a region or a postcode radius, five pages deep, at the honest
 * agent's pace.
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

import { parseMarktSearchPage } from './parse.ts';
import { MarktUrlError, type MarktDeps } from './shared.ts';

const PROVIDER = 'markt-de' as const;
export const MARKT_HOST = 'www.markt.de';
export const MARKT_ORIGIN = `https://${MARKT_HOST}`;
export const MARKT_TERMS_DOC = 'docs/quellen/markt.de.md';
/** Measured: 20 rows on every result page, from page 1 to page 201. */
export const MARKT_ROWS_PER_PAGE = 20;

/**
 * The radius values the site's own control offers.
 *
 * Read out of `data-slider-input-list` on the search form, not invented. An
 * arbitrary `?radius=37` is not something the UI can produce, so it is not
 * something this adapter asks for.
 */
export const MARKT_RADIUS_STEPS: readonly number[] = [0, 5, 10, 15, 20, 25, 50, 100, 150, 200, 250];

/**
 * The keyword, as markt.de itself canonicalises it.
 *
 * Measured by following the redirect from `/suche.htm?keywords=…`:
 * `"damen fahrrad"` → `/suche/damen+fahrrad/`, `"Nähmaschine Bernina"` →
 * `/suche/n%C3%A4hmaschine+bernina/`. Lowercased, words joined with `+`, UTF-8
 * percent-encoded — and the umlaut kept rather than transliterated, because
 * `naehmaschine` is a different word to this search engine.
 *
 * Building the canonical form ourselves rather than letting the redirect do it
 * saves one request per search, and — more to the point — means the URL the
 * robots gate inspects is the URL that is actually fetched.
 */
export function marktKeywordPath(keyword: string): string {
  const words = keyword
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) {
    throw new MarktUrlError(
      'markt.de braucht einen Suchbegriff. Ohne ihn bliebe nur, den Katalog seitenweise durchzublättern — genau das Sammeln, das die Nutzungsbedingungen untersagen.',
    );
  }
  return words.map(encodeURIComponent).join('+');
}

export interface MarktScope {
  /** `geoUrlId`: a place slug or a postcode. First path segment. */
  readonly region: string | null;
  /** A top-level category slug: `haus-garten`, `elektronik-technik`. Also the first path segment. */
  readonly category: string | null;
}

/** One slug: lowercase letters, digits, single dashes. Shared by both scope halves. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What the user pins once, from the environment.
 *
 * `TROEDLER_MARKT_REGION` is markt.de's own `geoUrlId` — a place slug or, just
 * as validly, a postcode: measured, `/30966/suche/fahrrad/?radius=25` answers
 * 200 with the distance printed on every row.
 *
 * `TROEDLER_MARKT_CATEGORY` is a top-level category slug, and on this source it
 * is the difference between a usable search and an unusable one. markt.de's
 * site-wide keyword search drifts out of classifieds fast: measured on
 * "fahrrad", pages 4 and 50 were twenty of twenty job postings and property
 * listings. `/haus-garten/suche/naehmaschine/` returns 36 hits and zero of
 * them.
 *
 * Both are validated by SHAPE, not against a table: troedler ships no place or
 * category list, and a well-formed but unknown value earns an honest 404 from
 * the site rather than a silent nationwide search.
 */
export function marktScopeFromEnv(env: Record<string, string | undefined>): MarktScope {
  const region = env.TROEDLER_MARKT_REGION?.trim().toLowerCase() || null;
  if (region && !SLUG.test(region)) {
    throw new ProviderError(
      PROVIDER,
      'not-configured',
      `TROEDLER_MARKT_REGION muss eine markt.de-Region sein — ein Slug wie "berlin", "nordrhein-westfalen" oder eine Postleitzahl wie "30966". "${region}" passt nicht.`,
    );
  }

  const category =
    env.TROEDLER_MARKT_CATEGORY?.trim()
      .toLowerCase()
      .replace(/^\/+|\/+$/g, '') || null;
  if (category && !SLUG.test(category)) {
    throw new ProviderError(
      PROVIDER,
      'not-configured',
      `TROEDLER_MARKT_CATEGORY muss eine markt.de-Hauptkategorie sein, z. B. "haus-garten", "elektronik-technik" oder "hobby-freizeit-lernen". "${category}" passt nicht.`,
    );
  }

  return { region, category };
}

/**
 * The nearest published step at or above `km`.
 *
 * Widening rather than narrowing, so a radius filter never drops an offer the
 * user asked to see — the kernel can still discard rows that are too far, but
 * it can never recover ones the site declined to send. Above the largest step
 * the site publishes there is nothing to widen to, and the request comes back
 * narrower than asked; that case is reported, not papered over.
 */
export function marktRadiusStep(km: number): number {
  const steps = MARKT_RADIUS_STEPS;
  for (const step of steps) if (step >= km) return step;
  return steps[steps.length - 1];
}

/** `?sorting=` values the site publishes. `newest` is the default and has none. */
const MARKT_SORTING: Partial<Record<SortKey, string>> = {
  'price-asc': 'price',
  'price-desc': '-price',
};

export interface MarktUrl {
  readonly url: string;
  readonly applied: readonly FilterKey[];
  readonly warnings: readonly string[];
}

/**
 * One search URL, plus an honest account of what it actually constrains.
 *
 * Two things markt.de will NOT do over a plain GET, and both are declared
 * unapplied rather than quietly dropped: the price range and the
 * private/commercial split. Their controls post an encrypted target through
 * `/urlMaskingRedirect.htm` (`data-targeturl="EpFPH8ZM…"`), so there is no URL
 * to build — not one robots.txt forbids, one that does not exist. The kernel
 * finishes both, and `--explain` says so.
 *
 * **A region and a category cannot both be set.** Not a simplification —
 * measured, and both orderings fail silently, which is why this is enforced
 * here rather than left to the caller:
 *
 *     /haus-garten/30966/suche/fahrrad/?radius=25  → 301 to the HOMEPAGE
 *     /30966/haus-garten/suche/fahrrad/?radius=25  → 200, "0 Treffer",
 *                                                    17 recommendation ads
 *
 * The geo wins, because it is what the caller asked for in this query while the
 * category is a standing preference — and the drop is reported.
 */
export function buildMarktSearchUrl(query: SearchQuery, scope: MarktScope, page: number): MarktUrl {
  const keyword = marktKeywordPath(query.text ?? '');
  const applied: FilterKey[] = [];
  const warnings: string[] = [];

  let geo = scope.region;
  let radius: number | null = null;
  if (query.postalCode && query.radiusKm !== undefined) {
    if (scope.region && scope.region !== query.postalCode) {
      warnings.push(
        `markt.de: Die Suche nutzt die PLZ ${query.postalCode} aus der Anfrage, nicht die konfigurierte Region „${scope.region}".`,
      );
    }
    geo = query.postalCode.trim();
    radius = marktRadiusStep(query.radiusKm);
    if (radius === query.radiusKm) {
      applied.push('radius');
    } else {
      // Snapping UP keeps every wanted row in the answer and hands the kernel
      // a `distanceKm` per row to narrow with. Claiming `radius` here would
      // tell the kernel not to bother, and rows up to the next step would ride
      // along as if they had been asked for.
      warnings.push(
        radius > query.radiusKm
          ? `markt.de kennt nur die Umkreise ${MARKT_RADIUS_STEPS.join(', ')} km — gesucht wurde mit ${radius} km statt ${query.radiusKm} km; die zu weit entfernten Treffer werden hier aussortiert.`
          : // Above the largest step there is nothing to widen to, so the answer
            // is narrower than asked and no local pass can fix that. Saying "the
            // rest is filtered locally" here would promise a rescue that cannot
            // happen — offers between the step and the wanted radius were never
            // sent.
            `markt.de kennt höchstens ${radius} km — der gewünschte Umkreis von ${query.radiusKm} km lässt sich nicht abfragen, weiter entfernte Angebote fehlen in diesem Ergebnis.`,
      );
    }
  }

  let segment = geo;
  if (scope.category) {
    if (geo) {
      warnings.push(
        `markt.de kann Kategorie und Ort nicht zugleich: „${scope.category}" bleibt unberücksichtigt, gesucht wird in „${geo}".`,
      );
    } else {
      segment = scope.category;
    }
  }

  const params = new URLSearchParams();
  if (radius !== null) params.set('radius', String(radius));
  const sorting = MARKT_SORTING[query.sort ?? 'relevance'];
  if (sorting) {
    params.set('sorting', sorting);
    applied.push('sort');
  } else if (query.sort === 'newest') {
    // The bare URL IS "Neueste Anzeigen": measured, the option carries
    // `clsy-sorting__option--selected` and no parameter of its own.
    applied.push('sort');
  }
  if (page > 1) params.set('page', String(page));

  const path = segment ? `/${encodeURIComponent(segment)}/suche/${keyword}/` : `/suche/${keyword}/`;
  const search = params.toString();
  return { url: `${MARKT_ORIGIN}${path}${search ? `?${search}` : ''}`, applied, warnings };
}

export function marktCapabilities(): ProviderCapabilities {
  return {
    id: PROVIDER,
    label: 'markt.de',
    host: MARKT_HOST,
    access: 'html',
    freshness: 'live',
    // Radius and sort, and nothing else. Price range, price type and the
    // private/commercial split are all behind the POST-masked form; condition,
    // shipping and GTIN are not fields this source has at all.
    serverFilters: ['radius', 'sort'] as readonly FilterKey[],
    serverSorts: ['newest', 'price-asc', 'price-desc'] as readonly SortKey[],
    maxResults: MARKT_ROWS_PER_PAGE * PAGE_DEPTH.max,
    cache: {
      // Nothing is written to disk, and the TTL is zero. Not a performance
      // choice: the same clause that forbids automated collection also states
      // "Ebenso ist es untersagt, fremde Anzeigeninhalte zu kopieren, zu
      // verändern oder zu verbreiten". A file on disk is a copy.
      ttlSeconds: 0,
      memoryOnly: true,
    },
    enabledByDefault: false,
    termsDoc: MARKT_TERMS_DOC,
    disclaimer:
      'markt.de: Anzeigeninhalte dürfen laut Nutzungsbedingungen nicht kopiert, verändert oder verbreitet werden — die Treffer sind nur zum Ansehen da.',
    note: `Aus. Die Nutzungsbedingungen von markt.de verbieten den automatisierten Abruf: „Das automatische Auslesen oder Sammeln von Inhalten auf markt.de (z. B. durch Crawler, Spider oder Scraper) ist ohne ausdrückliche schriftliche Erlaubnis verboten." Die robots.txt erlaubt die Suchpfade zwar (geprüft 2026-08-21), das ersetzt die schriftliche Erlaubnis aber nicht. Einschalten ist eine Entscheidung — siehe ${MARKT_TERMS_DOC}.`,
  };
}

export function createMarktDeProvider(deps: MarktDeps): MarketProvider {
  const now = deps.now ?? (() => new Date());

  return {
    capabilities: marktCapabilities(),

    async status(): Promise<ProviderStatus> {
      if (!deps.enabled) {
        return {
          configured: false,
          problem: {
            kind: 'not-configured',
            message: `markt.de ist aus. Die Nutzungsbedingungen untersagen „das automatische Auslesen oder Sammeln von Inhalten … ohne ausdrückliche schriftliche Erlaubnis" — siehe ${MARKT_TERMS_DOC}.`,
          },
        };
      }
      try {
        marktScopeFromEnv(deps.env);
      } catch (err) {
        if (err instanceof ProviderError)
          return { configured: false, problem: { kind: err.kind, message: err.message } };
        throw err;
      }
      // No probe request: `status()` runs before every search, and spending a
      // round trip to learn what the search is about to learn anyway doubles
      // the load on a source that owes us nothing.
      return { configured: true, problem: null };
    },

    async search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
      const scope = marktScopeFromEnv(deps.env);
      const wanted = clamp(query.limit, RESULTS_PER_PROVIDER);
      const maxPages = Math.min(Math.ceil(wanted / MARKT_ROWS_PER_PAGE), PAGE_DEPTH.max);

      const listings: Listing[] = [];
      const seen = new Set<string>();
      const warnings: string[] = [];
      let applied: readonly FilterKey[] = [];
      let totalEstimate: number | null = null;
      let requests = 0;
      let more = false;
      let partnerAds = 0;

      for (let page = 1; page <= maxPages; page += 1) {
        let built: MarktUrl;
        try {
          built = buildMarktSearchUrl(query, scope, page);
        } catch (err) {
          if (err instanceof MarktUrlError)
            throw new ProviderError(PROVIDER, 'blocked-by-policy', err.message);
          throw err;
        }
        applied = built.applied;
        if (page === 1) warnings.push(...built.warnings);

        const res = await deps.http.get(built.url, { provider: PROVIDER, enabled: deps.enabled, signal });
        requests += 1;

        const parsed = parseMarktSearchPage(await res.text(), { now: now() });
        if (page === 1) {
          totalEstimate = parsed.totalEstimate;
          warnings.push(...parsed.warnings);
        }
        partnerAds += parsed.partnerAds;

        for (const listing of parsed.listings) {
          // A promoted row (`markt_upselling_pushup`) reappears on later pages.
          if (seen.has(listing.id)) continue;
          seen.add(listing.id);
          listings.push(listing);
        }

        more = parsed.nextUrl !== null;
        if (!more || listings.length >= wanted) break;
      }

      if (partnerAds > 0) {
        // Not cosmetic. markt.de's site-wide keyword search drifts out of
        // classifieds from page 2 on: measured on "fahrrad", page 2 carried 12
        // Partner-Anzeigen and pages 4 and 50 carried 20 of 20 — job postings
        // and property listings, all with a markt.de ad id and no price. They
        // are real ads on this source, so they are returned; they are flagged
        // `commercial` so a private-seller filter removes them, and this line
        // is what stops "50 Treffer" from reading as fifty second-hand offers.
        warnings.push(
          `markt.de: ${partnerAds} von ${listings.length} Zeilen waren Partner-Anzeigen (gewerbliche Fremdinhalte, oft Jobs oder Immobilien).`,
        );
      }

      const kept = listings.slice(0, wanted);
      return {
        provider: PROVIDER,
        listings: kept,
        applied,
        truncated:
          more || listings.length > wanted || (totalEstimate !== null && totalEstimate > kept.length),
        totalEstimate,
        requests,
        warnings,
      };
    },
  };
}
