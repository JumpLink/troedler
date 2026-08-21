/**
 * What markt.de and Quoka have in common.
 *
 * They are two unrelated codebases — a Java/Apache stack with hashed
 * `clsy-` class names on one side, ASP.NET behind Cloudflare on the other —
 * and they share no markup whatsoever. What they share is the *domain*: German
 * classified ads, where the price is a phrase rather than a number, the date is
 * relative to now, the seller is a private person until proven otherwise, and
 * the free text routinely carries a phone number that must never reach a cache.
 *
 * That domain, and nothing else, lives here.
 */

import {
  DESCRIPTION_CHARS,
  ProviderError,
  parseGermanDate,
  parseGermanPrice,
  stripContactDetails,
  type Location,
  type ParsedPrice,
} from '@troedler/core';
import type { HttpClient } from '@troedler/http';

export interface MarktDeps {
  readonly http: HttpClient;
  readonly env: Record<string, string | undefined>;
  /** Whether the user switched this source on. Never defaulted to true anywhere. */
  readonly enabled: boolean;
  /**
   * Injected, never `new Date()` inside the parser.
   *
   * Both sources print "heute 17:52" and "vor 3 Min." instead of a timestamp,
   * so the listing date is only computable relative to something. A test that
   * cannot pin that something is a test that passes at 23:59 and fails at 00:01.
   */
  readonly now?: () => Date;
}

/** Raised while building a URL, so the provider can turn it into a `ProviderError`. */
export class MarktUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarktUrlError';
  }
}

/**
 * The failure that has to be loud.
 *
 * A results container that is present but yields nothing parsable is the markup
 * having moved, and the one thing it must never look like is "nothing matched"
 * — that answer is indistinguishable from a correct one, so nobody goes looking
 * for it. Both of these portals make the trap concrete rather than theoretical:
 * each answers a zero-hit query with HTTP 200 and a full page of unrelated
 * recommendation ads.
 */
export function parseFailed(provider: string, detail: string): ProviderError {
  return new ProviderError(
    provider,
    'parse-failed',
    `${detail} Das Seitenlayout hat sich vermutlich geändert — der Adapter muss nachgezogen werden, statt „keine Treffer" zu melden.`,
  );
}

/**
 * `"9.933"` out of `"Suchen (9.933 Treffer)"`, `"3521"` out of a script variable.
 *
 * Returns `null` when no digit run is there at all, which is what separates
 * "the count element moved" from "the count is zero" — the caller needs both.
 */
