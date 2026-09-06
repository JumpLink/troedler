/**
 * The accounting that travels with the grid.
 *
 * In the sections layout every source carries its own report at the head of its
 * own block. The grid dissolves those blocks, and dissolving them would also
 * dissolve the one invariant this app was built around: a source that was
 * skipped, refused or broke must never read like a source with nothing to
 * offer. So the grid gets this strip instead — the same five states, the same
 * sentences from `reportLine`, one line each, above the tiles.
 *
 * It is laid out BEFORE the fan-out starts, like the panels, so the results
 * area can never appear without it.
 */

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import Pango from '@girs/pango-1.0';

import { reportLine, type ProviderId } from '@troedler/core';

import type { SourceResult } from '../../../core/actions/index.ts';
import { outcomeClasses } from './outcome.ts';

const LINE = ['caption'];

export class SourceStrip extends Adw.Bin {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerSourceStrip' }, this);
  }

  private readonly box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 2,
    marginTop: 10,
    marginBottom: 10,
    marginStart: 12,
    marginEnd: 12,
  });
  private readonly lines = new Map<ProviderId, Gtk.Label>();

  constructor() {
    super({ cssClasses: ['card'] });
    this.set_child(this.box);
  }

  clear(): void {
    let child = this.box.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.box.remove(child);
      child = next;
    }
    this.lines.clear();
  }

  /** Asked, nothing back yet — the state a person must be able to see. */
  pending(id: ProviderId, label: string): void {
    if (this.lines.has(id)) return;
    const line = new Gtk.Label({
      label: `${label} — wird gesucht …`,
      xalign: 0,
      wrap: true,
      wrapMode: Pango.WrapMode.WORD_CHAR,
      cssClasses: [...LINE, 'dim-label'],
    });
    this.lines.set(id, line);
    this.box.append(line);
  }

  settle(result: SourceResult): void {
    const line = this.lines.get(result.report.provider);
    if (!line) return;
    line.set_label(reportLine(result.report));
    line.set_css_classes(outcomeClasses(result.report.outcome, LINE));
  }

  notAsked(id: ProviderId, label: string): void {
    const line = this.lines.get(id);
    if (line) line.set_label(`${label} — nicht angefragt`);
  }
}
