/**
 * HTML in, `Listing[]` out — and not one byte of I/O.
 *
 * That purity is why the tests for the interesting part of this adapter run
 * without a network, without GJS, and without ever touching kleinanzeigen.de.
 * It is also where the project's most expensive failure class is fenced off:
 *
 * **An empty result and a moved selector look identical from outside.** The
 * reference implementation in this space ships a changelog entry about exactly
 * that — "silent empty results on pages 2+" — and a scraper that reports
 * success with nothing in it is worse than one that crashes, because nobody
 * goes looking. So a page that yielded no rows must PROVE it meant to: the
 * site prints „Es wurden keine Ergebnisse …" when a query genuinely matched
 * nothing, and without that sentence an empty parse is a `parse-failed`.
 */

import {
  DESCRIPTION_CHARS,
  ProviderError,
  conditionFromGerman,
  listingKey,
  parseGermanDate,
  parseGermanPrice,
  stripContactDetails,
  type Condition,
  type Delivery,
  type Listing,
  type Location,
  type SellerType,
} from '@troedler/core';
import {
  attr,
  parseHtml,
  query,
  queryAll,
  text,
  textOf,
  type HtmlElement,
  type HtmlNode,
} from '@troedler/html';

import { absolute, listingIdFrom } from './url.ts';
import { NO_RESULTS_MARKER, SRP, VIP } from './types.ts';

const PROVIDER = 'kleinanzeigen' as const;
const INVISIBLE = /[\u200B-\u200D\uFEFF\u00AD]/g;

export interface ParseOptions {
  /**
   * Now, injected. „Heute, 18:20" is only a timestamp relative to something,
   * and a test that cannot pin that something passes at 23:59 and fails at
   * 00:01.
   */
  readonly now: Date;
}

export interface ListingParseOptions extends ParseOptions {
  /**
   * The URL the response actually came from, after redirects.
   *
   * Load-bearing, not diagnostic. Measured: a deleted or unknown ad is NOT a
   * 404 and carries no marker — `/s-anzeige/1` answers `HTTP 200` with 334 934
   * bytes of the site's own front page. Without the final URL there is nothing
   * in that body to tell "this ad is gone" from "the ad markup was
   * redesigned", and those two owe the caller opposite answers: `null` and a
   * `parse-failed`.
   */
  readonly finalUrl?: string;
}

export interface SearchPage {
  readonly listings: readonly Listing[];
  /** The site's own match count. An estimate it rounds; shown, never computed with. */
  readonly totalEstimate: number | null;
  /** `link[rel="next"]`, relative, or `null` on the last page the site offers. */
  readonly nextPath: string | null;
  /** Ads on the page including top ads — what the discriminator counts. */
  readonly seen: number;
  /** Top ads dropped. They repeat on every page of a query; measured: 2 per page. */
  readonly topAds: number;
}

function fail(detail: string): never {
  throw new ProviderError(
    PROVIDER,
    'parse-failed',
    `Kleinanzeigen antwortete mit HTML, das dieser Adapter nicht mehr versteht: ${detail}. Vermutlich hat sich das Markup geändert — siehe docs/quellen/kleinanzeigen.de.md.`,
  );
}

