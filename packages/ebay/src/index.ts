/**
 * `@troedler/ebay` — the eBay Browse API adapter (EBAY_DE by default).
 *
 * Official API only. There is no HTML path here and there is no place to add
 * one: eBay publishes an API and licenses it, so scraping the website would be
 * both worse data and a rule broken for nothing.
 *
 * Terms, rate limits, licence obligations and the one blocker that stops a
 * fresh keyset from working: `docs/quellen/ebay.de.md`.
 */

export {
  createEbayProvider,
  DEFAULT_MARKETPLACE_ID,
  LICENCE_MAX_AGE_SECONDS,
  type EbayDeps,
} from './provider.ts';
export {
  CONDITION_IDS,
  countryOfMarketplace,
  MAX_QUERY_CHARS,
  planSearch,
  SELLER_ACCOUNT_TYPE_MARKETPLACES,
  type EbayQueryPlan,
  type FilterOwners,
  type PlanOptions,
} from './filter.ts';
export {
  attributeWarnings,
  mapItemSummary,
  parseItemResponse,
  parseSearchResponse,
  PROVIDER_ID,
  type ParseContext,
  type ParsedSearch,
  type WarningVerdict,
} from './parse.ts';
export { EBAY_API_HOST, EBAY_SANDBOX_HOST, EBAY_SCOPE, EbayClient, type EbayHttp } from './request.ts';
export type * from './types.ts';
