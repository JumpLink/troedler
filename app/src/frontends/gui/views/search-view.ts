/**
 * The search screen — grouped by source, because that is the answer.
 *
 * "It costs 40 € on one market and 120 € on another" is what this project
 * exists to tell you, and a single mixed list destroys it. So the results area
 * is one panel per source, laid out BEFORE the fan-out starts and settling in
 * place as each one answers.
 *
 * Two things this view refuses to do:
 *
 *  - **Show rows without their report.** Every panel carries its source's
 *    outcome sentence whether it found something or not. A source that was
 *    skipped, refused or broke reads exactly like a source with no matches
 *    unless it is spelled out, and "no matches" is the answer people act on.
 *  - **Say "nothing found" when nobody answered.** Those are different facts
 *    and only the second means the thing is not out there second-hand.
 *
 * The compare view — `--compare`, one product across the sources that carry it
 * — is deliberately not here yet, and the reason is a measurement rather than a
 * scope cut. Only eBay, Discogs and Booklooker can emit a GTIN at all; the other
 * five hardcode `gtin: null`, and the title+price fallback is intentionally
 * strict. Measured 2026-08-22 over three live searches (Kraftwerk Autobahn,
 * Fahrrad, Bohrmaschine) with eBay unconfigured: 113 groups, **none** of them
 * spanning more than one source. A screen whose every row is a group of one is
 * a worse list, not a better answer. It becomes the headline view the day an
 * eBay keyset is configured and a group actually spans two markets.
 */

import Adw from '@girs/adw-1';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import Pango from '@girs/pango-1.0';

import { emptinessNotice, gapNotice, type ProviderId } from '@troedler/core';

import { search, type SourceResult } from '../../../core/actions/index.ts';
import { isEnabled, type Context } from '../../../core/context.ts';
import { SourcePanel } from '../widgets/source-panel.ts';

