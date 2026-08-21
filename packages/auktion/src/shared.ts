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
  return seconds === null ? null : new Date(now.getTime() + seconds * 1000).toISOString();
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
  const m = text.match(/^(\d{4,5})\s+(.+)$/);
  return {
    postalCode: m ? m[1] : null,
    city: m ? m[2].trim() : text || null,
    country,
    // Never computed here: neither site publishes a distance, and inventing one
    // would need a geocoder this project deliberately does not carry.
    distanceKm: null,
  };
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
