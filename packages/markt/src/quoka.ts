/**
 * The Quoka adapter — on by default, and the reasoning is worth reading once.
 *
 * Measured on 2026-08-21, both documents fetched under the honest user agent:
 *
 *  - **robots.txt.** The `*` group opens with `Allow: /` and then disallows 52
 *    paths. Every one of them belongs to the site's PREVIOUS URL scheme —
 *    `/Suchergebnis/`, `/Suchen/`, `/Detailansicht/`, `/Bildansicht/` — plus
 *    internals (`/ajax/`, `/qs/`, `/qpi/`, `/libs/`, `/outgoing/`). Today's
 *    search lives at `/anzeigen/?q=…` and today's ad at
 *    `/anzeigen/<kategorie>/…/anzeige/<slug>/<token>.html`, neither of which
 *    any rule touches. Run through `@troedler/compliance`'s own matcher: ALLOW,
 *    on the `Allow: /` rule.
 *  - **The `ClaudeBot` group is not ours.** Quoka names ClaudeBot, claude-web,
 *    anthropic-ai, GPTBot, CCBot, PerplexityBot and Applebot with `Allow: /`
 *    each — and blocks Bytespider, Baiduspider, DeepSeek and five others. A
 *    considered AI policy, and a permission granted to those names.
 *    `groupFor(robots, 'troedler')` returns `*`, which is what troedler abides
 *    by. It happens to permit the same paths; we do not borrow a bot's name to
 *    find out.
 *  - **The AGB say nothing about crawlers.** No occurrence of Crawler, Spider,
 *    Scraper, Roboter, automatisiert or maschinell anywhere in the document
 *    (https://hilfebereich.quoka.de/agb/). What it does say, under
 *    "Nutzungsrecht": "Quoka gestattet Ihnen die Ansicht und das Herunterladen
 *    einer Kopie der Inhalte auf quoka.de ausschließlich für persönliche und
 *    nicht-kommerzielle Zwecke", and "Es ist nicht gestattet, die Inhalte zu
 *    verkaufen, zu verändern, zu veröffentlichen, zu verbreiten oder auf andere
 *    Weise für öffentliche oder kommerzielle Zwecke zu nutzen."
 *
 * A local tool searching on its own user's behalf is the permitted case, almost
 * word for word. Redistribution is the forbidden one — which troedler does not
 * do, and which the `disclaimer` keeps in front of whoever is looking at the
 * rows. Hence `enabledByDefault: true`, and a cache that may live on disk
 * because "das Herunterladen einer Kopie … für persönliche Zwecke" is the thing
 * that was expressly allowed.
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
  type SellerType,
  type SortKey,
} from '@troedler/core';

import { parseQuokaSearchPage } from './parse.ts';
import { MarktUrlError, type MarktDeps } from './shared.ts';

const PROVIDER = 'quoka' as const;
export const QUOKA_HOST = 'www.quoka.de';
export const QUOKA_ORIGIN = `https://${QUOKA_HOST}`;
export const QUOKA_TERMS_DOC = 'docs/quellen/quoka.de.md';
/** Measured: 20 rows per page, `&pag=` up to at least 100. */
export const QUOKA_ROWS_PER_PAGE = 20;

/**
 * A category as Quoka spells it under `/anzeigen/`: `elektronik/computer`.
 *
 * Shape-validated rather than checked against a table, for the same reason as
 * markt.de's region: no place or category list ships with troedler, and a
 * well-formed but unknown category gets an honest 404 rather than a silent
 * search of everything.
 */
export function quokaCategoryFromEnv(env: Record<string, string | undefined>): string | null {
  const raw = env.TROEDLER_QUOKA_CATEGORY?.trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  if (!raw) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(raw)) {
    throw new ProviderError(
      PROVIDER,
      'not-configured',
      `TROEDLER_QUOKA_CATEGORY muss ein Quoka-Kategoriepfad unter /anzeigen/ sein, z. B. "elektronik/computer". "${raw}" passt nicht.`,
    );
  }
  return raw;
}

export interface QuokaUrl {
  readonly url: string;
  readonly applied: readonly FilterKey[];
  readonly warnings: readonly string[];
  /** What the request constrains the seller to — the parser stamps it onto every row. */
  readonly sellerType: SellerType;
}

