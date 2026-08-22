/**
 * zoll-auktion.de — the permanent public auction of the Generalzolldirektion.
 *
 * Seized, pledged, confiscated and lost-and-found goods, sold by federal,
 * state and municipal offices. No API, but nothing in the way either: measured
 * 2026-08-21 the host serves `User-agent: * / Allow: /` and a sitemap index,
 * runs plain Apache with no bot wall, and — the part that decides the design —
 * puts its entire search form on the query string. Price bounds, radius,
 * delivery mode and sort order are all `GET` parameters that robots.txt
 * permits, so this adapter pushes them down instead of making the kernel
 * finish the job on ten rows.
 *
 * The one thing it never does is bid. § 3 of the Versteigerungsbedingungen
 * makes bidding an act by a registered person, and troedler has no account,
 * no session and no way to send one.
 */

import {
  PAGE_DEPTH,
  ProviderError,
  RESULTS_PER_PROVIDER,
  clamp,
  listingKey,
  type FilterKey,
  type Listing,
  type MarketProvider,
  type ProviderCapabilities,
  type ProviderResult,
  type ProviderStatus,
  type SearchQuery,
  type SortKey,
} from '@troedler/core';
import { parseZollDetailPage, parseZollSearchPage } from './parse.ts';
import {
  absolutize,
  cleanDescription,
  endsAtFrom,
  parseBidAmount,
  parseBidCount,
  splitGermanLocation,
  type AuktionDeps,
} from './shared.ts';
import type { ZollCardRaw, ZollDetailRaw } from './types.ts';

const PROVIDER = 'zoll-auktion' as const;
const HOST = 'www.zoll-auktion.de';
const SEARCH_PATH = '/auktion/auktionsuebersicht.php';

/** Measured 2026-08-21: the result list is a fixed ten cards, with no page-size parameter. */
const ROWS_PER_PAGE = 10;

/**
 * The `n4` radius selector, in kilometres.
 *
 * A closed list of steps, not a free number — the form offers exactly these,
 * and sending anything else is asking the server a question it has no field
 * for.
 */
const RADIUS_STEPS: readonly { readonly km: number; readonly value: string }[] = [
  { km: 20, value: '1' },
  { km: 50, value: '2' },
  { km: 100, value: '3' },
  { km: 250, value: '4' },
  { km: 500, value: '5' },
];
/** Everything past the last step. The form spells it "> 500 km". */
const RADIUS_BEYOND = '6';

/** The `s` parameter, read off the sort `<select>` of a live result page. */
const SORT_VALUES: Partial<Record<SortKey, string>> = {
  'ending-soonest': '12',
  'price-asc': '11',
  'price-desc': '21',
  newest: '24',
};

export interface ZollSearchUrl {
  readonly url: string;
  /** Filters actually pushed down — never a filter that was merely approximated. */
  readonly applied: readonly FilterKey[];
  readonly warnings: readonly string[];
}

/**
 * Turn a query into one result-page URL.
 *
 * Exported because it is the half of this file with decisions in it and no I/O:
 * which wish the remote can grant, which one it can only approximate, and which
 * one it must be told about. The rule throughout is that a filter goes into
 * `applied` **only when the URL expresses it exactly**. An approximation that
 * claims to be exact is worse than none: the kernel then skips its own pass and
 * nobody ever learns that "max 12,50 €" was sent as "max 13 €".
 */
