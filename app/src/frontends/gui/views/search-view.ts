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
import { FILTER_ICON } from '../icons.ts';
import { OfferGrid } from '../widgets/offer-grid.ts';
import { SourceCensus } from '../widgets/source-census.ts';
import { SourcePanel } from '../widgets/source-panel.ts';

export class SearchView extends Gtk.Box {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerSearchView' }, this);
  }

  private readonly context: Context;
  /**
   * The one width in this view that is not negotiable.
   *
   * `widthChars` is the FLOOR, and it exists because `Gtk.Box` hands every
   * child its natural width and gives the surplus to the only `hexpand` one —
   * this entry. When the row beside it carried five controls, below the width
   * they needed between them there was no surplus, so the entry absorbed the
   * whole deficit and rendered as the `⊗` clear glyph with the query squeezed
   * out of the allocation: measured 57 px of entry and 13 px of inner `GtkText`
   * at a 600 px window, with `TR_APP_QUERY=fahrrad` loaded and the results being
   * bicycles. It held the full string the whole time; nothing about the query
   * was wrong.
   *
   * Moving the five controls into a popover is what made the FLOOR sufficient
   * rather than merely necessary, and the arithmetic is why: a filter button
   * (34 px) and one run button (~110 px) are 156 px between them, so from 360 px
   * upwards there is a readable entry and them at the same time and the row no
   * longer needs to stack. What is left beside the entry is small ENOUGH that
   * the floor holds everywhere, and a floor that holds everywhere is a floor
   * that can never be taken away again.
   *
   * **This is the property that has to survive the `.blp` migration:
   * `width-chars: 12` on the `Gtk.SearchEntry` in `search-view.blp`, and
   * `hexpand: true`.** Drop either one and the deficit goes straight back into
   * the entry.
   */
  private readonly entry = new Gtk.SearchEntry({
    hexpand: true,
    widthChars: 12,
    placeholderText: 'Wonach suchen?',
  });
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
   *
   * **The label, and no icon.** This had `iconName` as well, on the reasoning
   * that an icon is the modern thing — and a screenshot caught what GTK4 does
   * with a button that has both: it draws the ICON and drops the label. So the
   * button said nothing in either state, and while the search ran it showed a
   * magnifier — the one glyph that means the opposite of what pressing it does.
   * The comment here used to claim the label was never wrong about that. It was
   * not on screen at all.
   */
  private readonly goButton = new Gtk.Button({
    label: 'Suchen',
    tooltipText: 'Suche starten (Enter)',
    cssClasses: ['suggested-action'],
  });
  /**
   * The three secondary filters, behind one button.
   *
   * Höchstpreis, Anbieter and Erklären were three controls in the toolbar row,
   * which made the entry the squeezed one. In a popover they are still exactly
   * the same three fields with the same three values — the kernel never learned
   * anything new about them — but the row they sat in is now one entry wide plus
   * two buttons, and that is the whole reason a 360 px window is usable.
   *
   * The rows are `Adw`'s own, so each one is a title, a value and a label
   * instead of a bare control, and `useMarkup: false` in the CONSTRUCTOR on
   * every row: `PreferencesRow` parses title and subtitle as Pango markup on
   * assignment, and a later `set_use_markup(false)` is too late (the incident is
   * in AGENTS.md).
   *
   * The subtitles are short ON PURPOSE, and that is a measurement rather than a
   * taste. An `Adw.ActionRow` does not wrap its subtitle in this libadwaita, so
   * a row asks for the full width of its longest line and the popover takes that
   * as its own width — a popover wider than the window it belongs to, which is
   * what the first version of these three produced: full sentences for subtitles,
   * measured 388 px of popover over a window that is 360 px wide. The unit went
   * into the title for the same reason: `Adw.SpinRow` exposes no suffix of its
   * own, and „Höchstpreis" alone does not say what the number is.
   */
  private readonly maxPrice = new Adw.SpinRow({
    title: 'Höchstpreis €',
    subtitle: '0 = kein Limit',
    adjustment: new Gtk.Adjustment({
      lower: 0,
      upper: 100000,
      stepIncrement: 10,
      pageIncrement: 100,
    }),
    value: 0,
    digits: 0,
    snapToTicks: true,
    numeric: true,
    useMarkup: false,
  });
  private readonly seller = new Adw.ComboRow({
    title: 'Anbieter',
    subtitle: 'privat / gewerblich',
    useMarkup: false,
    model: Gtk.StringList.new([
      'alle',
      `nur ${SELLER_TYPE_LABEL.private}`,
      `nur ${SELLER_TYPE_LABEL.commercial}`,
    ]),
  });
  private readonly explain = new Adw.SwitchRow({
    title: 'Erklären',
    subtitle: 'welche Filter griffen',
    useMarkup: false,
  });
  /**
   * The receipt for a filter that is set but no longer on screen.
   *
   * A popover is where filters are set in current Adwaita apps, and it is also
   * where a filter disappears from view — so the row below the toolbar names what
   * is set, and a chip takes its own filter back off. „nur privat" changes what
   * the list MEANS; a person who cannot see that they set it will set it again.
   * Empty when nothing is set, so it never costs a row over the results.
   */
  private readonly chips = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    marginStart: 12,
    marginEnd: 12,
    marginBottom: 6,
  });
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
  /**
   * The toolbar: the entry, and the two buttons that are all that has to fit
   * beside it.
   *
   * 12 px of margin and 6 px of spacing, against the 8/8 the old row used. Below
   * 600 px that is 14 px back for the entry out of a window that has 240 px of
   * it to spare, and above 600 px nobody can see the difference — a measured
   * trade, not a taste one.
   */
  private readonly bar = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    marginTop: 12,
    marginBottom: 12,
    marginStart: 12,
    marginEnd: 12,
  });
  private readonly clamp = new Adw.Clamp({ maximumSize: 720, tighteningThreshold: 480 });
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
    super({ orientation: Gtk.Orientation.VERTICAL });
    this.context = context;
    this.layout = layoutOf(context.config);
    this.grid = new OfferGrid(context, { showSource: true, sorted: true });
    this.describeLayout();

    this.bar.append(this.entry);
    this.bar.append(this.filterButton());
    this.bar.append(this.goButton);
    // Clamped rather than free: without it a 4K window stretches the row to its
    // full width and the entry — the only `hexpand` child — becomes a text field
    // a mile long with the query somewhere in the middle of it. 720 px is where
    // a search field stops being a field and starts being a banner, and
    // `Adw.Clamp` is the one widget here that caps a natural width at all
    // (`max-width-chars` on a label that ellipsizes does not — measured on a
    // `Gtk.Picture` card, in AGENTS.md).
    this.clamp.set_child(this.bar);
    this.append(this.clamp);
    this.append(this.chips);

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
   * The filter button and the popover it opens.
   *
   * A `Gtk.MenuButton`, which is where a popover has lived since GTK 4.10 took
   * `popover` off `Gtk.Button` — and it is the shape Adwaita's own filter
   * affordance has anyway: a flat button that opens a popover and reports its own
   * open state, which is why a person can tell at a glance that the filters are
   * over there.
   *
   * A popover rather than a dialog or a second row, because that is where
   * Adwaita apps put filters, and because it costs the toolbar nothing: the three
   * rows are laid out once and shown over the results, so nothing here takes
   * height away from the list at any window width.
   *
   * The icon is the app's OWN (`icons.ts`): `view-filter-symbolic` is not a name
   * the Adwaita theme has, and a missing `-symbolic` on a `Gtk.MenuButton` is a
   * white rectangle, not a placeholder.
   *
   * `autohide` is the default and stays on — the popover closes on the click
   * outside that a person expects, and closing it is not the end of anything,
   * because the chip row still says what is set.
   */
  private filterButton(): Gtk.MenuButton {
    const button = new Gtk.MenuButton({
      iconName: FILTER_ICON,
      tooltipText: 'Filter',
    });
    const group = new Adw.PreferencesGroup();
    group.add(this.maxPrice);
    group.add(this.seller);
    group.add(this.explain);
    // The width the popover is BUILT at, and it is a floor rather than a cap:
    // the three rows between them ask for 274 px (the price row is the widest —
    // its spin buttons and its title, not its subtitle), and an `Adw` popover
    // adds 80 px of its own padding and frame around that, which lands the
    // popover at 354 px measured. Under a 360 px window, with 6 px to spare —
    // and the margins are 6 rather than 12 because the popover already pads
    // itself, so 12 was a second padding on top of the first.
    const box = new Gtk.Box({
      widthRequest: 250,
      marginTop: 6,
      marginBottom: 6,
      marginStart: 6,
      marginEnd: 6,
    });
    box.append(group);
    button.set_popover(new Gtk.Popover({ child: box }));
    return button;
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
