/**
 * eBay's JSON → `Listing[]`. Pure: no fetch, no clock, no globals.
 *
 * That purity is not tidiness — it is the only reason the tests below run with
 * no network and no keyset, against a hand-written response. And a hand-written
 * response is all we are allowed to commit: real listing JSON is other
 * people's data under a licence that forbids redistributing it.
 *
 * Two failure modes get special treatment here.
 *
 * **"Green and empty."** A 200 whose `itemSummaries` we can no longer read
 * looks exactly like "nothing matched". So a response that claims matches but
 * carries no rows, or carries rows none of which yields a usable `Listing`,
 * raises `parse-failed` instead of returning `[]`.
 *
 * **A filter eBay threw away.** Invalid filters come back as HTTP 200 plus a
 * `warnings[]` entry (12002 / 12014 / 12015), and the rows are then
 * *unfiltered*. If the kernel is told that filter was applied, it skips its own
 * pass and hands the user unfiltered results with a confident face. So
 * `attributeWarnings` takes a warning apart and removes what it names — and
 * when it cannot tell what a warning names, it removes everything.
 */

import {
  ProviderError,
  addMoney,
  conditionFromEbayId,
  listingKey,
  moneyFromDecimal,
  stripContactDetails,
  type Condition,
  type Delivery,
  type FilterKey,
  type Listing,
  type Location,
  type Money,
  type PriceKind,
  type SellerType,
} from '@troedler/core';
import type { FilterOwners } from './filter.ts';
import type { EbayAmount, EbayError, EbayItem, EbayItemSummary, EbaySearchResponse } from './types.ts';

export const PROVIDER_ID = 'ebay' as const;

export interface ParseContext {
  /** ISO 8601 UTC, injected — a parser that reads the clock cannot be tested. */
  readonly fetchedAt: string;
  /** Characters of `shortDescription` kept. */
  readonly descriptionChars: number;
}

export interface ParsedSearch {
  readonly listings: readonly Listing[];
  /** eBay's own estimate. Its docs call it "an indicator"; never calculated with. */
  readonly total: number | null;
  readonly warnings: readonly EbayError[];
  /** eBay silently rewrote the search term. */
  readonly correctedQuery: string | null;
}

function amount(raw: EbayAmount | undefined): Money | null {
  if (!raw?.value) return null;
  return moneyFromDecimal(raw.value, raw.currency ?? 'EUR');
}

/** `price + shipping`, but only when that is a real number and not a mixed-currency guess. */
function sum(price: Money | null, shipping: Money | null): Money | null {
  if (!price || !shipping || price.currency !== shipping.currency) return null;
  return addMoney(price, shipping);
}

function isoOrNull(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Distance, in kilometres, as eBay measured it.
 *
 * We always ask with `pickupRadiusUnit:km`, so `km` is what comes back; the
 * mile branch is a unit conversion of a number eBay computed, not a distance
 * this process worked out — `Listing.distanceKm` forbids the latter, and
 * throwing away a measured distance because of its unit helps nobody.
 */
function distanceKm(value: string | undefined, unit: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const u = (unit ?? 'km').toLowerCase();
  if (u === 'km' || u === 'kilometer') return Math.round(n * 10) / 10;
  if (u === 'mi' || u === 'mile') return Math.round(n * 1.609344 * 10) / 10;
  return null;
}

function sellerType(raw: string | undefined): SellerType {
  if (raw === 'INDIVIDUAL') return 'private';
  if (raw === 'BUSINESS') return 'commercial';
  return 'unknown';
}

/**
 * Price kind from `buyingOptions`.
 *
 * `AUCTION` outranks `BEST_OFFER` because an auction with a Buy-It-Now still
 * ends at a hammer price, and calling that "negotiable" would put a live
 * auction in the same bucket as a fixed-price ad. An empty `buyingOptions`
 * stays `unknown`: `Listing` says null means "the marketplace does not tell
 * us", and inventing `fixed` from silence is the kind of lie the ranking then
 * acts on.
 */
function priceKind(options: readonly string[]): PriceKind {
  if (options.includes('AUCTION')) return 'auction';
  if (options.includes('BEST_OFFER')) return 'negotiable';
  if (options.length > 0) return 'fixed';
  return 'unknown';
}

function delivery(item: EbayItemSummary): Delivery {
  const ships = (item.shippingOptions?.length ?? 0) > 0;
  const collects = (item.pickupOptions?.length ?? 0) > 0;
  if (ships && collects) return 'both';
  if (ships) return 'shipping';
  if (collects) return 'pickup';
  return 'unknown';
}

function images(item: EbayItemSummary): string[] {
  const urls = [
    item.image?.imageUrl,
    ...(item.additionalImages ?? []).map((i) => i.imageUrl),
    ...(item.thumbnailImages ?? []).map((i) => i.imageUrl),
  ];
  // Largest first: `image` is the gallery picture, `thumbnailImages` the 64 px
  // strip. Linked, never fetched and never rehosted — see Listing.images.
  return [...new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0))];
}

