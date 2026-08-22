/**
 * Envelope → `Listing[]`, with no way out to the network.
 *
 * Pure by construction: nothing here imports `fetch`, the `HttpClient` or the
 * clock. That is what makes the whole failure surface of this source testable
 * without a key — and this source's failure surface is the interesting part,
 * because every one of its failures arrives as `HTTP 200`.
 *
 * The rule the file is built around: **a successful call that yields no rows
 * is a bug until proven otherwise.** booklooker answers a search without a
 * `token` with `200 OK` and `{"status":"NOK"}`, and its legacy interface
 * answers without a `pid` with `200 OK` and a body of zero bytes (both
 * measured 2026-08-21). An adapter that reads either as "0 Treffer" reports a
 * confident, wrong answer that nobody can see. So: an empty payload is
 * `parse-failed`, a payload whose rows carry no deep link is `parse-failed`,
 * and only a well-formed list that genuinely contains no offers is zero.
 */

import {
  DESCRIPTION_CHARS,
  ProviderError,
  addMoney,
  conditionFromGerman,
  listingKey,
  moneyFromDecimal,
  parseGermanDate,
  type ParsedDate,
  parseGermanPrice,
  stripContactDetails,
  type Condition,
  type Delivery,
  type Listing,
  type Money,
  type PriceKind,
  type SellerType,
} from '@troedler/core';
import { parseHtml, query, queryAll, text, type HtmlElement, type HtmlNode } from '@troedler/html';
import type { BooklookerEnvelope, BooklookerRecord } from './types.ts';

export const PROVIDER = 'booklooker' as const;

/** Everything `parse.ts` needs from the outside, so it needs nothing else. */
export interface ParseContext {
  /** Retrieval time. A parameter, never `new Date()` — see `parseGermanDate`. */
  readonly now: Date;
  /** Currency of the numbers on the wire. booklooker settles in EUR. */
  readonly currency: string;
}

export interface ParsedSearch {
  readonly listings: Listing[];
  readonly warnings: string[];
}

// ─── the envelope ──────────────────────────────────────────────────────────

function fail(message: string): never {
  throw new ProviderError(PROVIDER, 'parse-failed', message);
}

/**
 * Map a `NOK` envelope onto a `ProviderErrorKind`.
 *
 * The distinction that matters is between a token that timed out — which the
 * API documents as normal and expects us to fix by authenticating again — and
 * a key that was rejected, which is a decision we do not argue with.
 */
export function errorFor(code: string): ProviderError {
  switch (code) {
    case 'API_KEY_MISSING':
      return new ProviderError(
        PROVIDER,
        'not-configured',
        'Booklooker hat keinen API-Key erhalten (API_KEY_MISSING). Setze BOOKLOOKER_API_KEY.',
      );
    case 'AUTHENTICATION_FAILED':
      return new ProviderError(
        PROVIDER,
        'refused',
        'Booklooker kennt diesen API-Key nicht (AUTHENTICATION_FAILED). Kein zweiter Versuch — der Schlüssel ist falsch oder zurückgezogen.',
      );
    case 'TOKEN_EXPIRED':
    case 'TOKEN_UNKNOWN':
    case 'TOKEN_MISSING':
      return new ProviderError(PROVIDER, 'refused', `Booklooker-Token nicht (mehr) gültig (${code}).`);
    case 'QUOTA_EXCEEDED':
      return new ProviderError(
        PROVIDER,
        'rate-limited',
        'Booklooker-Kontingent erschöpft (QUOTA_EXCEEDED). Die Suche darf 50× je 10 Minuten kostenlos laufen.',
      );
    case 'TEMPORARILY_BLOCKED':
      return new ProviderError(
        PROVIDER,
        'refused',
        'Booklooker hat den Zugang vorübergehend gesperrt (TEMPORARILY_BLOCKED). Das ist eine Entscheidung des Anbieters — bitte den Support fragen, nicht erneut anfragen.',
      );
    case 'SERVER_DOWN':
      return new ProviderError(
        PROVIDER,
        'unreachable',
        'Booklooker-API wegen Wartungsarbeiten nicht verfügbar (SERVER_DOWN).',
      );
    case 'INVALID_REQUEST_METHOD':
      // Ours to fix, not the user's: /authenticate is POST-only, /search GET-only.
      return new ProviderError(
        PROVIDER,
        'remote-error',
        'Booklooker lehnt die HTTP-Methode ab (INVALID_REQUEST_METHOD).',
      );
    default:
      return new ProviderError(PROVIDER, 'remote-error', `Booklooker antwortete mit ${code}.`);
  }
}

