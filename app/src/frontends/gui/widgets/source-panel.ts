/**
 * One source's block — and the reason this app is laid out per source at all.
 *
 * The panel exists BEFORE its source answers. A search creates one per provider
 * it is about to ask, in a pending state, and each settles in place. That order
 * is the design, not an animation: a results area that appears without its
 * explanation beside it is exactly how "no matches" gets read as "this thing
 * does not exist second-hand", and a blank pane for the eight seconds a
 * two-second-per-host floor costs is pixel-identical to a broken one.
 *
 * So the panel renders the whole `ProviderReport` vocabulary and not just rows:
 *
 *   pending    „wird gesucht …" — asked, no answer yet
 *   ok         the rows, the band, the disclaimer, and how many fell to a limit
 *   empty      „keine Treffer" — the source answered and had nothing
 *   skipped    the reason, in the operator's or the config's own words
 *   failed     the error KIND, and whether coming back could help
 *
 * `reportLine` writes all five sentences and the CLI prints the same ones. The
 * only thing decided here is which of them gets an Adwaita colour.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import Pango from '@girs/pango-1.0';

import { bandText, explainLines, reportLine, type ProviderId } from '@troedler/core';

import type { Context } from '../../../core/context.ts';
import type { SourceResult } from '../../../core/actions/index.ts';
import { OfferGrid } from './offer-grid.ts';
import { outcomeClasses } from './outcome.ts';

function dim(text: string, extra: string[] = []): Gtk.Label {
  return new Gtk.Label({
    label: text,
    xalign: 0,
    wrap: true,
    wrapMode: Pango.WrapMode.WORD_CHAR,
    maxWidthChars: 90,
    marginStart: 12,
    marginEnd: 12,
    cssClasses: ['dim-label', 'caption', ...extra],
  });
}

export class SourcePanel extends Adw.Bin {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerSourcePanel' }, this);
  }

  readonly provider: ProviderId;
  private readonly context: Context;
  /** The market's own name. `heading` becomes the report sentence on settle. */
  private readonly sourceLabel: string;
  private readonly box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
  // Wrapping, and it is not cosmetic: a skipped source's whole worth is the
  // SENTENCE saying why, and „übersprungen — EBAY_CLIENT_ID und …" ran off the
  // right edge of the window where nobody would read the half that matters.
  private readonly heading = new Gtk.Label({
    xalign: 0,
    wrap: true,
    wrapMode: Pango.WrapMode.WORD_CHAR,
    maxWidthChars: 72,
    cssClasses: ['title-4'],
  });
  private readonly body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
  private explain: boolean;

  constructor(context: Context, provider: ProviderId, label: string, explain: boolean) {
    super({ cssClasses: ['card'], marginTop: 6, marginBottom: 6 });
    this.provider = provider;
    this.context = context;
    this.sourceLabel = label;
    this.explain = explain;

    this.box.set_margin_top(12);
    this.box.set_margin_bottom(12);
    this.heading.set_margin_start(12);
    this.heading.set_margin_end(12);
    this.heading.set_label(label);
    this.box.append(this.heading);
    this.box.append(this.body);
    this.set_child(this.box);

    this.pending();
  }

  /** Asked, nothing back yet. The state a person must be able to see. */
  pending(): void {
    this.clear();
    const row = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      marginStart: 12,
      marginEnd: 12,
    });
    const spinner = new Adw.Spinner();
    spinner.set_size_request(16, 16);
    row.append(spinner);
    row.append(new Gtk.Label({ label: 'wird gesucht …', xalign: 0, cssClasses: ['dim-label'] }));
    this.body.append(row);
  }

  /** The source never got asked — a search that named other providers. */
  notAsked(): void {
    this.clear();
    this.body.append(dim('nicht angefragt'));
  }

  settle(result: SourceResult, now: number): void {
    const { report } = result;
    this.clear();
    this.heading.set_label(reportLine(report));
    // Only a failure earns the error colour. `skipped` is a decision — an
    // operator's terms, a missing key — and painting it red would tell a person
    // something broke when nothing did.
    this.heading.set_css_classes(outcomeClasses(report.outcome, ['title-4']));

    for (const warning of report.warnings) this.body.append(dim(`Hinweis: ${warning}`));

    if (result.listings.length > 0) {
      // Cards here too — the layouts differ in how the results are GROUPED, not
      // in what an offer looks like. Two card designs would be two places to
      // change the day a fact moves.
      const grid = new OfferGrid(this.context, { showSource: false, sorted: false });
      grid.set_margin_start(8);
      grid.set_margin_end(8);
      grid.set_margin_top(4);
      grid.set_margin_bottom(4);
      for (const listing of result.listings) {
        grid.add(listing, this.sourceLabel, result.verdicts.get(listing.key), now);
      }
      this.body.append(grid);
    }

    if (result.band) {
      const text = bandText(result.band);
      if (text.quantiles) {
        const q = text.quantiles;
        this.body.append(dim(`${text.headline}:`));
        this.body.append(
          new Gtk.Label({
            label: `${q.min} … ${q.p25} — ${q.median} — ${q.p75} … ${q.max}`,
            xalign: 0,
            marginStart: 12,
            marginEnd: 12,
            wrap: true,
            cssClasses: ['band'],
          }),
        );
      } else {
        this.body.append(dim(text.headline));
      }
      for (const caveat of text.caveats) this.body.append(dim(`(${caveat})`));
    }

    // A provenance notice for data that is not there is noise at best and a
    // claim at worst — it once stood under every skipped eBay run with zero
    // rows. It belongs WITH the rows or nowhere.
    if (report.disclaimer && report.count > 0) {
      this.body.append(dim(report.disclaimer, ['accent']));
    }

    if (this.explain) {
      for (const line of explainLines(report)) {
        // `strong` marks the filter that could not take effect. The terminal
        // stops dimming it; here it gets a warning colour, and neither surface
        // decides for itself which line that is.
        this.body.append(line.strong ? dim(line.text, ['warning']) : dim(line.text));
      }
    }
  }

  setExplain(explain: boolean): void {
    this.explain = explain;
  }

  private clear(): void {
    let child = this.body.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.body.remove(child);
      child = next;
    }
  }
}
