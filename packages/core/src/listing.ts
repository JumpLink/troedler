/**
 * The `Listing` DTO — one shape for an offer, whatever marketplace it came from.
 *
 * Derived field by field from what the six v1 sources actually return, so that
 * no adapter has to invent data and no consumer has to special-case a source.
 * Where a source cannot supply a field it stays `null`; `null` means "this
 * marketplace does not tell us", never "zero" and never "no".
 *
 * What is deliberately ABSENT is as load-bearing as what is present:
 *
 *   - **No seller name, id or profile.** eBay's API licence forbids storing
 *     user ids outright, and a seller pseudonym plus a town is personal data
 *     under the GDPR that we have no reason to hold. `sellerType` — private or
 *     commercial — is the only thing a buyer actually needs, and it is a
 *     category, not a person.
 *   - **No phone numbers, no e-mail addresses.** Classified ads carry them in
 *     free text. They are stripped in the adapter while parsing, not deleted
 *     later, because "we'll clean it up afterwards" is how personal data ends
 *     up in a cache file.
 *   - **No image bytes, only URLs.** Rehosting someone's photo is a
 *     reproduction; linking it is not.
 */

import type { Money } from './money.ts';
import type { TimePrecision } from './normalize.ts';

/** Every marketplace troedler can speak to. Also the key in config and CLI flags. */
export type ProviderId =
  | 'ebay'
  | 'kleinanzeigen'
  | 'discogs'
  | 'booklooker'
  | 'zoll-auktion'
  | 'justiz-auktion'
  | 'markt-de'
  | 'quoka';

/**
 * Condition, normalised across sources.
 *
 * The axis is eBay's conditionId scale because it is the finest-grained one in
 * the field and every other source maps onto it without loss: refurbished
 * grades collapse into `refurb-*`, a classified ad that says nothing lands on
 * `unknown`. Mapping the other way — inventing "used-good" from silence —
 * would be a lie the ranking then acts on.
 */
export type Condition =
  | 'new'
  | 'new-other'
  | 'refurb-a'
  | 'refurb-b'
  | 'refurb-c'
  | 'used-excellent'
  | 'used-good'
  | 'used-acceptable'
  | 'for-parts'
  | 'unknown';

/** How the price is meant: fixed, negotiable ("VB"), a live auction bid, free, or a "from" price. */
export type PriceKind = 'fixed' | 'negotiable' | 'auction' | 'free' | 'from' | 'unknown';

export type SellerType = 'private' | 'commercial' | 'unknown';

/** Whether the item ships or has to be collected. */
export type Delivery = 'shipping' | 'pickup' | 'both' | 'unknown';

export interface Location {
  /** Postal code as printed. Not normalised — Germany, Austria and Switzerland disagree on length. */
  readonly postalCode: string | null;
  readonly city: string | null;
  readonly country: string | null;
  /** Kilometres from the query's origin, when the source computed it. Never computed here. */
  readonly distanceKm: number | null;
}

export interface Listing {
  /** `<provider>:<id>` — globally unique, stable, and what the CLI and MCP take as a handle. */
  readonly key: string;
  readonly provider: ProviderId;
  /** The marketplace's own id, unmodified. */
  readonly id: string;
  readonly title: string;
  /** Teaser or full text, already stripped of phone numbers and e-mail addresses. */
  readonly description: string | null;
  readonly url: string;

  readonly price: Money | null;
  readonly priceKind: PriceKind;
  /** Shipping cost when known. `null` means unknown, `0` means free — do not conflate. */
  readonly shippingCost: Money | null;
  /**
   * `price + shippingCost` when both are known and share a currency, else `null`.
   * Precomputed here rather than in each view: a listing that is cheap plus
   * expensive postage is not cheap, and every surface must agree on that.
   */
  readonly totalPrice: Money | null;

  readonly condition: Condition;
  /** The source's own condition wording, kept for display — normalisation loses nuance. */
  readonly conditionRaw: string | null;
  readonly sellerType: SellerType;
  readonly delivery: Delivery;
  readonly location: Location;

  /** When the offer went up. ISO 8601 UTC. */
  readonly listedAt: string | null;
  /**
   * How much of that the source actually said. `null` exactly when `listedAt`
   * is null.
   *
   * `day` means the page printed a calendar day and no clock, so `listedAt`
   * holds MIDNIGHT — the earliest instant it could be, not the instant it was.
   * Without this the two were indistinguishable and `--since <heute 12:00>`
   * dropped every ad from today, whatever time it went up. Measured on Quoka:
   * page 1 of a search carries 6 of 20 rows in the day-only form, page 100
   * carries 20 of 20.
   */
  readonly listedAtPrecision: TimePrecision | null;
  /** When it ends — meaningful for auctions, rolling and meaningless for fixed-price listings. */
  readonly endsAt: string | null;
  /** Live auctions only. */
  readonly bidCount: number | null;

  /** Image URLs, largest first. Never fetched, never stored — only linked. */
  readonly images: readonly string[];
  /** GTIN/EAN/ISBN when the source has one. The only reliable cross-provider identity. */
  readonly gtin: string | null;

  /** When troedler retrieved it. ISO 8601 UTC. Drives cache TTL and the "how old is this" display. */
  readonly fetchedAt: string;
}

/** The handle the CLI and MCP take, e.g. `ebay:v1|256789012345|0`. */
export function listingKey(provider: ProviderId, id: string): string {
  return `${provider}:${id}`;
}

export function parseListingKey(key: string): { provider: ProviderId; id: string } | null {
  const at = key.indexOf(':');
  if (at <= 0 || at === key.length - 1) return null;
  return { provider: key.slice(0, at) as ProviderId, id: key.slice(at + 1) };
}
