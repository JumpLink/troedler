/**
 * What the source's markup looks like — the selectors and the raw row shape.
 *
 * The selectors live in one exported table rather than sprinkled through
 * `parse.ts` for a reason that has already bitten every scraper in this space:
 * the markup moves, and when it does you want one list to re-measure against a
 * saved page, not a diff across a parser. Each entry records what it was
 * measured against on 2026-08-21 so the next person can tell a stale selector
 * from a wrong one.
 *
 * There is deliberately no selector here for the seller's name, profile link
 * or shop page. They are all present in the markup — `.userprofile-vip` holds
 * a full name, the result list links `/pro/<shop>` — and none of them is
 * something we are entitled to keep. Not selecting them is cheaper than
 * remembering to drop them.
 */

/** Measured against `https://www.kleinanzeigen.de/s-fahrrad/k0`, 2026-08-21, 324 523 bytes. */
export const SRP = {
  /** The result list container. Its PRESENCE is what separates "no hits" from "markup moved". */
  list: '#srchrslt-adtable',
  /** One row. 27 on a full page: 25 regular ads plus 2 top ads. */
  item: 'li.ad-listitem',
  /** The ad inside a row. Rows without one are the site's own ad slots. */
  ad: 'article[data-adid]',
  /** Top ads repeat on EVERY page of a query. Measured: 2 per page, identical across pages 1 and 2. */
  topAdRow: 'is-topad',
  title: '.text-module-begin > a',
  description: '.aditem-main--middle--description',
  /** Exact class: `p[class*="price"]` also matches `--old-price`, the struck-through former price. */
  price: '.aditem-main--middle--price-shipping--price',
  /** Postal code and place. Carries a zero-width space inside the place name. */
  location: '.aditem-main--top--left',
  /** `"Heute, 18:20"`, `"Gestern, 14:29"`, `"26.04.2026"`. EMPTY on top ads. */
  date: '.aditem-main--top--right',
  image: 'img',
  /** Also carries size tags (`"L (40)"`) and `"Direkt kaufen"` — match the text, not the presence. */
  tag: 'span.simpletag',
  /** Present exactly on commercial sellers. Measured: 5 of 27 rows. */
  commercial: '.badge-hint-pro-small-srp',
  /** `"1 - 25 von 921.982 Ergebnissen für „fahrrad“ in Deutschland"`, or the no-hits sentence. */
  summary: '.breadcrump-summary',
  next: 'link[rel="next"]',
} as const;

/** Measured against a live ad page (`vip.html`), 2026-08-21, 287 049 bytes. */
export const VIP = {
  title: '#viewad-title',
  /** `"3.550 € VB"`. There is NO schema.org Product/Offer on this page — only ImageObject. */
  price: '#viewad-price',
  /** `"22083 Hamburg Barmbek - Hamburg Barmbek-Süd"`. */
  locality: '#viewad-locality',
  description: '#viewad-description-text',
  /** `"21.08.2026"`. */
  postedAt: '#viewad-extra-info',
  /** `"Anzeigen-ID 3490401536"`. */
  idBox: '#viewad-ad-id-box',
  /** Attribute list: `Art/Herren`, `Typ/Rennräder`, `Zustand/Sehr Gut`. */
  detail: '#viewad-details li.addetailslist--detail',
  detailValue: '.addetailslist--detail--value',
  /** `"Nur Abholung"` or `"Versand möglich"`. */
  shipping: '.boxedarticle--details--shipping',
  /**
   * Seller CATEGORY, never the seller. Two nodes: `"Privater Nutzer"` and
   * `"Aktiv seit 28.03.2015"`. We read the first for `private`/`commercial`
   * and keep neither string.
   */
  sellerKind: '.userprofile-vip-details',
  /** Full-size images, `?rule=$_59.AUTO`. Measured: 18 on the test ad. */
  image: '#viewad-image',
  /** The site's own marker for an ad that is gone. */
  expired: '#srchrslt-adexpired',
} as const;

/**
 * The sentence the site prints when a query genuinely matched nothing.
 *
 * Measured live against `/s-qxzvwlkjhgfdsayy/k0`: HTTP 200, 111 889 bytes, the
 * result-list container ABSENT, and the summary reading „Es wurden keine
 * Ergebnisse für „qxzvwlkjhgfdsayy“ in Deutschland gefunden." This string is
 * the only thing that distinguishes an honest empty result from markup that
 * moved under us, which is why it is a constant and not an inline literal.
 */
export const NO_RESULTS_MARKER = 'Es wurden keine Ergebnisse';
