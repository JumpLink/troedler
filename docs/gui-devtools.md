# Driving the GUI as an agent

How to get the troedler window into a state worth looking at, screenshot it, and resize it — the
devtools plane and the environment variables that stand in for the controls it cannot operate. The
rule these serve (a screenshot is still the only thing that sees what a widget actually drew) lives
in [AGENTS.md](../AGENTS.md); the incidents it found are in [gui-icons-and-templates.md](./gui-icons-and-templates.md) and [gui-toolbar-layout.md](./gui-toolbar-layout.md).

`GJSIFY_DEVTOOLS=1` exports `org.gjsify.Devtools` at `/eu/jumplink/Troedler/devtools`; `Screenshot`,
`DumpTree`, `FindWidget` and `ActivateWidget` work over `gdbus`. `ResizeWindow(w, h)` and
`GetProperty(path, prop)` are the two that answer geometry and layout questions.

The devtools plane cannot type into an entry — `SendKey` takes accelerators — so
**`TR_APP_QUERY=<begriff>` runs a search at startup**, `TR_APP_VIEW=suche|quellen` opens a view, and
`TR_APP_LAYOUT=grid|sections` switches the layout AFTER the query through the same `setLayout` the
settings dialog calls. That last one exists because the devtools plane cannot operate an
`Adw.ComboRow` at all — `ActivateWidget` on its list row reports `true` and changes no selection,
`SendKey` answers `false` — so the live switch would otherwise be the one path here that can only be
checked by reading it. Without the query hook the only screenshottable state of the search view is
the empty one, and every state worth checking is on the other side of a query.

Geometry by PNG, not by property: GTK4 has no GObject `width` (`GetProperty` answers not-found), so
the allocated width is the IHDR of the widget's own `Screenshot` result. The measurements built on
that are in [gui-toolbar-layout.md](./gui-toolbar-layout.md).

Launch the window detached and find its PID by `/proc/<pid>/cmdline` rather than by name — see [running-and-stopping.md](./running-and-stopping.md).
