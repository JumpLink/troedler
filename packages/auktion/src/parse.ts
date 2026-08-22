/**
 * HTML in, raw rows out. No clock, no network, no `Listing`.
 *
 * That is the whole reason the tests run without a socket, and it is also why
 * the two very different page shapes can be checked against fixtures that were
 * written by hand rather than copied off the wire.
 *
 * **Selectors are chosen by meaning, not by class.** Both sites are public
 * German authority portals under the BITV, so both carry `aria-label`s,
 * `id`s and `<dl>` term/definition pairs that describe what a value *is* —
 * `aria-label="Restlaufzeit"`, `id="hoechstgebot"`, `<dt>Artikelstandort:</dt>`.
 * Those are load-bearing for screen-reader users and therefore far more stable
 * than the Bootstrap/FontAwesome class soup wrapped around them; a redesign
 * changes `col-lg-3`, it does not quietly drop the accessible name.
 */

import {
  attr,
  parseHtml,
  query,
  queryAll,
  text,
  textOf,
  type HtmlElement,
} from '@troedler/html';
import { parseFailed } from './shared.ts';
import type { JustizDetailRaw, ZollCardRaw, ZollDetailRaw } from './types.ts';

/**
 * Term/definition pairs of a `<dl>`, keyed by the term.
 *
 * Walks `dt` and `dd` in document order rather than zipping two lists: a page
 * that ever prints two `<dd>`s under one `<dt>` would silently shift every
 * later value by one, and a location landing in the payment field is exactly
 * the kind of wrong-but-plausible result this project is built to avoid.
 */
function dlPairs(scope: HtmlElement): Map<string, string> {
  const out = new Map<string, string>();
  let term: string | null = null;
  for (const node of queryAll(scope, 'dt, dd')) {
    // `localName`, not `tagName`: the DOM spells `tagName` UPPERCASE for HTML
    // elements. The previous parser answered `'dt'` here, this one answers
    // `'DT'`, and the comparison silently stopped matching — every `<dt>` was
    // read as a `<dd>` with no term, so the whole infobox came back empty.
    if (node.localName === 'dt') {
      term = text(node).replace(/:\s*$/, '').trim().toLowerCase();
    } else if (term !== null) {
      if (!out.has(term)) out.set(term, text(node));
    }
  }
  return out;
}

/** The `<li>`s of a Zoll result card, keyed by the accessible name of their icon. */
function cardFields(card: HtmlElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const li of queryAll(card, 'ul[aria-label="Auktionsdetails"] li')) {
    const key = attr(query(li, 'span[aria-label]'), 'aria-label');
    if (key) out.set(key.toLowerCase(), text(li));
  }
  return out;
}

