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
 * TWO LAYOUTS, one invariant. Since 2026-09-06 the results area can be a single
 * price-sorted grid of cards („like a shop") or the source blocks it started as,
 * switchable in the settings. What is NOT switchable is the accounting: the grid
 * carries a `SourceStrip` with the same five report states above it, laid out
 * before the fan-out just as the panels are. A layout may change how offers are
 * grouped; it may not change whether a skipped source is visible.
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
import { layoutOf, type ResultLayout } from '@troedler/store';

import { search, type SourceResult } from '../../../core/actions/index.ts';
import { isEnabled, type Context } from '../../../core/context.ts';
import { OfferGrid } from '../widgets/offer-grid.ts';
import { SourcePanel } from '../widgets/source-panel.ts';
import { SourceStrip } from '../widgets/source-strip.ts';

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
  private readonly strip = new SourceStrip();
  private readonly grid: OfferGrid;
  private readonly labels = new Map<ProviderId, string>();
  /**
   * Everything that has settled in this search, kept so that switching the
   * layout re-lays the SAME results instead of asking the marketplaces again.
   * A preference is not a reason to spend somebody's rate limit twice.
   */
  private readonly settled: { result: SourceResult; now: number }[] = [];
  private layout: ResultLayout;
  private running: AbortController | null = null;

  constructor(context: Context) {
    super({ orientation: Gtk.Orientation.VERTICAL });
    this.context = context;
    this.layout = layoutOf(context.config);
    this.grid = new OfferGrid(context, { showSource: true, sorted: true });
    this.describeLayout();

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

  /**
   * The empty screen says what THIS layout does, not what the app used to do.
   *
   * The line here read „Die Treffer bleiben nach Quelle getrennt" and stayed
   * that way when the grid became the default — a start screen promising the
   * one property the active layout does not have. A surface that describes a
   * different program than the one running is the defect this project spends
   * most of its comments on; it does not stop being that when it is the welcome
   * text.
   */
  private describeLayout(): void {
    this.status.set_description(
      this.layout === 'grid'
        ? 'Alle Treffer in einem Raster, günstigste zuerst — jede Karte nennt ihren Markt, ' +
            'damit sichtbar bleibt, dass dasselbe Ding hier 40 € und dort 120 € kostet.'
        : 'Die Treffer bleiben nach Quelle getrennt — dasselbe Ding kostet auf dem einen Markt ' +
            '40 € und auf dem anderen 120 €, und das ist die Antwort.',
    );
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

    this.settled.length = 0;
    // Every enabled source gets its place now, in list order, so the results
    // area can never appear without the accounting that belongs beside it —
    // panels in one layout, strip lines in the other, same guarantee.
    this.prepare(this.askable());

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
          // still gets its place rather than dropping off the screen silently.
          if (!this.labels.has(id)) this.addSource(id, label);
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
      for (const [id, label] of this.labels) {
        if (answered.has(id)) continue;
        this.panels.get(id)?.notAsked();
        this.strip.notAsked(id, label);
      }
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
      if (aborted) {
        for (const [id, label] of this.labels) {
          this.panels.get(id)?.notAsked();
          this.strip.notAsked(id, label);
        }
      }
    } finally {
      this.running = null;
      this.startButton.set_sensitive(true);
      this.stopButton.set_sensitive(false);
    }
  }

  private settle(source: SourceResult): void {
    // `GLib.get_real_time()` is microseconds since the epoch; the presenter
    // wants milliseconds, and it wants them passed in rather than read, so the
    // wording is reproducible in a test. Kept with the result, so that
    // re-laying it later says „vor 2 d" about the same moment rather than
    // quietly re-reading the clock.
    const now = Math.floor(GLib.get_real_time() / 1000);
    this.settled.push({ result: source, now });
    this.place(source, now);
  }

  /** Lay the results area out for the sources that are about to be asked. */
  private prepare(sources: readonly { id: ProviderId; label: string }[]): void {
    this.clearChildren(this.results);
    this.panels.clear();
    this.labels.clear();
    this.strip.clear();
    this.grid.clear();

    if (this.layout === 'grid') {
      this.results.append(this.strip);
      this.results.append(this.grid);
    }
    for (const { id, label } of sources) this.addSource(id, label);
  }

  private addSource(id: ProviderId, label: string): void {
    this.labels.set(id, label);
    if (this.layout === 'grid') {
      this.strip.pending(id, label);
      return;
    }
    const panel = new SourcePanel(this.context, id, label, this.explain.get_active());
    this.panels.set(id, panel);
    this.results.append(panel);
  }

  /** Put one settled source where the current layout wants it. */
  private place(source: SourceResult, now: number): void {
    if (this.layout === 'grid') {
      this.strip.settle(source);
      const label = this.labels.get(source.report.provider) ?? source.report.provider;
      for (const listing of source.listings) {
        this.grid.add(listing, label, source.verdicts.get(listing.key), now);
      }
      return;
    }
    this.panels.get(source.report.provider)?.settle(source, now);
  }

  /**
   * Switch layout without asking the marketplaces again.
   *
   * Everything needed is already in `settled`: the same results, re-laid. A
   * preference is not a reason to spend somebody's rate limit twice — and on a
   * source with a ten-second crawl-delay it would be a visibly punishing way to
   * change one's mind about a grid.
   */
  setLayout(layout: ResultLayout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.describeLayout();
    if (this.labels.size === 0) return;
    const sources = [...this.labels].map(([id, label]) => ({ id, label }));
    this.prepare(sources);
    for (const { result, now } of this.settled) this.place(result, now);
  }
}
