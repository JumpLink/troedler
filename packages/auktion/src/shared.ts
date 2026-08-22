/**
 * What zoll-auktion.de and justiz-auktion.de have in common.
 *
 * They are two different codebases from two different authorities — Apache/PHP
 * from the Generalzolldirektion, a 2019 NRW justice-portal theme from the other
 * — and they share no markup at all. What they do share is the *domain*: both
 * are public-authority auctions, both print a countdown rather than a deadline,
 * both count bids in German, and in both the seller is an office rather than a
 * person. That domain, and nothing else, lives here.
 */

import {
  DESCRIPTION_CHARS,
  ProviderError,
  money,
  stripContactDetails,
  type Location,
  type Money,
} from '@troedler/core';
import type { HttpClient } from '@troedler/http';

export interface AuktionDeps {
  readonly http: HttpClient;
  readonly env: Record<string, string | undefined>;
  readonly enabled: boolean;
  /**
   * Injected, never `new Date()` inside the parser.
   *
   * Both sites print "still 1 day 14 hrs 40 min" instead of a deadline, so the
   * end time is only computable relative to something. A test that cannot pin
   * that something is a test whose expected `endsAt` changes every second.
   */
  readonly now?: () => Date;
}

/**
 * `"1 Tag 14 Std. 40 Min."` → seconds.
 *
 * One function for four spellings, because the two sites disagree and each is
 * inconsistent with itself. Measured 2026-08-21:
 *
 *   zoll search   `noch 55 Sekunden` · `noch 37 Minuten` · `noch 23 Std. 40 Min.`
 *                 `1 Tag 12 Std. 55 Min.` · `2 Tage 17 Std. 3 Min.`
 *   zoll detail   `1 Tag 14 Std. 38 Min.`
 *   justiz card   `Restzeit: 3 T, 1 Std, 47 Min`
 *   justiz detail `24 Tage, 1 Stunde, 31 Minuten`
 *
 * Returns `null` when no number carried a unit at all — which is how "the
 * countdown moved or the auction ended" stays distinguishable from "0 seconds
 * left".
 */
export function parseRemainingSeconds(raw: string | null | undefined): number | null {
  const text = (raw ?? '').replace(/\u00A0/g, ' ');
  if (!text.trim()) return null;

  let seconds = 0;
  let matched = false;
  for (const m of text.matchAll(/(\d+)\s*([A-Za-zÄÖÜäöü]+)/g)) {
    const value = Number.parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(value)) continue;

    // `sek` before the bare `s`: "Std" and "Sekunden" both start with one.
    if (unit.startsWith('sek')) seconds += value;
    else if (unit.startsWith('min')) seconds += value * 60;
    else if (unit.startsWith('s')) seconds += value * 3600;
    else if (unit.startsWith('t')) seconds += value * 86400;
    else continue;
    matched = true;
  }
  return matched ? seconds : null;
}

/**
 * The auction's end as an instant, from the countdown plus now.
 *
 * Deliberately NOT parsed out of the absolute date both detail pages also
 * print. `"So., 23.08.2026 - 09:00 Uhr"` carries no time zone, so reading it
 * means assuming the reader's clock is set to Europe/Berlin — true on the
 * machine this was written on, wrong by an hour or two for anyone else, and
 * wrong in the one field a bidder actually acts on. The countdown needs no such
 * assumption, and it is the only form the *search* page offers anyway, so this
 * is also the path that keeps both page shapes on one code path.
 */
export function endsAtFrom(remaining: string | null | undefined, now: Date): string | null {
  const seconds = parseRemainingSeconds(remaining);
  if (seconds === null) return null;

  // Rounded to the countdown's own granularity, not taken at face value. The
  // countdown is floored and our clock is read after the response came back, so
  // the raw sum is early by up to one unit and jitters with the latency. Real
  // auctions end on a whole minute, so snapping to the printed granularity
  // removes both errors instead of trading one for the other.
  const grain = remainingGranularitySeconds(remaining) ?? 1;
  const at = now.getTime() + seconds * 1000;
  const snapped = Math.round(at / (grain * 1000)) * grain * 1000;
  return new Date(snapped).toISOString();
}