/**
 * Unwrap an envelope, or throw.
 *
 * `status` is checked before `returnValue` is even looked at, because on this
 * API the transport already said 200 and the envelope is the only truth left.
 */
export function unwrap(envelope: unknown): unknown {
  if (typeof envelope !== 'object' || envelope === null) {
    fail(`Booklooker lieferte keinen Antwortumschlag (${describe(envelope)}).`);
  }
  const { status, returnValue } = envelope as BooklookerEnvelope;
  if (typeof status !== 'string') {
    fail('Booklooker-Antwort ohne Feld "status" — das Format der Schnittstelle hat sich geändert.');
  }
  if (status !== 'OK') {
    throw errorFor(typeof returnValue === 'string' && returnValue ? returnValue : status);
  }
  return returnValue;
}

/** The token from `/authenticate`. A blank one would authenticate every later call into a 200-NOK loop. */
export function readToken(envelope: unknown): string {
  const value = unwrap(envelope);
  if (typeof value !== 'string' || value.trim() === '') {
    fail('Booklooker meldete OK, lieferte aber keinen Token — nicht verwertbar.');
  }
  return value.trim();
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'string') return `String(${value.length})`;
  return typeof value;
}

// ─── the payload ───────────────────────────────────────────────────────────

/**
 * Pull the offer records out of whatever `returnValue` turned out to be.
 *
 * Two shapes are accepted because the API documents neither. `article_list`
 * proves this API delivers bulk payloads as a STRING inside `returnValue`
 * (newline-separated, TAB-columned), and the `extraFields` table for `search`
 * is written entirely in XML element notation — so a string holding an XML
 * document is the likely shape and the first branch. A JSON array of records
 * is the other reading of "eine selbsterklärende Liste" and costs one branch.
 * Anything else fails loudly with the shape it saw, which is the message that
 * makes the next fix a five-minute job.
 */
export function recordsFrom(returnValue: unknown): BooklookerRecord[] {
  if (typeof returnValue === 'string') {
    const body = returnValue.trim();
    if (body === '') {
      // The measured trap, in its REST form. `status: OK` plus nothing is not
      // "no offers" — it is an interface that did not do what we asked.
      fail(
        'Booklooker meldete OK, lieferte aber einen leeren Rumpf. Das ist kein Nullergebnis, sondern eine unbrauchbare Antwort.',
      );
    }
    // `/search` answers with JSON INSIDE the envelope's string field — measured
    // 2026-08-22: `{"status":"OK","returnValue":"{\"Book\":[…]}"}`. Two encodings,
    // and only `/authenticate` uses the string as a plain token. Guessing that a
    // string had to be markup is what made this adapter report `parse-failed` on
    // its first real answer — correctly, which is the only reason it was cheap
    // to find.
    if (body.startsWith('{') || body.startsWith('[')) {
      let inner: unknown;
      try {
        inner = JSON.parse(body);
      } catch (error) {
        fail(
          `Booklooker lieferte einen returnValue, der wie JSON beginnt, aber keines ist (${
            error instanceof Error ? error.message : String(error)
          }).`,
        );
      }
      return recordsFrom(inner);
    }
    if (!body.includes('<')) {
      fail(`Booklooker lieferte weder JSON noch XML, sondern Text: „${body.slice(0, 80)}…".`);
    }
    return recordsFromMarkup(body);
  }

  if (Array.isArray(returnValue)) {
    if (returnValue.length === 0) return [];
    return returnValue.map(recordFromObject);
  }

  if (typeof returnValue === 'object' && returnValue !== null) {
    // A single wrapper property holding the list, e.g. `{ articles: [...] }`.
    const lists = Object.values(returnValue as Record<string, unknown>).filter(Array.isArray);
    if (lists.length === 1) return (lists[0] as unknown[]).map(recordFromObject);
    fail(
      `Booklooker lieferte ein Objekt ohne erkennbare Trefferliste (Felder: ${Object.keys(returnValue).join(', ') || 'keine'}).`,
    );
  }

  fail(`Booklooker lieferte einen unerwarteten returnValue (${describe(returnValue)}).`);
}

