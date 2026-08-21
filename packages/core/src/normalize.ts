/**
 * Turning what a marketplace prints into something comparable.
 *
 * All of it pure and all of it tested, because these are the functions that
 * decide whether two rows are "the same thing" and whether a price filter
 * matches — the two places where a quiet bug produces plausible, wrong answers
 * rather than a crash.
 */

import { money, type Money } from './money.ts';
import type { Condition, PriceKind } from './listing.ts';

/** Zero-width characters. Classified-ad markup is full of them inside place names. */
const INVISIBLE = /[\u200B-\u200D\uFEFF\u00AD]/g;

/**
 * A comparison key for a title.
 *
 * `ß → ss` happens BEFORE the NFKD fold, and it is not optional. Neither
 * SQLite's FTS5 `remove_diacritics 2` nor `Intl.Collator(…, {sensitivity:'base'})`
 * folds it — measured: `Grüße` indexes as `gruße`, so searching `grusse` finds
 * nothing. In German second-hand listings "Straße", "Fußball", "Größe" and
 * "Weiß" are everywhere, so the gap is not academic.
 */
export function normalizeTitle(input: string): string {
  return input
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** German phone shapes: +49…, 0049…, 0176…, with spaces, slashes, dashes or dots between. */
const PHONE = /(?:\+49|0049|\b0)[\d\s()/.-]{7,}\d/g;

/**
 * Strip contact details from free text.
 *
 * Done here, while parsing, and never "cleaned up later". A phone number that
 * reaches the cache has already been stored, and storing it is the thing we
 * are avoiding — kleinanzeigen's terms forbid collecting other users' phone
 * numbers outright, and the EDPB's scraping guidance asks for exactly this
 * kind of syntax filter at collection time.
 */
export function stripContactDetails(text: string): string {
  return text.replace(EMAIL, '[…]').replace(PHONE, '[…]');
}

export interface ParsedPrice {
  readonly price: Money | null;
  readonly kind: PriceKind;
}

/**
 * Parse a German price as printed on a classified ad.
 *
 * Handles `"3.550 € VB"`, `"249 €"`, `"1.200,50 €"`, `"Zu verschenken"`,
 * `"VB"` alone and `""`. The thousands separator is `.` and the decimal
 * separator is `,` — reading it the English way turns 3.550 € into three euros
 * fifty, which then sorts to the top of a price-ascending search and looks
 * like a bargain.
 */
export function parseGermanPrice(raw: string | null | undefined, currency = 'EUR'): ParsedPrice {
  const text = (raw ?? '').replace(INVISIBLE, '').trim();
  if (!text) return { price: null, kind: 'unknown' };

  const lower = text.toLowerCase();
  if (lower.includes('verschenken') || lower.includes('zu verschenken')) {
    return { price: money(0, currency), kind: 'free' };
  }

  const negotiable = /\bvb\b|verhandlungsbasis/i.test(text);
  // The `+` on the grouping is load-bearing, and `*` was a measured bug: with
  // `*` the grouped alternative matches three bare digits and wins outright, so
  // an UNGROUPED four-digit price silently lost its tail — `"2099 €"` parsed as
  // 209 €, `"1234,56"` as 1,23 €. Requiring at least one `.ddd` group forces
  // the ungrouped case down to `\d+`, which reads it whole. Same shape as
  // `parseGermanCount` in the markt adapter, for the same reason.
  const match = text.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  if (!match) return { price: null, kind: negotiable ? 'negotiable' : 'unknown' };

  const whole = Number.parseInt(match[1].replaceAll('.', ''), 10);
  const cents = match[2] ? Number.parseInt(match[2].padEnd(2, '0'), 10) : 0;
  if (!Number.isFinite(whole)) return { price: null, kind: negotiable ? 'negotiable' : 'unknown' };

  return { price: money(whole * 100 + cents, currency), kind: negotiable ? 'negotiable' : 'fixed' };
}

/**
 * Parse the relative dates classified ads print: `"Heute, 17:08"`,
 * `"Gestern, 14:29"`, `"26.04.2026"`.
 *
 * `now` is a parameter, not `new Date()`, because "Heute" is only meaningful
 * relative to something and a test that cannot pin that something is a test
 * that passes at 23:59 and fails at 00:01. Returns ISO 8601 UTC.
 */
export function parseGermanDate(raw: string | null | undefined, now: Date): string | null {
  const text = (raw ?? '').replace(INVISIBLE, '').trim();
  if (!text) return null;

  const time = text.match(/(\d{1,2}):(\d{2})/);
  const hours = time ? Number.parseInt(time[1], 10) : 0;
  const minutes = time ? Number.parseInt(time[2], 10) : 0;

  const lower = text.toLowerCase();
  if (lower.startsWith('heute') || lower.startsWith('gestern')) {
    const d = new Date(now.getTime());
    if (lower.startsWith('gestern')) d.setDate(d.getDate() - 1);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  }

  const dmy = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) {
    const d = new Date(
      Number.parseInt(dmy[3], 10),
      Number.parseInt(dmy[2], 10) - 1,
      Number.parseInt(dmy[1], 10),
      hours,
      minutes,
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * eBay's numeric condition ids, which are the axis every other source maps onto.
 * Source: developer.ebay.com item condition id values.
 */
const EBAY_CONDITION: Record<string, Condition> = {
  '1000': 'new',
  '1500': 'new-other',
  '1750': 'new-other',
  '2000': 'refurb-a',
  '2010': 'refurb-a',
  '2020': 'refurb-b',
  '2030': 'refurb-c',
  '2500': 'refurb-c',
  '2750': 'used-excellent',
  '2990': 'used-excellent',
  '3000': 'used-excellent',
  '3010': 'used-good',
  '4000': 'used-good',
  '5000': 'used-good',
  '6000': 'used-acceptable',
  '7000': 'for-parts',
};

export function conditionFromEbayId(id: string | null | undefined): Condition {
  return (id && EBAY_CONDITION[id]) || 'unknown';
}

/** Best effort from German condition wording, as classified ads and book shops print it. */
export function conditionFromGerman(raw: string | null | undefined): Condition {
  const t = (raw ?? '').toLowerCase();
  if (!t) return 'unknown';
  if (/\bneu\b|neuwertig|ungeöffnet|originalverpackt|\bovp\b/.test(t)) {
    return /neuwertig/.test(t) ? 'used-excellent' : 'new';
  }
  if (/generalüberholt|refurbished|wiederaufbereitet/.test(t)) return 'refurb-b';
  if (/defekt|bastler|ersatzteil|nicht funktions/.test(t)) return 'for-parts';
  if (/sehr gut|gut erhalten/.test(t)) return 'used-excellent';
  if (/\bgut\b/.test(t)) return 'used-good';
  if (/akzeptabel|gebrauchsspuren|befriedigend|stark gebraucht/.test(t)) return 'used-acceptable';
  if (/gebraucht/.test(t)) return 'used-good';
  return 'unknown';
}

/** Order from best to worst, so a condition floor can be expressed as a comparison. */
export const CONDITION_ORDER: readonly Condition[] = [
  'new',
  'new-other',
  'refurb-a',
  'refurb-b',
  'refurb-c',
  'used-excellent',
  'used-good',
  'used-acceptable',
  'for-parts',
  'unknown',
];

export function conditionRank(c: Condition): number {
  const i = CONDITION_ORDER.indexOf(c);
  return i < 0 ? CONDITION_ORDER.length : i;
}
