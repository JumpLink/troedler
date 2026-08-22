import { describe, expect, it } from '@gjsify/unit';
import {
  ProviderError,
  conditionFromEbayId,
  type Condition,
  type ProviderErrorKind,
  type SearchQuery,
} from '@troedler/core';
import {
  CONDITION_IDS,
  attributeWarnings,
  createEbayProvider,
  mapItemSummary,
  parseSearchResponse,
  planSearch,
  type EbayHttp,
} from '@troedler/ebay';
import type { FetchOptions } from '@troedler/http';

/**
 * eBay adapter — the filter grammar, the warnings veto, and the mapping.
 *
 * Every case here carries a DISCRIMINATOR: something that would look different
 * if the code under test quietly did nothing. A test that only asserts "a
 * listing came back" passes just as happily against an adapter that ignored
 * the whole query, and this adapter's expensive failure is exactly that —
 * plausible rows that answer a different question than the one asked.
 *
 * The sample response below is HAND-WRITTEN. Real eBay listing JSON is other
 * people's data under a licence that forbids redistributing it, so it never
 * enters this repository; what is reproduced is the SHAPE — the fields, the
 * enums, the omissions — taken from Browse OAS v1.20.4.
 */

// ─── harness ──────────────────────────────────────────────────────────────

interface Recorded {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly form?: Record<string, string>;
}

type Reply = (url: string, headers: Record<string, string>) => unknown;

function harness(replies: { get?: Reply; token?: Reply } = {}): { http: EbayHttp; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const http: EbayHttp = {
    // Derived from the recorded calls, so the fake cannot claim zero for a
    // request it actually made.
    requestsUsed: () => calls.length,
    async getJson<T>(url: string, options: FetchOptions): Promise<T> {
      const headers = { ...options.headers };
      calls.push({ method: 'GET', url, headers });
      return (replies.get ? replies.get(url, headers) : { total: 0 }) as T;
    },
    async postForm<T>(url: string, form: Record<string, string>, options: FetchOptions): Promise<T> {
      const headers = { ...options.headers };
      calls.push({ method: 'POST', url, headers, form });
      return (
        replies.token
          ? replies.token(url, headers)
          : { access_token: 'app-token-1', expires_in: 7200, token_type: 'Application Access Token' }
      ) as T;
    },
  };
  return { http, calls };
}

const CREDS = { EBAY_CLIENT_ID: 'id-1', EBAY_CLIENT_SECRET: 'secret-1' };

function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

function filtersOf(url: string): string[] {
  return (paramsOf(url).get('filter') ?? '').split(',').filter(Boolean);
}

function query(extra: Partial<SearchQuery> = {}): SearchQuery {
  return { text: 'Bandsäge', ...extra };
}

const PLAN_OPTIONS = { marketplaceId: 'EBAY_DE', limit: 25 };

/**
 * Assert a `ProviderError` of a SPECIFIC kind.
 *
 * `expect(...).toThrow(ProviderError)` would not do: @gjsify/unit types the
 * argument as `ErrorConstructor`, which a class with required constructor
 * parameters is not. Checking the kind is the better assertion anyway — the
 * whole point of `ProviderErrorKind` is that "the markup moved" and "the source
 * refused us" must not be the same failure.
 */
function expectThrows(fn: () => unknown, kind: ProviderErrorKind): ProviderError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe(kind);
    return err as ProviderError;
  }
  throw new Error(`erwartet: ProviderError(${kind}) — es wurde nichts geworfen`);
}

async function expectRejects(promise: Promise<unknown>, kind: ProviderErrorKind): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe(kind);
    return err as ProviderError;
  }
  throw new Error(`erwartet: ProviderError(${kind}) — die Zusage wurde erfüllt`);
}

// ─── the hand-written response ────────────────────────────────────────────

const FIXED_PRICE_ROW = {
  itemId: 'v1|256789012345|0',
  legacyItemId: '256789012345',
  title: 'Metabo BAS 318 Bandsäge – gebraucht, funktionsfähig',
  // Carries a phone number and an e-mail on purpose: classified free text does,
  // and eBay's shortDescription is free text too.
  shortDescription: 'Abholung möglich, Rückfragen unter 0176 1234567 oder werkstatt@example.org',
  condition: 'Gebraucht',
  conditionId: '3000',
  price: { value: '289.00', currency: 'EUR' },
  buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
  // Deliberately different from itemCreationDate — a relist keeps the origin
  // date, and mapping the wrong one dates the listing years early.
  itemOriginDate: '2023-01-05T09:00:00.000Z',
  itemCreationDate: '2026-08-19T07:12:44.000Z',
  itemEndDate: '2026-09-18T07:12:44.000Z',
  seller: { username: 'werkzeug_nord', feedbackScore: 812, sellerAccountType: 'INDIVIDUAL' },
  itemLocation: { city: 'Buxtehude', postalCode: '21614', stateOrProvince: 'Niedersachsen', country: 'DE' },
  distanceFromPickupLocation: { value: '12.4', unitOfMeasure: 'km' },
  shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '4.99', currency: 'EUR' } }],
  pickupOptions: [{ pickupLocationType: 'ARRANGED_LOCATION' }],
  image: { imageUrl: 'https://i.ebayimg.example/g/AbC/s-l500.jpg' },
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.example/g/AbC/s-l64.jpg' }],
  itemWebUrl: 'https://www.ebay.de/itm/256789012345',
  listingMarketplaceId: 'EBAY_DE',
};

