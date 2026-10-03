# The search toolbar: the arithmetic, the measurements, the invariants

Why the toolbar in `app/src/frontends/gui/views/search-view.blp` looks the way it does. The rule
itself lives in [AGENTS.md](../AGENTS.md); the incident history, the pixel arithmetic and the measured table live here,
because they are the reason the numbers are written down at all.

**A `Gtk.Box` row has no floor, and the search entry paid for it.** It was reported as „the entry
shows an x": under `TR_APP_QUERY=fahrrad` the results are bicycles, but the entry renders as `⊗`.
Not a wrong query — the entry held the full string the whole time, and what a person sees is the
clear glyph with the text squeezed out of the allocation. The cause is that a horizontal `Gtk.Box`
gives every child its natural width and hands the surplus to the only `hexpand` one, so once the
window is narrower than the other five controls need together, the entry absorbs the ENTIRE deficit
and GTK answers by overflowing the row.

The first fix was a floor plus a stack, and the stack is what made it temporary. The other five
controls asked for 509 px between them (price 150, dropdown 139, check 82, buttons 55 + 43, plus 40
spacing and 24 margins), so below ~663 px there is no width for a readable entry and for them at
once: a `width-chars: 12` floor kept the horizontal band above that readable, and an
`Adw.Breakpoint` at 700 px stacked the bar below it. That fixed the width and spent the height — six
rows of controls, a full-width „Suchen", a full-width „Stopp" and then the per-source block, which
at 600 px is nearly the whole window with no results on it.

**What is there now removes the arithmetic instead of working around it.** The three secondary filters
(Höchstpreis, Anbieter, Erklären) live in one `Gtk.MenuButton` popover as `Adw.SpinRow` /
`Adw.ComboRow` / `Adw.SwitchRow`; what is left in the toolbar is the entry, a 34 px filter button and
one run button that becomes „Stopp" while the search runs — 156 px beside the entry against the 509 px
before. The breakpoint is GONE, and a `Gtk.Box` row that asks for 156 px does not need one. The entry
therefore keeps its floor everywhere instead of only above a boundary, and the `Adw.Clamp` around the
row is what stops a 4K window from stretching the entry to a mile.

## How it was measured

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
the whole query. (550/418/197, not the 589/457/236 measured hours earlier with an icon on the run
button: a `Gtk.Button` that has BOTH `label` and `icon-name` draws the icon and drops the label —
see [gui-icons-and-templates.md](./gui-icons-and-templates.md).)

The popover measures 354 px wide, so it fits a 360 px window with 6 px to spare, which is why its
three subtitles are one short line each — an `Adw.ActionRow` does not wrap its subtitle in this
libadwaita, so a longer one measured 388 px and a popover wider than its own window. (An earlier
draft with full sentences measured 587 px over a 600 px window.)

## What has to survive an edit

**The properties that have to survive in `search-view.blp` are `width-chars: 12` and
`hexpand: true` on the `Gtk.SearchEntry`.** A `Gtk.SearchEntry` written into a template without them
brings the 57 px back, and no test here would notice — which is the whole reason these numbers are
written down. `searchView.bar` is no longer public: nothing outside the view needs it, because there
is no breakpoint driving it.

**The toolbar IS a Blueprint template**, and that is the one thing [AGENTS.md](../AGENTS.md) used to
leave open. It used to say the defect was *deliberately NOT fixed on this branch* and left the
before-picture for whoever took it — which was the right call while the branch only MOVED the widget
and the fix belonged on `main`. It is not the right call now: `main` carries the rebuilt toolbar and
the branch carries the same design as `search-view.blp`, so the two facts have to be told once,
together. The template keeps `width-chars: 12`, `hexpand: true`, `troedler-filter-symbolic` and a
`go_button` with a label and no `icon-name`, and the popover is a second template
(`search-view-popover.blp`) because a `Gtk.Popover` is not a child of the view — the button owns it
and shows it over the results.

## Neighbouring traps, same widgets

`validate()` in `config.ts` REBUILDS the config object, so the `ui` section was dropped on every
load and the whole setting was inert while the type check, the lint and the build stayed green
(`config.test.ts` now round-trips it). And `Gtk.Picture` reports its paintable's INTRINSIC width as
its natural width, which in a homogeneous `Gtk.FlowBox` makes one 1600 px photograph set the width
of every card — two columns where four fit. `Adw.Clamp` is the only thing in this toolkit that caps
a natural width; `max-width-chars` on a label that also ellipsizes does not.

Driving the window from an agent (the `TR_APP_*` variables the measurements above use) is in [gui-devtools.md](./gui-devtools.md).
