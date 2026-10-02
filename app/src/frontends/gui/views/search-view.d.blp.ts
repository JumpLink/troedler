// GENERATED from search-view.blp — do not edit. ADR 0088 says what these exports mean.
// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

/** The GtkBuilder XML this `.blp` compiles to. */
declare const xml: string;
export default xml;

/** The class `template $TroedlerSearchView` defines. */
export declare const GTypeName: 'TroedlerSearchView';

/**
 * Every id inside the template, in source order — what `registerClass` is given.
 *
 * A MUTABLE tuple, and the `readonly` is missing for a reason that is not ours: `@girs`
 * declares `GObject.MetaInfo['InternalChildren']` as `string[]`, so a `readonly` tuple is
 * refused at the call site with TS4104 and the consumer would have to spread it — the
 * boilerplate ADR 0088 exists to remove. The tuple still pins the exact ids and arity,
 * which is the property that matters. `status/open-todos/blueprint.md` carries the
 * upstream half.
 */
export declare const InternalChildren: [
    'entry',
    'filter_button',
    'go_button',
    'chips',
    'notices',
    'scroller',
    'status',
    'results',
];

/** The `_`-prefixed members GJS installs for them. Merge it into the class interface. */
export interface Children {
    _entry: Gtk.SearchEntry;
    _filter_button: Gtk.MenuButton;
    _go_button: Gtk.Button;
    _chips: Gtk.Box;
    _notices: Gtk.Box;
    _scroller: Gtk.ScrolledWindow;
    _status: Adw.StatusPage;
    _results: Gtk.Box;
}
