/**
 * Every offer from every source, in one wrapping grid.
 *
 * This is the layout somebody means by „like a shop", and it buys its legibility
 * with something real, which is why the setting exists rather than a decision
 * made once here: a single sorted grid pools numbers that are not the same KIND
 * of number. An auction's current bid, a dealer's asking price and „cheapest of
 * 191 copies worldwide" all render as a euro amount, and sorted together the
 * cheapest tile is regularly an auction with four days left. So:
 *
 *  - the card's price line keeps the presenter's own wording, which names the
 *    kind („Auktion", „Festpreis") rather than leaving a bare number;
 *  - every card carries its source badge, because in a mixed grid that badge is
 *    the only thing left of „40 € here, 120 € there";
 *  - the price BAND is not shown over the grid at all. One band across sources
 *    would be exactly the false average the README refuses; the bands live in
 *    the sections layout, one per source, where they mean something.
 *
 * Cards are inserted in sorted position rather than the grid being rebuilt as
 * each source answers. Rebuilding would be simpler and would also blank and
 * re-lay every tile four times while somebody is already reading the first
 * source's results.
 */

import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import type { Listing, PriceVerdict } from '@troedler/core';

import type { Context } from '../../../core/context.ts';
import { OfferCard } from './offer-card.ts';

export interface GridOptions {
  /** A badge per card. Redundant inside a source's own block, essential in the mixed grid. */
  readonly showSource: boolean;
  /** Cheapest first across sources, or the order the source gave them in. */
  readonly sorted: boolean;
}

/** What the grid sorts on: the number the card shows, unknown prices last. */
function sortKey(listing: Listing): number {
  return listing.totalPrice?.minor ?? listing.price?.minor ?? Number.POSITIVE_INFINITY;
}

export class OfferGrid extends Gtk.FlowBox {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerOfferGrid' }, this);
  }

  private readonly context: Context;
  private readonly options: GridOptions;
  /** Sort keys in the order the children sit, so an insert finds its slot. */
  private readonly keys: number[] = [];

  constructor(context: Context, options: GridOptions) {
    super({
      cssClasses: ['offer-grid'],
      // Nothing here is a selection: a card is a link, and a selected tile that
      // does nothing is a control that lies about what it is.
      selectionMode: Gtk.SelectionMode.NONE,
      homogeneous: true,
      minChildrenPerLine: 2,
      maxChildrenPerLine: 6,
      rowSpacing: 12,
      columnSpacing: 12,
      valign: Gtk.Align.START,
    });
    this.context = context;
    this.options = options;
  }

  clear(): void {
    this.remove_all();
    this.keys.length = 0;
  }

  get count(): number {
    return this.keys.length;
  }

  add(listing: Listing, sourceLabel: string, verdict: PriceVerdict | undefined, now: number): void {
    const card = new OfferCard(this.context, listing, sourceLabel, verdict, now, {
      showSource: this.options.showSource,
    });

    // Inside one source's block the order is the SOURCE's — relevance, or
    // whatever that market ranks by. Re-sorting it there would quietly answer a
    // different question than the one the market was asked.
    if (!this.options.sorted) {
      this.keys.push(sortKey(listing));
      this.append(card);
      return;
    }

    const key = sortKey(listing);
    // Linear scan, and deliberately: the list is tens of items and stays sorted,
    // so this is a handful of comparisons against a binary search that would
    // need its own test to prove it lands on the right side of equal keys.
    let at = this.keys.length;
    for (let i = 0; i < this.keys.length; i += 1) {
      if (this.keys[i]! > key) {
        at = i;
        break;
      }
    }
    this.keys.splice(at, 0, key);
    this.insert(card, at);
  }
}
