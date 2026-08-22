/**
 * HTML → `Listing[]`, with no I/O anywhere in the file.
 *
 * That is not tidiness. It is the only reason the tests for these two adapters
 * run without a network: every judgement that can be wrong — which nodes are
 * results and which are recommendations, what "2 099 EUR" is worth, whether a
 * page with zero rows is empty or broken — happens in here, against a string.
 *
 * Both portals share one hazard and it decides the shape of both parsers:
 * **a query that matches nothing still answers HTTP 200 with a full page of
 * ads.** markt.de puts twenty unrelated ones under a "Leider wurden keine
 * Anzeigen gefunden" heading; Quoka puts six under "wurden keine Ergebnisse
 * gefunden", inside the very same `.article-list` the real hits use. A parser
 * that just collects rows returns those as results, and the result looks
 * exactly like a successful search. So neither parser trusts the row selector
 * alone: the source's OWN hit count decides whether zero rows is an answer or a
 * defect.
 */

import { listingKey, stripContactDetails, type Listing, type SellerType } from '@troedler/core';
import { attr, parseHtml, query, queryAll, text, textOf, type HtmlElement } from '@troedler/html';

import {
  MARKT_NO_RESULTS,
  MARKT_SRP,
  QUOKA_NO_RESULTS,
  QUOKA_SRP,
  type MarktRawAd,
  type QuokaRawAd,
} from './types.ts';
import {
  canonicalUrl,
  cleanDescription,
  largestImage,
  parseDistanceKm,
  parseFailed,
  parseGermanCount,
  parseMarktDate,
  parseMarktPrice,
  parseQuokaDate,
  parseQuokaPrice,
  splitPostalPlace,
} from './shared.ts';

export interface ParseOptions {
  /** Pinned by the caller — "heute" is meaningless without it. */
  readonly now: Date;
}

export interface SearchPage {
  readonly listings: readonly Listing[];
  /** Rows the row selector matched, before any were dropped. */
  readonly seen: number;
  /** The source's own count. `null` when it printed none — a warning, not a failure. */
  readonly totalEstimate: number | null;
  /** Absolute URL of the next page, as the page itself links it. */
  readonly nextUrl: string | null;
  readonly warnings: readonly string[];
}

export interface MarktSearchPage extends SearchPage {
  /** Rows marked "Partner-Anzeige" — affiliate inventory, kept but flagged commercial. */
  readonly partnerAds: number;
}

export interface QuokaSearchPage extends SearchPage {
  /**
   * Whether the page itself backed the seller-type filter we asked it for.
   *
   * The adapter reads it to decide whether `sellerType` may stay in `applied` —
   * an unconfirmed filter must not be reported as pushed down, or `--explain`
   * would claim a server-side guarantee nobody gave.
   */
  readonly sellerFilter: QuokaSellerFilterCheck;
}

// ---------------------------------------------------------------------------
// markt.de
// ---------------------------------------------------------------------------

const MARKT_ORIGIN = 'https://www.markt.de/';

/**
 * Private or commercial, from the profile picture and nothing else.
 *
 * markt.de states the answer plainly on the ad page ("Anzeigentyp:
 * Gewerbliches Angebot" / "Privatangebot") but prints no badge in the result
 * list. What it does print is the seller's avatar, and its source URL carries
 * the account kind: `default_private.svg` / `default_business.svg` for accounts
 * without a picture, `images_profile/` / `images_business/` for accounts with
 * one. Cross-checked against the ad page for one of each on 2026-08-21: the
 * `images_business` row reads "Gewerbliches Angebot", the `default_private` row
 * "Privatangebot".
 *
 * The URL is read and dropped. It never enters the `Listing`, because an avatar
 * URL identifies a person as surely as a name does — measured: 8 of 20 rows on
 * one page carried a personal photograph.
 *
 * `null` when the row shows no avatar at all (12 of 20 rows on another page),
 * which becomes `sellerType: 'unknown'` rather than a guess.
 */
