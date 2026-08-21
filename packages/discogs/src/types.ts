/**
 * The raw shapes `api.discogs.com` returns — written from responses measured on
 * 2026-08-21, not from the documentation.
 *
 * Every field is optional and widely typed on purpose. These describe a remote
 * that can change without telling us, so the types say "this is what we saw",
 * and `parse.ts` is the place that decides whether what arrived is usable. A
 * confident non-optional type here would only move the failure from a checked
 * branch to an unchecked property access.
 */

/** The envelope every paginated Discogs collection carries. */
export interface DiscogsPagination {
  readonly page?: number;
  readonly pages?: number;
  readonly per_page?: number;
  /** Total matches. An exact count, unlike eBay's estimate — but still only shown, never used for arithmetic. */
  readonly items?: number;
}

/**
 * One row of `GET /database/search?type=release`.
 *
 * Note what is NOT here: a price. The public search endpoint returns catalogue
 * metadata only, which is the single fact that shapes this whole adapter.
 */
export interface DiscogsSearchRow {
  readonly id?: number;
  /** Already `"Artist - Release"`. Discogs joins it server-side. */
  readonly title?: string;
  /** Path on the website, e.g. `/release/125204-Kraftwerk-Kraftwerk`. */
  readonly uri?: string;
  readonly year?: string;
  /** Country of MANUFACTURE, never the seller's — see the comment in parse.ts. */
  readonly country?: string;
  readonly format?: readonly string[];
  readonly label?: readonly string[];
  readonly genre?: readonly string[];
  readonly style?: readonly string[];
  readonly catno?: string;
  /**
   * A mixed bag: real EAN/UPC codes, label codes (`LC00162`), rights societies
   * (`BIEM/GEMA`) and matrix/runout inscriptions all share this array. Measured
   * on release 4570366, which lists ten entries of which two are the barcode.
   */
  readonly barcode?: readonly string[];
  /** Empty strings without a token — measured across two searches, six rows. */
  readonly cover_image?: string;
  readonly thumb?: string;
}

export interface DiscogsSearchResponse {
  readonly pagination?: DiscogsPagination;
  readonly results?: readonly DiscogsSearchRow[];
}

/**
 * `GET /marketplace/stats/{release_id}?curr_abbr=EUR` — the only public window
 * onto the Discogs Marketplace, and an aggregate rather than an offer.
 */
export interface DiscogsMarketplaceStats {
  readonly num_for_sale?: number;
  /** Honours `curr_abbr` and names its own currency. `null` when nothing is for sale. */
  readonly lowest_price?: { readonly value?: number; readonly currency?: string } | null;
  /** Discogs forbids selling this release (bootlegs, takedowns). Then `num_for_sale` is 0. */
  readonly blocked_from_sale?: boolean;
}

/** Discogs' error payloads, which arrive with a 4xx status. */
export interface DiscogsError {
  readonly message?: string;
}

/** What `X-Discogs-Ratelimit*` said on the last response we got. */
export interface DiscogsRateLimit {
  /** Requests allowed in the moving 60-second window: 25 unauthenticated, 60 with a token. */
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly used: number | null;
}

/**
 * `GET /releases/{id}` — the catalogue entry in full.
 *
 * Used only for detail, and with one field held at arm's length: this endpoint
 * also carries `lowest_price`, as a bare number that IGNORES `curr_abbr` and
 * comes back in USD. It is not modelled here at all, so nothing can read it by
 * accident. See the header of `parse.ts` for the measurement.
 *
 * Unlike the search rows, images ARE populated here without a token — measured
 * on release 125204: eleven `images` entries and a `thumb`.
 */
export interface DiscogsRelease {
  readonly id?: number;
  /** The release title alone; the artist is separate, unlike in search rows. */
  readonly title?: string;
  readonly artists_sort?: string;
  readonly artists?: readonly { readonly name?: string }[];
  readonly year?: number;
  readonly country?: string;
  readonly notes?: string;
  readonly genres?: readonly string[];
  readonly styles?: readonly string[];
  readonly labels?: readonly { readonly name?: string; readonly catno?: string }[];
  readonly formats?: readonly {
    readonly name?: string;
    readonly descriptions?: readonly string[];
  }[];
  /** Typed identifiers — `type: "Barcode"` is the real one, next to Matrix / Runout and Rights Society. */
  readonly identifiers?: readonly { readonly type?: string; readonly value?: string }[];
  readonly images?: readonly { readonly type?: string; readonly uri?: string }[];
  readonly thumb?: string;
}