/**
 * The deep link is the discriminator.
 *
 * It is the ONE field the documentation names for the search result — "Der
 * Deep-Link zum Angebot bei booklooker.de befindet sich im Element
 * `<DetailLinkUrl>`" — so an item is anything that contains one, and markup
 * that contains none is markup we do not understand. Finding items by their
 * deep link instead of by a container name also survives a rename of the
 * container, which is not documented anywhere and could be anything.
 */
const DEEP_LINK_TAG = 'detaillinkurl';

function recordsFromMarkup(markup: string): BooklookerRecord[] {
  // Parsed through the shared façade, in HTML mode: it lower-cases element
  // names (`<DetailLinkUrl>` → `detaillinkurl`) and decodes entities, which is
  // all this payload needs. A real XML mode would be better — see the note in
  // docs/quellen/booklooker.de.md — but a second parser in this package would
  // be worse than a slightly wrong-moded shared one.
  const doc = parseHtml(markup);
  const anchors = queryAll(doc, DEEP_LINK_TAG);

  if (anchors.length === 0) {
    if (query(doc, `[${DEEP_LINK_TAG}]`)) {
      fail(
        'Booklooker liefert den Deep-Link inzwischen als Attribut statt als Element — der Parser muss nachgezogen werden.',
      );
    }
    fail(
      `Booklooker-Antwort enthält kein <DetailLinkUrl>. ${queryAll(doc, '*').length} Elemente, keines davon ein Treffer — das Format hat sich geändert.`,
    );
  }

  const items: HtmlElement[] = [];
  for (const anchor of anchors) {
    const parent = anchor.parent;
    // A deep link with no element around it is a flat document; then the whole
    // document is the one record, which is still better than dropping it.
    items.push(parent && 'name' in parent ? (parent as HtmlElement) : (doc as unknown as HtmlElement));
  }
  const unique = [...new Set(items)];

  // Many links, one container: the offers are flat siblings rather than
  // wrapped one by one. Parsing that shape would fold N offers into a single
  // row whose every field is an array — 150 books reported as one, with no
  // error anywhere. Refuse instead.
  if (anchors.length > 1 && unique.length === 1) {
    fail(
      `Booklooker lieferte ${anchors.length} Deep-Links, aber nur einen Container — die Angebote sind nicht ` +
        'einzeln umschlossen und ließen sich nur zu EINEM Treffer verschmelzen.',
    );
  }
  return unique.map(recordFromElement);
}

function recordFromElement(item: HtmlNode): BooklookerRecord {
  const out: Record<string, string | string[]> = {};
  for (const el of queryAll(item, '*')) {
    if (el === item) continue;
    add(out, el.name, text(el));
  }
  return out;
}

function recordFromObject(entry: unknown): BooklookerRecord {
  if (typeof entry !== 'object' || entry === null) {
    fail(`Booklooker-Trefferliste enthält ${describe(entry)} statt eines Angebots.`);
  }
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) add(out, key, String(v));
    else if (typeof value === 'object') add(out, key, '');
    else add(out, key, String(value));
  }
  return out;
}

function add(out: Record<string, string | string[]>, name: string, value: string): void {
  const key = name.toLowerCase();
  const existing = out[key];
  if (existing === undefined) out[key] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else out[key] = [existing, value];
}

// ─── one record → one Listing ──────────────────────────────────────────────

/**
 * Field names, resolved by candidate.
 *
 * The names in the first position of each list are the documented ones (the
 * `extraFields` table and `<DetailLinkUrl>`); the rest are the German and
 * English spellings the same shop uses elsewhere. This list is the inferred
 * part of the adapter, and it is safe to infer precisely because a record
 * that resolves to no title or no link is DROPPED, and a payload in which
 * every record drops is a `parse-failed` — a wrong guess here cannot turn
 * into a quiet zero.
 *
 * Absent on purpose: `uID` (booklooker's seller id), and every seller name or
 * profile field. `Listing` has nowhere to put them and we have no reason to
 * hold them.
 */
