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
 * carries a `SourceCensus` with the same five report states above it, laid out
 * before the fan-out just as the panels are. A layout may change how offers are
 * grouped; it may not change whether a skipped source is visible.
 *
 * The toolbar above it is one wide entry, one filter button and one run button.
 * That is a deliberate departure from the six controls in a row it replaces, and
 * the reason is arithmetic rather than taste: a `Gtk.Box` gives every child its
 * natural width and hands the surplus to the only `hexpand` one, so five controls
 * asking for 509 px between them left the entry 57 px at a 600 px window and the
 * query rendered as the `⊗` clear glyph alone. Hoisting the three secondary
 * filters into a popover leaves 156 px beside the entry, so `width-chars: 12` is
 * now a floor that holds from 360 px up rather than one that only holds once the
 * window is wide — and one run button that becomes „Stopp" instead of two
 * full-width ones spends the height the results needed.
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

import {
  activeFilterChips,
  emptinessNotice,
  gapNotice,
  SELLER_TYPE_LABEL,
  type ActiveFilters,
  type ChipKey,
  type FilterChip,
  type ProviderId,
} from '@troedler/core';
import { layoutOf, type ResultLayout } from '@troedler/store';

import { search, type SourceResult } from '../../../core/actions/index.ts';
import { isEnabled, type Context } from '../../../core/context.ts';
import { setAccessibleLabel } from '../a11y.ts';
import { OfferGrid } from '../widgets/offer-grid.ts';
import { SourceCensus } from '../widgets/source-census.ts';
import { SourcePanel } from '../widgets/source-panel.ts';

import Template from './search-view.blp';
import PopoverTemplate from './search-view-popover.blp';

/**
 * The three secondary filters, behind one button — and why they are a template
 * of their own.
 *
 * Höchstpreis, Anbieter and Erklären were three controls in the toolbar row,
 * which made the entry the squeezed one. In a popover they are still exactly the
 * same three fields with the same three values — the kernel never learned
 * anything new about them — but the row they sat in is now one entry wide plus
 * two buttons, and that is the whole reason a 360 px window is usable.
 *
 * The rows are `Adw`'s own, so each one is a title, a value and a label instead
 * of a bare control, and `use-markup: false` in the TEMPLATE on every row:
 * `PreferencesRow` parses title and subtitle as Pango markup on assignment, and
 * a later `set_use_markup(false)` is too late (the incident is in AGENTS.md).
 *
 * `Adw` is a VALUE import here again, not type-only: this class still builds the
 * popover itself rather than letting the view template hold it. That is not an
 * oversight — a `Gtk.Popover` is not a child of the view, so a template inside
 * `search-view.blp` would name a widget that is not in the hierarchy the
 * template describes.
 */
class FilterPopover extends Adw.Bin {
  static {
    GObject.registerClass(
      {
        GTypeName: 'TroedlerFilterPopover',
        Template: PopoverTemplate,
        InternalChildren: ['max_price', 'seller', 'explain'],
      },
      this,
    );
  }

  declare private readonly _max_price: Adw.SpinRow;
  declare private readonly _seller: Adw.ComboRow;
  declare private readonly _explain: Adw.SwitchRow;

  get maxPrice(): Adw.SpinRow {
    return this._max_price;
  }

  get seller(): Adw.ComboRow {
    return this._seller;
  }

  get explain(): Adw.SwitchRow {
    return this._explain;
  }

  constructor() {
    super();
    // The model is set here rather than in the template because it is built
    // from the kernel's own seller labels — `SELLER_TYPE_LABEL` is a German
    // sentence the CLI prints too, and a second copy in a `.blp` is exactly how
    // the two surfaces end up disagreeing about the same word.
    this._seller.set_model(
      Gtk.StringList.new(['alle', `nur ${SELLER_TYPE_LABEL.private}`, `nur ${SELLER_TYPE_LABEL.commercial}`]),
    );
  }

  /** The popover as the button wants it: itself, wrapped. */
  asPopover(): Gtk.Popover {
    return new Gtk.Popover({ child: this });
  }
}

