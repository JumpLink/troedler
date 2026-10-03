/**
 * The accounting, in one line — and the whole block behind it.
 *
 * This replaced a strip that printed one wrapped line per source, always. That
 * was right about the accounting and wrong about the height: at 600 px the
 * seven lines — several of them three lines long, because a skip's reason is the
 * sentence that matters — pushed the results off the screen, and the reason the
 * lines were visible at all was a toolbar with five controls in it. The fix
 * belongs here rather than there, because the toolbar has since been rebuilt
 * around one entry and the accounting still has to be reachable.
 *
 * So the block is COLLAPSED, never dropped, and the collapsed line is written to
 * still carry it: `sourceCensus` names every source that did not answer. A count
 * would let a skipped eBay pass for a market with nothing on it, which is the
 * one reading this app is built against.
 *
 * A failure expands itself. A skip does not: it is an operator's decision or a
 * missing key, and it is named in the line instead — the same judgement
 * `outcomeClasses` and `explainLines` make, from the kernel, so this widget
 * decides only the geometry.
 *
 * Laid out BEFORE the fan-out starts, exactly as the panels are, so the results
 * area can never appear without the accounting that belongs beside it.
 */

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import Pango from '@girs/pango-1.0';

import { reportLine, sourceCensus, type ProviderId, type ProviderReport } from '@troedler/core';

import type { SourceResult } from '../../../core/actions/index.ts';
import { setAccessibleLabel } from '../a11y.ts';
import { outcomeClasses } from './outcome.ts';

const LINE = ['caption'];

/**
 * The disclosure arrows, and why these two.
 *
 * `view-list-symbolic` / `view-more-symbolic` were the wrong pair: the three-dot
 * and the list glyphs are not a disclosure idiom in Adwaita, they are two
 * different *actions*, and the summary line ends in a three-dot menu that then
 * turns into a list — a button that changes what it means when you press it.
 * `pan-end-symbolic` / `pan-down-symbolic` are the pan arrows an
 * `Adw.ExpanderRow` uses, which is the thing this row behaves like.
 *
 * The pair was once the other way round. An arrow that points DOWN at a closed
 * row says „there is more below" while the row is already showing everything
 * that is below it, and one that points RIGHT at an open row hides the reading
 * instruction the open state exists to give — the Adwaita convention is
 * end→down, collapsed→expanded, and it is the only convention here that agrees
 * with the accessible name two constants further down.
 */
const COLLAPSED_ICON = 'pan-end-symbolic';
const EXPANDED_ICON = 'pan-down-symbolic';

/**
 * What a screen reader is told about the toggle.
 *
 * The visible row is a sentence about the search, and read on its own it says
 * nothing about the button inside it — so the accessible name is the ACTION, and
 * it swaps with the state the way the arrow does.
 */
const EXPAND_HINT = 'Quellenbericht zeigen';
const COLLAPSE_HINT = 'Quellenbericht ausblenden';

export class SourceCensus extends Adw.Bin {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerSourceCensus' }, this);
  }

  private readonly box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    marginTop: 10,
    marginBottom: 10,
    marginStart: 12,
    marginEnd: 12,
  });
  /** The whole collapsed line: spinner, sentence, chevron. Toggles the block. */
  private readonly summary = new Gtk.Button({ cssClasses: ['flat'] });
  private readonly summaryRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
  private readonly spinner = new Adw.Spinner({ visible: false });
  private readonly sentence = new Gtk.Label({
    xalign: 0,
    hexpand: true,
    wrap: true,
    wrapMode: Pango.WrapMode.WORD_CHAR,
    cssClasses: LINE,
  });
  private readonly chevron = new Gtk.Image({ iconName: COLLAPSED_ICON });
  private readonly detail = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 2,
    visible: false,
  });
  private readonly lines = new Map<ProviderId, Gtk.Label>();
  private readonly reports = new Map<ProviderId, ProviderReport>();
  /** Sources the search WILL ask, so an unfinished fan-out does not look done. */
  private asked = 0;
  private rows = 0;
  private expanded = false;

  constructor() {
    super({ cssClasses: ['card'] });

    this.summaryRow.append(this.spinner);
    this.summaryRow.append(this.sentence);
    this.summaryRow.append(this.chevron);
    this.summary.set_child(this.summaryRow);
    this.summary.connect('clicked', () => this.setExpanded(!this.expanded));

    this.box.append(this.summary);
    this.box.append(this.detail);
    this.set_child(this.box);
    this.setExpanded(false);
  }

  clear(): void {
    let child = this.detail.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.detail.remove(child);
      child = next;
    }
    this.lines.clear();
    this.reports.clear();
    this.asked = 0;
    this.rows = 0;
    this.expanded = false;
    this.set_visible(false);
  }

  /** Asked, nothing back yet — the state a person must be able to see. */
  pending(id: ProviderId, label: string): void {
    if (this.lines.has(id)) return;
    this.asked += 1;
    const line = new Gtk.Label({
      label: `${label} — wird gesucht …`,
      xalign: 0,
      wrap: true,
      wrapMode: Pango.WrapMode.WORD_CHAR,
      cssClasses: [...LINE, 'dim-label'],
    });
    this.lines.set(id, line);
    this.detail.append(line);
    this.refresh();
  }

  settle(result: SourceResult): void {
    const line = this.lines.get(result.report.provider);
    if (!line) return;
    this.reports.set(result.report.provider, result.report);
    this.rows += result.listings.length;
    line.set_label(reportLine(result.report));
    line.set_css_classes(outcomeClasses(result.report.outcome, LINE));
    this.refresh();
  }

  notAsked(id: ProviderId, label: string): void {
    const line = this.lines.get(id);
    if (line) line.set_label(`${label} — nicht angefragt`);
  }

  /**
   * Re-read the reports and rewrite the one line.
   *
   * The numbers are counted here rather than read off the widgets on purpose:
   * a line that reads its own siblings would have to be re-asked "how many of you
   * are there", and `notAsked` sources must keep their place in the count.
   */
  private refresh(): void {
    const census = sourceCensus([...this.reports.values()], this.asked, this.rows);
    if (!census) {
      this.set_visible(false);
      return;
    }
    this.set_visible(true);
    this.sentence.set_label(census.text);
    this.sentence.set_css_classes(census.tone === 'ok' ? LINE : [...LINE, census.tone]);
    this.spinner.set_visible(this.reports.size < this.asked);
    // A failure is the line a reader must not skim past, so it opens the block
    // itself. Only that far: a user who expanded a clean search keeps it open.
    if (census.expand) this.setExpanded(true);
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.detail.set_visible(expanded);
    this.chevron.set_from_icon_name(expanded ? EXPANDED_ICON : COLLAPSED_ICON);
    this.sentence.set_tooltip_text(expanded ? 'Quellenbericht ausblenden' : 'Quellenbericht zeigen');
    setAccessibleLabel(this.summary, expanded ? COLLAPSE_HINT : EXPAND_HINT);
  }
}
