/**
 * Behördenversteigerungen: zoll-auktion.de and justiz-auktion.de.
 *
 * Two providers out of one package because they are the same *domain* — public
 * bodies auctioning seized, forfeited and surplus goods, always as a live
 * auction, always with an office rather than a person on the other side — and
 * two different websites. Everything about that domain lives in `shared.ts`;
 * the markup, the URL grammar and, as it turns out, what is possible at all
 * differ per host and live in `zoll.ts` and `justiz.ts`.
 *
 * They differ in the last point more than one would expect: Zoll-Auktion puts
 * its whole search form on the query string and is a full-featured adapter,
 * while Justiz-Auktion only searches through a PHP session and therefore
 * refuses to, out loud. See the file header of `justiz.ts` for the measurement.
 */

export {
  buildSearchUrl,
  createZollAuktionProvider,
  parseZollShipping,
  type ZollSearchUrl,
} from './zoll.ts';
export { createJustizAuktionProvider } from './justiz.ts';
export {
  parseZollSearchPage,
  parseZollDetailPage,
  parseJustizDetailPage,
  type ZollSearchPage,
} from './parse.ts';
export {
  absoluteEndFrom,
  absolutize,
  cleanDescription,
  endsAtFrom,
  isoOffsetMinutes,
  parseBidAmount,
  parseBidCount,
  parseRemainingSeconds,
  remainingGranularitySeconds,
  splitGermanLocation,
  type AuktionDeps,
} from './shared.ts';
export type { JustizDetailRaw, ZollCardRaw, ZollDetailRaw } from './types.ts';
