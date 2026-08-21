/**
 * @troedler/markt — the markt.de and Quoka adapters.
 *
 * Two providers out of one package because they are the same *kind* of source:
 * German classified-ad portals, plain server-rendered HTML, no API on either
 * side, and the same handful of fields per ad. Their markup has nothing in
 * common — `shared.ts` holds the domain, `marktde.ts` and `quoka.ts` hold the
 * two sites — but keeping them together is what makes the difference between
 * them visible, and the difference is the point of this package:
 *
 *   **markt.de: robots.txt open, terms closed → off by default.**
 *   **Quoka: robots.txt open, terms silent on crawling → on by default.**
 *
 * Both name `ClaudeBot` in robots.txt with an explicit `Allow`. Neither
 * permission is ours: troedler sends its own name, matches the `*` group, and
 * abides by that. See each provider file for the measurements.
 */

export {
  MARKT_HOST,
  MARKT_ORIGIN,
  MARKT_RADIUS_STEPS,
  MARKT_ROWS_PER_PAGE,
  MARKT_TERMS_DOC,
  buildMarktSearchUrl,
  createMarktDeProvider,
  marktCapabilities,
  marktKeywordPath,
  marktRadiusStep,
  marktScopeFromEnv,
  type MarktScope,
  type MarktUrl,
} from './marktde.ts';

export {
  QUOKA_HOST,
  QUOKA_ORIGIN,
  QUOKA_ROWS_PER_PAGE,
  QUOKA_TERMS_DOC,
  buildQuokaSearchUrl,
  createQuokaProvider,
  quokaCapabilities,
  quokaCategoryFromEnv,
  type QuokaUrl,
} from './quoka.ts';

export {
  parseMarktSearchPage,
  parseQuokaResultCount,
  parseQuokaSearchPage,
  quokaIdFromUrl,
  quokaPlace,
  type MarktSearchPage,
  type ParseOptions,
  type QuokaParseOptions,
  type SearchPage,
} from './parse.ts';

export {
  MarktUrlError,
  cleanDescription,
  germanizeAmount,
  parseGermanCount,
  parseMarktDate,
  parseMarktPrice,
  parseQuokaDate,
  parseQuokaPrice,
  splitPostalPlace,
  type MarktDeps,
} from './shared.ts';

export {
  MARKT_SRP,
  QUOKA_NO_RESULTS,
  QUOKA_SRP,
  MARKT_NO_RESULTS,
  type MarktRawAd,
  type QuokaRawAd,
} from './types.ts';
