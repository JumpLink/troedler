/**
 * justiz-auktion.de — the auction portal of the German and Austrian judiciary.
 *
 * Bailiff seizures, criminal-court confiscations, lost property and surplus
 * office equipment, run by the NRW Ministry of Justice for the federation and
 * the states. robots.txt is as open as it gets (`User-agent: * / Disallow:`
 * plus two sitemaps, measured 2026-08-21) and there is no bot wall.
 *
 * **And yet this provider does not search.** Measured, not assumed:
 *
 *   - The quick form and the advanced form both `POST`, the advanced one as
 *     `multipart/form-data` with a hidden `_CSRF` token taken off the form page.
 *   - `GET /suche?txt_search=fahrrad` answers HTTP 200 with **all 394 lots**,
 *     ignoring the term — as does `auction_search.php?keywords=…`. The site even
 *     advertises that GET as a schema.org `SearchAction`; it does not filter.
 *   - The criteria live in the PHP session, not the URL: after a successful
 *     POST the pagination links are bare `auction_search.php?start=10`. A
 *     cookie-jar POST with the token returned 29 hits for "fahrrad" — proof
 *     that the only working search is a session.
 *
 * A session plus a replayed CSRF token is exactly the thing troedler will not
 * build, and `HttpClient` has no way out of this process other than `get()`.
 * The alternatives are both worse than refusing: walking all 40 result pages
 * per query is a full-database copy at forty requests a go, and matching the
 * sitemap's slugs locally would quietly under-report — the slugs drop umlauts
 * ("Rücklicht" is spelled `Rcklicht`) and carry no description, while the
 * site's own search reads both. Six of those 29 hits had "Fahrrad" in the
 * title.
 *
 * So `search()` refuses out loud and `getListing()` — one GET, no session,
 * robots-permitted — does the part that works.
 */

import {
  ProviderError,
  conditionFromGerman,
  listingKey,
  type Listing,
  type MarketProvider,
  type ProviderCapabilities,
  type ProviderResult,
  type ProviderStatus,
} from '@troedler/core';
import { parseJustizDetailPage } from './parse.ts';
import {
  absolutize,
  cleanDescription,
  endsAtFrom,
  parseBidAmount,
  parseBidCount,
  splitGermanLocation,
  type AuktionDeps,
} from './shared.ts';
import type { JustizDetailRaw } from './types.ts';

const PROVIDER = 'justiz-auktion' as const;
const HOST = 'www.justiz-auktion.de';

/**
 * Detail URLs are `<anything>-<id>`; only the trailing number is routed.
 *
 * Measured 2026-08-21: `/x-211751` and `/auktion-211751` both return the same
 * lot, and an unknown id answers HTTP 404. That is what makes a listing
 * reachable from an id alone, with no slug to remember and no index to walk.
 *
 * The page's own `<link rel="canonical">` is NOT used to build it: on the lot
 * measured, id 211751, the canonical pointed at a different auction (211622).
 */
function detailUrl(id: string): string {
  return `https://${HOST}/auktion-${encodeURIComponent(id)}`;
}

const SEARCH_REFUSAL =
  'Justiz-Auktion lässt sich nicht durchsuchen, ohne eine PHP-Sitzung samt CSRF-Token nachzubauen: ' +
  'die Suche läuft nur als POST, die Suchbegriffe stehen in der Sitzung statt in der URL, und ' +
  '„?txt_search=…" liefert unverändert den gesamten Katalog. troedler baut keine Sitzungen auf. ' +
  'Einzelne Auktionen sind abrufbar — `troedler show justiz-auktion:<Auktions-ID>`.';