export class SearchView extends Gtk.Box {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerSearchView' }, this);
  }

  private readonly context: Context;
  private readonly entry = new Gtk.SearchEntry({ hexpand: true, placeholderText: 'Wonach suchen?' });
  private readonly maxPrice = new Gtk.Entry({
    placeholderText: 'Höchstpreis €',
    inputPurpose: Gtk.InputPurpose.NUMBER,
    widthChars: 12,
  });
  private readonly seller = new Gtk.DropDown({
    model: Gtk.StringList.new(['Anbieter: alle', 'nur privat', 'nur gewerblich']),
  });
  private readonly explain = new Gtk.CheckButton({ label: 'Erklären' });
  private readonly startButton = new Gtk.Button({ label: 'Suchen', cssClasses: ['suggested-action'] });
  private readonly stopButton = new Gtk.Button({ label: 'Stopp', sensitive: false });
  private readonly results = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
  private readonly notices = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
  private readonly status = new Adw.StatusPage({
    title: 'Mehrere Gebrauchtwaren-Marktplätze, eine Anfrage',
    description:
      'Die Treffer bleiben nach Quelle getrennt — dasselbe Ding kostet auf dem einen Markt 40 € und auf dem anderen 120 €, und das ist die Antwort.',
    iconName: 'system-search-symbolic',
    vexpand: true,
  });
  // Never horizontally: every label in here wraps, so a horizontal scrollbar
  // could only ever mean something is being hidden rather than wrapped — and
  // what gets hidden first is the right-hand end of the sentence that explains
  // why a source found nothing.
  private readonly scroller = new Gtk.ScrolledWindow({
    vexpand: true,
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
  });
  private readonly panels = new Map<ProviderId, SourcePanel>();
  private running: AbortController | null = null;

  constructor(context: Context) {
    super({ orientation: Gtk.Orientation.VERTICAL });
    this.context = context;

    const bar = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      marginTop: 12,
      marginBottom: 12,
      marginStart: 12,
      marginEnd: 12,
    });
    bar.append(this.entry);
    bar.append(this.maxPrice);
    bar.append(this.seller);
    bar.append(this.explain);
    bar.append(this.startButton);
    bar.append(this.stopButton);
    this.append(bar);

    this.notices.set_margin_start(12);
    this.notices.set_margin_end(12);
    this.append(this.notices);

    this.results.set_margin_start(12);
    this.results.set_margin_end(12);
    this.results.set_margin_bottom(12);
    const inner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    inner.append(this.status);
    inner.append(this.results);
    this.scroller.set_child(inner);
    this.append(this.scroller);

    this.entry.connect('activate', () => void this.run());
    this.startButton.connect('clicked', () => void this.run());
    // The button aborts the signal the whole search hangs off — the queue wait
    // included, which is what makes it mean something: with a two-second floor
    // per host, most of a cancelled search is time spent waiting for a turn.
    this.stopButton.connect('clicked', () => this.running?.abort());
    this.explain.connect('toggled', () => {
      for (const panel of this.panels.values()) panel.setExplain(this.explain.get_active());
    });
  }

  /**
   * Put a query in and run it — the `TR_APP_QUERY` hook's only entry point.
   *
   * Goes through the entry rather than around it, so what a screenshot shows is
   * the same path a person's Return takes.
   */
  runQuery(text: string): void {
    this.entry.set_text(text);
    void this.run();
  }

  /** Which sources this search will ask, in the order the panels appear. */
  private askable(): { id: ProviderId; label: string }[] {
    return this.context.providers
      .filter((p) => isEnabled(this.context.config, p))
      .map((p) => ({ id: p.capabilities.id, label: p.capabilities.label }));
  }

  private note(text: string, classes: string[] = ['dim-label']): void {
    this.notices.append(
      new Gtk.Label({
        label: text,
        xalign: 0,
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        cssClasses: classes,
      }),
    );
  }

  private clearChildren(box: Gtk.Box): void {
    let child = box.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      box.remove(child);
      child = next;
    }
  }

  private async run(): Promise<void> {
    const text = this.entry.get_text().trim();
    if (!text) return;
    if (this.running) return;

    const controller = new AbortController();
    this.running = controller;
    this.startButton.set_sensitive(false);
    this.stopButton.set_sensitive(true);
    this.status.set_visible(false);
    this.clearChildren(this.notices);
    this.clearChildren(this.results);
    this.panels.clear();

    const explain = this.explain.get_active();
    // Every enabled source gets its panel now, in list order, so the results
    // area can never appear without the accounting that belongs beside it.
    for (const { id, label } of this.askable()) {
      const panel = new SourcePanel(id, label, explain);
      this.panels.set(id, panel);
      this.results.append(panel);
    }

    const euros = Number.parseFloat(this.maxPrice.get_text().replace(',', '.'));
    const sellerIndex = this.seller.get_selected();

    try {
      const result = await search(this.context, {
        text,
        maxPriceMinor: Number.isFinite(euros) ? Math.round(euros * 100) : undefined,
        sellerType: sellerIndex === 1 ? 'private' : sellerIndex === 2 ? 'commercial' : undefined,
        signal: controller.signal,
        onSourceStarted: (id, label) => {
          // A provider the view did not expect — the config changed under it —
          // still gets a panel rather than dropping off the screen silently.
          if (!this.panels.has(id)) {
            const panel = new SourcePanel(id, label, explain);
            this.panels.set(id, panel);
            this.results.append(panel);
          }
        },
        onSource: (source: SourceResult) => this.settle(source),
      });

      // What the query asked for that cannot take effect, said with the
      // results rather than swallowed: a wish silently dropped is worse than
      // one that is refused.
      for (const gap of result.gaps) this.note(gapNotice(gap), ['warning']);

      const rows = [...result.outcome.grouped.values()].reduce((n, list) => n + list.length, 0);
      const emptiness = emptinessNotice(result.noSourceAnswered, rows);
      if (emptiness) this.note(emptiness, result.noSourceAnswered ? ['warning'] : ['dim-label']);

      // Panels for sources the fan-out never reached — `--provider` narrowing,
      // or a source switched off between laying out and asking.
      const answered = new Set(result.outcome.reports.map((r) => r.provider));
      for (const [id, panel] of this.panels) if (!answered.has(id)) panel.notAsked();
    } catch (err) {
      // An aborted search is a decision the user made, not a failure to report
      // as one. Anything else is worth a sentence rather than a silent stop.
      const aborted = controller.signal.aborted;
      this.note(
        aborted
          ? 'Abgebrochen. Was schon angekommen war, steht oben.'
          : `Die Suche ist gescheitert: ${err instanceof Error ? err.message : String(err)}`,
        aborted ? ['dim-label'] : ['error'],
      );
      for (const panel of this.panels.values()) if (aborted) panel.notAsked();
    } finally {
      this.running = null;
      this.startButton.set_sensitive(true);
      this.stopButton.set_sensitive(false);
    }
  }

  private settle(source: SourceResult): void {
    const panel = this.panels.get(source.report.provider);
    if (!panel) return;
    // `GLib.get_real_time()` is microseconds since the epoch; the presenter
    // wants milliseconds, and it wants them passed in rather than read, so the
    // wording is reproducible in a test.
    panel.settle(source, Math.floor(GLib.get_real_time() / 1000));
  }
}
