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

/**
 * Measured against `https://www.kleinanzeigen.de/s-e-bike/k0`, 2026-10-12.
 *
 * The result list was rebuilt on utility classes (Tailwind-style) between
 * 2026-08-21 and 2026-10-12: every semantic class the first measurement relied
 * on (`ad-listitem`, `aditem-*`, `text-module-begin`, `is-topad`,
 * `breadcrump-summary`, `link[rel=next]`) is gone, the DOM order is the same.
 * What survived are ids, `data-*` attributes, tag structure and the icon
 * `data-title`s — so the selectors below hang on those, never on a utility
 * class a redesign renames next week. Two exceptions are marked.
 */
export const SRP = {
  /** The result list container. Its PRESENCE is what separates "no hits" from "markup moved". */
  list: '#srchrslt-adtable',
  /** One row. 27 on a full page: 25 regular ads, 2 top ads. The site's own ad slots are rows without an `article`. */
  item: '#srchrslt-adtable > li',
  /** The ad inside a row. */
  ad: 'article[data-adid]',
  /**
   * Top ads repeat on EVERY page of a query (measured: 2 per page). Their row
   * has a direct `svg` child — the purple "Top" badge — which no regular row
   * has. Tested against the `li`, so it is a selector for the row's own child.
   */
  topAdBadge: ':scope > svg',
  title: 'h3 > a',
  description: 'h3 + p',
  /**
   * Utility class, exception 1. The struck-through former price is a sibling
   * `p.line-through`; only the current price carries `text-secondary`.
   */
  price: 'p.text-secondary',
  /** Postal code and place, next to the pin icon. Carries a zero-width space inside the place name. */
  location: 'svg[data-title="locationOutline"] + span',
  /** `"Heute, 18:20"`, `"Gestern, 14:29"`, `"26.04.2026"`. ABSENT on top ads. */
  date: 'svg[data-title="calendarOutline"] + span',
  image: 'img',
  /**
   * Utility class, exception 2: the shipping line is `p.flex` holding the
   * tags. The text is matched, not the presence ("Versand möglich", size tags).
   */
  tag: 'p.flex > span',
  /** Present exactly on commercial sellers; the link is the shop page, which is never read. */
  commercial: 'a[href^="/pro/"]',
  /** `"1 - 25 von 99.200 Ergebnissen für „e bike“ in Deutschland"`, or the no-hits sentence. */
  summary: '#srp-breadcrumb-summary',
  /** The arrow after the page numbers. Absent on the last page; pages ≥ 6 are `span`s, not links. */
  next: '#pagination-container a[aria-label="Nächste"]',
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