function sellerIsCommercial(row: HtmlElement): boolean | null {
  const src = attr(query(row, MARKT_SRP.sellerImage), 'src');
  if (!src) return null;
  if (/default_business\.svg|\/images_business\//.test(src)) return true;
  if (/default_private\.svg|\/images_profile\//.test(src)) return false;
  return null;
}

/**
 * One row of the markt.de result list.
 *
 * The title comes from the `li`'s own `title` attribute rather than the link
 * text, for two measured reasons: the link text is truncated in the markup
 * itself (class `clsy-truncate-multi`), and on a Partner-Anzeige there is no
 * link at all — its title is a `<button>` that posts an encrypted target
 * through `/urlMaskingRedirect.htm`. The `li` carries the full title and the
 * unmasked path (`data-onclick-url`) in both cases.
 */
function parseMarktRow(row: HtmlElement): MarktRawAd | null {
  const domId = attr(row, 'id') ?? '';
  const id = domId.startsWith('markt_result_') ? domId.slice('markt_result_'.length) : '';
  if (!id) return null;

  const href = attr(query(row, MARKT_SRP.link), 'href') ?? attr(row, 'data-onclick-url');
  const url = canonicalUrl(MARKT_ORIGIN, href);
  if (!url) return null;

  const title = (attr(row, 'title') ?? textOf(row, MARKT_SRP.link)).trim();
  if (!title) return null;

  const image = query(row, MARKT_SRP.image);
  const largest = largestImage(attr(image, 'src'), attr(image, 'srcset'));

  const distanceText = textOf(row, MARKT_SRP.locationDistance);
  const locationFull = text(query(row, MARKT_SRP.location));
  // The distance is a `<span>` INSIDE the location node, so the collapsed text
  // reads "30966 Hemmingen (Niedersachsen)12 km" with no separator at all.
  const locationText =
    distanceText && locationFull.endsWith(distanceText)
      ? locationFull.slice(0, locationFull.length - distanceText.length).trim()
      : locationFull;

  return {
    id,
    url,
    title,
    description: textOf(row, MARKT_SRP.description),
    priceAmountText: textOf(row, MARKT_SRP.priceAmount),
    priceLabelText: textOf(row, MARKT_SRP.priceLabel),
    locationText,
    distanceText,
    dateText: textOf(row, MARKT_SRP.date),
    imageUrls: largest ? [largest] : [],
    partnerAd: query(row, MARKT_SRP.partner) !== null,
    commercial: sellerIsCommercial(row),
  };
}

function marktSellerType(ad: MarktRawAd): SellerType {
  // A Partner-Anzeige is affiliate inventory by definition, so it is commercial
  // whatever the avatar says.
  if (ad.partnerAd) return 'commercial';
  if (ad.commercial === null) return 'unknown';
  return ad.commercial ? 'commercial' : 'private';
}

function marktAdToListing(ad: MarktRawAd, now: Date, fetchedAt: string): Listing {
  const price = parseMarktPrice(ad.priceAmountText, ad.priceLabelText);
  const postedAt = parseMarktDate(ad.dateText, now);
  return {
    key: listingKey('markt-de', ad.id),
    provider: 'markt-de',
    id: ad.id,
    title: ad.title,
    description: cleanDescription(ad.description),
    url: ad.url,
    price: price.price,
    priceKind: price.kind,
    // Never printed on a result row, and `null` must not be read as "free".
    shippingCost: null,
    totalPrice: null,
    // The result list carries no condition field. Reading one out of the title
    // is how the kernel's condition filter starts acting on fiction — the ad
    // page has "Zustand: Neu", the list does not.
    condition: 'unknown',
    conditionRaw: null,
    sellerType: marktSellerType(ad),
    // Shipping versus collection is stated in the ad body, not in a field.
    delivery: 'unknown',
    location: splitPostalPlace(ad.locationText, parseDistanceKm(ad.distanceText)),
    listedAt: postedAt?.iso ?? null,
    listedAtPrecision: postedAt?.precision ?? null,
    endsAt: null,
    bidCount: null,
    images: ad.imageUrls,
    gtin: null,
    fetchedAt,
  };
}

export function parseMarktSearchPage(html: string, options: ParseOptions): MarktSearchPage {
  const doc = parseHtml(html);
  const warnings: string[] = [];

  // The submit button prints the exact figure on every page ("Suchen (9.933
  // Treffer)"); the headline caps out at "über 1.000 Treffer", so it is only
  // the fallback — and a lower bound whenever it is the one used.
  const headline = textOf(doc, MARKT_SRP.topCount);
  const exact = parseGermanCount(textOf(doc, MARKT_SRP.submitCount));
  const totalEstimate = exact ?? parseGermanCount(headline);

  const rows = queryAll(doc, MARKT_SRP.item);
  const declaredEmpty = totalEstimate === 0 || html.includes(MARKT_NO_RESULTS);

  if (totalEstimate === null && rows.length === 0 && !declaredEmpty) {
    throw parseFailed(
      'markt-de',
      'Weder die Trefferzahl noch eine einzige Anzeige war auf der Seite von markt.de zu finden.',
    );
  }
  if (declaredEmpty) {
    // markt.de answers a zero-hit query with twenty recommendation ads. The
    // `>`-anchored row selector already excludes them; this branch is the
    // second lock, so a markup change cannot turn them into results.
    return { listings: [], seen: 0, totalEstimate: 0, nextUrl: null, warnings, partnerAds: 0 };
  }
  if (rows.length === 0) {
    throw parseFailed(
      'markt-de',
      `markt.de meldet ${totalEstimate ?? 'mehrere'} Treffer, aber keine einzige Zeile passte auf den Selektor.`,
    );
  }

  const fetchedAt = options.now.toISOString();
  const listings: Listing[] = [];
  let partnerAds = 0;
  for (const row of rows) {
    const ad = parseMarktRow(row);
    if (!ad) continue;
    if (ad.partnerAd) partnerAds += 1;
    listings.push(marktAdToListing(ad, options.now, fetchedAt));
  }
  if (listings.length === 0) {
    throw parseFailed(
      'markt-de',
      `${rows.length} Zeilen auf der Seite, aber in keiner stand Titel, ID und Link.`,
    );
  }

  if (totalEstimate === null) {
    warnings.push('markt.de: Die Trefferzahl stand nicht auf der Seite — die Zeilen selbst wurden gelesen.');
  } else if (exact === null) {
    warnings.push(`markt.de nennt nur „${headline}" — die Gesamtzahl ist eine Untergrenze.`);
  }

  return { listings, seen: rows.length, totalEstimate, nextUrl: marktNextUrl(doc), warnings, partnerAds };
}

/** The `rel="next"` href, absolute. Its query IS the page number, so it stays. */
function marktNextUrl(doc: ReturnType<typeof parseHtml>): string | null {
  const href = (attr(query(doc, MARKT_SRP.next), 'href') ?? '').trim();
  if (!href) return null;
  try {
    return new URL(href, MARKT_ORIGIN).toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quoka
// ---------------------------------------------------------------------------

const QUOKA_ORIGIN = 'https://www.quoka.de/';

export interface QuokaParseOptions extends ParseOptions {
  /**
   * What the request ASKED the source for.
   *
   * Quoka prints no seller badge on a result row, but it does offer a
   * server-side `commercial=` filter: under `commercial=false` every row on the
   * page is private by construction. Passing that down is reporting a fact
   * about the request, not guessing a fact about the ad — which is why it is a
   * parameter here rather than a heuristic below.
   *
   * It is only stamped on when the page CONFIRMS the filter ran — see
   * `checkQuokaSellerFilter`. A request is what we asked for; the strip is what
   * the operator did.
   */
  readonly sellerType: SellerType;
}

/** Which side of Quoka's seller strip an entry is. */
export type QuokaFacetKind = 'all' | 'private' | 'commercial';

export interface QuokaUserTypeFacet {
  /** `null` when the label is not one of the three this source has ever printed. */
  readonly kind: QuokaFacetKind | null;
  /** The operator's own word, quoted rather than translated. */
  readonly label: string;
  readonly count: number | null;
  readonly active: boolean;
}

/**
 * The verdict on "did the seller filter we asked for actually run".
 *
 * Three outcomes and not two: a strip that contradicts the request is a
 * different fact from a strip nobody could find, and only the first one is
 * evidence about the operator. Both cost the stamp — a claim we cannot back is
 * not a claim this project makes — but they are reported apart, because the
 * first means the parameter stopped working and the second means the markup
 * moved, and those get fixed in different places.
 */
export type QuokaSellerFilterCheck =
  | { readonly kind: 'confirmed'; readonly label: string }
  | { readonly kind: 'contradicted'; readonly detail: string }
  | { readonly kind: 'unverifiable'; readonly detail: string };

/** Quoka's own words for the three sides. Its labels, not ours. */
const QUOKA_FACET_LABEL: Readonly<Record<string, QuokaFacetKind>> = {
  alle: 'all',
  privat: 'private',
  gewerblich: 'commercial',
};

/** What a `SellerType` in the query means on this source's strip. */
function facetForSellerType(sellerType: SellerType): QuokaFacetKind {
  return sellerType === 'private' ? 'private' : sellerType === 'commercial' ? 'commercial' : 'all';
}

/**
 * The three entries of the seller-type strip, as the page renders them.
 *
 * The label is read by subtracting the count from the entry's text: the markup
 * is `Privat<br><span class="lf-count">1148</span>`, so `textContent` is
 * "Privat1148" and taking it whole would match nothing.
 */
export function parseQuokaUserTypeFacets(scope: HtmlElement): QuokaUserTypeFacet[] {
  const facets: QuokaUserTypeFacet[] = [];
  for (const entry of queryAll(scope, QUOKA_SRP.userTypeFilter)) {
    const countText = textOf(entry, QUOKA_SRP.userTypeCount);
    const whole = text(entry);
    const label = (countText && whole.endsWith(countText) ? whole.slice(0, -countText.length) : whole).trim();
    const count = /^\d+$/.test(countText) ? Number.parseInt(countText, 10) : null;
    facets.push({
      kind: QUOKA_FACET_LABEL[label.toLowerCase()] ?? null,
      label,
      count,
      active: (attr(entry, 'class') ?? '').split(/\s+/).includes(QUOKA_SRP.userTypeActive),
    });
  }
  return facets;
}

/**
 * The canary for the seller-type stamp — two independent locks, no extra request.
 *
 * The stamp says "every row here is private" on the strength of a URL parameter,
 * and the source record has said since 2026-08-21 that this "is only true while
 * the operator honours the parameter: were it ignored, resultscount would stay
 * at its unfiltered value and the stamp would be set anyway". That is the
 * project's own signature failure — green, and it checked nothing — sitting in a
 * field a user filters on.
 *
 * The strip settles it, and it settles it better than the count comparison that
 * record proposed, because it is a statement rather than an inference:
 *
 *  1. **The active entry must be the side we asked for.** If we sent
 *     `commercial=false` and Quoka marks "Alle" as active, the parameter did
 *     nothing and every row on the page is a mixture.
 *  2. **`resultscount` must equal the active entry's own count.** This catches
 *     the case the first lock cannot: a page that marks "Privat" active and then
 *     serves the unfiltered row set anyway.
 *
 * A missing or unrecognisable strip is `unverifiable`, not `confirmed`. The
 * whole point is that an unverified stamp reads exactly like a verified one.
 */
export function checkQuokaSellerFilter(
  facets: readonly QuokaUserTypeFacet[],
  sellerType: SellerType,
  totalEstimate: number | null,
): QuokaSellerFilterCheck {
  const wanted = facetForSellerType(sellerType);

  if (facets.length === 0) {
    return {
      kind: 'unverifiable',
      detail: 'die Anbietertyp-Auswahl war auf der Seite nicht zu finden',
    };
  }
  const active = facets.find((f) => f.active);
  if (!active) {
    return { kind: 'unverifiable', detail: 'keine der Anbietertyp-Auswahlen war als aktiv markiert' };
  }
  if (active.kind === null) {
    return {
      kind: 'unverifiable',
      detail: `die aktive Anbietertyp-Auswahl hieß „${active.label}" — das ist keine der drei bekannten`,
    };
  }
  if (active.kind !== wanted) {
    const asked = facets.find((f) => f.kind === wanted)?.label ?? wanted;
    return {
      kind: 'contradicted',
      detail: `angefragt war „${asked}", aktiv war aber „${active.label}"`,
    };
  }
  if (totalEstimate !== null && active.count !== null && totalEstimate !== active.count) {
    return {
      kind: 'contradicted',
      detail:
        `„${active.label}" war aktiv, aber resultscount (${totalEstimate}) und die Zahl an der ` +
        `Auswahl (${active.count}) widersprechen sich`,
    };
  }
  return { kind: 'confirmed', label: active.label };
}

/**
 * Quoka's own hit count, out of `var resultscount = 3521;`.
 *
 * It sits in an inline script rather than in the markup, which is unusual
 * enough to note and reliable enough to depend on: present on every page
 * fetched on 2026-08-21, including the zero-hit one, where it read `0` while
 * six recommendation ads sat in the result list underneath. That contrast is
 * exactly why this figure is the discriminator and the row count is not.
 */
export function parseQuokaResultCount(html: string): number | null {
  for (const script of queryAll(parseHtml(html), 'script')) {
    const body = text(script);
    if (!body.includes('resultscount')) continue;
    const m = body.match(/resultscount\s*=\s*(\d+)/);
    if (m) return Number.parseInt(m[1], 10);
  }
  return null;
}

/** The ad token out of `…/anzeige/<slug>/<token>.html`. */
export function quokaIdFromUrl(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/\/([0-9a-z]+)\.html(?:[?#]|$)/i);
  return m ? m[1] : null;
}

/**
 * `"73728 Esslingen, Baden-Württemberg"` → the part before the Bundesland.
 *
 * The state is dropped: `Location` has no field for it, and folding it into
 * `city` would make "Esslingen" fail a comparison against every other source's
 * spelling of the same place. Measured over 102 location strings from this
 * source: exactly zero or one comma, never two, and what follows it is always
 * the state.
 */
export function quokaPlace(raw: string): string {
  const comma = raw.lastIndexOf(',');
  return comma < 0 ? raw.trim() : raw.slice(0, comma).trim();
}

function parseQuokaRow(row: HtmlElement): QuokaRawAd | null {
  const link = query(row, QUOKA_SRP.title);
  const url = canonicalUrl(QUOKA_ORIGIN, attr(link, 'href'));
  if (!url) return null;

  // The row also carries `data-articleid` (a GUID) and `location` (the same
  // token as the URL). The URL token is the id, because it is the one that
  // names the ad page and therefore the one `key` must survive a re-search with.
  const id = quokaIdFromUrl(url) ?? attr(row, 'location');
  if (!id) return null;

  const title = text(link).trim();
  if (!title) return null;

  // A reduced price puts the current figure in `.new-price` and the
  // struck-through former one in `.old-price`, both inside `.article-price`.
  // Reading the container would concatenate them into "29.0 EUR30.0 EUR".
  const priceText = textOf(row, QUOKA_SRP.newPrice) || textOf(row, QUOKA_SRP.price);

  const image = attr(query(row, QUOKA_SRP.image), 'src');
  return {
    id,
    url,
    title,
    description: textOf(row, QUOKA_SRP.description),
    priceText,
    locationText: textOf(row, QUOKA_SRP.location),
    dateText: textOf(row, QUOKA_SRP.date),
    imageUrls: image ? [image] : [],
  };
}

function quokaAdToListing(ad: QuokaRawAd, now: Date, fetchedAt: string, sellerType: SellerType): Listing {
  const price = parseQuokaPrice(ad.priceText);
  const postedAt = parseQuokaDate(ad.dateText, now);
  return {
    key: listingKey('quoka', ad.id),
    provider: 'quoka',
    id: ad.id,
    // Scrubbed like the description, not raw. `types.ts` promises this source
    // carries contact details "on every row"; that held for one field of two,
    // and a phone number in a title reaches the cache exactly as fast as one in
    // the body. Nothing in a 66-title sample carried one — a gap, not a leak.
    title: stripContactDetails(ad.title),
    description: cleanDescription(ad.description),
    url: ad.url,
    price: price.price,
    priceKind: price.kind,
    shippingCost: null,
    totalPrice: null,
    condition: 'unknown',
    conditionRaw: null,
    sellerType,
    delivery: 'unknown',
    location: splitPostalPlace(quokaPlace(ad.locationText), null),
    listedAt: postedAt?.iso ?? null,
    listedAtPrecision: postedAt?.precision ?? null,
    endsAt: null,
    bidCount: null,
    images: ad.imageUrls,
    gtin: null,
    fetchedAt,
  };
}

export function parseQuokaSearchPage(html: string, options: QuokaParseOptions): QuokaSearchPage {
  const doc = parseHtml(html);
  const warnings: string[] = [];

  const totalEstimate = parseQuokaResultCount(html);
  const rows = queryAll(doc, QUOKA_SRP.item);
  const declaredEmpty = totalEstimate === 0 || (totalEstimate === null && html.includes(QUOKA_NO_RESULTS));

  // Before any early return: the strip is on the zero-hit page too (measured
  // 2026-08-22, all three counts `0` with "Privat" still marked active), and a
  // caller that gets no verdict cannot tell "not checked" from "fine".
  const sellerFilter = checkQuokaSellerFilter(
    parseQuokaUserTypeFacets(doc),
    options.sellerType,
    totalEstimate,
  );
  // Only stamped when the page confirmed it. `unknown` costs the row a field;
  // a wrong stamp costs the user a filter they believe in.
  const stamp: SellerType = sellerFilter.kind === 'confirmed' ? options.sellerType : 'unknown';
  if (options.sellerType !== 'unknown' && sellerFilter.kind !== 'confirmed') {
    warnings.push(
      `Quoka: der Anbietertyp-Filter ist nicht belegt (${sellerFilter.detail}) — ` +
        'die Zeilen tragen deshalb keinen Anbietertyp.',
    );
  }
  // The mirror case: nothing was asked for and the source narrowed anyway, so
  // the rows are a subset and `totalEstimate` describes something else.
  if (options.sellerType === 'unknown' && sellerFilter.kind === 'contradicted') {
    warnings.push(`Quoka: es wurde kein Anbietertyp angefragt, die Seite meldet aber ${sellerFilter.detail}.`);
  }

  if (totalEstimate === null && rows.length === 0 && !declaredEmpty) {
    throw parseFailed(
      'quoka',
      'Weder `resultscount` noch eine einzige Anzeige war auf der Ergebnisseite von Quoka zu finden.',
    );
  }
  if (declaredEmpty) {
    // The zero-hit page keeps six recommendation ads inside `.article-list`,
    // distinguishable only by an empty `data-articleid`. Two independent locks:
    // this branch and the `:not([data-articleid=""])` in the row selector.
    return { listings: [], seen: 0, totalEstimate: 0, nextUrl: null, warnings, sellerFilter };
  }
  if (rows.length === 0) {
    throw parseFailed(
      'quoka',
      `Quoka meldet ${totalEstimate ?? 'mehrere'} Treffer, aber keine einzige Zeile passte auf den Selektor.`,
    );
  }

  const fetchedAt = options.now.toISOString();
  const listings: Listing[] = [];
  for (const row of rows) {
    const ad = parseQuokaRow(row);
    if (ad) listings.push(quokaAdToListing(ad, options.now, fetchedAt, stamp));
  }
  if (listings.length === 0) {
    throw parseFailed(
      'quoka',
      `${rows.length} Zeilen auf der Seite, aber in keiner stand Titel, ID und Link.`,
    );
  }
  if (totalEstimate === null) {
    warnings.push('Quoka: `resultscount` stand nicht auf der Seite — die Zeilen selbst wurden gelesen.');
  }

  return { listings, seen: rows.length, totalEstimate, nextUrl: quokaNextUrl(doc), warnings, sellerFilter };
}

/**
 * The next page, as the pagination itself links it.
 *
 * Both arrows are `li.arrow`; on page 1 the "previous" one is a `<span>` and
 * only "next" is a link, from page 2 on both are links and the last one is the
 * one wanted. Read from the DOM rather than computed from the count, so a
 * paging scheme that changes surfaces as "no next page" instead of as a URL the
 * site never offered.
 */
function quokaNextUrl(doc: ReturnType<typeof parseHtml>): string | null {
  const arrows = queryAll(doc, QUOKA_SRP.next);
  const href = (attr(arrows[arrows.length - 1], 'href') ?? '').trim();
  if (!href) return null;
  try {
    return new URL(href, QUOKA_ORIGIN).toString();
  } catch {
    return null;
  }
}
