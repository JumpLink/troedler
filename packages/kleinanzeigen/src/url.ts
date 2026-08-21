/**
 * The URL grammar — pure, and the most delicate file in this adapter.
 *
 * kleinanzeigen.de encodes the whole query in the path, and robots.txt shuts
 * off most of that path space. So this file has two jobs, and the second one
 * is the load-bearing one:
 *
 *  1. Build the handful of shapes the operator permits.
 *  2. Make it impossible to build any of the shapes it forbids — from user
 *     input, by accident, or by a later edit.
 *
 * Every rule below was measured against the live site on 2026-08-21, not read
 * off a blog post. The canonical URL the site answers with is the proof; where
 * a form is unmeasured it is simply not built.
 */

import type { KleinanzeigenCategory } from './categories.ts';

export const HOST = 'www.kleinanzeigen.de';
export const ORIGIN = `https://${HOST}`;

/**
 * Result pages we will ever ask for.
 *
 * robots.txt carries a rule that reads, with … standing in for its wildcard,
 * `Disallow: /…/seite:6…` — and that pattern needs a slash in front of
 * `seite:6`, which the keyword form `/s-seite:6/fahrrad/k0` does not
 * have. Measured: our own robots matcher ALLOWS `/s-seite:6/fahrrad/k0` and
 * denies `/s-fahrraeder/seite:6/c217`. Relying on that gap would be reading
 * the letter against the plain intent — the site itself links pages 2 to 5 and
 * stops. So the cap lives here, in the builder, where robots.txt cannot be
 * argued with rather than merely obeyed.
 */
export const MAX_PAGE = 5;

/** Regular ads per result page. Measured: 25, plus a variable number of top ads. */
export const ADS_PER_PAGE = 25;

/** Zero-width characters. They turn up inside place names in this markup. */
const INVISIBLE = /[\u200B-\u200D\uFEFF\u00AD]/g;

export interface KleinanzeigenLocation {
  /** The operator's own slug, e.g. `hamburg`. */
  readonly slug: string;
  /** The numeric id behind the `l` token, e.g. 9409. */
  readonly id: number;
}

export interface KleinanzeigenScope {
  readonly category: KleinanzeigenCategory | null;
  readonly location: KleinanzeigenLocation | null;
}

export const NO_SCOPE: KleinanzeigenScope = { category: null, location: null };

/**
 * Turn what the user typed into one path segment.
 *
 * The sanitising is not tidiness, it is the gate's second half. A raw search
 * term goes straight into the path, so `preis:100` would build
 * `/s-preis:100/k0` — and measured, our robots matcher lets that through,
 * because `Disallow: /…/preis:…` wants a slash before `preis:`. A term with a
 * `/` in it would forge a whole extra segment and hit the keyword-order trap
 * below. So everything that is not a letter or a digit collapses to `-`, which
 * makes the forbidden tokens (`:`, `+`, `/`) unspellable from user input.
 *
 * Umlauts are KEPT and percent-encoded rather than transliterated. Measured:
 * `/s-b%C3%BCrostuhl/k0` echoes „bürostuhl" in its heading and
 * `/s-buerostuhl/k0` echoes „buerostuhl" — both find 30 351 ads, because the
 * site folds them itself. Transliterating would silently search for a
 * different word than the user asked for and rely on that folding to hide it.
 */
export function keywordSlug(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The `k`-token that follows the last path segment.
 *
 * Order is `k0`, then the category, then the location — measured: the site
 * canonicalises `/s-hamburg/fahrrad/k0c217l9409` to
 * `/s-fahrraeder/hamburg/fahrrad/k0c217l9409`, keeping exactly that token.
 * The `r<km>` radius token is deliberately absent and must stay absent: every
 * `…r1` … `…r200` variant is disallowed in robots.txt.
 */
function scopeToken(scope: KleinanzeigenScope): string {
  let token = 'k0';
  if (scope.category) token += `c${scope.category.id}`;
  if (scope.location) token += `l${scope.location.id}`;
  return token;
}

export class UrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlError';
  }
}

