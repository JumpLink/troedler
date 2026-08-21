/**
 * Building eBay's `filter=` grammar — pure, and the most test-worthy file here.
 *
 * The grammar is small but unforgiving, and every one of its rules is a way to
 * get an HTTP 200 with the wrong rows in it:
 *
 *   - `price:[a..b]` without `priceCurrency` is error 12012.
 *   - The four pickup filters and `deliveryOptions` are all-or-nothing (12010);
 *     four out of five is a warning and an unfiltered result set.
 *   - `sellerAccountTypes` exists on ten marketplaces, not on all of them, and
 *     sending it to a marketplace that has never heard of it warns (12014)
 *     rather than fails.
 *
 * So this module returns not just the parameters but WHICH `FilterKey` each
 * eBay filter name serves. That map is what lets `parse.ts` take a warning
 * naming `pickupPostalCode` and remove `radius` from `applied`, so the kernel
 * knows it still has to do the work itself.
 *
 * Source for the grammar: Buy API Field Filters reference,
 * `https://edp.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html`,
 * read 2026-08-21.
 */

import type { Condition, SellerType } from '@troedler/core';
import type { FilterKey, SearchQuery } from '@troedler/core';

/** eBay filter name → the query filters it is standing in for. */
export type FilterOwners = ReadonlyMap<string, readonly FilterKey[]>;

export interface EbayQueryPlan {
  /** Query parameters, `filter` already joined with commas. Not yet URL-encoded. */
  readonly search: Record<string, string>;
  /** Filters we ASKED eBay to apply. Its `warnings[]` still get a veto — see parse.ts. */
  readonly claimed: readonly FilterKey[];
  readonly filterOwners: FilterOwners;
  /** Things the user should know about what we did to their query. */
  readonly notes: readonly string[];
  /** Value for `X-EBAY-C-ENDUSERCTX`, or null. */
  readonly endUserCtx: string | null;
}

/**
 * Marketplaces where `sellerAccountTypes` exists.
 *
 * Verbatim from the field-filter reference: AT, BE, CH, DE, ES, FR, GB, IE,
 * IT, PL. Elsewhere the filter is accepted, warned about (12014) and ignored —
 * which is precisely the shape of failure this project treats as the expensive
 * one, so we do not send it at all.
 */
export const SELLER_ACCOUNT_TYPE_MARKETPLACES: readonly string[] = [
  'EBAY_AT',
  'EBAY_BE',
  'EBAY_CH',
  'EBAY_DE',
  'EBAY_ES',
  'EBAY_FR',
  'EBAY_GB',
  'EBAY_IE',
  'EBAY_IT',
  'EBAY_PL',
];

/**
 * The inverse of `conditionFromEbayId()`.
 *
 * Core owns the forward direction and this is the only place that reverses it,
 * so the two can drift — an id added to core's table but not here silently
 * narrows a condition filter. `ebay.test.ts` round-trips every id below
 * through `conditionFromEbayId` to make that drift a failing test rather than
 * a shorter result list.
 *
 * Ids: eBay item condition id values,
 * `https://edp.ebay.com/api-docs/sell/static/metadata/condition-id-values.html`.
 */
export const CONDITION_IDS: Readonly<Record<Condition, readonly string[]>> = {
  new: ['1000'],
  'new-other': ['1500', '1750'],
  'refurb-a': ['2000', '2010'],
  'refurb-b': ['2020'],
  'refurb-c': ['2030', '2500'],
  'used-excellent': ['2750', '2990', '3000'],
  'used-good': ['3010', '4000', '5000'],
  'used-acceptable': ['6000'],
  'for-parts': ['7000'],
  // Not a condition eBay has an id for. Asking for "unknown" cannot be pushed
  // down, and inventing ids for it would silently widen the search.
  unknown: [],
};

const SELLER_ACCOUNT_TYPE: Readonly<Record<SellerType, string | null>> = {
  private: 'INDIVIDUAL',
  commercial: 'BUSINESS',
  unknown: null,
};

const SORT_PARAM: Readonly<Record<string, string | null>> = {
  relevance: null, // Best Match is what you get by omitting `sort`.
  'price-asc': 'price',
  'price-desc': '-price',
  newest: 'newlyListed',
  'ending-soonest': 'endingSoonest',
};