function location(item: EbayItemSummary): Location {
  const loc = item.itemLocation;
  return {
    postalCode: loc?.postalCode ?? null,
    city: loc?.city ?? null,
    country: loc?.country ?? null,
    distanceKm: distanceKm(
      item.distanceFromPickupLocation?.value,
      item.distanceFromPickupLocation?.unitOfMeasure,
    ),
  };
}

/**
 * One row. `null` when it is not usable as a listing at all.
 *
 * Returning null rather than a half-listing is what lets the caller notice
 * that a whole page of rows stopped mapping — which is the markup-moved
 * signal, and the difference between "parse-failed" and "no results".
 */
export function mapItemSummary(item: EbayItemSummary, ctx: ParseContext): Listing | null {
  const id = item.itemId;
  const title = item.title;
  if (!id || !title) return null;

  const options = item.buyingOptions ?? [];
  const isAuction = options.includes('AUCTION');
  // For an auction the live high bid IS the price; `price` is the opening bid.
  const price = (isAuction ? amount(item.currentBidPrice) : null) ?? amount(item.price);
  const shippingCost = amount(item.shippingOptions?.[0]?.shippingCost);
  const condition: Condition = conditionFromEbayId(item.conditionId);
  const gtin = (item as EbayItem).gtin;

  return {
    key: listingKey(PROVIDER_ID, id),
    provider: PROVIDER_ID,
    id,
    title,
    // Stripped here, while parsing — an eBay `shortDescription` is seller free
    // text and can carry a phone number just like a classified ad can.
    description: item.shortDescription
      ? clip(stripContactDetails(item.shortDescription), ctx.descriptionChars)
      : null,
    // `itemWebUrl`, never `itemAffiliateWebUrl`: troedler sends no EPN campaign
    // id, so the affiliate URL would be absent anyway — and silently
    // monetising someone's search is not this tool's business.
    url: item.itemWebUrl ?? `https://www.ebay.de/itm/${item.legacyItemId ?? id}`,
    price,
    priceKind: priceKind(options),
    shippingCost,
    totalPrice: sum(price, shippingCost),
    condition,
    conditionRaw: item.condition ?? null,
    // `sellerAccountType` and nothing else. The username is not even in the
    // raw type — see types.ts.
    sellerType: sellerType(item.seller?.sellerAccountType),
    delivery: delivery(item),
    location: location(item),
    // `itemCreationDate`, not `itemOriginDate`: a relist keeps the origin date,
    // so "newly listed" measured against it is years off.
    listedAt: isoOrNull(item.itemCreationDate),
    // Meaningful for an auction. For a fixed-price listing eBay rolls it
    // forward on every renewal, so reporting it as "ends at" is a countdown to
    // nothing.
    endsAt: isAuction ? isoOrNull(item.itemEndDate) : null,
    bidCount: isAuction && typeof item.bidCount === 'number' ? item.bidCount : null,
    images: images(item),
    // Search never carries a GTIN — only `getItem` does. Left null rather than
    // guessed, because it is the key the cross-provider dedup trusts most.
    gtin: typeof gtin === 'string' && gtin.length > 0 ? gtin : null,
    fetchedAt: ctx.fetchedAt,
  };
}

/**
 * The whole search response.
 *
 * Throws `parse-failed` rather than returning an empty list whenever the shape
 * says there should have been rows. eBay omits `itemSummaries` entirely for a
 * genuine zero-hit search, so that case is told apart by `total`.
 */