function clean(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/**
 * `"22083 Hamburg Barmbek-\u200BSüd"` → postal code plus place.
 *
 * That escape is what the markup really contains: a zero-width space inside
 * the place name. It survives `.trim()` and turns any later comparison against
 * a place name into a silent miss, so it is stripped here rather than admired.
 */
export function parseLocation(raw: string): Location {
  const value = clean(raw);
  const match = value.match(/^(\d{4,5})\s+(.*)$/);
  if (match) return { postalCode: match[1], city: match[2] || null, country: 'DE', distanceKm: null };
  return { postalCode: null, city: value || null, country: 'DE', distanceKm: null };
}

/**
 * Shipping, from the one tag the result list prints.
 *
 * „Versand möglich" means the seller ALSO ships, not that collection is off —
 * so it maps to `both`, and its absence to `pickup`. Cross-checked against the
 * ad page of a row that carried no tag: its detail page says „Nur Abholung".
 * The same `span.simpletag` element also carries clothing sizes and „Direkt
 * kaufen", which is why this matches on the text and not on the selector.
 */
function deliveryFromTags(tags: readonly string[]): Delivery {
  return tags.some((t) => /versand/i.test(t)) ? 'both' : 'pickup';
}

/**
 * Private or commercial.
 *
 * The `PRO` badge marks commercial sellers and nothing marks private ones, so
 * absence is read as private rather than as unknown. That is not a guess about
 * a person: German law requires commercial sellers to be identifiable as such,
 * the operator implements that with this badge, and reading absence as
 * `unknown` would make the filter match everything and mean nothing. Measured:
 * 5 of 27 rows carried it.
 */
function sellerTypeFrom(hasBadge: boolean): SellerType {
  return hasBadge ? 'commercial' : 'private';
}

/** `"1 - 25 von 921.982 Ergebnissen für „fahrrad“ in Deutschland"` → 921982. */
export function parseTotal(summary: string): number | null {
  const match = clean(summary).match(/von\s+([\d.]+)\s+Ergebnis/i);
  if (!match) return null;
  const n = Number.parseInt(match[1].replaceAll('.', ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * The image the row publishes, largest first.
 *
 * Each row carries a schema.org `ImageObject` whose `contentUrl` is the large
 * variant (`?rule=$_59.AUTO`); the visible `<img>` is the thumbnail
 * (`$_2.AUTO`). Both are read off the page rather than derived by rewriting
 * the `rule` parameter — a URL we constructed is a URL nobody promised us.
 * Measured: 27 of 27 rows carried a parsable `ImageObject`.
 */
function imagesFrom(ad: HtmlElement): string[] {
  const urls: string[] = [];
  for (const script of queryAll(ad, 'script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(text(script)) as { '@type'?: string; contentUrl?: string };
      if (parsed['@type'] === 'ImageObject' && typeof parsed.contentUrl === 'string')
        urls.push(parsed.contentUrl);
    } catch {
      // A row whose JSON-LD does not parse still has a thumbnail below. One
      // malformed block is not a reason to drop the whole listing.
    }
  }
  const thumb = attr(query(ad, SRP.image), 'src');
  if (thumb && !urls.includes(thumb)) urls.push(thumb);
  return urls;
}

/** The longer of the two texts the row offers, stripped of contact details and capped. */
function descriptionFrom(ad: HtmlElement): string | null {
  let best = textOf(ad, SRP.description);
  for (const script of queryAll(ad, 'script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(text(script)) as { description?: string };
      if (typeof parsed.description === 'string' && parsed.description.length > best.length) {
        best = parsed.description;
      }
    } catch {
      // See imagesFrom: a broken block costs the longer text, not the row.
    }
  }
  const stripped = stripContactDetails(best.replace(INVISIBLE, '').trim());
  if (!stripped) return null;
  // Capped with the kernel's own limit rather than a number chosen here: the
  // teaser is enough to judge an offer, and § 5 of the operator's terms
  // forbids reproducing their content beyond ordinary use.
  return stripped.length > DESCRIPTION_CHARS.default
    ? `${stripped.slice(0, DESCRIPTION_CHARS.default)}…`
    : stripped;
}

function rowToListing(ad: HtmlElement, options: ParseOptions, fetchedAt: string): Listing | null {
  const id = attr(ad, 'data-adid') ?? listingIdFrom(attr(ad, 'data-href'));
  const link = query(ad, SRP.title);
  const href = attr(ad, 'data-href') ?? attr(link, 'href');
  const title = clean(text(link));
  // No id, no href or no title means the row is not an offer we can key, link
  // or name. Dropping it is right; inventing any of the three is not.
  if (!id || !href || !title) return null;

  const { price, kind } = parseGermanPrice(textOf(ad, SRP.price));
  const tags = queryAll(ad, SRP.tag).map((t) => clean(text(t)));
  const postedAt = parseGermanDate(textOf(ad, SRP.date), options.now);

  return {
    key: listingKey(PROVIDER, id),
    provider: PROVIDER,
    id,
    title,
    description: descriptionFrom(ad),
    url: absolute(href),
    price,
    priceKind: kind,
    // The result list never prints postage, and `null` here means exactly
    // that — not "free". `totalPrice` stays null for the same reason.
    shippingCost: null,
    totalPrice: null,
    // The result list carries NO condition field. Guessing one out of the
    // title („neu") would hand the kernel's condition filter something to act
    // on that the source never said. The ad page has a real one.
    condition: 'unknown',
    conditionRaw: null,
    sellerType: sellerTypeFrom(queryAll(ad, SRP.commercial).length > 0),
    delivery: deliveryFromTags(tags),
    location: parseLocation(textOf(ad, SRP.location)),
    listedAt: postedAt?.iso ?? null,
    listedAtPrecision: postedAt?.precision ?? null,
    endsAt: null,
    bidCount: null,
    images: imagesFrom(ad),
    gtin: null,
    fetchedAt,
  };
}

function isTopAd(li: HtmlElement): boolean {
  return (attr(li, 'class') ?? '').split(/\s+/).includes(SRP.topAdRow);
}

/**
 * One result page.
 *
 * Throws `parse-failed` in three distinguishable situations, all of which
 * would otherwise be reported to the user as "nothing found":
 *
 *  - no ads and no „keine Ergebnisse" sentence — we got some other page
 *    (an interstitial, a bot wall, a redesign);
 *  - ads present but the row container no longer matches, so iterating rows
 *    yields nothing;
 *  - rows present but none of them produced a usable listing.
 */
export function parseSearchPage(html: string, options: ParseOptions): SearchPage {
  const doc = parseHtml(html);
  const fetchedAt = options.now.toISOString();

  const rows = queryAll(doc, SRP.item);
  const ads = queryAll(doc, SRP.ad);
  const summary = textOf(doc, SRP.summary);

  if (ads.length === 0) {
    if (summary.includes(NO_RESULTS_MARKER)) {
      return { listings: [], totalEstimate: 0, nextPath: null, seen: 0, topAds: 0 };
    }
    fail(
      `keine Anzeige über "${SRP.ad}" gefunden und auch nicht die Meldung "${NO_RESULTS_MARKER}"` +
        (query(doc, SRP.list) ? ` — die Trefferliste "${SRP.list}" ist aber da` : ''),
    );
  }
  if (rows.length === 0) {
    fail(`${ads.length} Anzeigen gefunden, aber keine einzige Zeile über "${SRP.item}"`);
  }

  const listings: Listing[] = [];
  let topAds = 0;
  for (const li of rows) {
    const ad = query(li, SRP.ad);
    if (!ad) continue;
    // Top ads are paid placements repeated on EVERY page of a query. Left in,
    // the same bicycle shows up on page 1, 2 and 3 and the user counts three
    // bicycles.
    if (isTopAd(li)) {
      topAds += 1;
      continue;
    }
    const listing = rowToListing(ad, options, fetchedAt);
    if (listing) listings.push(listing);
  }

  if (listings.length === 0 && topAds < ads.length) {
    fail(`${ads.length} Anzeigen gefunden, aber keine mit ID, Link und Titel`);
  }

  const next = attr(query(doc, SRP.next), 'href');
  return {
    listings,
    totalEstimate: parseTotal(summary),
    nextPath: next ?? null,
    seen: ads.length,
    topAds,
  };
}

/** Path of a URL, tolerant of a value that is not one. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
}

/** `"Anzeigen-ID 3490401536"` → `"3490401536"`. */
function idFromBox(raw: string): string | null {
  const match = clean(raw).match(/(\d{5,})/);
  return match ? match[1] : null;
}

/** The ad page's attribute list: `Art/Herren`, `Typ/Rennräder`, `Zustand/Sehr Gut`. */
export function parseDetails(scope: HtmlNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const li of queryAll(scope, VIP.detail)) {
    const value = textOf(li, VIP.detailValue);
    const whole = text(li);
    // The key is the li's own text with the value node's text taken off the
    // end — there is no element around it to select.
    const key = clean(whole.slice(0, Math.max(0, whole.length - value.length)));
    if (key) out.set(key, clean(value));
  }
  return out;
}

/**
 * One ad page.
 *
 * Returns `null` for an ad that is gone — that is an answer, not a failure —
 * and throws `parse-failed` when the page is an ad page whose title selector
 * stopped matching. Telling those apart needs `finalUrl`, because the site
 * signals "gone" with a redirect and a 200 rather than with a 404 or a marker.
 *
 * The seller's name, profile and shop link are all on this page and none of
 * them is read: only `.userprofile-vip-details`, and only to decide
 * private-versus-commercial, which is a category rather than a person.
 */
export function parseListingPage(html: string, id: string, options: ListingParseOptions): Listing | null {
  const doc = parseHtml(html);
  const title = clean(textOf(doc, VIP.title));

  if (!title) {
    if (query(doc, VIP.expired)) return null;
    // Redirected off the ad path — measured behaviour for an id that no longer
    // exists. That is an answer, not a failure.
    if (options.finalUrl && !pathOf(options.finalUrl).startsWith('/s-anzeige/')) return null;
    fail(
      `die Anzeigenseite hat keinen Titel unter "${VIP.title}" und wurde auch nicht auf die Startseite umgeleitet`,
    );
  }

  const details = parseDetails(doc);
  const postedAt = parseGermanDate(textOf(doc, VIP.postedAt), options.now);
  const conditionRaw = details.get('Zustand') ?? null;
  const condition: Condition = conditionRaw ? conditionFromGerman(conditionRaw) : 'unknown';

  const { price, kind } = parseGermanPrice(textOf(doc, VIP.price));
  const shippingText = textOf(doc, VIP.shipping);
  const delivery: Delivery = /versand/i.test(shippingText)
    ? 'both'
    : /abholung/i.test(shippingText)
      ? 'pickup'
      : 'unknown';

  const kinds = queryAll(doc, VIP.sellerKind).map((n) => clean(text(n)));
  const sellerType: SellerType = kinds.some((k) => /gewerblich/i.test(k))
    ? 'commercial'
    : kinds.some((k) => /privat/i.test(k))
      ? 'private'
      : 'unknown';

  const description = stripContactDetails(clean(textOf(doc, VIP.description)));
  const images = queryAll(doc, VIP.image)
    .map((img) => attr(img, 'src'))
    .filter((src): src is string => typeof src === 'string' && src.length > 0);

  return {
    key: listingKey(PROVIDER, id),
    provider: PROVIDER,
    id: idFromBox(textOf(doc, VIP.idBox)) ?? id,
    title,
    description: description || null,
    url: absolute(`/s-anzeige/${id}`),
    price,
    priceKind: kind,
    // „Versand möglich" says postage exists, never how much. `0` here would
    // claim free shipping.
    shippingCost: null,
    totalPrice: null,
    condition,
    conditionRaw,
    sellerType,
    delivery,
    location: parseLocation(textOf(doc, VIP.locality)),
    listedAt: postedAt?.iso ?? null,
    listedAtPrecision: postedAt?.precision ?? null,
    endsAt: null,
    bidCount: null,
    images: [...new Set(images)],
    gtin: null,
    fetchedAt: options.now.toISOString(),
  };
}
