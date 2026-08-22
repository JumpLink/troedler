/**
 * One offer, as a row.
 *
 * Every string here comes from `@troedler/core`'s `present.ts`. That is not
 * ceremony: this widget and `cli/output.ts` render the same `Listing`, and the
 * day one of them starts spelling a condition or a date its own way is the day
 * the two surfaces disagree about an offer a person is about to buy.
 *
 * No image is loaded, ever. Rendering a remote thumbnail IS downloading it —
 * outside the robots gate, outside the rate limiter, without the honest user
 * agent — and the Leitplanke says images are URLs, never fetched. The link is
 * the whole of what this row does with them.
 */

import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import Pango from '@girs/pango-1.0';

import { VERDICT_LABEL, listingFacts, listingPrice, type Listing, type PriceVerdict } from '@troedler/core';

export class ListingRow extends Gtk.Box {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerListingRow' }, this);
  }

  constructor(listing: Listing, verdict: PriceVerdict | undefined, now: number) {
    super({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 2,
      marginTop: 6,
      marginBottom: 6,
      marginStart: 12,
      marginEnd: 12,
    });

    const title = new Gtk.Label({
      label: listing.title,
      xalign: 0,
      // Wrap rather than ellipsize: a marketplace title carries the model
      // number at the end as often as at the front, and a row that hides it
      // makes two different machines look like the same offer.
      wrap: true,
      wrapMode: Pango.WrapMode.WORD_CHAR,
      maxWidthChars: 72,
      cssClasses: ['heading'],
    });
    this.append(title);

    const price = listingPrice(listing);
    const priceLabel = new Gtk.Label({
      label: `${price.text}${price.shipping}`,
      xalign: 0,
      cssClasses: ['title-4'],
    });
    this.append(priceLabel);

    // `listingFacts` decides which facts a row HAS — condition, seller, place,
    // the auction countdown, how long ago — so this view never asks "does this
    // listing have an end date" and never invents a separator for a field that
    // is missing.
    const facts = listingFacts(
      listing,
      now,
      verdict && verdict !== 'unknown' ? [VERDICT_LABEL[verdict]] : [],
    );
    if (facts.length > 0) {
      this.append(
        new Gtk.Label({
          label: facts.join(' · '),
          xalign: 0,
          wrap: true,
          wrapMode: Pango.WrapMode.WORD_CHAR,
          maxWidthChars: 90,
          cssClasses: ['dim-label', 'caption'],
        }),
      );
    }

    const link = new Gtk.LinkButton({
      uri: listing.url,
      label: listing.url,
      halign: Gtk.Align.START,
      cssClasses: ['caption', 'flat'],
    });
    link.set_tooltip_text(listing.url);
    // A `Gtk.LinkButton` does not wrap, so its MINIMUM width is the whole URL —
    // and a marketplace URL is one unbreakable token of eighty characters.
    // Measured: that alone pushed the window past its own 980 px and shoved the
    // header bar off to the left, with every label in the results clipped at
    // the right edge. Ellipsising the label bounds the minimum; the full URL is
    // still the link target and still the tooltip, so nothing is lost but the
    // middle of a string nobody reads.
    const linkLabel = link.get_child();
    if (linkLabel instanceof Gtk.Label) {
      linkLabel.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
      linkLabel.set_max_width_chars(48);
      linkLabel.set_xalign(0);
    }
    this.append(link);

    if (listing.description) {
      const body = new Gtk.Label({
        label: listing.description,
        xalign: 0,
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        lines: 3,
        ellipsize: Pango.EllipsizeMode.END,
        cssClasses: ['dim-label', 'caption'],
      });
      this.append(body);
    }
  }
}