export class SearchView extends Gtk.Box {
  static {
    GObject.registerClass(
      {
        GTypeName: 'TroedlerSearchView',
        Template,
        // The five this class reads or connects, plus the empty-state page whose
        // description describes the ACTIVE layout. The panels, the census and the
        // grid are not here: they are one-per-source, and a template cannot
        // count. `prepare()` appends them to `results`.
        InternalChildren: ['entry', 'filter_button', 'go_button', 'chips', 'notices', 'status', 'results'],
      },
      this,
    );
  }

  declare private readonly _entry: Gtk.SearchEntry;
  declare private readonly _filter_button: Gtk.MenuButton;
  declare private readonly _go_button: Gtk.Button;
  declare private readonly _chips: Gtk.Box;
  declare private readonly _notices: Gtk.Box;
  declare private readonly _status: Adw.StatusPage;
  declare private readonly _results: Gtk.Box;

  /**
   * The one width in this view that is not negotiable.
   *
   * `width-chars: 12` AND `hexpand: true` live in `search-view.blp` on the
   * `Gtk.SearchEntry`, and they are the property of this migration that matters
   * most — see the note on the entry in the template for the measurement. This
   * getter exists only so the constructor can read and connect it.
   */
  private get entry(): Gtk.SearchEntry {
    return this._entry;
  }

  private get filterButton(): Gtk.MenuButton {
    return this._filter_button;
  }

  /**
   * One button, and it is the search itself.
   *
   * There were two: a full-width „Suchen" and a full-width „Stopp" below it, and
   * on a narrow window they were the largest thing on screen — a button each for
   * the same action in its two states. Return in the entry already started the
   * search, so the button is for the pointer, and a pointer does not need a
   * second one for the other state.
   *
   * Stopp is the same button because Stopp is not a mode: it aborts the signal
   * the search hangs off and then there is no search.
   */
  private get goButton(): Gtk.Button {
    return this._go_button;
  }

  /**
   * The receipt for a filter that is set but no longer on screen.
   *
   * A popover is where filters are set in current Adwaita apps, and it is also
   * where a filter disappears from view — so the row below the toolbar names what
   * is set, and a chip takes its own filter back off. „nur privat" changes what
   * the list MEANS; a person who cannot see that they set it will set it again.
   * Empty when nothing is set, so it never costs a row over the results.
   */
  private get chips(): Gtk.Box {
    return this._chips;
  }

  private get notices(): Gtk.Box {
    return this._notices;
  }

  private get status(): Adw.StatusPage {
    return this._status;
  }

  private get results(): Gtk.Box {
    return this._results;
  }

  private readonly context: Context;
  /**
   * The three secondary filters, behind the toolbar's filter button.
   *
   * A plain field and not a template child: they live in the popover's own
   * template, and this is where the view reaches them. Everything else about them
   * — why a popover, why the subtitles are short, why `use-markup: false` — is
   * on `FilterPopover` and in `search-view-popover.blp`.
   */
  private readonly filterRows = new FilterPopover();
  private get maxPrice(): Adw.SpinRow {
    return this.filterRows.maxPrice;
  }

  private get seller(): Adw.ComboRow {
    return this.filterRows.seller;
  }

  private get explain(): Adw.SwitchRow {
    return this.filterRows.explain;
  }

  private readonly panels = new Map<ProviderId, SourcePanel>();
  private readonly census = new SourceCensus();
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
    super();
    this.context = context;
    this.layout = layoutOf(context.config);
    this.grid = new OfferGrid(context, { showSource: true, sorted: true });
    this.describeLayout();
    this.attachPopover();