function toListing(raw: JustizDetailRaw, url: string, now: Date, fetchedAt: string): Listing {
  const current = parseBidAmount(raw.currentBidText);
  const start = parseBidAmount(raw.startBidText);
  // Before the first bid the site prints "Aktuelles Gebot: 0,00 €" — a
  // placeholder, not a price. Passing that on would put the lot at the top of
  // a price-ascending search looking like a giveaway.
  const price = current && current.minor > 0 ? current : (start ?? current);

  const shipping = raw.shippingText ?? '';
  return {
    key: listingKey(PROVIDER, raw.id),
    provider: PROVIDER,
    id: raw.id,
    title: raw.title,
    description: cleanDescription(raw.description),
    url,
    price,
    priceKind: 'auction',
    shippingCost: null,
    totalPrice: null,
    // The only source in this package that states a condition outright, in a
    // "Zustand:" line of its own.
    condition: conditionFromGerman(raw.conditionText),
    conditionRaw: raw.conditionText,
    // A court, a bailiff's office or a public prosecutor — a body, never a person.
    sellerType: 'commercial',
    // The field is single-valued here, unlike Zoll-Auktion's badge: it says
    // either "Selbstabholung" or "Versand" and says nothing about the other,
    // so neither is widened to "both".
    delivery: /abholung/i.test(shipping) ? 'pickup' : /versand/i.test(shipping) ? 'shipping' : 'unknown',
    location: splitGermanLocation(raw.locationText, raw.countryText),
    // Never printed on the page — and Austria and Germany share the portal, so
    // there is no local convention to fall back on either.
    listedAt: null,
    listedAtPrecision: null,
    endsAt: endsAtFrom(raw.remainingText, now),
    bidCount: parseBidCount(raw.bidsText),
    images: raw.imagePaths.map((p) => absolutize(HOST, p)).filter((u): u is string => u !== null),
    gtin: null,
    fetchedAt,
  };
}

const CAPABILITIES: ProviderCapabilities = {
  id: PROVIDER,
  label: 'Justiz-Auktion',
  host: HOST,
  access: 'html',
  freshness: 'live',
  serverFilters: [],
  serverSorts: [],
  // Not a paging cap: this source answers no searches at all, and saying "50"
  // here would make `providers show` promise something that never arrives.
  maxResults: 0,
  cache: {
    ttlSeconds: 300,
    // § 9 der AGB („Urheberrecht und Verwendungsbeschränkung") behält die
    // Verwendung der Inhalte vor — also nichts auf die Platte, wie bei
    // Zoll-Auktion, wo derselbe Satz in § 8 Abs. 1 steht.
    memoryOnly: true,
  },
  // On, because the part that works — fetching one known auction — needs the
  // gate open, and nothing about the source forbids reading it. What is off is
  // the search, and that is said in `note` rather than hidden behind a switch.
  enabledByDefault: true,
  termsDoc: 'docs/quellen/justiz-auktion.de.md',
  disclaimer:
    'Justiz-Auktion: Der genannte Betrag ist das aktuelle Höchstgebot bzw. das Startgebot, kein Kaufpreis.',
  note: SEARCH_REFUSAL,
  noCoMingling: false,
};

export function createJustizAuktionProvider(deps: AuktionDeps): MarketProvider {
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
          problem: { kind: 'not-configured', message: 'Justiz-Auktion ist nicht aktiviert.' },
        };
      }
      // Configured, reachable, and permanently unable to do the one thing
      // `searchAll` asks of it. Reporting that here rather than from `search()`
      // is what turns it into a `skipped` row with a reason instead of a
      // failure — and keeps `getListing()` available all the same.
      return { configured: true, problem: { kind: 'blocked-by-policy', message: SEARCH_REFUSAL } };
    },

    async search(): Promise<ProviderResult> {
      // Unreachable through `searchAll`, which stops at `status()`. Kept because
      // a direct caller must hit the same wall, and because an empty list here
      // would be the exact lie this project exists to avoid.
      throw new ProviderError(PROVIDER, 'blocked-by-policy', SEARCH_REFUSAL);
    },

    async getListing(id: string, signal?: AbortSignal): Promise<Listing | null> {
      const url = detailUrl(id);
      let html: string;
      try {
        const res = await deps.http.get(url, { provider: PROVIDER, enabled: deps.enabled, signal });
        html = await res.text();
      } catch (err) {
        // A gone auction is an answer, not a failure — but `HttpClient` folds
        // every non-OK status into one `remote-error` whose only trace of the
        // code is its message. Reading it back is a workaround; the fix belongs
        // in `@troedler/http`, which should carry the status on the error.
        if (err instanceof ProviderError && err.kind === 'remote-error' && /HTTP 404\b/.test(err.message)) {
          return null;
        }
        throw err;
      }

      const raw = parseJustizDetailPage(html);
      // The site also answers some dead ids with HTTP 200 and an error page.
      if (!raw) return null;

      const at = now();
      return toListing(raw, url, at, at.toISOString());
    },
  };
}
