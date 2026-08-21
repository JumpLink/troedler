/**
 * eBay's own shapes, transcribed from the Browse API contract.
 *
 * Source: Browse OAS3 **v1.20.4**, fetched 2026-08-21 from
 * `https://edp.ebay.com/api-docs/buy/browse/openapi/3/buy_browse_v1_oas3.json`
 * (the `developer.ebay.com` mirror answers scripts with a WAF 403).
 * Rate-limit shapes from Developer Analytics OAS `v1_beta.0.1`.
 *
 * Everything is optional. Not laziness: eBay omits a field entirely rather
 * than sending null, and it omits different ones per marketplace, per
 * `fieldgroups` and per listing format. A required field here would be a lie
 * the compiler believes, and `parse.ts` would then read `undefined.value` on a
 * perfectly ordinary auction row.
 *
 * Only the fields troedler actually maps are listed. The contract has ~45 more
 * on `ItemSummary` alone — `watchCount`, `marketingPrice`, `qualifiedPrograms`
 * — and every one of them we transcribe is a field a future reader has to
 * check against the contract.
 */

export interface EbayAmount {
  readonly value?: string;
  readonly currency?: string;
}

export interface EbayImage {
  readonly imageUrl?: string;
}

export interface EbayItemLocation {
  readonly city?: string;
  readonly postalCode?: string;
  readonly stateOrProvince?: string;
  readonly country?: string;
}

export interface EbayShippingOption {
  readonly shippingCost?: EbayAmount;
  /** `FIXED` or `CALCULATED`. A calculated cost is absent until a destination is known. */
  readonly shippingCostType?: string;
}

export interface EbayPickupOption {
  readonly pickupLocationType?: string;
}

/** Distance eBay computed between the item and the pickup postcode we sent. */
export interface EbayTargetLocation {
  readonly value?: string;
  /** `mi` or `km` — eBay answers in whatever `pickupRadiusUnit` asked for. */
  readonly unitOfMeasure?: string;
}

/**
 * The seller block, minus the person.
 *
 * `username`, `userId`, `feedbackScore` and `feedbackPercentage` exist in the
 * contract and are deliberately NOT transcribed. The API licence is explicit —
 * *"You will not under any circumstances collect, store or share any eBay
 * User' User IDs or passwords"* (API License Agreement, section 5) — and a
 * field that is not in the type is a field no one maps by accident.
 */
export interface EbaySeller {
  /** `INDIVIDUAL` or `BUSINESS`. A category, not a person. */
  readonly sellerAccountType?: string;
}

export interface EbayCategory {
  readonly categoryId?: string;
  readonly categoryName?: string;
}

export interface EbayItemSummary {
  readonly itemId?: string;
  readonly legacyItemId?: string;
  readonly title?: string;
  /** Only present with `fieldgroups=EXTENDED`. */
  readonly shortDescription?: string;
  readonly condition?: string;
  readonly conditionId?: string;
  readonly price?: EbayAmount;
  /** Auctions only — the live high bid, which `price` is not. */
  readonly currentBidPrice?: EbayAmount;
  readonly bidCount?: number;
  /** `FIXED_PRICE` | `AUCTION` | `BEST_OFFER` | `CLASSIFIED_AD`. */
  readonly buyingOptions?: readonly string[];
  readonly shippingOptions?: readonly EbayShippingOption[];
  readonly pickupOptions?: readonly EbayPickupOption[];
  readonly distanceFromPickupLocation?: EbayTargetLocation;
  /** `city` only with `fieldgroups=EXTENDED`. */
  readonly itemLocation?: EbayItemLocation;
  readonly seller?: EbaySeller;
  /** When eBay first published this listing. */
  readonly itemCreationDate?: string;
  /** Survives a relist, which is why `itemCreationDate` is the one we map. */
  readonly itemOriginDate?: string;
  readonly itemEndDate?: string;
  readonly image?: EbayImage;
  readonly thumbnailImages?: readonly EbayImage[];
  readonly additionalImages?: readonly EbayImage[];
  readonly categories?: readonly EbayCategory[];
  readonly leafCategoryIds?: readonly string[];
  readonly itemWebUrl?: string;
  /** Only filled when an EPN campaign id is sent. troedler sends none. */
  readonly itemAffiliateWebUrl?: string;
  readonly itemHref?: string;
  readonly listingMarketplaceId?: string;
  readonly epid?: string;
  readonly adultOnly?: boolean;
}

/** `getItem` adds the fields a summary cannot carry — `gtin` above all. */
export interface EbayItem extends EbayItemSummary {
  /** EAN/UPC/ISBN. The single cross-marketplace identity, and search never returns it. */
  readonly gtin?: string;
  readonly mpn?: string;
  readonly brand?: string;
  readonly warnings?: readonly EbayError[];
}

export interface EbayErrorParameter {
  readonly name?: string;
  readonly value?: string;
}

/**
 * eBay's error/warning object.
 *
 * The same shape carries both, and the difference is only where it appears:
 * in a 4xx body it is fatal, inside a 200 `warnings[]` it means "your filter
 * was ignored and you got unfiltered results". That second case is the one
 * that quietly produces wrong answers — see `attributeWarnings`.
 */
export interface EbayError {
  readonly errorId?: number;
  readonly domain?: string;
  readonly category?: string;
  readonly message?: string;
  readonly longMessage?: string;
  readonly parameters?: readonly EbayErrorParameter[];
}

export interface EbaySearchResponse {
  readonly href?: string;
  readonly next?: string;
  readonly prev?: string;
  readonly limit?: number;
  readonly offset?: number;
  /** eBay's own words: *"an indicator … It could vary."* Shown, never calculated with. */
  readonly total?: number;
  readonly itemSummaries?: readonly EbayItemSummary[];
  readonly warnings?: readonly EbayError[];
  readonly autoCorrections?: { readonly q?: string };
}

export interface EbayTokenResponse {
  readonly access_token?: string;
  /** Seconds. 7200 for an application token. */
  readonly expires_in?: number;
  readonly token_type?: string;
  readonly error?: string;
  readonly error_description?: string;
}

export interface EbayRate {
  readonly count?: number;
  readonly limit?: number;
  readonly remaining?: number;
  /** ISO 8601 — when the window rolls over. */
  readonly reset?: string;
  readonly timeWindow?: number;
}

export interface EbayRateResource {
  readonly name?: string;
  readonly rates?: readonly EbayRate[];
}

export interface EbayRateLimit {
  readonly apiContext?: string;
  readonly apiName?: string;
  readonly apiVersion?: string;
  readonly resources?: readonly EbayRateResource[];
}

export interface EbayRateLimitResponse {
  readonly rateLimits?: readonly EbayRateLimit[];
}
