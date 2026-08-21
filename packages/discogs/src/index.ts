/**
 * `@troedler/discogs` — the Discogs adapter.
 *
 * The source that needs no credentials: `api.discogs.com` answers
 * unauthenticated at 25 requests per minute, so this provider is on by default
 * and works out of the box. A `DISCOGS_TOKEN` only raises the ceiling to 60.
 *
 * What it returns is release-level, not offer-level — see `provider.ts` for why
 * that is a property of the API and not a shortcut taken here.
 */

export { DiscogsProvider, type DiscogsDeps } from './provider.ts';
export {
  buildTitle,
  buildDescription,
  extractGtin,
  isValidGtin,
  mapReleases,
  parseSearchResponse,
  plainNotes,
  releaseToRow,
  sellUrl,
  type MappableRow,
  type MappedReleases,
  type ParsedSearch,
} from './parse.ts';
export {
  authHeaders,
  buildReleaseUrl,
  buildSearchUrl,
  buildStatsUrl,
  DISCOGS_HOST,
  MAX_PER_PAGE,
  normalizeCurrency,
  readRateLimit,
  type HeaderBag,
} from './request.ts';
export type {
  DiscogsMarketplaceStats,
  DiscogsRateLimit,
  DiscogsRelease,
  DiscogsSearchResponse,
  DiscogsSearchRow,
} from './types.ts';

import { DiscogsProvider, type DiscogsDeps } from './provider.ts';

/**
 * The factory the app calls. Dependencies injected, never reached for: nothing
 * in this package reads `process.env`, opens a socket, or knows what a config
 * file is.
 */
export function createDiscogsProvider(deps: DiscogsDeps): DiscogsProvider {
  return new DiscogsProvider(deps);
}