export function buildSearchUrl(query: SearchQuery, page: number): ZollSearchUrl {
  const params = new URLSearchParams();
  params.set('n0', 'search');
  if (query.text.trim()) params.set('n2', query.text.trim());

  const applied: FilterKey[] = [];
  const warnings: string[] = [];

  if (query.minPriceMinor !== undefined) {
    // Rounded outward, always: a floor rounded up or a ceiling rounded down
    // would drop rows the user wanted, and a dropped row is invisible.
    params.set('n8', String(Math.floor(query.minPriceMinor / 100)));
    if (query.minPriceMinor % 100 === 0) applied.push('minPrice');
  }
  if (query.maxPriceMinor !== undefined) {
    params.set('n7', String(Math.ceil(query.maxPriceMinor / 100)));
    if (query.maxPriceMinor % 100 === 0) applied.push('maxPrice');
  }

  if (query.postalCode && query.radiusKm !== undefined) {
    const step = RADIUS_STEPS.find((s) => s.km >= (query.radiusKm ?? 0));
    params.set('n6', query.postalCode);
    params.set('n4', step?.value ?? RADIUS_BEYOND);
    if (step && step.km === query.radiusKm) {
      applied.push('radius');
    } else {
      warnings.push(
        `Zoll-Auktion kennt nur die Umkreisstufen 20/50/100/250/500 km — ${query.radiusKm} km wurde auf ${
          step ? `${step.km} km` : 'über 500 km'
        } aufgerundet. Der Rest lässt sich nicht nachfiltern, weil troedler bewusst keinen Geocoder mitbringt.`,
      );
    }
  }

  if (query.delivery === 'pickup') {
    params.set('n5[]', 'a');
    applied.push('delivery');
  } else if (query.delivery === 'shipping') {
    // "Versand nach Deutschland". The form also offers EU and Europe as
    // separate boxes; for a German buyer the narrower one is the question.
    params.set('n5[]', '1');
    applied.push('delivery');
  }

  const sort = SORT_VALUES[query.sort ?? 'relevance'];
  if (sort) {
    params.set('s', sort);
    applied.push('sort');
  }

  if (page > 1) params.set('pagination', String(page));
  return { url: `https://${HOST}${SEARCH_PATH}?${params.toString()}`, applied, warnings };
}

/**
 * Any image variant, rewritten to the largest one.
 *
 * Image paths are `/auktion/bilder/<slug>/<variant>_<id>_<hash>/<datei>.jpg`,
 * and the variant prefix is the only thing that differs between sizes.
 * Measured 2026-08-21 on `971850_Vorn.jpg`, all HTTP 200: `t_…` 17 267 B (the
 * result card's thumbnail), the bare `<id>_<hash>` the detail page's carousel
 * links 179 757 B, `galerie_…` 76 616 B, and `galerie_large_…` 190 757 B — the
 * biggest of the four. So this is a rewrite between verified variants rather
 * than a guessed URL, and it gives the search page and the detail page one
 * shape for the same photo, which is what makes them comparable at all.
 *
 * The smaller variants are deliberately NOT kept alongside: `images` is a list
 * of photos, and padding it with three sizes of one photo would make
 * `images.length` mean something different per provider.
 */
