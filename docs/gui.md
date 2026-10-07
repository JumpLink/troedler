# GUI — layout incidents, measurements and guards

Every defect in this file survived a green type check, a green lint, a green build and a green test
suite, and was found by looking at a PNG of the running app. Each one is now behind something that
can fail without one. Extracted verbatim from `AGENTS.md`.

**Two layouts, one invariant.** The results area is either a price-sorted grid of cards over every
source or a block per source, chosen in the settings (`config.ui.layout`, GUI-only — the CLI has
one layout and always groups). What is NOT switchable is the accounting: the grid carries a
`SourceCensus` with the same five report states, laid out before the fan-out just as the panels are.
A layout may change how offers are grouped; it may not change whether a skipped source is visible.
Switching re-lays the results already held rather than searching again — a preference is not a
reason to spend somebody's rate limit twice.

Two traps this cost, both measured: `validate()` in `config.ts` REBUILDS the config object, so the
new `ui` section was dropped on every load and the whole setting was inert while the type check,
the lint and the build stayed green (`config.test.ts` now round-trips it). And `Gtk.Picture` reports
its paintable's INTRINSIC width as its natural width, which in a homogeneous `Gtk.FlowBox` makes one
1600 px photograph set the width of every card — two columns where four fit. `Adw.Clamp` is the only
thing in this toolkit that caps a natural width; `max-width-chars` on a label that also ellipsizes
does not.

The app entry point starts with `import 'dotenv/config'` for the same reason the CLI's does.
Leaving it out was a real defect: `troedler check` reported Booklooker „bereit" while the window
beside it said „Kein BOOKLOOKER_API_KEY gesetzt" — same machine, same `.env`.

**A `Gtk.Box` row has no floor, and the search entry paid for it.** It was reported as „the entry
shows an x": under `TR_APP_QUERY=fahrrad` the results are bicycles, but the entry renders as `⊗`.
Not a wrong query — the entry held the full string the whole time, and what a person sees is the
clear glyph with the text squeezed out of the allocation. The cause is that a horizontal `Gtk.Box`
gives every child its natural width and hands the surplus to the only `hexpand` one, so once the
window is narrower than the other five controls need together, the entry absorbs the ENTIRE deficit
and GTK answers by overflowing the row.

The first fix was a floor plus a stack, and the stack is what made it temporary. The other five controls
asked for 509 px between them (price 150, dropdown 139, check 82, buttons 55 + 43, plus 40 spacing and
24 margins), so below ~663 px there is no width for a readable entry and for them at once: a
`width-chars: 12` floor kept the horizontal band above that readable, and an `Adw.Breakpoint` at
700 px stacked the bar below it. That fixed the width and spent the height — six rows of controls, a
full-width „Suchen", a full-width „Stopp" and then the per-source block, which at 600 px is nearly
the whole window with no results on it.

**What is there now removes the arithmetic instead of working around it.** The three secondary filters
(Höchstpreis, Anbieter, Erklären) live in one `Gtk.MenuButton` popover as `Adw.SpinRow` /
`Adw.ComboRow` / `Adw.SwitchRow`; what is left in the toolbar is the entry, a 34 px filter button and
one run button that becomes „Stopp" while the search runs — 156 px beside the entry against the 509 px
before. The breakpoint is GONE, and a `Gtk.Box` row that asks for 156 px does not need one. The entry
therefore keeps its floor everywhere instead of only above a boundary, and the `Adw.Clamp` around the
row is what stops a 4K window from stretching the entry to a mile.

The collapsed source block is the other half. `SourceStrip` printed one wrapped line per source,
always; `SourceCensus` collapses it to `sourceCensus()`'s one line and keeps the lines behind a
toggle. **The line NAMES every source that did not answer and never counts it** — a count would let a
skipped eBay pass for a market with nothing on it, which is the reading the whole block exists to
prevent. A failure expands the block by itself (`expand`); a skip does not, because it is an operator's
decision or a missing key and is named in the line instead. Both sentences live in `@troedler/core`,
so the widget decides geometry and nothing else.

Measured through the devtools plane rather than by eye, stepping the window down. GTK4 has no
GObject `width` (`GetProperty` answers not-found), so the number is the widget's OWN PNG:
`Screenshot` takes a widget path and the IHDR of the result is the allocated width. 2026-10-01,
`TR_APP_QUERY=trekkingrad`, toolbar rebuilt as described — and the allocation does not depend on the
query, `fahrrad` measured the same 34 px-tall row the same day:

| window | entry on `main` | text on `main` | entry now | text now | toolbar row |
|---:|---:|---:|---:|---:|---:|
| 980 px | 349 px | 305 px | **550 px** | **506 px** | 689×34, one row |
| 600 px | **57 px** | **13 px** | **418 px** | **374 px** | 557×34, one row |
| 360 px | 57 px | 13 px | **197 px** | **153 px** | 336×34, one row |