const FIELDS = {
  url: ['detaillinkurl', 'detaillink', 'url', 'link'],
  id: ['articleid', 'article_id', 'artikelnummer', 'orderno', 'order_no', 'id'],
  title: ['title', 'titel'],
  author: ['author', 'autor', 'artist', 'kuenstler', 'cast'],
  publisher: ['publisher', 'verlag', 'label'],
  year: ['year', 'yearofpublication', 'erscheinungsjahr', 'jahr'],
  price: ['price', 'preis', 'articleprice'],
  shipping: ['shippingprice', 'shipping', 'versandkosten', 'porto', 'postage'],
  currency: ['currency', 'waehrung', 'währung'],
  isbn: ['isbn', 'isbn13', 'isbn10'],
  ean: ['ean', 'gtin'],
  condition: ['condition', 'zustand'],
  sellerType: ['sellertype', 'anbietertyp'],
  country: ['sellercountry', 'country', 'land'],
  image: ['picurl', 'imageurl', 'image', 'picture', 'cover', 'thumbnail', 'bild'],
  listedAt: ['dateofentry', 'date', 'einstelldatum', 'datum'],
  description: ['infotext', 'comment', 'annotation', 'description', 'beschreibung', 'kommentar', 'bemerkung'],
  /** `1` / `0`. The only condition signal this API sends — see `conditionOf`. */
  isNew: ['new', 'neu'],
  /** Present on a single offer, absent on an aggregate row. */
  articleId: ['articleid', 'article_id'],
} as const;

function read(rec: BooklookerRecord, names: readonly string[]): string | null {
  for (const name of names) {
    const value = rec[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string' && first.trim() !== '') return first.trim();
  }
  return null;
}

/**
 * A price as this API might print it — and it might print it two ways.
 *
 * `article_list` returns prices as bare decimals, the website prints German
 * notation, and the search payload is undocumented. Reading `"12.50"` the
 * German way gives twelve euros (the cents fall off); reading `"1.234,56"`
 * the English way gives one euro twenty-three. The second mistake sorts a
 * €1234 first edition to the top of a cheapest-first search, so the notation
 * is decided per value instead of assumed once.
 */
export function parseApiPrice(
  raw: string | null,
  currency: string,
): { price: Money | null; kind: PriceKind } {
  if (raw === null) return { price: null, kind: 'unknown' };
  const value = raw.trim();
  if (value === '') return { price: null, kind: 'unknown' };

  // Bare decimal with at most two places and a single separator: unambiguous
  // once we know there is no thousands grouping.
  if (/^-?\d+[.,]\d{1,2}$/.test(value) || /^-?\d+$/.test(value)) {
    const m = moneyFromDecimal(value, currency);
    return m ? { price: m, kind: 'fixed' } : { price: null, kind: 'unknown' };
  }
  // Anything else — grouped digits, a currency symbol, "VB" — is display text.
  return parseGermanPrice(value, currency);
}

/** ISO 8601 UTC from either an ISO date or the German notation the core parser knows. */
function parseDate(raw: string | null, now: Date): ParsedDate | null {
  if (raw === null) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
    // A bare `YYYY-MM-DD` names a day; the midnight is ours, not the shop's.
    return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString(), precision: 'day' };
  }
  return parseGermanDate(raw, now);
}