function largestImage(path: string | null | undefined): string | null {
  const url = absolutize(HOST, path);
  if (!url) return null;
  return url.replace(/\/(?:t_|galerie_large_|galerie_)?(\d+_[0-9a-f]+)\//, '/galerie_large_$1/');
}

function toListing(card: ZollCardRaw, now: Date, fetchedAt: string): Listing | null {
  const url = absolutize(HOST, card.path);
  if (!url) return null;

  return {
    key: listingKey(PROVIDER, card.id),
    provider: PROVIDER,
    id: card.id,
    title: card.title,
    // The result card carries no item text at all; only the detail page does.
    description: null,
    url,
    // The figure on the card is the live high bid, or the opening bid while
    // there is none. Either way it is what the lot costs right now, not what
    // it will cost — hence `auction`, never `fixed`.
    price: parseBidAmount(card.priceText),
    priceKind: 'auction',
    // Shipping is quoted by the offering office after the hammer falls
    // (§ 5 Abs. 1), so it is unknown here — and `null` must not be read as free.
    shippingCost: null,
    totalPrice: null,
    // Nothing on the card states a condition, and guessing one from a title is
    // how a bidder ends up bidding on scrap.
    condition: 'unknown',
    conditionRaw: null,
    // Never a person: § 1 Abs. 5 admits only public bodies as sellers.
    sellerType: 'commercial',
    // The badge is printed only for pickup-only lots. Its absence means the
    // office also ships, and § 5 Abs. 1 keeps collection possible in that case
    // too — so "both", not "shipping".
    delivery: /abholung/i.test(card.deliveryText ?? '') ? 'pickup' : 'both',
    // The search page never names a country; only the detail page's JSON-LD does.
    location: splitGermanLocation(card.locationText, null),
    listedAt: null,
    endsAt: endsAtFrom(card.remainingText, now),
    bidCount: parseBidCount(card.bidsText),
    images: [largestImage(card.thumbnailPath)].filter((u): u is string => u !== null),
    gtin: null,
    fetchedAt,
  };
}

/**
 * The detail URL only routes on the trailing id.
 *
 * Measured 2026-08-21: `/auktion/produkt/x/971850` returns the same lot as the
 * slugged path and answers with the correct `<link rel="canonical">`, while an
 * unknown id gives HTTP 404. So one id is enough to fetch a lot, and the page
 * itself supplies the pretty URL to hand back.
 */
function detailUrl(id: string): string {
  return `https://${HOST}/auktion/produkt/x/${encodeURIComponent(id)}`;
}

function detailToListing(raw: ZollDetailRaw, fallbackUrl: string, now: Date, fetchedAt: string): Listing {
  const pickup = /ja/i.test(raw.pickupText ?? '');
  const ships = /ja/i.test(raw.shippingText ?? '');

  return {
    key: listingKey(PROVIDER, raw.id),
    provider: PROVIDER,
    id: raw.id,
    title: raw.title,
    description: cleanDescription(raw.description),
    url: absolutize(HOST, raw.path) ?? fallbackUrl,
    price: parseBidAmount(raw.priceText),
    priceKind: 'auction',
    shippingCost: null,
    totalPrice: null,
    condition: 'unknown',
    conditionRaw: null,
    sellerType: 'commercial',
    // Here the page states both facts separately, so unlike the result card
    // there is nothing to infer.
    delivery: pickup && ships ? 'both' : ships ? 'shipping' : pickup ? 'pickup' : 'unknown',
    location: splitGermanLocation(raw.locationText, raw.country),
    // `availabilityStarts` out of the JSON-LD, which carries a real UTC offset.
    listedAt: raw.startsAtIso ? new Date(raw.startsAtIso).toISOString() : null,
    endsAt: endsAtFrom(raw.remainingText, now),
    bidCount: parseBidCount(raw.bidsText),
    images: raw.imagePaths.map(largestImage).filter((u): u is string => u !== null),
    gtin: null,
    fetchedAt,
  };
}

const CAPABILITIES: ProviderCapabilities = {
  id: PROVIDER,
  label: 'Zoll-Auktion',
  host: HOST,
  access: 'html',
  freshness: 'live',
  serverFilters: ['minPrice', 'maxPrice', 'radius', 'delivery', 'sort'],
  // No `relevance`: the form has no such order. Left unsorted the site returns
  // "Auktionsende aufsteigend", which is a different thing, and claiming
  // relevance here would put that claim into `--explain`.
  serverSorts: ['price-asc', 'price-desc', 'newest', 'ending-soonest'],
  maxResults: ROWS_PER_PAGE * PAGE_DEPTH.max,
  cache: {
    // Five minutes, for two independent reasons that happen to agree. The live
    // one: a high bid can change any minute, and a stale bid shown as current
    // is a number someone would act on. The legal one: § 8 Abs. 1 of the
    // Versteigerungsbedingungen reserves the use of the site's contents, so
    // nothing is written to disk.
    ttlSeconds: 300,
    memoryOnly: true,
  },
  enabledByDefault: true,
  termsDoc: 'docs/quellen/zoll-auktion.de.md',
  disclaimer:
    'Zoll-Auktion: Der genannte Betrag ist das aktuelle Höchstgebot, kein Kaufpreis. Das angezeigte Ende kann sich verschieben — der Zuschlag fällt erst, wenn ein Gebot fünf Minuten Bestand hat (§ 3 Abs. 1 der Versteigerungsbedingungen).',
  note: 'Offen abrufbar: robots.txt sagt „User-agent: * / Allow: /" (geprüft 2026-08-21), und die Versteigerungsbedingungen untersagen automatisiertes Lesen nicht. Untersagt ist automatisiertes Bieten — troedler bietet nie, meldet sich nie an und speichert Treffer nur im Arbeitsspeicher.',
  noCoMingling: false,
};

export function createZollAuktionProvider(deps: AuktionDeps): MarketProvider {
  const now = deps.now ?? (() => new Date());

  return {
    capabilities: CAPABILITIES,

    /**
     * Requests spent against this host in this process.
     *
     * Read from the socket layer, not from a counter this adapter maintains —
     * a `catch` path that forgets to book its requests is exactly how a failed
     * search reported "0 Anfragen, 1189 ms".
     */
    requestsUsed: () => deps.http.requestsUsed(HOST),

    async status(): Promise<ProviderStatus> {
      if (!deps.enabled) {
        return {
          configured: false,
          problem: {
            kind: 'not-configured',
            message: 'Zoll-Auktion ist nicht aktiviert. Es sind keine Zugangsdaten nötig, nur der Schalter.',
          },
        };
      }
      // No probe request: `status()` runs before every search, and spending a
      // round trip to learn what the search itself is about to find out would
      // double the load on a source that owes us nothing.
      return { configured: true, problem: null };
    },

    async search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult> {
      const wanted = clamp(query.limit, RESULTS_PER_PROVIDER);
      const maxPages = Math.min(Math.ceil(wanted / ROWS_PER_PAGE), PAGE_DEPTH.max);

      const listings: Listing[] = [];
      const warnings: string[] = [];
      let applied: readonly FilterKey[] = [];
      let totalEstimate: number | null = null;
      let requests = 0;
      let more = false;

      for (let page = 1; page <= maxPages; page += 1) {
        const built = buildSearchUrl(query, page);
        applied = built.applied;
        if (page === 1) warnings.push(...built.warnings);

        const res = await deps.http.get(built.url, { provider: PROVIDER, enabled: deps.enabled, signal });
        requests += 1;

        const page1 = parseZollSearchPage(await res.text(), PROVIDER);
        if (page === 1) totalEstimate = page1.totalEstimate;

        const at = now();
        const fetchedAt = at.toISOString();
        for (const card of page1.cards) {
          const listing = toListing(card, at, fetchedAt);
          if (listing) listings.push(listing);
        }

        more = page1.hasNextPage;
        if (!more || listings.length >= wanted) break;
      }

      // Everything fetched goes back uncut. `wanted` decided how deep to page;
      // it is not a licence to throw away rows the kernel has not filtered or
      // sorted yet — that is how "the five cheapest" became "the five newest,
      // reordered" and a filtered-away page became the word `empty`.
      return {
        provider: PROVIDER,
        listings,
        applied,
        // True whenever the SOURCE had rows it did not hand over — the paging
        // budget ran out, or its own count exceeds what we fetched. The cut to
        // `--limit` is the kernel's and is reported separately.
        truncated: more || (totalEstimate !== null && totalEstimate > listings.length),
        totalEstimate,
        requests,
        warnings,
      };
    },

    async getListing(id: string, signal?: AbortSignal): Promise<Listing | null> {
      const url = detailUrl(id);
      let html: string;
      try {
        const res = await deps.http.get(url, { provider: PROVIDER, enabled: deps.enabled, signal });
        html = await res.text();
      } catch (err) {
        // A finished or withdrawn lot is an answer, not a failure. `HttpClient`
        // folds every non-OK status into one `remote-error` and keeps the code
        // only in the message, so it is read back from there; the durable fix
        // is a status field on `ProviderError` in `@troedler/http`.
        if (err instanceof ProviderError && err.kind === 'remote-error' && /HTTP 404\b/.test(err.message)) {
          return null;
        }
        throw err;
      }

      const raw = parseZollDetailPage(html);
      if (!raw) return null;

      const at = now();
      return detailToListing(raw, url, at, at.toISOString());
    },
  };
}
