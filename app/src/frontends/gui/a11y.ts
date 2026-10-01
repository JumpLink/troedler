/**
 * One accessible name, set the way GTK 4.12 wants it.
 *
 * `Gtk.Widget:accessible-label` is a real property on every accessible widget
 * since GTK 4.12, and it is the right way to name a button that has no text of
 * its own — a `⊗` inside a filter token, or a row that is a sentence about the
 * search and a toggle at the same time.
 *
 * `@girs/gtk-4.0` declares it only on the two classes that list it in their own
 * property table (`Gtk.ColumnViewRow`, `Gtk.ListItem`), so the type for a plain
 * button is missing while the property works. GJS exposes every GObject property
 * as a snake_case JS property, which is what the cast below reaches; the cast is
 * in ONE place so a fixed typelib is a one-line change here rather than a hunt
 * through the views.
 *
 * Delete this file and use `widget.accessible_label = …` once the types carry it.
 */

import type Gtk from '@girs/gtk-4.0';

type WithAccessibleLabel = { accessible_label: string };

/** The name a screen reader announces for `widget`; `null` clears it. */
export function setAccessibleLabel(widget: Gtk.Widget, label: string | null): void {
  (widget as unknown as WithAccessibleLabel).accessible_label = label ?? '';
}