/** Trailing numeric path segment: `/auktion/produkt/<slug>/971850` → `971850`. */
function idFromPath(path: string | null): string | null {
  const m = (path ?? '').match(/\/(\d+)(?:[/?#].*)?$/);
  return m ? m[1] : null;
}

/**
 * `"Auktionssuche: 83 Treffer"` → 83.
 *
 * The site's own count, and the only place it appears. It vanishes entirely on
 * a zero-hit page, which is why its absence is never read as an error.
 */
function totalFromBreadcrumb(doc: HtmlElement): number | null {
  const m = textOf(doc, 'li.breadcrumb-item.active').match(/([\d.]+)\s*Treffer/);
  if (!m) return null;
  const n = Number.parseInt(m[1].replaceAll('.', ''), 10);
  return Number.isFinite(n) ? n : null;
}

export interface ZollSearchPage {
  readonly cards: readonly ZollCardRaw[];
  /** The site's own hit count, `null` when it printed none. */
  readonly totalEstimate: number | null;
  readonly hasNextPage: boolean;
}

/**
 * One Zoll-Auktion result page.
 *
 * Three outcomes, and keeping them apart is the point of the function:
 * rows, an honestly empty result, or `parse-failed`. The site marks the empty
 * case explicitly — `<div id="za-search-result-list"><p>Keine Treffer.</p></div>`,
 * measured 2026-08-21 — so "no marker, no cards" is not a quiet zero, it is the
 * markup having moved.
 */
export function parseZollSearchPage(html: string, provider: string): ZollSearchPage {
  const doc = parseHtml(html);
  const root = query(doc, '#za-search-result-list');
  if (!root) {
    throw parseFailed(provider, 'Die Ergebnisliste (#za-search-result-list) fehlt auf der Trefferseite.');
  }

  const articles = queryAll(root, 'article');
  const totalEstimate = totalFromBreadcrumb(doc);
  const hasNextPage = query(doc, 'a[rel="next"]') !== null;

  if (articles.length === 0) {
    if (/keine\s+treffer/i.test(text(root))) return { cards: [], totalEstimate, hasNextPage: false };
    throw parseFailed(provider, 'Die Ergebnisliste enthält weder Treffer noch den Hinweis „Keine Treffer".');
  }

  const cards: ZollCardRaw[] = [];
  for (const card of articles) {
    const link = query(card, 'a[href*="/auktion/produkt/"]');
    const path = attr(link, 'href');
    const id = idFromPath(path);
    // Two clean sources, in order of how much they promise: the accessible
    // heading, then the link's `title`. The VISIBLE link text is deliberately
    // not a third — it is the one copy that carries soft hyphens
    // ("Modelleisenb&shy;ahn"), which would survive into the DTO and quietly
    // break every later comparison on the title.
    const title = textOf(card, 'h4.sr-only') || attr(link, 'title') || '';
    if (!id || !path || !title) continue;

    const fields = cardFields(card);
    cards.push({
      id,
      path,
      title,
      thumbnailPath: attr(query(card, 'img'), 'src'),
      priceText: textOf(card, 'p .font-weight-bold') || null,
      locationText: fields.get('artikelstandort') ?? null,
      deliveryText: fields.get('lieferinformationen') ?? null,
      remainingText: fields.get('restlaufzeit') ?? null,
      bidsText: fields.get('gebotsstatus') ?? null,
    });
  }

  // Cards present but not one of them readable: the card layout changed inside
  // an unchanged container. Returning `[]` here is what would look like a
  // perfectly good "nothing found".
  if (cards.length === 0) {
    throw parseFailed(provider, `${articles.length} Treffer-Kacheln gefunden, aber keine einzige lesbar.`);
  }
  return { cards, totalEstimate, hasNextPage };
}

/** The schema.org `Product` block, when the page carries one. */
function productJsonLd(doc: HtmlElement): Record<string, unknown> | null {
  for (const script of queryAll(doc, 'script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(text(script)) as Record<string, unknown>;
      if (data['@type'] === 'Product') return data;
    } catch {
      // A malformed JSON-LD block is the operator's problem, not a reason to
      // fail the page: everything read from it here has an HTML fallback.
    }
  }
  return null;
}

function pick(source: unknown, ...path: string[]): string | null {
  let cur: unknown = source;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : null;
}

/** One Zoll-Auktion detail page. `null` when the id does not resolve to a lot. */
export function parseZollDetailPage(html: string): ZollDetailRaw | null {
  const doc = parseHtml(html);
  const id = textOf(doc, '#bilder_auktionen_id');
  const title = textOf(doc, '#ueberschrift_auktion');
  if (!id || !title) return null;

  // Scoped to the auction info box, not the whole document. Further down the
  // same page an "Ansprechpartner" block pairs a named official with a direct
  // line and an e-mail address; keeping the walk out of it means those values
  // are never read, let alone stored. Not read either, though it is inside the
  // box: `Anbieter` — the offering authority. The DTO has no seller field.
  const facts = dlPairs(query(doc, '#auktionsinfobox') ?? doc);
  const ld = productJsonLd(doc);

  return {
    id,
    path: attr(query(doc, 'link[rel="canonical"]'), 'href') ?? '',
    title,
    priceText: textOf(doc, '#hoechstgebot') || null,
    locationText: facts.get('ort') ?? null,
    remainingText: textOf(doc, '#verbleibende_zeit') || null,
    endsAtText: textOf(doc, '#auktions_ende') || null,
    bidsText: textOf(doc, '#anz_gebote_zahl') || null,
    pickupText: facts.get('abholung') ?? null,
    shippingText: facts.get('versand') ?? null,
    // Scoped to the item description on purpose. The "Ansprechpartner" block
    // further down the same page names an official and prints a direct line;
    // it is not read, so it cannot be stored.
    description: textOf(doc, '#gegenstandsbeschreibung') || null,
    // The anchor around each carousel slide points at the unscaled original;
    // the `<img>` inside it is the display copy. Largest first, as the DTO asks.
    imagePaths: queryAll(doc, '#auk_carousel .carousel-item a[href]')
      .map((a) => attr(a, 'href'))
      .filter((href): href is string => Boolean(href)),
    // The one field worth taking from JSON-LD rather than the page: it carries
    // an explicit UTC offset, so unlike everything the page prints in German
    // wall-clock time it needs no guess about the reader's zone.
    startsAtIso: pick(ld, 'offers', 'availabilityStarts'),
    country: pick(ld, 'offers', 'availableAtOrFrom', 'address', 'addressCountry'),
  };
}

/** One Justiz-Auktion detail page. `null` on the 404 page, which answers with HTTP 200 markup. */
export function parseJustizDetailPage(html: string): JustizDetailRaw | null {
  const doc = parseHtml(html);
  const id = textOf(doc, '#auk_id span');
  const title = textOf(doc, 'h2.auktionstitel');
  if (!id || !title) return null;

  const bids = dlPairs(query(doc, 'dl#geb_uebersicht') ?? doc);
  const amounts = dlPairs(query(doc, 'dl.geb_top') ?? doc);
  const facts = dlPairs(query(doc, 'dl#auk_uebersicht') ?? doc);

  // The description is printed twice — once for the mobile layout, once for the
  // desktop one. `#artbeschr` is the mobile copy and the only one with an id,
  // so it is also the only one that cannot be picked up twice.
  const paragraphs = queryAll(doc, '#artbeschr p')
    .map((p) => text(p))
    .filter(Boolean);
  const conditionText = paragraphs.find((p) => /^zustand\s*:/i.test(p)) ?? null;
  const body = paragraphs.filter((p) => p !== conditionText).join(' ');

  return {
    id,
    title,
    currentBidText: amounts.get('aktuelles gebot') ?? null,
    startBidText: amounts.get('startgebot') ?? null,
    remainingText: facts.get('auktion endet in') ?? null,
    endsAtText: facts.get('endet am') ?? null,
    locationText: facts.get('artikelstandort') ?? null,
    shippingText: facts.get('versandart') ?? null,
    conditionText: conditionText ? conditionText.replace(/^zustand\s*:\s*/i, '') : null,
    description: body || null,
    // Deliberately NOT read from this page: `Verkäufer` (the authority) and
    // `Höchstbietender` (a masked but still user-scoped pseudonym). The DTO has
    // nowhere to put either, and that is the design, not an omission.
    bidsText: bids.get('anzahl gebote') ?? null,
    imagePaths: queryAll(doc, '.swiper-slide img[src]')
      .map((img) => attr(img, 'src'))
      .filter((src): src is string => Boolean(src)),
    countryText: (attr(query(doc, 'span.land img'), 'alt') ?? '').replace(/\s*Fahne\s*$/i, '').trim() || null,
  };
}
