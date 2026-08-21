/**
 * What the two portals' markup looks like — selectors in one table per source.
 *
 * They are collected here rather than sprinkled through `parse.ts` for the
 * reason every scraper in this field learns twice: the markup moves, and when
 * it does you want one list to re-measure against a saved page instead of a
 * diff across a parser. Each entry says what it was measured against on
 * 2026-08-21 and how many nodes it hit, so the next reader can tell a stale
 * selector from a wrong one.
 *
 * Two selectors are deliberately ABSENT, and their absence is load-bearing:
 *
 *   - markt.de prints the seller's profile picture (`.clsy-c-user__profile-image`)
 *     and a membership title (`Basis Mitglied`). The picture URL is read once,
 *     classified into private/commercial, and thrown away — it is never stored,
 *     because a profile image URL identifies a person as surely as a name does.
 *   - Quoka carries `data-phencrypted` on every row: the seller's telephone
 *     number, obfuscated. There is no selector for it here and there will not
 *     be one. § "Nutzungsrecht" of the Quoka terms and the GDPR agree for once.
 */

/** Measured against `https://www.markt.de/suche/fahrrad/`, 2026-08-21, 155 703 bytes, 20 rows. */
export const MARKT_SRP = {
  /**
   * The results list — as a DIRECT child of the results block, and that is the
   * whole trap on this source.
   *
   * A query that matches nothing still answers HTTP 200 with twenty perfectly
   * formed `li.clsy-c-result-list-item` nodes: measured on
   * `/suche/qqzzxxwwvv123/` — "0 Treffer", "Leider wurden keine Anzeigen
   * gefunden", and twenty unrelated ads underneath. Those live in
   * `div.clsy-more-results > section.clsy-more-results__alternative-results`,
   * one level deeper. The `>` combinators are what keeps them out; a plain
   * `.clsy-c-result-list-item` returns 20 rows for a search that found none.
   */
  list: '.clsy-c-search__blocks-results > ul.clsy-c-result-list',
  item: '.clsy-c-search__blocks-results > ul.clsy-c-result-list > li.clsy-c-result-list-item',
  /** `"Suchen (9.933 Treffer)"` — the EXACT count, on every page. */
  submitCount: '.clsy-c-search-menu__submit',
  /** `"115 Treffer"` when small, `"über 1.000 Treffer"` above a thousand. Fallback only. */
  topCount: '.clsy-c-search__top-info-resultcount',
  /** Present on a normal ad; ABSENT on a Partner-Anzeige, whose title is a POST button. */
  link: 'a.clsy-c-result-list-item__link',
  description: '.clsy-c-result-list-item__description',
  /** `"2.600 €"`, `"2.040,00 €"`, or empty for a giveaway. */
  priceAmount: '.clsy-c-result-list-item__price-amount',
  /** `"Festpreis"`, `"VB"`, `"Zu verschenken"`, `"Nettokaltmiete"`. */
  priceLabel: '.clsy-c-result-list-item__price-label',
  /** `"30966 Hemmingen (Niedersachsen)"`, plus a `<span>12 km</span>` when a radius was set. */
  location: '.clsy-c-result-list-item__location',
  locationDistance: '.clsy-c-result-list-item__location span',
  /** `"Heute, 16:51"`, `"Heute, vor 3 Min."`, `"Gestern, 23:03"`, `"15.08.2026"`. */
  date: '.clsy-c-result-list-item__date',
  image: 'img.clsy-c-result-list-item__thumbnail-img',
  /** `"Partner-Anzeige"` — affiliate inventory. Measured: 8 of 20 rows on `/elektronik-technik/suche/iphone/`. */
  partner: '.clsy-c-result-list-item__partner',
  /** Read for the private/commercial classification, then discarded. */
  sellerImage: '.clsy-c-user__profile-image',
  next: 'link[rel="next"]',
} as const;

/** Measured against `https://www.quoka.de/anzeigen/?q=fahrrad`, 2026-08-21, 336 873 bytes, 20 rows. */
export const QUOKA_SRP = {
  // No `list` entry on purpose: `item` below carries `.article-list` itself, so
  // a second copy here would be a selector nothing reads. In a table whose
  // whole purpose is "these are the measured selectors", a dead one is a trap
  // for whoever fixes the markup next and believes they are done.
  /**
   * One row — and the empty-`data-articleid` exclusion is the discriminator.
   *
   * Measured on `/anzeigen/?q=fahrrad&Zip=30966&Area=25`, which the site
   * answers with "Für die angegebenen Suchkriterien wurden keine Ergebnisse
   * gefunden" AND six recommendation ads inside the same `.article-list`.
   * Those six carry `data-articleid=""`; real hits carry a GUID.
   */
  item: '.article-list .article-item[data-articleid]:not([data-articleid=""])',
  title: 'h2.article-title a',
  description: 'p.article-description',
  /** `"60 EUR"`, `"2 099 EUR"`, `"29.0 EUR"`, `"8,5 EUR"`, `"zu verschenken"`. */
  price: '.article-price',
  /** A reduced price puts the current one here and the struck-through one in `.old-price`. */
  newPrice: '.article-price .new-price',
  /** `"73728 Esslingen, Baden-Württemberg"`, `"10115 Berlin - Kreuzberg"`. */
  location: 'p.article-location span',
  /** `"heute 17:52"`, `"gestern 22:35"`, `"21 Juli"`. */
  date: 'p.article-date span',
  image: '.art-img img',
  /** Both pagination arrows. On page 1 only "next" is a link; from page 2 the LAST one is. */
  next: 'ul.pagination li.arrow a',
} as const;

/**
 * The sentence Quoka prints when a query genuinely matched nothing.
 *
 * Kept as a constant because it, and the `resultscount` variable next to it,
 * are the only things separating an honest zero from markup that moved.
 */
export const QUOKA_NO_RESULTS = 'wurden keine Ergebnisse gefunden';

/** markt.de prints its own hit count into an inline script-free button label. */
export const MARKT_NO_RESULTS = 'Leider wurden keine Anzeigen gefunden';

/** One parsed markt.de row, before it becomes a `Listing`. */
export interface MarktRawAd {
  readonly id: string;
  /** Absolute, tracking parameters already stripped. */
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly priceAmountText: string;
  readonly priceLabelText: string;
  readonly locationText: string;
  readonly distanceText: string;
  readonly dateText: string;
  readonly imageUrls: readonly string[];
  /** Affiliate inventory rather than a user's classified ad. */
  readonly partnerAd: boolean;
  /** From the profile image only — `null` when the row shows none. */
  readonly commercial: boolean | null;
}

/** One parsed Quoka row. */
export interface QuokaRawAd {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly priceText: string;
  readonly locationText: string;
  readonly dateText: string;
  readonly imageUrls: readonly string[];
}