/** eBay caps free text at 100 characters and rejects `*` outright. */
export const MAX_QUERY_CHARS = 100;

/**
 * The two-letter country a marketplace id implies.
 *
 * Needed for `pickupCountry`, which the radius search cannot omit. Derived
 * rather than tabulated, and it returns null instead of guessing for the ids
 * whose suffix is not a country (`EBAY_MOTORS`) — a wrong `pickupCountry` is a
 * radius search around the wrong continent.
 */
export function countryOfMarketplace(marketplaceId: string): string | null {
  const suffix = marketplaceId.slice(marketplaceId.lastIndexOf('_') + 1);
  return /^[A-Z]{2}$/.test(suffix) ? suffix : null;
}

/** eBay wants a plain decimal; the query carries integer minor units. */
function decimal(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** `filter=` values are one comma-joined list; a date must survive it intact. */
function isoInstant(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface PlanOptions {
  readonly marketplaceId: string;
  /** Rows to ask for. eBay's own ceiling is 200. */
  readonly limit: number;
}

/**
 * Turn a `SearchQuery` into an eBay request.
 *
 * Claims a `FilterKey` only where the filter is genuinely equivalent. Two
 * deliberate omissions:
 *
 *   - **`delivery`** is never claimed. eBay has no "ships to me" filter that
 *     matches our meaning, and the pickup filter set below narrows to local
 *     pickup only as a side effect of a radius search. The kernel's own
 *     `delivery` check passes `both`/`unknown` rows, so letting it run costs
 *     no results and keeps `--explain` truthful.
 *   - **`radius` without a postcode** is not attempted at all: eBay's radius
 *     search is `pickupPostalCode`-based and has no other form.
 */
export function planSearch(query: SearchQuery, options: PlanOptions): EbayQueryPlan {
  const filters: string[] = [];
  const owners = new Map<string, readonly FilterKey[]>();
  const claimed: FilterKey[] = [];
  const notes: string[] = [];

  const add = (name: string, expression: string, keys: readonly FilterKey[]): void => {
    filters.push(expression);
    if (keys.length > 0) owners.set(name, keys);
  };

  const search: Record<string, string> = {
    // EXTENDED is not optional for us: `shortDescription` and
    // `itemLocation.city` exist only with it, and a listing without a town is
    // half a listing on a second-hand search.
    fieldgroups: 'EXTENDED',
    limit: String(options.limit),
    offset: '0',
  };

  const text = query.text.trim().replaceAll('*', ' ').replace(/\s+/g, ' ').trim();
  if (text) {
    search.q = text.slice(0, MAX_QUERY_CHARS);
    if (text.length > MAX_QUERY_CHARS) {
      notes.push(`eBay nimmt höchstens ${MAX_QUERY_CHARS} Zeichen Suchtext — der Rest wurde gekürzt.`);
    }
  }
  if (query.gtin) {
    search.gtin = query.gtin;
    claimed.push('gtin');
  }

  const currency = (query.currency ?? 'EUR').toUpperCase();
  const min = query.minPriceMinor;
  const max = query.maxPriceMinor;
  if (min !== undefined || max !== undefined) {
    // eBay's own three spellings, verbatim from the field-filter reference:
    // `price:[10..50]`, `price:[10]` for a floor, `price:[..50]` for a ceiling.
    // The leading dots are the entire difference between "from 50" and "up to
    // 50", and eBay accepts both without complaint.
    const keys: FilterKey[] = [];
    let range: string;
    if (min !== undefined && max !== undefined) {
      range = `[${decimal(min)}..${decimal(max)}]`;
      keys.push('minPrice', 'maxPrice');
    } else if (min !== undefined) {
      range = `[${decimal(min)}]`;
      keys.push('minPrice');
    } else {
      range = `[..${decimal(max ?? 0)}]`;
      keys.push('maxPrice');
    }
    add('price', `price:${range}`, keys);
    // Mandatory companion — without it eBay answers 12012 rather than guessing.
    add('priceCurrency', `priceCurrency:${currency}`, keys);
    claimed.push(...keys);
  }

  const wantedConditions = query.condition ?? [];
  const conditionIds = [...new Set(wantedConditions.flatMap((c) => CONDITION_IDS[c]))];
  // `unknown` has no eBay code, and the kernel's post-filter deliberately KEEPS
  // rows whose condition it cannot read. So a query for "new or unknown" that
  // is pushed down as `conditionIds:{1000}` loses every uncoded row — and
  // claiming `condition` would switch off the very pass that would have kept
  // them. Push the ids down anyway (a narrower fetch is still cheaper) but do
  // NOT claim the filter, so the kernel runs afterwards and the wider half of
  // the request survives.
  const coversEverythingAsked = wantedConditions.length > 0 && !wantedConditions.includes('unknown');
  if (conditionIds.length > 0) {
    add('conditionIds', `conditionIds:{${conditionIds.join('|')}}`, ['condition']);
    if (coversEverythingAsked) {
      claimed.push('condition');
    } else {
      notes.push(
        'eBay kennt keinen Zustandscode für „unbekannt" — der Zustandsfilter wird zusätzlich lokal angewandt.',
      );
    }
  } else if (wantedConditions.length > 0) {
    // Only conditions eBay has no id for at all.
    notes.push('eBay kennt keinen Zustandscode für „unbekannt" — der Zustandsfilter läuft lokal.');
  }

  const accountType = query.sellerType ? SELLER_ACCOUNT_TYPE[query.sellerType] : null;
  if (accountType) {
    if (SELLER_ACCOUNT_TYPE_MARKETPLACES.includes(options.marketplaceId)) {
      add('sellerAccountTypes', `sellerAccountTypes:{${accountType}}`, ['sellerType']);
      claimed.push('sellerType');
    } else {
      notes.push(
        `${options.marketplaceId} unterstützt den Filter „privat/gewerblich" nicht — er läuft lokal.`,
      );
    }
  }

  // The radius search. All five parts or none: four of them is warning 12010
  // and a silently nationwide result set.
  const pickupCountry = countryOfMarketplace(options.marketplaceId);
  const radiusKm = query.radiusKm;
  const postalCode = query.postalCode;
  const wantsRadius = radiusKm !== undefined && postalCode !== undefined && postalCode !== '';
  if (wantsRadius && query.delivery === 'shipping') {
    // eBay's radius search returns local-pickup offers only, so combining it
    // with "must ship" would return nothing and call it a result.
    notes.push(
      'eBays Umkreissuche liefert ausschließlich Abholangebote und passt nicht zu „Versand" — der Umkreis bleibt ungefiltert.',
    );
  } else if (radiusKm !== undefined && postalCode && pickupCountry) {
    const keys: readonly FilterKey[] = ['radius'];
    add('deliveryOptions', 'deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}', keys);
    add('pickupCountry', `pickupCountry:${pickupCountry}`, keys);
    add('pickupPostalCode', `pickupPostalCode:${postalCode}`, keys);
    add('pickupRadius', `pickupRadius:${Math.max(1, Math.round(radiusKm))}`, keys);
    add('pickupRadiusUnit', 'pickupRadiusUnit:km', keys);
    claimed.push('radius');
    notes.push('eBays Umkreissuche zeigt nur Angebote mit Abholung vor Ort.');
  } else if (wantsRadius) {
    notes.push(
      `Aus der Marktplatz-Kennung ${options.marketplaceId} lässt sich kein Land für die Umkreissuche ableiten — der Umkreis bleibt ungefiltert.`,
    );
  }

  if (query.since) {
    const iso = isoInstant(query.since);
    if (iso) {
      add('itemStartDate', `itemStartDate:[${iso}]`, ['since']);
      claimed.push('since');
    } else {
      notes.push(`„${query.since}" ist kein verwertbares Datum — der Zeitfilter läuft lokal.`);
    }
  }

  const sort = query.sort ? SORT_PARAM[query.sort] : null;
  if (sort) {
    search.sort = sort;
    claimed.push('sort');
  }

  if (filters.length > 0) search.filter = filters.join(',');

  // `contextualLocation` is what makes `sort=price` sort by price INCLUDING
  // shipping rather than by the bare item price. Only sent when the user gave
  // a postcode — inventing one would silently reorder their results.
  const endUserCtx = postalCode
    ? `contextualLocation=country%3D${pickupCountry ?? 'DE'}%2Czip%3D${encodeURIComponent(postalCode)}`
    : null;

  return { search, claimed, filterOwners: owners, notes, endUserCtx };
}