function checkDigit13(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * ISBN or EAN → a GTIN-13, or nothing.
 *
 * This is the field the whole cross-provider grouping rests on: `identityKey`
 * in the kernel trusts a GTIN and nothing else, and booklooker plus eBay are
 * the two sources that supply one. eBay returns EAN-13; a book that arrives
 * here as an ISBN-10 would never meet its eBay twin unless it is widened to
 * 13 first, and the grouping would fail in the one way nobody notices.
 *
 * The check digit is verified rather than trusted. A mistyped ISBN that keeps
 * its shape would otherwise become a confident identity and merge two
 * different books — `null` is a much cheaper wrong answer than that.
 */
export function toGtin13(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();

  if (s.length === 13 && /^\d{13}$/.test(s)) {
    return checkDigit13(s.slice(0, 12)) === s[12] ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += Number(s[i]) * (10 - i);
    sum += s[9] === 'X' ? 10 : Number(s[9]);
    if (sum % 11 !== 0) return null;
    const core = `978${s.slice(0, 9)}`;
    return `${core}${checkDigit13(core)}`;
  }
  return null;
}

function sellerTypeOf(raw: string | null): SellerType {
  if (raw === null) return 'unknown';
  const t = raw.trim().toLowerCase();
  // Documented as 0 = privat, 1 = gewerblich; the words are the belt to that
  // brace, since the same field is spelled out in the legacy XML.
  if (t === '1' || t.startsWith('gewerb') || t.startsWith('commerc') || t.startsWith('prof'))
    return 'commercial';
  if (t === '0' || t.startsWith('priv')) return 'private';
  return 'unknown';
}

/**
 * Condition, from the only two signals this API actually sends.
 *
 * Measured over 149 real rows: there is no free-text condition field at all —
 * `Edition` carries the binding ("Taschenbuch", "Leinen"), not the state. What
 * there is, on every row, is `New`: `1` on 51 of them, `0` on 98.
 *
 * `1` is a statement and becomes `new`. `0` is NOT: it says the book is not new
 * and stops there, and `Condition` has no "used, grade unstated" value distinct
 * from `unknown`. Turning it into `used-good` would invent a grade nobody wrote,
 * and the ranking would then act on it. So it stays `unknown` and the fact
 * travels in `conditionRaw`, where a reader sees it and a filter — which keeps
 * unknown-condition rows by design — does not silently drop half the source.
 *
 * The free-text mapper stays for the XML path, which does carry seller wording.
 */
function conditionOf(raw: string | null, isNew: string | null): Condition {
  if (isNew !== null) {
    const flag = isNew.trim();
    if (flag === '1') return 'new';
    if (flag === '0') return 'unknown';
  }
  return conditionFromGerman(raw);
}

/** What `conditionRaw` shows when the flag is all there is. */
function conditionTextOf(raw: string | null, isNew: string | null): string | null {
  if (raw) return raw;
  if (isNew === null) return null;
  const flag = isNew.trim();
  if (flag === '1') return 'neu';
  if (flag === '0') return 'gebraucht';
  return null;
}

/**
 * booklooker is a mail-order marketplace: every offer is posted, and the
 * search interface even takes a destination country to price the postage
 * with. `pickup` exists only as a payment method (Selbstabholung), never as
 * the sole option, so `shipping` is a fact about this source rather than a
 * guess about a row.
 */
const DELIVERY: Delivery = 'shipping';

function absoluteUrl(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `https://www.booklooker.de${value}`;
  return null;
}

/**
 * An id that stays the same between two searches.
 *
 * The article number is preferred because `/purchase` takes exactly that
 * (`"A02HuK3Z01ZZc"`), so a key from a search is a handle you can act on.
 * Falling back to the deep link keeps rows usable when the field is absent;
 * falling back to the row's position would not, because it changes with the
 * sort order and would break `dedupeWithinProvider`.
 */
function idOf(rec: BooklookerRecord, url: string): string {
  const explicit = read(rec, FIELDS.id);
  if (explicit) return explicit;
  try {
    const parsed = new URL(url);
    const tokens = [...parsed.searchParams.values(), ...parsed.pathname.split('/')].filter(
      (t) => t.length >= 4,
    );
    // Shape of the two article numbers the OpenAPI spec prints for `/purchase`
    // ("A02HuK3Z01ZZc", "A02ItXa601ZZx"). A preference, not a requirement: when
    // nothing matches, the last usable path or query token is used instead, and
    // that is still stable across searches.
    const article = tokens.find((t) => /^A[0-9A-Za-z]{10,14}$/.test(t));
    if (article) return article;
    const last = tokens.at(-1);
    if (last) return last;
  } catch {
    // A deep link we cannot parse is still a stable string; use it whole.
  }
  return url;
}

function toListing(rec: BooklookerRecord, ctx: ParseContext): Listing | null {
  const url = absoluteUrl(read(rec, FIELDS.url));
  const title = read(rec, FIELDS.title);
  if (url === null || title === null) return null;

  const currency = read(rec, FIELDS.currency)?.toUpperCase() || ctx.currency;
  const { price, kind } = parseApiPrice(read(rec, FIELDS.price), currency);
  const shipping = parseApiPrice(read(rec, FIELDS.shipping), currency).price;
  const totalPrice =
    price && shipping && price.currency === shipping.currency ? addMoney(price, shipping) : null;

  const author = read(rec, FIELDS.author);
  const publisher = read(rec, FIELDS.publisher);
  const year = read(rec, FIELDS.year);
  const note = read(rec, FIELDS.description);
  // The bibliographic head is worth keeping even when the seller wrote no
  // comment: for a used book "Suhrkamp, 1998" IS the description.
  const description = [author, [publisher, year].filter(Boolean).join(', ') || null, note]
    .filter((p): p is string => Boolean(p))
    .join(' · ');

  const image = absoluteUrl(read(rec, FIELDS.image));
  const id = idOf(rec, url);
  const isNew = read(rec, FIELDS.isNew);

  // A row WITHOUT an ArticleId is not an offer, it is a group of them: measured,
  // those carry `Offerer: "verschiedene Anbieter"` and a `resultnew.php` link
  // instead of `detail.php`. Its price is the cheapest of the group, so calling
  // it a fixed price would promise something no single seller offers.
  const aggregate = read(rec, FIELDS.articleId) === null;
  const postedAt = parseDate(read(rec, FIELDS.listedAt), ctx.now);

  return {
    key: listingKey(PROVIDER, id),
    provider: PROVIDER,
    id,
    title,
    description: description ? stripContactDetails(description).slice(0, DESCRIPTION_CHARS.default) : null,
    url,
    price,
    priceKind: price ? (aggregate ? 'from' : kind) : 'unknown',
    shippingCost: shipping,
    totalPrice,
    condition: conditionOf(read(rec, FIELDS.condition), isNew),
    conditionRaw: conditionTextOf(read(rec, FIELDS.condition), isNew),
    sellerType: sellerTypeOf(read(rec, FIELDS.sellerType)),
    delivery: DELIVERY,
    location: {
      postalCode: null,
      city: null,
      country: read(rec, FIELDS.country)?.toUpperCase() ?? null,
      distanceKm: null,
    },
    listedAt: postedAt?.iso ?? null,
    listedAtPrecision: postedAt?.precision ?? null,
    endsAt: null,
    bidCount: null,
    images: image ? [image] : [],
    gtin: toGtin13(read(rec, FIELDS.isbn) ?? read(rec, FIELDS.ean)),
    fetchedAt: ctx.now.toISOString(),
  };
}

/**
 * The whole payload.
 *
 * The last guard is the one that matters: records were found, none of them
 * became a listing. That is a changed field set, and reporting it as an empty
 * search would be the exact failure this project refuses to ship.
 */
export function parseSearchResponse(envelope: unknown, ctx: ParseContext): ParsedSearch {
  const records = recordsFrom(unwrap(envelope));
  if (records.length === 0) return { listings: [], warnings: [] };

  const listings: Listing[] = [];
  for (const rec of records) {
    const listing = toListing(rec, ctx);
    if (listing) listings.push(listing);
  }
  if (listings.length === 0) {
    fail(
      `Booklooker lieferte ${records.length === 1 ? '1 Datensatz' : `${records.length} Datensätze`}, ` +
        'aber keiner enthielt Titel und Deep-Link — die Feldnamen der Schnittstelle haben sich geändert.',
    );
  }

  const warnings: string[] = [];
  const dropped = records.length - listings.length;
  if (dropped > 0)
    warnings.push(
      `${dropped} von ${records.length} Booklooker-Datensätzen ohne Titel oder Link übersprungen.`,
    );
  return { listings, warnings };
}
