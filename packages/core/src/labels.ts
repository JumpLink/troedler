/**
 * Presentation constants — in the kernel, not in a view.
 *
 * The lesson is bauplaner's: a second copy of a label or a colour in a view is
 * how the CLI output and the GUI end up disagreeing about the same offer.
 * Anything both surfaces show is defined once, here.
 */

import { fmtMoney, type Money } from './money.ts';
import type { Condition, Delivery, PriceKind, ProviderId, SellerType } from './listing.ts';

export const CONDITION_LABEL: Record<Condition, string> = {
  new: 'Neu',
  'new-other': 'Neu (sonstige)',
  'refurb-a': 'Refurbished A',
  'refurb-b': 'Refurbished B',
  'refurb-c': 'Refurbished C',
  'used-excellent': 'Gebraucht — sehr gut',
  'used-good': 'Gebraucht — gut',
  'used-acceptable': 'Gebraucht — akzeptabel',
  'for-parts': 'Defekt / Ersatzteil',
  unknown: 'Zustand unbekannt',
};

export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  fixed: 'Festpreis',
  negotiable: 'VB',
  auction: 'Auktion',
  free: 'Zu verschenken',
  from: 'ab',
  unknown: '',
};

/**
 * A price with its kind attached on the side German puts it.
 *
 * "ab" is a preposition and leads; "VB" and "Auktion" trail. Appending all
 * three printed "9,00 € ab", which reads like a typo — on exactly the rows
 * where the marker is the whole point, because a Discogs "ab" price is the
 * cheapest of N copies worldwide and not something you can buy for that.
 */
export function fmtPriceWithKind(price: Money | null | undefined, kind: PriceKind): string {
  const text = fmtMoney(price);
  const label = PRICE_KIND_LABEL[kind];
  if (!label) return text;
  return kind === 'from' ? `${label} ${text}` : `${text} ${label}`;
}

export const SELLER_TYPE_LABEL: Record<SellerType, string> = {
  private: 'privat',
  commercial: 'gewerblich',
  unknown: '',
};

export const DELIVERY_LABEL: Record<Delivery, string> = {
  shipping: 'Versand',
  pickup: 'Abholung',
  both: 'Versand oder Abholung',
  unknown: '',
};

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  ebay: 'eBay',
  kleinanzeigen: 'Kleinanzeigen',
  discogs: 'Discogs',
  booklooker: 'Booklooker',
  'zoll-auktion': 'Zoll-Auktion',
  'justiz-auktion': 'Justiz-Auktion',
  'markt-de': 'markt.de',
  quoka: 'Quoka',
};
