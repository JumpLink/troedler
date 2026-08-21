/**
 * `@troedler/booklooker` — the booklooker.de REST API v2.0 adapter.
 *
 * The factory is the only thing `app/` needs; everything else is exported for
 * the tests, which is where the interesting behaviour of this source lives.
 */

export { createBooklookerProvider, type BooklookerDeps } from './provider.ts';
export {
  API_BASE,
  API_HOST,
  BOOKLOOKER_RESULTS,
  BooklookerSession,
  TOKEN_IDLE_MS,
  buildSearchParams,
  type BooklookerConfig,
  type BooklookerHttp,
  type SearchPlan,
} from './request.ts';
export {
  errorFor,
  parseApiPrice,
  parseSearchResponse,
  readToken,
  recordsFrom,
  toGtin13,
  unwrap,
  type ParseContext,
  type ParsedSearch,
} from './parse.ts';
export {
  MEDIA,
  SHIPPING_COUNTRIES,
  type BooklookerEnvelope,
  type BooklookerErrorCode,
  type BooklookerMedium,
  type BooklookerRecord,
  type ShippingCountry,
} from './types.ts';