/** `"20 Gebote"` → 20, `"1 Gebot"` → 1, `"0 Gebote"` → 0. `null` when unreadable. */
export function parseBidCount(raw: string | null | undefined): number | null {
  const m = (raw ?? '').match(/(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * A bid as printed: `"410,00 EUR"`, `"41.840,00 EUR"`, `"20,00 €"`.
 *
 * Not `parseGermanPrice`: that function classifies the price kind as well, and
 * on an auction the answer is always `auction` regardless of the wording. What
 * is left is the amount, and the German thousands/decimal convention that turns
 * 41.840,00 into forty-one euros if it is read the English way.
 */
export function parseBidAmount(raw: string | null | undefined, currency = 'EUR'): Money | null {
  const text = (raw ?? '').replace(/[\u00A0\u200B-\u200D\uFEFF\u00AD]/g, ' ').trim();
  const m = text.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const whole = Number.parseInt(m[1].replaceAll('.', ''), 10);
  if (!Number.isFinite(whole)) return null;
  const cents = m[2] ? Number.parseInt(m[2].padEnd(2, '0'), 10) : 0;
  return money(whole * 100 + cents, currency);
}

/**
 * `"33334 Gütersloh"` → postal code plus town.
 *
 * Both sites print the *authority's* address, which is a public office and not
 * a person; that is the only reason a location is kept at all. Austrian codes
 * are four digits (justiz-auktion carries Vienna lots), German ones five, so
 * the digit run is not length-checked.
 */
export function splitGermanLocation(raw: string | null | undefined, country: string | null): Location {
  const text = (raw ?? '').trim();

  // On a radius search Zoll-Auktion appends its OWN distance to the location:
  // `60320 Frankfurt am Main (ca. 4 km)`. Two errors in one when it is left in
  // place — the city name becomes useless for any cross-provider comparison,
  // and a distance the source computed lands in the bin while `distanceKm`,
  // which exists for exactly this, stays null. Still never computed here: this
  // reads a number the page printed.
  const near = text.match(/\s*\(\s*(?:ca\.?|rund|etwa)?\s*([\d.,]+)\s*km\s*\)\s*$/i);
  const withoutDistance = near ? text.slice(0, text.length - near[0].length).trim() : text;
  const distanceKm = near ? Number.parseFloat(near[1].replace(/\./g, '').replace(',', '.')) : null;

  const m = withoutDistance.match(/^(\d{4,5})\s+(.+)$/);
  return {
    postalCode: m ? m[1] : null,
    city: m ? m[2].trim() : withoutDistance || null,
    country,
    distanceKm: distanceKm !== null && Number.isFinite(distanceKm) ? distanceKm : null,
  };
}

/**
 * How fine the countdown was printed — the unit of its smallest term, in
 * seconds.
 *
 * The countdown is FLOORED, not rounded: measured against the server clock, a
 * page reading `noch 3 Std. 9 Min.` had 3 h 09 min 49 s left. Reading it as
 * exact puts the end up to one whole unit too early, and the network latency
 * between the render and our `now()` shifts it again in the other direction —
 * together, 21 seconds of spread across four runs on a value the source keeps
 * constant.
 */
export function remainingGranularitySeconds(raw: string | null | undefined): number | null {
  const text = (raw ?? '').replace(/\u00A0/g, ' ');
  let finest: number | null = null;
  for (const m of text.matchAll(/(\d+)\s*([A-Za-zÄÖÜäöü]+)/g)) {
    const unit = m[2].toLowerCase();
    const size = unit.startsWith('sek')
      ? 1
      : unit.startsWith('min')
        ? 60
        : unit.startsWith('s')
          ? 3600
          : unit.startsWith('t')
            ? 86400
            : null;
    if (size !== null && (finest === null || size < finest)) finest = size;
  }
  return finest;
}

/** The UTC offset an ISO 8601 string carries, in minutes. `+02:00` → 120, `Z` → 0. */
export function isoOffsetMinutes(iso: string | null | undefined): number | null {
  const m = (iso ?? '').match(/(?:Z|([+-])(\d{2}):?(\d{2}))$/);
  if (!m) return null;
  if (!m[1]) return 0;
  const minutes = Number.parseInt(m[2], 10) * 60 + Number.parseInt(m[3], 10);
  return m[1] === '-' ? -minutes : minutes;
}

/**
 * The absolute end the page prints, made exact by an offset the same page
 * printed elsewhere.
 *
 * `"So., 23.08.2026 - 09:00 Uhr"` carries no zone, which is why this was
 * previously derived from the countdown instead. But the detail page also
 * carries `availabilityStarts: 2026-08-15T18:00:00+02:00` in its JSON-LD —
 * the same wall clock the page prints for the start, once WITH an offset. So
 * the zone is readable off the document and does not have to be assumed from
 * the reader's clock. No fallback to the local zone: without the offset this
 * returns `null` and the caller keeps the countdown.
 */
export function absoluteEndFrom(
  raw: string | null | undefined,
  offsetMinutes: number | null,
): string | null {
  if (offsetMinutes === null) return null;
  const m = (raw ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})[^\d]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [day, month, year, hour, minute] = m.slice(1, 6).map((v) => Number.parseInt(v, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000;
  return new Date(utc).toISOString();
}

/**
 * The item text, shortened and scrubbed — in that order, while parsing.
 *
 * The scrub is not decoration. A Zoll-Auktion detail page carries an
 * "Ansprechpartner" block with a named official, a direct line and an e-mail
 * address. The parser never reads that block, and this is the second line of
 * defence for the case where a lot's own description repeats the number.
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

/** Site-relative → absolute. Both sites emit relative `src`/`href` throughout. */
export function absolutize(host: string, path: string | null | undefined): string | null {
  const p = (path ?? '').trim();
  if (!p) return null;
  try {
    return new URL(p, `https://${host}/`).toString();
  } catch {
    return null;
  }
}

/**
 * The failure that has to be loud.
 *
 * A results container that is present but yields nothing parsable is the
 * markup having moved, and the one thing it must never look like is "nothing
 * matched" — that answer is indistinguishable from a correct one and nobody
 * goes looking for it.
 */
export function parseFailed(provider: string, detail: string): ProviderError {
  return new ProviderError(
    provider,
    'parse-failed',
    `${detail} Das Seitenlayout hat sich vermutlich geändert — der Adapter muss nachgezogen werden, statt „keine Treffer" zu melden.`,
  );
}