const AUCTION_ROW = {
  itemId: 'v1|305566778899|0',
  title: 'Alte Bandsäge Werkstatt Konvolut',
  condition: 'Ersatzteil/defekt',
  conditionId: '7000',
  price: { value: '1.00', currency: 'EUR' },
  currentBidPrice: { value: '12.50', currency: 'EUR' },
  bidCount: 7,
  buyingOptions: ['AUCTION'],
  itemCreationDate: '2026-08-16T18:45:00.000Z',
  itemEndDate: '2026-08-23T18:45:00.000Z',
  seller: { username: 'haendler_sued', sellerAccountType: 'BUSINESS' },
  itemWebUrl: 'https://www.ebay.de/itm/305566778899',
};

function searchBody(extra: Record<string, unknown> = {}): unknown {
  return {
    href: 'https://api.ebay.com/…',
    total: 2,
    limit: 25,
    offset: 0,
    itemSummaries: [FIXED_PRICE_ROW, AUCTION_ROW],
    warnings: [],
    ...extra,
  };
}

const CTX = { fetchedAt: '2026-08-21T10:00:00.000Z', descriptionChars: 600 };

export default async () => {
  // ─── filter grammar ─────────────────────────────────────────────────────

  await describe('ebay planSearch(): the filter grammar', async () => {
    await it('always asks for EXTENDED and never invents a filter', () => {
      const plan = planSearch(query(), PLAN_OPTIONS);
      // EXTENDED is what carries shortDescription and itemLocation.city.
      expect(plan.search.fieldgroups).toBe('EXTENDED');
      expect(plan.search.q).toBe('Bandsäge');
      expect(plan.search.limit).toBe('25');
      // Discriminator: an unconstrained query must send NO filter= at all,
      // otherwise "the filter is there" proves nothing in the cases below.
      expect(plan.search.filter).toBeUndefined();
      expect(plan.claimed).toStrictEqual([]);
    });

    await it('pairs a price range with priceCurrency, which eBay requires (12012)', () => {
      const plan = planSearch(query({ minPriceMinor: 1000, maxPriceMinor: 5000 }), PLAN_OPTIONS);
      expect(filtersOf(`https://x/?${new URLSearchParams(plan.search)}`)).toStrictEqual([
        'price:[10.00..50.00]',
        'priceCurrency:EUR',
      ]);
      expect(plan.claimed).toStrictEqual(['minPrice', 'maxPrice']);
    });

    await it('writes an open range for a one-sided price, in eBay two-dot form', () => {
      const min = planSearch(query({ minPriceMinor: 1000 }), PLAN_OPTIONS);
      const max = planSearch(query({ maxPriceMinor: 5000 }), PLAN_OPTIONS);
      expect(min.search.filter).toBe('price:[10.00],priceCurrency:EUR');
      // Discriminator: the leading dots are the whole difference between
      // "from 50" and "up to 50", and eBay accepts both spellings silently.
      expect(max.search.filter).toBe('price:[..50.00],priceCurrency:EUR');
      expect(min.claimed).toStrictEqual(['minPrice']);
      expect(max.claimed).toStrictEqual(['maxPrice']);
    });

    await it('carries the query currency into priceCurrency', () => {
      const plan = planSearch(query({ maxPriceMinor: 5000, currency: 'chf' }), PLAN_OPTIONS);
      expect(plan.search.filter).toContain('priceCurrency:CHF');
    });

    await it('expands conditions to every eBay id they cover, deduped', () => {
      const plan = planSearch(query({ condition: ['used-good', 'for-parts', 'used-good'] }), PLAN_OPTIONS);
      // used-good is three ids on eBay's scale, not one — a single-id filter
      // would silently hide "Very Good" and "Good" listings.
      expect(plan.search.filter).toBe('conditionIds:{3010|4000|5000|7000}');
      expect(plan.claimed).toStrictEqual(['condition']);
    });

    await it('sends no condition filter when only "unknown" was asked for', () => {
      const plan = planSearch(query({ condition: ['unknown'] }), PLAN_OPTIONS);
      expect(plan.search.filter).toBeUndefined();
      expect(plan.claimed).toStrictEqual([]);
      expect(plan.notes.join(' ')).toContain('unbekannt');
    });

    await it('pushes privat/gewerblich down on EBAY_DE and refuses to on EBAY_US', () => {
      const de = planSearch(query({ sellerType: 'private' }), PLAN_OPTIONS);
      expect(de.search.filter).toBe('sellerAccountTypes:{INDIVIDUAL}');
      expect(de.claimed).toStrictEqual(['sellerType']);

      // Discriminator: the same query against a marketplace where the filter
      // does not exist must NOT send it — eBay answers 200 + warning 12014 and
      // hands back everybody's listings.
      const us = planSearch(query({ sellerType: 'private' }), { marketplaceId: 'EBAY_US', limit: 25 });
      expect(us.search.filter).toBeUndefined();
      expect(us.claimed).toStrictEqual([]);
      expect(us.notes.join(' ')).toContain('EBAY_US');
    });

    await it('maps commercial to BUSINESS', () => {
      expect(planSearch(query({ sellerType: 'commercial' }), PLAN_OPTIONS).search.filter).toBe(
        'sellerAccountTypes:{BUSINESS}',
      );
    });

    await it('sends all five pickup filters together or not at all (12010)', () => {
      const plan = planSearch(query({ postalCode: '21614', radiusKm: 25 }), PLAN_OPTIONS);
      expect(filtersOf(`https://x/?${new URLSearchParams(plan.search)}`)).toStrictEqual([
        'deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}',
        'pickupCountry:DE',
        'pickupPostalCode:21614',
        'pickupRadius:25',
        'pickupRadiusUnit:km',
      ]);
      expect(plan.claimed).toStrictEqual(['radius']);
      // The radius search is pickup-only, and the user has to be told.
      expect(plan.notes.join(' ')).toContain('Abholung');
    });

    await it('drops the radius rather than contradict a "must ship" query', () => {
      const plan = planSearch(
        query({ postalCode: '21614', radiusKm: 25, delivery: 'shipping' }),
        PLAN_OPTIONS,
      );
      // Discriminator: same postcode and radius as the case above, opposite
      // outcome. eBay's radius search returns local pickup ONLY, so combining
      // it with "must ship" returns nothing and calls it a result.
      expect(plan.search.filter).toBeUndefined();
      expect(plan.claimed).toStrictEqual([]);
      expect(plan.notes.join(' ')).toContain('Versand');
    });

    await it('needs a postcode for the radius — a radius alone is not pushed down', () => {
      const plan = planSearch(query({ radiusKm: 25 }), PLAN_OPTIONS);
      expect(plan.search.filter).toBeUndefined();
      expect(plan.claimed).toStrictEqual([]);
    });

    await it('refuses the radius when the marketplace id implies no country', () => {
      const plan = planSearch(query({ postalCode: '21614', radiusKm: 25 }), {
        marketplaceId: 'EBAY_MOTORS',
        limit: 25,
      });
      expect(plan.search.filter).toBeUndefined();
      expect(plan.claimed).toStrictEqual([]);
    });

    await it('normalises `since` to a UTC instant inside itemStartDate', () => {
      const plan = planSearch(query({ since: '2026-08-01T00:00:00+02:00' }), PLAN_OPTIONS);
      // Discriminator: the +02:00 offset must be gone, not carried along —
      // eBay reads the value as UTC whatever it says.
      expect(plan.search.filter).toBe('itemStartDate:[2026-07-31T22:00:00.000Z]');
      expect(plan.claimed).toStrictEqual(['since']);
    });

    await it('keeps an unparseable `since` local instead of sending nonsense', () => {
      const plan = planSearch(query({ since: 'letzte Woche' }), PLAN_OPTIONS);
      expect(plan.search.filter).toBeUndefined();
      expect(plan.claimed).toStrictEqual([]);
      expect(plan.notes.join(' ')).toContain('Datum');
    });

    await it('sends gtin as its own parameter, not as a filter', () => {
      const plan = planSearch({ text: '', gtin: '4007123456789' }, PLAN_OPTIONS);
      expect(plan.search.gtin).toBe('4007123456789');
      expect(plan.search.filter).toBeUndefined();
      expect(plan.search.q).toBeUndefined();
      expect(plan.claimed).toStrictEqual(['gtin']);
    });

    await it('translates every sort key, and omits `sort` for relevance', () => {
      const cases: [SearchQuery['sort'], string | undefined][] = [
        ['relevance', undefined],
        ['price-asc', 'price'],
        ['price-desc', '-price'],
        ['newest', 'newlyListed'],
        ['ending-soonest', 'endingSoonest'],
      ];
      for (const [key, expected] of cases) {
        const plan = planSearch(query({ sort: key }), PLAN_OPTIONS);
        expect(plan.search.sort).toBe(expected);
        // Discriminator: relevance is Best Match, which eBay gives you by NOT
        // sending sort — so it must also not be claimed as applied.
        expect(plan.claimed.includes('sort')).toBe(expected !== undefined);
      }
    });

    await it('trims the query to the 100 characters eBay accepts, and says so', () => {
      const long = 'a'.repeat(140);
      const plan = planSearch({ text: long }, PLAN_OPTIONS);
      expect(plan.search.q).toHaveLength(100);
      expect(plan.search.q === long).toBe(false);
      expect(plan.notes.join(' ')).toContain('100');
    });

    await it('drops the wildcard eBay does not support', () => {
      expect(planSearch({ text: 'band*säge' }, PLAN_OPTIONS).search.q).toBe('band säge');
    });

    await it('sets contextualLocation only when the user gave a postcode', () => {
      // Without it `sort=price` sorts by the bare item price rather than
      // price + shipping — and inventing a postcode would silently reorder
      // somebody else's results.
      expect(planSearch(query({ sort: 'price-asc' }), PLAN_OPTIONS).endUserCtx).toBeNull();
      expect(planSearch(query({ postalCode: '21614' }), PLAN_OPTIONS).endUserCtx).toBe(
        'contextualLocation=country%3DDE%2Czip%3D21614',
      );
    });

    await it('combines everything into one comma-joined filter', () => {
      const plan = planSearch(
        query({
          minPriceMinor: 5000,
          maxPriceMinor: 50000,
          condition: ['used-excellent'],
          sellerType: 'private',
          since: '2026-08-01T00:00:00.000Z',
          sort: 'newest',
        }),
        PLAN_OPTIONS,
      );
      expect(plan.search.filter).toBe(
        'price:[50.00..500.00],priceCurrency:EUR,conditionIds:{2750|2990|3000},sellerAccountTypes:{INDIVIDUAL},itemStartDate:[2026-08-01T00:00:00.000Z]',
      );
      expect(plan.claimed).toStrictEqual([
        'minPrice',
        'maxPrice',
        'condition',
        'sellerType',
        'since',
        'sort',
      ]);
    });
  });

  // ─── the condition table, against core ──────────────────────────────────

  await describe('ebay CONDITION_IDS: the inverse of core', async () => {
    await it('round-trips every id back to the condition it was listed under', () => {
      // The mechanism, not the fix: core owns conditionFromEbayId and this
      // table reverses it. An id added there and forgotten here narrows every
      // condition filter silently — this test turns that into a red run.
      let checked = 0;
      for (const [condition, ids] of Object.entries(CONDITION_IDS) as [Condition, readonly string[]][]) {
        for (const id of ids) {
          expect(conditionFromEbayId(id)).toBe(condition);
          checked += 1;
        }
      }
      // Discriminator: an emptied table would pass the loop above vacuously.
      expect(checked).toBe(16);
      expect(CONDITION_IDS.unknown).toStrictEqual([]);
    });
  });

  // ─── warnings → applied ─────────────────────────────────────────────────

  await describe('ebay attributeWarnings(): a filter eBay threw away', async () => {
    const owners = planSearch(
      query({ maxPriceMinor: 5000, sellerType: 'private', postalCode: '21614', radiusKm: 25 }),
      PLAN_OPTIONS,
    ).filterOwners;

    await it('says nothing when eBay warned about nothing', () => {
      const verdict = attributeWarnings([], owners);
      expect(verdict.rejected).toStrictEqual([]);
      expect(verdict.unattributed).toBe(false);
      expect(verdict.messages).toStrictEqual([]);
    });

    await it('removes only the filter a warning names', () => {
      const verdict = attributeWarnings(
        [
          {
            errorId: 12014,
            message: 'The sellerAccountTypes filter is not supported for this marketplace and was ignored.',
          },
        ],
        owners,
      );
      expect(verdict.rejected).toStrictEqual(['sellerType']);
      // Discriminator: the price and radius claims must SURVIVE, or "drops the
      // right one" is indistinguishable from "drops everything".
      expect(verdict.unattributed).toBe(false);
      expect(verdict.messages[0]).toContain('12014');
    });

    await it('reads the filter name out of the warning parameters, not just the text', () => {
      const verdict = attributeWarnings(
        [
          {
            errorId: 12015,
            message: 'The postal code filter value is invalid and this filter was ignored.',
            parameters: [{ name: 'pickupPostalCode', value: 'XXXXX' }],
          },
        ],
        owners,
      );
      // All five pickup filters serve one query filter, so any of them being
      // named must take `radius` out.
      expect(verdict.rejected).toStrictEqual(['radius']);
    });

    await it('drops both price keys when eBay rejects the price filter', () => {
      const both = planSearch(query({ minPriceMinor: 1000, maxPriceMinor: 5000 }), PLAN_OPTIONS);
      const verdict = attributeWarnings(
        [{ errorId: 12002, message: 'The value of price is invalid.' }],
        both.filterOwners,
      );
      expect(verdict.rejected).toStrictEqual(['minPrice', 'maxPrice']);
    });

    await it('flags a warning it cannot attribute', () => {
      const verdict = attributeWarnings([{ errorId: 12500, message: 'Something else entirely.' }], owners);
      expect(verdict.rejected).toStrictEqual([]);
      expect(verdict.unattributed).toBe(true);
    });
  });

  // ─── mapping ────────────────────────────────────────────────────────────

  await describe('ebay mapItemSummary(): one row to one Listing', async () => {
    await it('maps a fixed-price row field by field', () => {
      const l = mapItemSummary(FIXED_PRICE_ROW, CTX);
      if (!l) throw new Error('row did not map');

      expect(l.key).toBe('ebay:v1|256789012345|0');
      expect(l.provider).toBe('ebay');
      expect(l.url).toBe('https://www.ebay.de/itm/256789012345');
      expect(l.price).toStrictEqual({ minor: 28900, currency: 'EUR' });
      expect(l.shippingCost).toStrictEqual({ minor: 499, currency: 'EUR' });
      // Precomputed: a cheap item with expensive postage is not cheap.
      expect(l.totalPrice).toStrictEqual({ minor: 29399, currency: 'EUR' });
      // BEST_OFFER without AUCTION is negotiable, not fixed.
      expect(l.priceKind).toBe('negotiable');
      expect(l.condition).toBe('used-excellent');
      expect(l.conditionRaw).toBe('Gebraucht');
      expect(l.sellerType).toBe('private');
      expect(l.delivery).toBe('both');
      expect(l.location).toStrictEqual({
        postalCode: '21614',
        city: 'Buxtehude',
        country: 'DE',
        distanceKm: 12.4,
      });
      expect(l.images).toStrictEqual([
        'https://i.ebayimg.example/g/AbC/s-l500.jpg',
        'https://i.ebayimg.example/g/AbC/s-l64.jpg',
      ]);
      // Search results never carry a GTIN — only getItem does.
      expect(l.gtin).toBeNull();
      expect(l.fetchedAt).toBe('2026-08-21T10:00:00.000Z');
    });

    await it('dates the listing by itemCreationDate, never itemOriginDate', () => {
      const l = mapItemSummary(FIXED_PRICE_ROW, CTX);
      expect(l?.listedAt).toBe('2026-08-19T07:12:44.000Z');
      // Discriminator: the row carries a 2023 origin date on purpose. A relist
      // keeps it, so mapping it would age this listing by three years and put
      // it last in every "newest first" view.
      expect(l?.listedAt).toBe(new Date(FIXED_PRICE_ROW.itemCreationDate).toISOString());
      expect(l?.listedAt === new Date(FIXED_PRICE_ROW.itemOriginDate).toISOString()).toBe(false);
    });

    await it('reports no end date for a fixed-price listing that has one', () => {
      const l = mapItemSummary(FIXED_PRICE_ROW, CTX);
      // The row DOES carry itemEndDate. For a fixed-price listing eBay rolls
      // it forward on every renewal, so it is a countdown to nothing.
      expect(FIXED_PRICE_ROW.itemEndDate).toBeDefined();
      expect(l?.endsAt).toBeNull();
      expect(l?.bidCount).toBeNull();
    });

    await it('takes the live bid, not the opening price, for an auction', () => {
      const l = mapItemSummary(AUCTION_ROW, CTX);
      // Discriminator: the row has price 1.00 and currentBidPrice 12.50.
      // Mapping `price` would sort a hot auction to the top of a
      // price-ascending search as a one-euro bargain.
      expect(l?.price).toStrictEqual({ minor: 1250, currency: 'EUR' });
      expect(l?.priceKind).toBe('auction');
      expect(l?.bidCount).toBe(7);
      expect(l?.endsAt).toBe('2026-08-23T18:45:00.000Z');
      expect(l?.condition).toBe('for-parts');
      expect(l?.sellerType).toBe('commercial');
      expect(l?.delivery).toBe('unknown');
      // No shipping cost known — null, and therefore no invented total.
      expect(l?.shippingCost).toBeNull();
      expect(l?.totalPrice).toBeNull();
    });

    await it('strips phone numbers and e-mail addresses while parsing', () => {
      const l = mapItemSummary(FIXED_PRICE_ROW, CTX);
      expect(l?.description).toContain('Abholung möglich');
      // Discriminator: the source text contains both, and they are gone from
      // the mapped row — not "cleaned up later", which is how personal data
      // reaches a cache file.
      expect(FIXED_PRICE_ROW.shortDescription).toContain('0176');
      expect(l?.description).not.toContain('0176');
      expect(l?.description).not.toContain('@');
    });

    await it('carries no seller identity anywhere in the mapped row', () => {
      // The licence forbids storing eBay user ids outright. Serialising the
      // whole listing is the check that catches a username smuggled into any
      // field, not only the one we remembered to assert on.
      const serialised = JSON.stringify([
        mapItemSummary(FIXED_PRICE_ROW, CTX),
        mapItemSummary(AUCTION_ROW, CTX),
      ]);
      expect(FIXED_PRICE_ROW.seller.username).toBe('werkzeug_nord');
      expect(serialised).not.toContain('werkzeug_nord');
      expect(serialised).not.toContain('haendler_sued');
      expect(serialised).not.toContain('feedbackScore');
    });

    await it('refuses a row without an id or a title', () => {
      expect(mapItemSummary({ title: 'kein itemId' }, CTX)).toBeNull();
      expect(mapItemSummary({ itemId: 'v1|1|0' }, CTX)).toBeNull();
    });

    await it('leaves priceKind unknown when eBay names no buying option', () => {
      const l = mapItemSummary(
        { itemId: 'v1|9|0', title: 'x', price: { value: '5.00', currency: 'EUR' } },
        CTX,
      );
      // null means "the marketplace does not tell us". Inventing `fixed` from
      // silence is a lie the ranking then acts on.
      expect(l?.priceKind).toBe('unknown');
    });
  });

  // ─── the empty-and-green trap ───────────────────────────────────────────

  await describe('ebay parseSearchResponse(): telling empty from broken', async () => {
    await it('accepts a genuine zero-hit answer', () => {
      // eBay omits itemSummaries entirely when nothing matched.
      const parsed = parseSearchResponse({ total: 0, limit: 25, offset: 0 }, CTX);
      expect(parsed.listings).toStrictEqual([]);
      expect(parsed.total).toBe(0);
    });

    await it('raises parse-failed when eBay claims hits but sends no rows', () => {
      // Discriminator against the case above: same missing itemSummaries,
      // different total — and the difference must be an error, not [].
      const err = expectThrows(() => parseSearchResponse({ total: 1843 }, CTX), 'parse-failed');
      expect(err.message).toContain('1843');
    });

    await it('raises parse-failed when the response carries neither rows nor a total', () => {
      expectThrows(() => parseSearchResponse({ href: 'https://api.ebay.com/…' }, CTX), 'parse-failed');
    });

    await it('raises parse-failed when rows are present but none of them maps', () => {
      // This is the markup-moved shape: the list is there, the fields are not.
      expectThrows(
        () => parseSearchResponse({ total: 2, itemSummaries: [{ id: 'v1|1|0', name: 'renamed' }, {}] }, CTX),
        'parse-failed',
      );
    });

    await it('keeps a page whose rows still map, dropping only the broken one', () => {
      const parsed = parseSearchResponse({ total: 2, itemSummaries: [FIXED_PRICE_ROW, {}] }, CTX);
      expect(parsed.listings).toHaveLength(1);
    });

    await it('refuses a body that is not an object', () => {
      expectThrows(() => parseSearchResponse('<html>Access denied</html>', CTX), 'parse-failed');
      expectThrows(() => parseSearchResponse([FIXED_PRICE_ROW], CTX), 'parse-failed');
    });
  });

  // ─── the provider ───────────────────────────────────────────────────────

  await describe('ebay provider: headers, token cache, applied filters', async () => {
    await it('sends X-EBAY-C-MARKETPLACE-ID, without which eBay answers with US results', async () => {
      const { http, calls } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await provider.search(query());

      const get = calls.find((c) => c.method === 'GET');
      expect(get?.headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_DE');
      expect(get?.headers.Authorization).toBe('Bearer app-token-1');
    });

    await it('takes the marketplace from the environment when one is set', async () => {
      const { http, calls } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({
        http,
        env: { ...CREDS, EBAY_MARKETPLACE_ID: 'EBAY_AT' },
        enabled: true,
      });
      await provider.search(query());
      // Discriminator against the default above: same code path, different
      // header. A hard-coded EBAY_DE would pass one of these two, not both.
      expect(calls.find((c) => c.method === 'GET')?.headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_AT');
    });

    await it('fetches one token for two searches', async () => {
      const { http, calls } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await provider.search(query());
      await provider.search(query({ text: 'Hobelbank' }));

      // The OAuth budget is 1 000/day against 5 000 searches/day: a token per
      // search runs out of the smaller pool first.
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
      expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
      expect(calls[0].form).toStrictEqual({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      });
      // Basic auth over the raw keyset, base64 of "id-1:secret-1".
      expect(calls[0].headers.Authorization).toBe(`Basic ${btoa('id-1:secret-1')}`);
    });

    await it('fetches a second token once the first has expired', async () => {
      const { http, calls } = harness({ get: () => searchBody() });
      let clock = 1_000_000;
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true, now: () => clock });
      await provider.search(query());
      // Discriminator against "fetch once, ever": 7200 s minus the safety
      // margin has to actually be consulted.
      clock += 7200 * 1000;
      await provider.search(query());
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    });

    await it('spends one token on two concurrent searches', async () => {
      const { http, calls } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await Promise.all([provider.search(query()), provider.search(query({ text: 'Hobelbank' }))]);
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });

    await it('reports the filters it pushed down, and counts its requests', async () => {
      const { http } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      const result = await provider.search(query({ maxPriceMinor: 50000, sellerType: 'private' }));

      expect(result.applied).toStrictEqual(['maxPrice', 'sellerType']);
      expect(result.listings).toHaveLength(2);
      expect(result.totalEstimate).toBe(2);
      expect(result.truncated).toBe(false);
      // Token + search on the first call.
      expect(result.requests).toBe(2);
    });

    await it('does not count the cached token against the next search', async () => {
      const { http } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await provider.search(query());
      expect((await provider.search(query())).requests).toBe(1);
    });

    await it('marks the result truncated when eBay says there are more', async () => {
      const { http } = harness({ get: () => searchBody({ total: 1843 }) });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      const result = await provider.search(query());
      expect(result.truncated).toBe(true);
      expect(result.totalEstimate).toBe(1843);
    });

    await it('takes a rejected filter OUT of applied so the kernel redoes it', async () => {
      const { http } = harness({
        get: () =>
          searchBody({
            warnings: [
              {
                errorId: 12014,
                message:
                  'The sellerAccountTypes filter is not supported for this marketplace and was ignored.',
              },
            ],
          }),
      });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      const result = await provider.search(query({ maxPriceMinor: 50000, sellerType: 'private' }));

      // The rows came back UNFILTERED by seller type. Leaving sellerType in
      // `applied` makes the kernel skip its own pass, and the user is shown
      // commercial listings under a "private only" search.
      expect(result.applied).toStrictEqual(['maxPrice']);
      expect(result.warnings.join(' ')).toContain('12014');
    });

    await it('drops every claim when a warning names nothing we sent', async () => {
      const { http } = harness({
        get: () => searchBody({ warnings: [{ errorId: 12500, message: 'Unmapped complaint.' }] }),
      });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      const result = await provider.search(query({ maxPriceMinor: 50000, sellerType: 'private' }));
      // Blunt on purpose: one extra local pass is cheap, a silently ignored
      // filter is not.
      expect(result.applied).toStrictEqual([]);
      expect(result.warnings.join(' ')).toContain('vorsichtshalber');
    });

    await it('surfaces an autocorrected query as a warning', async () => {
      const { http } = harness({ get: () => searchBody({ autoCorrections: { q: 'Bandsäge' } }) });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      expect((await provider.search(query({ text: 'Bandsage' }))).warnings.join(' ')).toContain('korrigiert');
    });

    await it('refuses an empty query locally instead of spending a call on 12001', async () => {
      const { http, calls } = harness();
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await expectRejects(provider.search({ text: '   ' }), 'remote-error');
      // Discriminator: nothing left the process.
      expect(calls).toHaveLength(0);
    });
  });

  // ─── status: three states ───────────────────────────────────────────────

  await describe('ebay status(): three states, never two', async () => {
    await it('is not configured without credentials, and asks for nothing', async () => {
      const { http, calls } = harness();
      const status = await createEbayProvider({ http, env: {}, enabled: true }).status();
      expect(status.configured).toBe(false);
      expect(status.problem?.kind).toBe('not-configured');
      expect(status.problem?.message).toContain('EBAY_CLIENT_ID');
      expect(calls).toHaveLength(0);
    });

    await it('is configured and healthy when eBay issues a token', async () => {
      const { http, calls } = harness();
      const status = await createEbayProvider({ http, env: { ...CREDS }, enabled: true }).status();
      expect(status.configured).toBe(true);
      expect(status.problem).toBeNull();
      expect(calls).toHaveLength(1);
    });

    await it('is configured WITH a problem when the token is refused', async () => {
      const { http } = harness({
        token: () => {
          throw new ProviderError('ebay', 'refused', 'api.ebay.com verweigert den Zugriff (HTTP 401).');
        },
      });
      const status = await createEbayProvider({ http, env: { ...CREDS }, enabled: true }).status();
      // Discriminator against the not-configured case: credentials ARE set, so
      // "configured" stays true and the user is told to check the keyset —
      // collapsing these two into one boolean is how "nothing found" and
      // "never asked" become the same answer.
      expect(status.configured).toBe(true);
      expect(status.problem?.kind).toBe('refused');
      expect(status.problem?.message).toContain('Account-Deletion');
    });

    await it('reuses the token status() fetched, so a run costs one', async () => {
      const { http, calls } = harness({ get: () => searchBody() });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await provider.status();
      await provider.search(query());
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });

    await it('reports a disabled provider as blocked by policy', async () => {
      const { http } = harness();
      const status = await createEbayProvider({ http, env: { ...CREDS }, enabled: false }).status();
      expect(status.configured).toBe(false);
      expect(status.problem?.kind).toBe('blocked-by-policy');
    });
  });

  // ─── capabilities, getListing, quota ────────────────────────────────────

  await describe('ebay capabilities and the extra methods', async () => {
    await it('declares the licence obligations as data', () => {
      const { http } = harness();
      const caps = createEbayProvider({ http, env: {}, enabled: true }).capabilities;
      // Contractual, not a tuning knob: the API licence caps displayed listing
      // data at six hours.
      expect(caps.cache.ttlSeconds).toBe(6 * 3600);
      expect(caps.access).toBe('official-api');
      expect(caps.enabledByDefault).toBe(true);
      expect(caps.host).toBe('api.ebay.com');
      expect(caps.termsDoc).toBe('docs/quellen/ebay.de.md');
      expect(caps.disclaimer).toContain('getrennt');
      // `delivery` is not pushed down — declaring it would promise something
      // no request delivers.
      expect(caps.serverFilters).not.toContain('delivery');
      expect(caps.serverFilters).toContain('sellerType');
    });

    await it('answers null for an item that is gone', async () => {
      const { http } = harness({
        get: () => {
          throw new ProviderError('ebay', 'remote-error', 'api.ebay.com antwortete mit HTTP 404.');
        },
      });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      expect(await provider.getListing?.('v1|1|0')).toBeNull();
    });

    await it('does not turn a broken API into "the item is gone"', async () => {
      const { http } = harness({
        get: () => {
          throw new ProviderError('ebay', 'remote-error', 'api.ebay.com antwortete mit HTTP 500.');
        },
      });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      await expectRejects(provider.getListing?.('v1|1|0') as Promise<unknown>, 'remote-error');
    });

    await it('keeps the pipes in an item id encoded', async () => {
      const { http, calls } = harness({ get: () => ({ ...FIXED_PRICE_ROW, gtin: '4007123456789' }) });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      const listing = await provider.getListing?.('v1|256789012345|0');
      expect(calls.find((c) => c.method === 'GET')?.url).toContain('v1%7C256789012345%7C0');
      // getItem is the only place a GTIN ever appears.
      expect(listing?.gtin).toBe('4007123456789');
    });

    await it('accepts only the two hosts eBay itself serves as EBAY_API_HOST', async () => {
      for (const [configured, expected] of [
        ['api.sandbox.ebay.com', 'https://api.sandbox.ebay.com/'],
        ['evil.example.org', 'https://api.ebay.com/'],
        ['', 'https://api.ebay.com/'],
      ]) {
        const { http, calls } = harness({ get: () => searchBody() });
        await createEbayProvider({
          http,
          env: { ...CREDS, EBAY_API_HOST: configured },
          enabled: true,
        }).search(query());
        // apiHost: true switches the robots gate off on the strength of eBay's
        // licence, so a free-form host would post a keyset somewhere
        // unlicensed with that gate disabled.
        expect(calls[0].url.startsWith(expected)).toBe(true);
        expect(calls[1].url.startsWith(expected)).toBe(true);
      }
    });

    await it('reads the Browse budget and ignores the separate getItems pool', async () => {
      const { http, calls } = harness({
        get: (url) =>
          url.includes('rate_limit')
            ? {
                rateLimits: [
                  {
                    apiName: 'browse',
                    apiContext: 'buy',
                    resources: [
                      { name: 'buy.browse.getItems', rates: [{ limit: 5000, remaining: 5000, reset: 'x' }] },
                      {
                        name: 'buy.browse',
                        rates: [{ limit: 5000, remaining: 4873, reset: '2026-08-22T00:00:00.000Z' }],
                      },
                    ],
                  },
                ],
              }
            : searchBody(),
      });
      const provider = createEbayProvider({ http, env: { ...CREDS }, enabled: true });
      const quota = await provider.quota?.();
      // Discriminator: the getItems pool is listed FIRST and has a different
      // remaining count, so picking it would be visible here.
      expect(quota).toStrictEqual({ remaining: 4873, limit: 5000, resetAt: '2026-08-22T00:00:00.000Z' });
      expect(calls.find((c) => c.url.includes('rate_limit'))?.url).toContain('api_name=browse');
    });
  });
};