    this.entry.connect('activate', () => void this.run());
    // One handler for both labels: the button does whatever the label says, and
    // `run()` refuses to start a second search, so the running case can only
    // reach the abort. The abort is what makes Stopp mean something — it takes
    // the signal the whole fan-out hangs off, the queue wait included, and with a
    // two-second floor per host most of a cancelled search is time spent waiting
    // for a turn.
    this.goButton.connect('clicked', () => {
      if (this.running) this.running.abort();
      else void this.run();
    });
    this.explainRowChanged();
    // Once, so „no filters → no chip row" is decided in the same place that
    // decides what a filter looks like, rather than in a `visible: false` that a
    // later chip has to remember to contradict.
    this.chipsChanged();
    this.maxPrice.connect('notify::value', () => this.chipsChanged());
    this.seller.connect('notify::selected', () => this.chipsChanged());
    this.explain.connect('notify::active', () => {
      this.explainRowChanged();
      this.chipsChanged();
    });
  }

  /**
   * Give the toolbar's filter button something to open.
   *
   * The BUTTON is in `search-view.blp` — a `Gtk.MenuButton`, which is where a
   * popover has lived since GTK 4.10 took `popover` off `Gtk.Button`, and the
   * shape Adwaita's own filter affordance has anyway: a flat button that opens a
   * popover and reports its own open state, which is why a person can tell at a
   * glance that the filters are over there.
   *
   * Its ICON is there too, and it is the app's OWN (`troedler-filter-symbolic`
   * from `icons.ts`): `view-filter-symbolic` is not a name the Adwaita theme
   * has, and a missing `-symbolic` on a `Gtk.MenuButton` is a white rectangle,
   * not a placeholder.
   *
   * The POPOVER is attached here rather than declared in the template because it
   * is not part of this view's hierarchy — it is shown over the results, and a
   * template cannot name a widget that is not one of its children. That is why
   * `FilterPopover` is its own class over its own `.blp` rather than a corner of
   * this one.
   *
   * `autohide` is the default and stays on — the popover closes on the click
   * outside that a person expects, and closing it is not the end of anything,
   * because the chip row still says what is set.
   */
  private attachPopover(): void {
    this.filterButton.set_popover(new FilterPopover().asPopover());
  }

  /**
   * `--explain` reaches the panels through one place.
   *
   * Both the switch and a chip that takes „Erklären" off end up here, and the
   * panels that already exist have to hear about it either way — a checkbox that
   * only coloured the NEXT search's panels would be a control that lies about
   * the results already on screen.
   */
  private explainRowChanged(): void {
    for (const panel of this.panels.values()) panel.setExplain(this.explain.get_active());
  }

  /**
   * Rebuild the chip row from the kernel's reading of the current filters.
   *
   * The sentences and the keys come from `activeFilterChips` rather than from
   * the three controls one at a time: a filter is either set or it is not, and
   * the widget that knows that is the one deciding what to show. Each chip
   * removes ITS OWN filter, because a row of chips where every chip clears
   * everything is a row of chips that gets one wrong click.
   */
  private chipsChanged(): void {
    let child = this.chips.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.chips.remove(child);
      child = next;
    }
    const active = activeFilterChips(this.filters());
    for (const chip of active) this.chips.append(this.chip(chip));
    this.chips.set_visible(active.length > 0);
  }

  /**
   * One active filter, as a token you can take off again.
   *
   * A `Gtk.Button` with a label was the first version and it read as TEXT: a
   * flat button with a label is indistinguishable from the sentence beside it, so
   * there was nothing that looked pressable. A token is a pill with its own
   * little `⊗`, and the `⊗` is a separate `Gtk.Button` rather than a gesture on
   * the pill — one click then removes exactly the filter whose name is on it.
   *
   * The close button carries a `window-close-symbolic` and an accessible label
   * that says WHICH filter it removes: „Erklären an" alone would be a chip
   * labelled with a word and a cross.
   */
  private chip(chip: FilterChip): Gtk.Box {
    const remove = new Gtk.Button({
      iconName: 'window-close-symbolic',
      cssClasses: ['flat', 'circular'],
      tooltipText: `${chip.text} — entfernen`,
    });
    setAccessibleLabel(remove, `Filter ${chip.text} entfernen`);
    remove.connect('clicked', () => {
      this.clearFilter(chip.key);
      this.chipsChanged();
    });
    const token = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
    token.append(new Gtk.Label({ label: chip.text }));
    token.append(remove);
    const pill = new Gtk.Box({ cssClasses: ['filter-chip'] });
    pill.append(token);
    return pill;
  }

  /** One filter back to its default, through the same signal a switch uses. */
  private clearFilter(key: ChipKey): void {
    switch (key) {
      case 'price':
        this.maxPrice.set_value(0);
        break;
      case 'seller':
        this.seller.set_selected(0);
        break;
      case 'explain':
        this.explain.set_active(false);
        break;
    }
  }

  /**
   * The filters as the search will see them.
   *
   * One reader for three controls, because `run()` must not and the chips must
   * not each work out for themselves what „no ceiling" and „no seller type" mean.
   * The kernel's vocabulary is the same: `maxPriceMinor` is cents, and a
   * `null` seller type is „no filter", not „private".
   */
  private filters(): ActiveFilters {
    const euros = this.maxPrice.get_value();
    return {
      maxPriceMinor: euros > 0 ? Math.round(euros * 100) : null,
      sellerType: this.sellerIndex() === 1 ? 'private' : this.sellerIndex() === 2 ? 'commercial' : null,
      explain: this.explain.get_active(),
    };
  }

  /** Index in the combo ⟺ the stored value. One list, so they cannot drift. */
  private sellerIndex(): number {
    const index = this.seller.get_selected();
    return index === 1 || index === 2 ? index : 0;
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
    this.setRunning(true);
    this.status.set_visible(false);
    this.clearChildren(this.notices);
    this.clearChildren(this.results);
    this.panels.clear();

    this.settled.length = 0;
    // Every enabled source gets its place now, in list order, so the results
    // area can never appear without the accounting that belongs beside it —
    // panels in one layout, the collapsed census in the other, same guarantee.
    this.prepare(this.askable());

    const { maxPriceMinor, sellerType } = this.filters();

    try {
      const result = await search(this.context, {
        text,
        // `null` is the kernel's word for „no filter"; `SearchQuery` wants it
        // absent, and the cache key in `query.ts` is built off `!== undefined`,
        // so a `null` here would be a different query string for the same search.
        maxPriceMinor: maxPriceMinor ?? undefined,
        sellerType: sellerType ?? undefined,
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
        this.census.notAsked(id, label);
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
          this.census.notAsked(id, label);
        }
      }
    } finally {
      this.running = null;
      this.setRunning(false);
    }
  }

  /**
   * The one button, in whichever of its two states the search is in.
   *
   * One place, because the two used to be two widgets and could disagree: the
   * old code set the sensitivity of each in `run()`'s head and in its `finally`,
   * and anything that threw between them left a „Suchen" that did nothing beside
   * a „Stopp" that still worked. There is now nothing to keep in step.
   */
  private setRunning(running: boolean): void {
    this.goButton.set_label(running ? 'Stopp' : 'Suchen');
    this.goButton.set_tooltip_text(running ? 'Suche abbrechen' : 'Suche starten (Enter)');
    // `destructive-action` rather than `suggested-action` while it aborts: it is
    // the same class of button, saying the opposite thing about what pressing it
    // will do, and both cannot be on one widget.
    this.goButton.set_css_classes(running ? ['destructive-action'] : ['suggested-action']);
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
    this.census.clear();
    this.grid.clear();

    if (this.layout === 'grid') {
      this.results.append(this.census);
      this.results.append(this.grid);
    }
    for (const { id, label } of sources) this.addSource(id, label);
  }

  private addSource(id: ProviderId, label: string): void {
    this.labels.set(id, label);
    if (this.layout === 'grid') {
      this.census.pending(id, label);
      return;
    }
    const panel = new SourcePanel(this.context, id, label, this.explain.get_active());
    this.panels.set(id, panel);
    this.results.append(panel);
  }

  /** Put one settled source where the current layout wants it. */
  private place(source: SourceResult, now: number): void {
    if (this.layout === 'grid') {
      this.census.settle(source);
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