/**
 * Path for one result page.
 *
 * The segment order is the whole trap, and it is worth stating precisely:
 *
 *     /s- <categorySlug>? / <locationSlug>? / seite:N? / <keyword> / <token>
 *
 * **The last segment before the token is the keyword.** Measured: asking for
 * `/s-fahrrad/hamburg/k0l9409` gets canonicalised to
 * `/s-hamburg/hamburg/k0l9409` with the heading „Hamburg in Hamburg" — the
 * site read `fahrrad` as the place and `hamburg` as the search term, answered
 * 200, and returned 27 plausible ads for the wrong query. Getting this order
 * backwards does not fail, it lies.
 *
 * `seite:N` is one segment of its own, immediately before the keyword —
 * measured for all three shapes: `/s-seite:2/fahrrad/k0`,
 * `/s-fahrraeder/seite:2/rennrad/k0c217` and
 * `/s-fahrraeder/hamburg/seite:2/fahrrad/k0c217l9409`. Writing it as "two
 * spellings" is what it looks like from outside; it is one rule.
 */
export function searchPath(keyword: string, scope: KleinanzeigenScope = NO_SCOPE, page = 1): string {
  const slug = keywordSlug(keyword);
  if (!slug) {
    throw new UrlError(
      'Kleinanzeigen braucht einen Suchbegriff. Ohne ihn bliebe nur, die Plattform seitenweise durchzublättern — genau die Belastung, die § 5 der Nutzungsbedingungen untersagt.',
    );
  }
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new UrlError(
      `Kleinanzeigen liefert nur die Seiten 1 bis ${MAX_PAGE}; Seite ${page} wurde nicht angefragt.`,
    );
  }

  const segments: string[] = [];
  if (scope.category) segments.push(scope.category.slug);
  if (scope.location) segments.push(encodeURIComponent(scope.location.slug));
  if (page > 1) segments.push(`seite:${page}`);
  segments.push(encodeURIComponent(slug));

  return `/s-${segments.join('/')}/${scopeToken(scope)}`;
}

export function searchUrl(keyword: string, scope: KleinanzeigenScope = NO_SCOPE, page = 1): string {
  return ORIGIN + searchPath(keyword, scope, page);
}

/**
 * Path of one ad.
 *
 * The long form `/s-anzeige/<slug>/<id>-<catId>-<locId>` carries routing hints
 * that save the site a redirect, so it is used whenever the result list gave
 * us one. `getListing(id)` has only the id and uses the short form, which
 * redirects — one extra hop, and honest about what we actually know.
 */
export function listingPath(id: string): string {
  if (!/^\d+$/.test(id)) throw new UrlError(`"${id}" ist keine Kleinanzeigen-Anzeigen-ID.`);
  return `/s-anzeige/${id}`;
}

export function listingUrl(id: string): string {
  return ORIGIN + listingPath(id);
}

/** Absolute URL from an `href`/`data-href` the page gave us. Relative or already absolute. */
export function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return ORIGIN + (href.startsWith('/') ? href : `/${href}`);
}

/**
 * The ad id out of a detail-page path.
 *
 * Both spellings occur: `/s-anzeige/<slug>/<id>-<catId>-<locId>` in result
 * lists, `/s-anzeige/<id>` after a redirect. Returns `null` rather than
 * guessing — a listing without an id is a listing we cannot key, and a made-up
 * key is worse than a dropped row.
 */
export function listingIdFrom(href: string | null | undefined): string | null {
  if (!href) return null;
  const path = href.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  const tail = path.replace(/\/$/, '').split('/').pop() ?? '';
  const match = tail.match(/^(\d+)(?:-\d+-\d+)?$/);
  return match ? match[1] : null;
}