/**
 * One search URL, and an honest account of what it constrains.
 *
 * Three parameters were tried against the live site and only one of them does
 * anything, which is precisely why the other two are absent here rather than
 * present and hopeful:
 *
 *   `&commercial=false`  WORKS. 3521 hits → 1140, matching the "Privat 1140"
 *                        count the site prints beside the filter.
 *   `&order=priceasc`    IGNORED. Same 20 rows in the same order as the bare
 *                        URL. The sort control is a `<select>` with no name,
 *                        driven by script; there is no GET form of it.
 *   `&Zip=…&Area=…`      WORSE THAN IGNORED. Answers "Für die angegebenen
 *                        Suchkriterien wurden keine Ergebnisse gefunden" with
 *                        `resultscount = 0` and six recommendation ads. The
 *                        location control geocodes through `City`/`County`
 *                        first; a bare postcode is not a query this site takes.
 *
 * A radius that silently returns nothing is the worst outcome available here,
 * so radius stays the kernel's job and is never put in the URL.
 */
export function buildQuokaSearchUrl(query: SearchQuery, category: string | null, page: number): QuokaUrl {
  const text = (query.text ?? '').trim();
  if (!text && !category) {
    throw new MarktUrlError(
      'Quoka braucht einen Suchbegriff oder eine konfigurierte Kategorie (TROEDLER_QUOKA_CATEGORY) — sonst bliebe nur, den Katalog durchzublättern.',
    );
  }

  const applied: FilterKey[] = [];
  const warnings: string[] = [];
  const params = new URLSearchParams();
  if (text) params.set('q', text);

  let sellerType: SellerType = 'unknown';
  if (query.sellerType === 'private' || query.sellerType === 'commercial') {
    params.set('commercial', query.sellerType === 'commercial' ? 'true' : 'false');
    applied.push('sellerType');
    sellerType = query.sellerType;
  }

  if (query.sort === 'newest') {
    // Not a parameter — the site's default order. Measured across four pages of
    // one query: page 1 all "heute", page 4 "gestern", page 8 "19 August",
    // page 50 "21 Juli". Strictly descending, so the claim is a measurement.
    applied.push('sort');
  } else if (query.sort && query.sort !== 'relevance') {
    warnings.push(
      'Quoka sortiert nur nach Datum (neueste zuerst) — die gewünschte Sortierung macht der Kern.',
    );
  }

  if (page > 1) params.set('pag', String(page));

  const path = category ? `/anzeigen/${category}/` : '/anzeigen/';
  const search = params.toString();
  return { url: `${QUOKA_ORIGIN}${path}${search ? `?${search}` : ''}`, applied, warnings, sellerType };
}

export function quokaCapabilities(): ProviderCapabilities {
  return {
    id: PROVIDER,
    label: 'Quoka',
    host: QUOKA_HOST,
    access: 'html',
    freshness: 'live',
    // Seller type and the default date order. Price range, radius and any other
    // sort are script-driven with no GET equivalent — see `buildQuokaSearchUrl`
    // for what was measured rather than assumed.
    serverFilters: ['sellerType', 'sort'] as readonly FilterKey[],
    serverSorts: ['newest'] as readonly SortKey[],
    maxResults: QUOKA_ROWS_PER_PAGE * PAGE_DEPTH.max,
    cache: {
      // Fifteen minutes. Classified ads go stale by being sold rather than by
      // changing, and this source's own "Nutzungsrecht" clause expressly
      // permits downloading a copy for personal use — so unlike markt.de, disk
      // is allowed here.
      ttlSeconds: 900,
      memoryOnly: false,
    },
    enabledByDefault: true,
    termsDoc: QUOKA_TERMS_DOC,
    disclaimer:
      'Quoka gestattet Ansicht und Download der Inhalte ausschließlich für persönliche, nicht-kommerzielle Zwecke — Weitergabe oder Veröffentlichung der Treffer ist nicht erlaubt.',
    note: null,
    noCoMingling: false,
  };
}

