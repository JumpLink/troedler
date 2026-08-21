/**
 * What booklooker's REST API v2.0 actually puts on the wire.
 *
 * Two things about this source shape the whole adapter and neither is
 * negotiable:
 *
 * **Every answer is HTTP 200.** Measured 2026-08-21 against
 * `api.booklooker.de`: a missing key, an unknown token, a wrong HTTP verb, an
 * exhausted quota — all of them come back `200 OK` with
 * `Content-Type: text/html` and a JSON envelope whose `status` is `NOK`. The
 * HTTP layer therefore cannot tell success from failure here; only the
 * envelope can, and that is why `status` is read before anything else.
 *
 * **The success payload is undocumented.** Both the OpenAPI 3.1 spec and the
 * interface page say only "eine selbsterklärende Liste mit den gefundenen
 * Artikeln" and print `returnValue: ""` as the example. The field NAMES that
 * are documented all come from the `extraFields` table, and that table is
 * written in XML element notation (`<AbsentFrom>`, `<PaymentList>`,
 * `<DetailLinkUrl>`) — the same table the legacy XML interface uses. So the
 * record shape below is a set of documented names plus their plausible
 * spellings, resolved case-insensitively, and `parse.ts` refuses to guess:
 * a payload in which nothing carries a deep link is a `parse-failed`, never
 * an empty result. See `docs/quellen/booklooker.de.md` for what is measured
 * and what is inferred.
 */

/** The envelope. Both fields are `unknown` because only `parse.ts` may trust them. */
export interface BooklookerEnvelope {
  readonly status?: unknown;
  readonly returnValue?: unknown;
}

/**
 * The `returnValue` of a failed call, as a closed set.
 *
 * Taken from the OpenAPI `components.responses` block plus the four codes
 * measured live. Codes outside this list are still handled — they land on
 * `remote-error` with their own text — but the ones here get a mapping to a
 * `ProviderErrorKind` that the caller can act on.
 */
export type BooklookerErrorCode =
  | 'API_KEY_MISSING'
  | 'AUTHENTICATION_FAILED'
  | 'TOKEN_MISSING'
  | 'TOKEN_UNKNOWN'
  | 'TOKEN_EXPIRED'
  | 'INVALID_INTERFACE'
  | 'INVALID_REQUEST_METHOD'
  | 'INVALID_PARAMETERS'
  | 'PARAMETER_MISMATCH'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'TEMPORARILY_BLOCKED'
  | 'SERVER_DOWN'
  | 'ENCODING_ERROR';

/** The three codes that mean "the token died of old age", not "you are refused". */
export const TOKEN_CODES: readonly string[] = ['TOKEN_EXPIRED', 'TOKEN_UNKNOWN', 'TOKEN_MISSING'];

/**
 * One offer, flattened out of whichever container it arrived in.
 *
 * Keys are lower-cased element/property names; a repeated name becomes an
 * array. Flattening XML and JSON into the same shape here is what lets
 * `toListing()` exist once instead of twice.
 */
export type BooklookerRecord = Readonly<Record<string, string | readonly string[]>>;

/** The five media types booklooker indexes. `book` is its own default and ours. */
export type BooklookerMedium = 'book' | 'abook' | 'film' | 'music' | 'game';

export const MEDIA: readonly BooklookerMedium[] = ['book', 'abook', 'film', 'music', 'game'];

/** Countries `showShippingPrice` accepts. Anything else is silently ignored by the remote. */
export type ShippingCountry = 'de' | 'at' | 'ch';

export const SHIPPING_COUNTRIES: readonly ShippingCountry[] = ['de', 'at', 'ch'];