export function parseGermanCount(raw: string | null | undefined): number | null {
  const m = (raw ?? '').replace(/\u00A0/g, ' ').match(/(\d{1,3}(?:\.\d{3})+|\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1].replaceAll('.', ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * `"30966 Hemmingen (Niedersachsen)"` → postal code plus place.
 *
 * `country` is derived from the code's LENGTH rather than assumed: markt.de
 * carries a `dach-region` and links a Swiss sister site, and German codes are
 * five digits while Austrian and Swiss ones are four. Five digits means
 * Germany; four means one of the other two and we cannot tell which, so the
 * field stays `null` rather than becoming a plausible guess.
 */
export function splitPostalPlace(raw: string | null | undefined, distanceKm: number | null): Location {
  const text = (raw ?? '').replace(/\u00A0/g, ' ').trim();
  const m = text.match(/^(\d{4,5})\s+(.+)$/);
  if (!m) return { postalCode: null, city: text || null, country: null, distanceKm };
  return {
    postalCode: m[1],
    city: m[2].trim() || null,
    country: m[1].length === 5 ? 'DE' : null,
    distanceKm,
  };
}

/** `"12 km"` → 12. `null` when the source printed no distance, which it only does under a radius. */
export function parseDistanceKm(raw: string | null | undefined): number | null {
  const m = (raw ?? '').match(/(\d+(?:[.,]\d+)?)\s*km/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * The ad text, shortened and scrubbed — in that order, while parsing.
 *
 * The scrub is not decoration and it is not deferrable. markt.de's own terms
 * forbid collecting other users' contact details, Quoka ships an encrypted
 * phone number on every result row, and sellers put their mobile number in the
 * ad body on both. A number that reaches the cache has already been stored, and
 * storing it is the thing being avoided.
 */
export function cleanDescription(raw: string | null | undefined): string | null {
  const text = (raw ?? '')
    .replace(/\u00AD/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const cut =
    text.length > DESCRIPTION_CHARS.default ? `${text.slice(0, DESCRIPTION_CHARS.default).trimEnd()}…` : text;
  return stripContactDetails(cut);
}

/**
 * Site-relative → absolute, with the tracking query dropped.
 *
 * `?keywords=…&rView=list&absIndex=7&geoUrlId=…` is this run's session noise:
 * two searches must not produce two different URLs, and therefore two different
 * `key`s, for one ad.
 *
 * // gjsify gap (unfixed): the URL class under GJS exposes GETTERS only.
 * // `url.search = ''` throws `TypeError: setting getter-only property
 * // "search"`, and so does every other setter — measured 2026-08-21 on
 * // gjs 1.88.1 for `search`, `hash`, `pathname`, `href` and `host`. Composing
 * // the result from `origin` + `pathname` needs no setter and is what makes
 * // this adapter work on both runtimes; the mutating version parsed every page
 * // correctly under Node and returned zero rows under GJS.
 */
export function canonicalUrl(origin: string, path: string | null | undefined): string | null {
  const p = (path ?? '').trim();
  if (!p) return null;
  try {
    const url = new URL(p, origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * The largest image a `srcset` offers, else the plain `src`.
 *
 * `Listing.images` is documented "largest first" and both sources ship a 130 px
 * thumbnail as `src` with the bigger variant only in `srcset`. Taking `src`
 * blindly hands every consumer the small one.
 */
export function largestImage(src: string | null, srcset: string | null): string | null {
  const candidates: { url: string; width: number }[] = [];
  for (const part of (srcset ?? '').split(',')) {
    const [url, descriptor] = part.trim().split(/\s+/, 2);
    if (!url) continue;
    const width = Number.parseInt((descriptor ?? '').replace(/[^\d]/g, ''), 10);
    candidates.push({ url, width: Number.isFinite(width) ? width : 0 });
  }
  candidates.sort((a, b) => b.width - a.width);
  return candidates[0]?.url ?? (src?.trim() || null);
}

/**
 * markt.de's relative wording, which core's German date parser does not cover.
 *
 * Measured wordings on this source: `"Heute, 16:51"`, `"Gestern, 23:03"`,
 * `"15.08.2026"` — all three handled by `parseGermanDate` — and
 * `"Heute, vor 3 Min."`, which is NOT. That last one is the dangerous case: it
 * starts with "Heute", so `parseGermanDate` takes its today-branch, finds no
 * `HH:MM`, and returns today at 00:00 — a plausible timestamp up to eighteen
 * hours early, on the very freshest ads, which is exactly the rows a `--since`
 * filter is about. So the relative form is matched FIRST and the general parser
 * only gets what is left.
 *
 * Only "Min." was observed in the field (up to `"vor 55 Min."`, after which the
 * site switches to `HH:MM`); "Std." is its obvious sibling and costs one branch.
 */
export function parseMarktDate(raw: string | null | undefined, now: Date): string | null {
  const text = (raw ?? '').replace(/\u00A0/g, ' ').trim();
  const relative = text.match(/vor\s+(\d+)\s*(Min|Std|Stunde|Minute)/i);
  if (relative) {
    const value = Number.parseInt(relative[1], 10);
    if (!Number.isFinite(value)) return null;
    const seconds = /^s/i.test(relative[2]) ? value * 3600 : value * 60;
    return new Date(now.getTime() - seconds * 1000).toISOString();
  }
  return parseGermanDate(text, now);
}

const GERMAN_MONTHS: Record<string, number> = {
  januar: 0,
  februar: 1,
  märz: 2,
  maerz: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  dezember: 11,
};

/**
 * Quoka's wording: `"heute 17:52"`, `"gestern 22:35"`, `"21 Juli"`.
 *
 * The first two are `parseGermanDate`'s job. The third is not a form core knows
 * — a day and a month NAME with no year — and it is what every ad older than
 * two days carries, so leaving it `null` would blank the date on most of the
 * inventory beyond page three.
 *
 * The missing year is inferred as the most recent past occurrence: on
 * 21 August, "15 Dezember" is last December, not this one. Guessing the current
 * year would post-date ads into the future, where a `--since` filter keeps them
 * forever.
 */
export function parseQuokaDate(raw: string | null | undefined, now: Date): string | null {
  const text = (raw ?? '').replace(/\u00A0/g, ' ').trim();
  if (!text) return null;

  const viaCore = parseGermanDate(text, now);
  if (viaCore) return viaCore;

  const m = text.match(/^(\d{1,2})\.?\s+([A-Za-zÄÖÜäöüß]+)\.?$/);
  if (!m) return null;
  const month = GERMAN_MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;

  const day = Number.parseInt(m[1], 10);
  const candidate = new Date(now.getFullYear(), month, day, 0, 0, 0, 0);
  if (candidate.getTime() > now.getTime()) candidate.setFullYear(now.getFullYear() - 1);
  return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
}

/**
 * Quoka's invariant number format, rewritten as German notation.
 *
 * Measured price shapes on this source: `"60 EUR"`, `"2 099 EUR"`,
 * `"1400.0 EUR"`, `"9999.9 EUR"`, `"8,5 EUR"`, `"zu verschenken"`. The group
 * separator is a SPACE and the decimal separator is a dot *or* a comma —
 * neither is what `parseGermanPrice` expects, and handing it the raw string is
 * not merely lossy, it is quietly wrong in both directions:
 *
 *     parseGermanPrice("2 099 EUR")  →   2,00 €   (a thousandth of the price)
 *     parseGermanPrice("1400.0 EUR") → 140,00 €   (a tenth of it)
 *
 * A price-ascending search then puts those at the top and they look like the
 * bargain of the year. So the amount is translated into the notation core's
 * parser documents — thousands with `.`, decimals with `,` — and the money
 * semantics (VB, "zu verschenken", minor units) stay core's job.
 *
 * // core gap: `parseGermanPrice` also mis-reads an UNGROUPED four-digit price,
 * // `"2099 €"` → 209 €, because its first alternative matches three digits and
 * // wins. Neither source prints that form, so nothing here works around it —
 * // but the day one does, this comment is the trail. Reported 2026-08-21.
 */
export function germanizeAmount(raw: string): string {
  return raw.replace(
    /(\d+(?:[ \u00A0]\d{3})*)(?:[.,](\d{1,2}))?/,
    (_all, whole: string, fraction?: string) => {
      const grouped = whole.replace(/[ \u00A0]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return fraction === undefined ? grouped : `${grouped},${fraction}`;
    },
  );
}

/** Quoka's price cell, via `germanizeAmount`, then core. */
export function parseQuokaPrice(raw: string | null | undefined): ParsedPrice {
  const text = (raw ?? '').trim();
  if (!text) return { price: null, kind: 'unknown' };
  return parseGermanPrice(germanizeAmount(text));
}

/**
 * markt.de's price cell: an amount and a label that belong together.
 *
 * They sit in two sibling nodes — `"2.600 €"` plus `"Festpreis"`, `"120 €"`
 * plus `"VB"`, and for a giveaway an EMPTY amount plus `"Zu verschenken"`.
 * Joining them before parsing is what lets core recognise VB and the giveaway
 * without this file re-implementing either. `"Nettokaltmiete"` and the other
 * property labels pass through untouched and land on `fixed`, which is what
 * they are.
 */
export function parseMarktPrice(
  amount: string | null | undefined,
  label: string | null | undefined,
): ParsedPrice {
  return parseGermanPrice(`${(amount ?? '').trim()} ${(label ?? '').trim()}`.trim());
}