export function parseSearchResponse(raw: unknown, ctx: ParseContext): ParsedSearch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderError(PROVIDER_ID, 'parse-failed', 'eBay lieferte kein Suchergebnis-Objekt.');
  }
  const body = raw as EbaySearchResponse;
  const total = typeof body.total === 'number' ? body.total : null;
  const warnings = body.warnings ?? [];
  const correctedQuery = body.autoCorrections?.q ?? null;
  const rows = body.itemSummaries;

  if (rows === undefined) {
    // eBay leaves `itemSummaries` out when nothing matched. Anything else —
    // a positive total with no rows, or no `total` at all — means the response
    // is not the one this parser was written against.
    if (total === 0) return { listings: [], total, warnings, correctedQuery };
    throw new ProviderError(
      PROVIDER_ID,
      'parse-failed',
      total === null
        ? 'eBay lieferte weder itemSummaries noch total — das Antwortformat hat sich geändert.'
        : `eBay meldet ${total} Treffer, liefert aber keine itemSummaries.`,
    );
  }
  if (!Array.isArray(rows)) {
    throw new ProviderError(PROVIDER_ID, 'parse-failed', 'eBays itemSummaries ist keine Liste.');
  }

  const listings: Listing[] = [];
  for (const row of rows) {
    const listing = mapItemSummary(row, ctx);
    if (listing) listings.push(listing);
  }

  if (rows.length > 0 && listings.length === 0) {
    throw new ProviderError(
      PROVIDER_ID,
      'parse-failed',
      `eBay lieferte ${rows.length} Einträge, von denen keiner itemId und title trägt — das Antwortformat hat sich geändert.`,
    );
  }
  return { listings, total, warnings, correctedQuery };
}

export interface WarningVerdict {
  /** Sentences for `ProviderResult.warnings`. German — the user reads these. */
  readonly messages: readonly string[];
  /** Filters eBay refused. These MUST come out of `applied`. */
  readonly rejected: readonly FilterKey[];
  /** eBay warned about something no sent filter explains. */
  readonly unattributed: boolean;
}

function warningText(w: EbayError): string {
  return [w.message, w.longMessage, ...(w.parameters ?? []).map((p) => `${p.name ?? ''} ${p.value ?? ''}`)]
    .filter(Boolean)
    .join(' ');
}

/**
 * Work out which filters a `warnings[]` entry threw away.
 *
 * Matching is on the eBay filter NAME appearing in the warning text, because
 * that is what eBay actually puts there — 12015 says *"The postal code filter
 * value is invalid … and this filter was ignored"* and names
 * `pickupPostalCode` in `parameters`. Error ids are not enough on their own:
 * 12002 is "some filter value is invalid" for every filter there is.
 *
 * A warning that names nothing we sent sets `unattributed`, and the caller
 * then drops every claim. That is deliberately blunt: an unrecognised warning
 * costs one local filtering pass, while a wrongly-kept claim costs the user a
 * result list that quietly ignores what they asked for.
 */
export function attributeWarnings(warnings: readonly EbayError[], owners: FilterOwners): WarningVerdict {
  const messages: string[] = [];
  const rejected = new Set<FilterKey>();
  let unattributed = false;

  for (const w of warnings) {
    const text = warningText(w);
    if (!text) continue;
    messages.push(w.errorId ? `eBay ${w.errorId}: ${text}` : `eBay: ${text}`);

    const haystack = text.toLowerCase();
    let matched = false;
    for (const [name, keys] of owners) {
      if (!haystack.includes(name.toLowerCase())) continue;
      matched = true;
      for (const k of keys) rejected.add(k);
    }
    if (!matched) unattributed = true;
  }

  return { messages, rejected: [...rejected], unattributed };
}

/** `getItem` gives one full listing — and the GTIN a search result never carries. */
export function parseItemResponse(raw: unknown, ctx: ParseContext): Listing {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderError(PROVIDER_ID, 'parse-failed', 'eBay lieferte kein Artikel-Objekt.');
  }
  const listing = mapItemSummary(raw as EbayItem, ctx);
  if (!listing) {
    throw new ProviderError(
      PROVIDER_ID,
      'parse-failed',
      'eBays Artikel-Antwort trägt weder itemId noch title.',
    );
  }
  return listing;
}