The toolbar row is 34 px tall at every width: it does not stack, and at 360 px the entry still holds
the whole query. (550/418/197, not the 589/457/236 measured hours earlier with an icon on the run button:
a `Gtk.Button` that has BOTH `label` and `icon-name` draws the icon and drops the label — see below.)

The popover measures 354 px wide, so it fits a 360 px window with 6 px to spare, which is why its three
subtitles are one short line each — an `Adw.ActionRow` does not wrap its subtitle in this libadwaita,
so a longer one measured 388 px and a popover wider than its own window. (An earlier draft with full
sentences measured 587 px over a 600 px window.)

**The properties that have to survive in `search-view.blp` are `width-chars: 12` and
`hexpand: true` on the `Gtk.SearchEntry`.** A `Gtk.SearchEntry` written into a template without them
brings the 57 px back, and no test here would notice — which is the whole reason these numbers are
written down. `searchView.bar` is no longer public: nothing outside the view needs it, because there
is no breakpoint driving it.

**The toolbar IS a Blueprint template now**, and that is the one thing this file used to leave open.
It used to say the defect was *deliberately NOT fixed on this branch* and left the before-picture for
whoever took it — which was the right call while the branch only MOVED the widget and the fix belonged
on `main`. It is not the right call now: `main` carries the rebuilt toolbar and the branch carries the
same design as `search-view.blp`, so the two facts have to be told once, together. The template keeps
`width-chars: 12`, `hexpand: true`, `troedler-filter-symbolic` and a `go_button` with a label and no
`icon-name`, and the popover is a second template (`search-view-popover.blp`) because a `Gtk.Popover` is
not a child of the view — the button owns it and shows it over the results.

**An icon name is not a string, it is a dependency on somebody else's package.** The filter button asked
for `view-filter-symbolic`, and **no version of Adwaita has it** — there is no funnel in the theme at
all. It type-checked, compiled, ran, and rendered as an EMPTY WHITE RECTANGLE, because a missing
`-symbolic` on a `Gtk.MenuButton` is not the `image-missing` placeholder a `Gtk.Image` draws. So the
Adwaita apps that need a funnel bundle one, and this does too: an original 16×16 symbolic in
`app/src/frontends/gui/resources/`, compiled into a GResource by `scripts/build-icon-resource.mjs` and
carried **inside the bundle** as base64 — the bundle is the artefact, and a `.gresource` beside it is a
second thing to install and a second thing to lose silently. `MainWindow` registers it first thing.

`scripts/guard-icon-names.mjs` is the part that matters, and it is in CI: it asks whether **each icon
name the GUI uses resolves in the theme this machine has**, which is a question no type system can ask,
and it proves the generated resource still matches its SVG by SHA-256, so an icon edited without
regenerating fails a build that needs nothing but Node. Both halves were measured by putting the old
name back: red, then green. It strips comments before it greps — a guard that reads its own documentation
as a usage fails for ever, the same trap `guard-unused-kernel.mjs` records for the English word „until".

**A screenshot is still the only thing that sees what a widget actually drew.** Three defects on this
toolbar survived a green type check, a green lint, a green build and 1487 green tests: a white rectangle
where an icon belongs, a three-dot menu where a disclosure arrow belongs, and a run button that drew a
magnifier while it was ABORTING the search. Each was found by looking at a PNG of the running app, and
each is now behind something that can fail without one.

**The fourth one was the Blueprint migration, and it is behind `guard-template-types.mjs`.** A `.blp`
template's `$Name` and the `GTypeName` registering it are ONE string, and they were two: the popover's
template said `$TroedlerSearchPopover`, its class said `GTypeName: 'TroedlerFilterPopover'`. GJS refuses
to build a template whose type does not match the one registering it, `super()` throws, and the window
comes up with **no search view in it at all** — an empty frame where the whole app is. The base class has
to match too (`Gtk.Box` declared, `Adw.Bin` extended) and that is the same failure. It passed everything
first, including CI, for the same reason the other three did. The guard asks the question TypeScript
cannot — one string, two files — and needs nothing but Node. Measured by putting the wrong name back:
red, then green.

**Driving it as an agent.** `GJSIFY_DEVTOOLS=1` exports `org.gjsify.Devtools` at
`/eu/jumplink/Troedler/devtools`; `Screenshot`, `DumpTree`, `FindWidget` and `ActivateWidget` work
over `gdbus`. `ResizeWindow(w, h)` and `GetProperty(path, prop)` are the two that answer geometry and
layout questions. The devtools plane cannot type into an entry — `SendKey` takes accelerators — so
**`TR_APP_QUERY=<begriff>` runs a search at startup**, `TR_APP_VIEW=suche|quellen` opens a
view, and `TR_APP_LAYOUT=grid|sections` switches the layout AFTER the query through the same
`setLayout` the settings dialog calls. That last one exists because the devtools plane cannot
operate an `Adw.ComboRow` at all — `ActivateWidget` on its list row reports `true` and changes no
selection, `SendKey` answers `false` — so the live switch would otherwise be the one path here
that can only be checked by reading it. Without the query hook the only screenshottable state of the search view is the empty one,
and every state worth checking is on the other side of a query.
