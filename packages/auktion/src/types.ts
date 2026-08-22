/**
 * The raw shapes the two auction sites print, before anything is normalised.
 *
 * They exist so `parse.ts` can stay a pure function of a string: HTML in, these
 * out, no clock, no network, no `Listing`. Everything here is `string | null`
 * on purpose — the page prints text, and the moment a parser starts returning
 * numbers it has silently decided what an unparsable field means.
 */

/** One result card on the Zoll-Auktion search page (`#za-search-result-list article`). */
export interface ZollCardRaw {
  /** The auction id, from the product link's last path segment. */
  readonly id: string;
  /** Site-relative product path, e.g. `/auktion/produkt/1_AMG_E_Bike_U3_Klapprad/971850`. */
  readonly path: string;
  readonly title: string;
  /** Site-relative thumbnail path, `…/t_<id>_<hash>/<file>.jpg`. */
  readonly thumbnailPath: string | null;
  /** Current highest bid, or the start bid while there are none: `"410,00 EUR"`. */
  readonly priceText: string | null;
  /** `"33334 Gütersloh"` — the authority's collection point. */
  readonly locationText: string | null;
  /**
   * `"Nur Abholung möglich!"`, or `null` when the site omits the row.
   *
   * Presence is a fact: the badge is printed exactly for pickup-only lots.
   * Absence is NOT the complement of it — measured 2026-08-22 on `n2=uhr`, the
   * operator's own collection filter returns 1 056 of 1 086 lots, so the source
   * says collection is impossible for 30 of them, and none of those 30 carries
   * a badge. The earlier reading of absence as "ships AND collects" asserted
   * collection for exactly those.
   */
  readonly deliveryText: string | null;
  /** Remaining time as printed: `"1 Tag 14 Std. 40 Min."`, `"noch 55 Sekunden"`. */
  readonly remainingText: string | null;
  /** `"20 Gebote"`, `"1 Gebot"`, `"0 Gebote"`. */
  readonly bidsText: string | null;
}

/** One Zoll-Auktion detail page (`/auktion/produkt/<slug>/<id>`). */
export interface ZollDetailRaw {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly priceText: string | null;
  readonly locationText: string | null;
  readonly remainingText: string | null;
  /** `"So., 23.08.2026 - 09:00 Uhr"` — kept only as the fallback, see `endsAtFrom`. */
  readonly endsAtText: string | null;
  readonly bidsText: string | null;
  /** `"Ja"` / `"Nein"` from the Abholung row. */
  readonly pickupText: string | null;
  /**
   * The Versand row, which does NOT mirror the one above.
   *
   * `"Nein"`, or a destination with the flat rate: `"Deutschland (10,00 EUR)"`.
   * This comment used to claim `Ja`/`Nein` here too — inferred from the row
   * above, never measured, and the adapter's `/ja/i` test matched neither real
   * form. See `parseZollShipping`.
   */
  readonly shippingText: string | null;
  /** Item description only — never the Ansprechpartner block, which names a person. */
  readonly description: string | null;
  /** Site-relative image paths, largest variant first. */
  readonly imagePaths: readonly string[];
  /** `availabilityStarts` out of the schema.org JSON-LD: ISO 8601 *with* offset. */
  readonly startsAtIso: string | null;
  readonly country: string | null;
}

/** One Justiz-Auktion detail page (`/<anything>-<id>`). */
export interface JustizDetailRaw {
  readonly id: string;
  readonly title: string;
  /** `"20,00 €"` — the live bid. */
  readonly currentBidText: string | null;
  readonly startBidText: string | null;
  /** `"24 Tage, 1 Stunde, 31 Minuten"`. */
  readonly remainingText: string | null;
  /** `"14.09.2026 20:00:00"` — fallback only, see `endsAtFrom`. */
  readonly endsAtText: string | null;
  /** `"58097 Hagen"`. */
  readonly locationText: string | null;
  /** `"Selbstabholung"` / `"Versand"`. */
  readonly shippingText: string | null;
  /** `"Zustand: Gebraucht"` — the one source in this package that states a condition. */
  readonly conditionText: string | null;
  readonly description: string | null;
  readonly bidsText: string | null;
  readonly imagePaths: readonly string[];
  /** From the flag image's alt text: `"Deutschland"` or `"Österreich"`. */
  readonly countryText: string | null;
}
