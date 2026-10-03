# Icons and Blueprint templates: what no type system can ask

Two questions the GUI keeps getting wrong, each found by looking at a PNG of the running app and
then put behind a guard that fails without one. The rules stay in [AGENTS.md](../AGENTS.md); this file holds the incidents
and how the guards measure.

## An icon name is not a string, it is a dependency on somebody else's package

The filter button asked for `view-filter-symbolic`, and **no version of Adwaita has it** — there is
no funnel in the theme at all. It type-checked, compiled, ran, and rendered as an EMPTY WHITE
RECTANGLE, because a missing `-symbolic` on a `Gtk.MenuButton` is not the `image-missing`
placeholder a `Gtk.Image` draws. So the Adwaita apps that need a funnel bundle one, and this does
too: an original 16×16 symbolic in `app/src/frontends/gui/resources/`, compiled into a GResource by
`scripts/build-icon-resource.mjs` and carried **inside the bundle** as base64 — the bundle is the
artefact, and a `.gresource` beside it is a second thing to install and a second thing to lose
silently. `MainWindow` registers it first thing.

`scripts/guard-icon-names.mjs` is the part that matters, and it is in CI: it asks whether **each
icon name the GUI uses resolves in the theme this machine has**, which is a question no type system
can ask, and it proves the generated resource still matches its SVG by SHA-256, so an icon edited
without regenerating fails a build that needs nothing but Node. Both halves were measured by putting
the old name back: red, then green. It strips comments before it greps — a guard that reads its own
documentation as a usage fails for ever, the same trap `guard-unused-kernel.mjs` records for the
English word „until".

## A screenshot is still the only thing that sees what a widget actually drew

Three defects on this toolbar survived a green type check, a green lint, a green build and 1487
green tests: a white rectangle where an icon belongs, a three-dot menu where a disclosure arrow
belongs, and a run button that drew a magnifier while it was ABORTING the search. Each was found by
looking at a PNG of the running app, and each is now behind something that can fail without one.

The magnifier case also produced a layout number: a `Gtk.Button` that has BOTH `label` and
`icon-name` draws the icon and drops the label, which is why the toolbar row measured 550/418/197 px
of entry rather than 589/457/236 — see [gui-toolbar-layout.md](./gui-toolbar-layout.md).

## The fourth one was the Blueprint migration, and it is behind `guard-template-types.mjs`

A `.blp` template's `$Name` and the `GTypeName` registering it are ONE string, and they were two:
the popover's template said `$TroedlerSearchPopover`, its class said `GTypeName:
'TroedlerFilterPopover'`. GJS refuses to build a template whose type does not match the one
registering it, `super()` throws, and the window comes up with **no search view in it at all** — an
empty frame where the whole app is. The base class has to match too (`Gtk.Box` declared, `Adw.Bin`
extended) and that is the same failure. It passed everything first, including CI, for the same
reason the other three did. The guard asks the question TypeScript cannot — one string, two files —
and needs nothing but Node. Measured by putting the wrong name back: red, then green.

`build:app` writes a `<name>.d.blp.ts` beside every `.blp` (ADR 0088 § 4) and those are COMMITTED,
so the drift gate reads a real artifact; `.oxfmtrc.json` excludes them, because a formatter that
rewrote a file two producers already write would make `blueprint types --check` unsatisfiable.

## Driving the window from an agent

`GJSIFY_DEVTOOLS=1`, the `org.gjsify.Devtools` plane and the `TR_APP_*` variables are in [gui-devtools.md](./gui-devtools.md) — that
is how a screenshot of the state worth checking is produced at all.