export function createQuokaProvider(deps: MarktDeps): MarketProvider {
  const now = deps.now ?? (() => new Date());

  return {
    capabilities: quokaCapabilities(),

    /**
     * Requests spent against this host in this process.
     *
     * Read from the socket layer, not from a counter this adapter maintains —
     * a `catch` path that forgets to book its requests is exactly how a failed
     * search reported "0 Anfragen, 1189 ms".
     */
    requestsUsed: () => deps.http.requestsUsed(QUOKA_HOST),

    async status(): Promise<ProviderStatus> {
      if (!deps.enabled) {
        return {
          configured: false,
          problem: {
            kind: 'not-configured',
            message: 'Quoka ist nicht aktiviert. Zugangsdaten braucht es keine, nur den Schalter.',
          },
        };
      }
      try {
        quokaCategoryFromEnv(deps.env);
      } catch (err) {
        if (err instanceof ProviderError)
          return { configured: false, problem: { kind: err.kind, message: err.message } };
        throw err;
      }
      return { configured: true, problem: null };
    },

    async search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
      const category = quokaCategoryFromEnv(deps.env);
      const wanted = clamp(query.limit, RESULTS_PER_PROVIDER);
      const maxPages = Math.min(Math.ceil(wanted / QUOKA_ROWS_PER_PAGE), PAGE_DEPTH.max);

      const listings: Listing[] = [];
      const seen = new Set<string>();
      const warnings: string[] = [];
      let applied: readonly FilterKey[] = [];
      let totalEstimate: number | null = null;
      let requests = 0;
      let more = false;
      /** Set false by any page whose seller strip did not back the filter. */
      let sellerFilterBacked = true;

      for (let page = 1; page <= maxPages; page += 1) {
        let built: QuokaUrl;
        try {
          built = buildQuokaSearchUrl(query, category, page);
        } catch (err) {
          if (err instanceof MarktUrlError)
            throw new ProviderError(PROVIDER, 'blocked-by-policy', err.message);
          throw err;
        }
        applied = built.applied;
        if (page === 1) warnings.push(...built.warnings);

        const res = await deps.http.get(built.url, { provider: PROVIDER, enabled: deps.enabled, signal });
        requests += 1;

        const parsed = parseQuokaSearchPage(await res.text(), { now: now(), sellerType: built.sellerType });
        // Every page is checked, not only the first: the strip is on all of them
        // (measured 2026-08-22 on page 2 of a filtered search), and a filter that
        // is honoured on page 1 and dropped on page 3 is exactly the shape of
        // defect this canary is for. One unconfirmed page disqualifies the claim
        // for the whole result — `applied` is a statement about the run.
        if (built.sellerType !== 'unknown' && parsed.sellerFilter.kind !== 'confirmed') {
          sellerFilterBacked = false;
        }
        if (page === 1) {
          totalEstimate = parsed.totalEstimate;
          warnings.push(...parsed.warnings);
        } else {
          // Later pages contribute only what is new — repeating page 1's notes
          // per page would turn one fact into five lines of the same sentence.
          for (const warning of parsed.warnings) if (!warnings.includes(warning)) warnings.push(warning);
        }

        for (const listing of parsed.listings) {
          if (seen.has(listing.id)) continue;
          seen.add(listing.id);
          listings.push(listing);
        }

        more = parsed.nextUrl !== null;
        if (!more || listings.length >= wanted) break;
      }

      // An unbacked filter is not an applied one. Dropping it here is what makes
      // the kernel finish the job and `--explain` report it honestly: with every
      // row's `sellerType` back at `unknown`, `applyPostFilters` finds the filter
      // structurally inert on this source and prints it under "NICHT angewandt"
      // instead of under a server-side guarantee.
      if (!sellerFilterBacked) applied = applied.filter((key) => key !== 'sellerType');

      // Everything fetched goes back uncut. `wanted` decided how deep to page;
      // it is not a licence to throw away rows the kernel has not filtered or
      // sorted yet — that is how "the five cheapest" became "the five newest,
      // reordered" and a filtered-away page became the word `empty`.
      return {
        provider: PROVIDER,
        listings,
        applied,
        truncated: more || (totalEstimate !== null && totalEstimate > listings.length),
        totalEstimate,
        requests,
        warnings,
      };
    },
  };
}
