/**
 * One offer, as a card.
 *
 * The whole tile is the link — that is the shop gesture, and it is also why
 * this is a `Gtk.LinkButton` rather than a box with a click handler: the widget
 * that already knows how to hand a URI to the desktop is the one that should
 * do it, and it brings keyboard focus and an activation state with it.
 *
 * Every string still comes from `@troedler/core`'s `present.ts`. That rule does
 * not soften because the shape changed: this card and `cli/output.ts` render
 * the same `Listing`, and the day one of them spells a condition or a date its
 * own way is the day the two surfaces disagree about an offer somebody is about
 * to buy. What a card decides is what FITS — two lines of title, the facts
 * trimmed to one — never what a fact says.
 *
 * The price is the biggest thing on the tile and the source badge is the second
 * biggest. In the grid those two carry the entire answer this project exists to
 * give: the same saw is 40 € on one market and 120 € on another, and a card
 * that showed the price without the market would be a prettier way of hiding it.
 */

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import Pango from '@girs/pango-1.0';

import { VERDICT_LABEL, listingFacts, listingPrice, type Listing, type PriceVerdict } from '@troedler/core';

import type { Context } from '../../../core/context.ts';
import { Thumbnail } from './thumbnail.ts';

/** Tall enough that a photograph is a photograph, short enough for three rows. */
const THUMB_HEIGHT = 168;
/** The card's width, and the only thing that decides how many fit on a line. */
const CARD_WIDTH = 300;

export class OfferCard extends Gtk.LinkButton {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerOfferCard' }, this);
  }

  constructor(
    context: Context,
    listing: Listing,
    sourceLabel: string,
    verdict: PriceVerdict | undefined,
    now: number,
    options: { showSource: boolean },
  ) {
    super({
      uri: listing.url,
      cssClasses: ['offer-card', 'flat'],
      // The default is CENTER, which would leave a short card floating in the
      // middle of a row whose neighbour has a longer title.
      valign: Gtk.Align.FILL,
      hexpand: true,
    });
    this.set_tooltip_text(listing.title);

    // Inherited from the row this card replaces, and still load-bearing: a
    // `Gtk.LinkButton` left to build its own child gets a LABEL OF THE URI, and
    // a marketplace URL is one unbreakable token of eighty characters. Its
    // minimum width then becomes the widget's, which once pushed the window
    // past its own 980 px and shoved the header bar off to the left. Setting
    // our own child is what keeps that from coming back — the URL is the link
    // target and the tooltip, never a label.

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });

    // The badge sits ON the photograph, not beside the price. Beside it, the two
    // shared 240 px and the PRICE was the one that got ellipsized — „10,10 €
    // Festpre…" — which is the single worst thing on this card to cut, and it
    // was cut on every tile. Up here it costs nothing and reads like a shop.
    const thumb = new Gtk.Overlay();
    thumb.set_child(new Thumbnail(context, listing, THUMB_HEIGHT, CARD_WIDTH));
    if (options.showSource) {
      thumb.add_overlay(
        new Gtk.Label({
          label: sourceLabel,
          cssClasses: ['offer-source'],
          halign: Gtk.Align.END,
          valign: Gtk.Align.START,
          marginTop: 8,
          marginEnd: 8,
        }),
      );
    }
    box.append(thumb);

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 4,
      cssClasses: ['offer-body'],
    });

    const price = listingPrice(listing);
    // No ellipsize on this one, deliberately. The price is what the card is for;
    // if it does not fit, the card is wrong, and a truncated number that still
    // looks like a number is worse than a layout that visibly needs fixing.
    body.append(
      new Gtk.Label({
        label: price.text,
        xalign: 0,
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        cssClasses: ['offer-price', 'numeric'],
      }),
    );

    // „inkl. Versand" belongs to the price and is a separate string in the
    // presenter, so it stays a separate line rather than being glued on and
    // pushing the number itself out of the card on a narrow window.
    if (price.shipping) {
      body.append(
        new Gtk.Label({
          label: price.shipping.trim(),
          xalign: 0,
          cssClasses: ['caption', 'dim-label'],
          ellipsize: Pango.EllipsizeMode.END,
        }),
      );
    }

    body.append(
      new Gtk.Label({
        label: listing.title,
        xalign: 0,
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        lines: 2,
        ellipsize: Pango.EllipsizeMode.END,
        // Without this a long unbroken title sets the card's minimum width and
        // the whole grid widens to fit one advert.
        maxWidthChars: 22,
        cssClasses: ['heading'],
      }),
    );

    const facts = listingFacts(
      listing,
      now,
      verdict && verdict !== 'unknown' ? [VERDICT_LABEL[verdict]] : [],
    );
    if (facts.length > 0) {
      body.append(
        new Gtk.Label({
          label: facts.join(' · '),
          xalign: 0,
          wrap: true,
          wrapMode: Pango.WrapMode.WORD_CHAR,
          lines: 2,
          ellipsize: Pango.EllipsizeMode.END,
          maxWidthChars: 22,
          cssClasses: ['dim-label', 'caption'],
        }),
      );
    }

    box.append(body);

    // The card is clamped, not merely asked nicely. `max-width-chars` on a label
    // that ALSO ellipsizes does not bound its natural width — measured on the
    // facts line, which ran 70 characters wide on one line with the property set
    // to 22 — and one wide child sets the width of every tile in a homogeneous
    // FlowBox. `Adw.Clamp` is the only thing here that actually caps a natural
    // width, so it wraps the whole card rather than the picture alone.
    const clamp = new Adw.Clamp({ maximumSize: CARD_WIDTH, tighteningThreshold: CARD_WIDTH });
    clamp.set_child(box);
    this.set_child(clamp);
  }
}
