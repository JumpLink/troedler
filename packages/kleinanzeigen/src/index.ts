/**
 * @troedler/kleinanzeigen — the kleinanzeigen.de adapter.
 *
 * Off by default and not switchable from inside this package: the operator's
 * terms of use forbid automated access without their written consent, so
 * enabling it is a decision a person makes after reading
 * `docs/quellen/kleinanzeigen.de.md`. See `provider.ts` for what that costs in
 * capabilities — almost every filter is disallowed by robots.txt and therefore
 * finished by the kernel.
 */

export {
  CATEGORIES,
  CategoryError,
  categoryById,
  resolveCategory,
  type KleinanzeigenCategory,
} from './categories.ts';
export {
  parseDetails,
  parseListingPage,
  parseLocation,
  parseSearchPage,
  parseTotal,
  type ListingParseOptions,
  type ParseOptions,
  type SearchPage,
} from './parse.ts';
export {
  KleinanzeigenProvider,
  TERMS_DOC,
  capabilitiesFor,
  scopeFromEnv,
  type KleinanzeigenDeps,
} from './provider.ts';
export { NO_RESULTS_MARKER, SRP, VIP } from './types.ts';
export {
  ADS_PER_PAGE,
  HOST,
  MAX_PAGE,
  NO_SCOPE,
  ORIGIN,
  UrlError,
  absolute,
  keywordSlug,
  listingIdFrom,
  listingPath,
  listingUrl,
  searchPath,
  searchUrl,
  type KleinanzeigenLocation,
  type KleinanzeigenScope,
} from './url.ts';

import { KleinanzeigenProvider, type KleinanzeigenDeps } from './provider.ts';

/**
 * The factory the app injects.
 *
 * Dependencies come in, nothing is reached for: no `process.env`, no global
 * HTTP client, no clock. That is what lets the whole adapter be driven from a
 * test with a fake fetch and a pinned `now`.
 */
export function createKleinanzeigenProvider(deps: KleinanzeigenDeps): KleinanzeigenProvider {
  return new KleinanzeigenProvider(deps);
}
