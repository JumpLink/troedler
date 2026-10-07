# Architektur — package layout and the three surfaces

Extracted verbatim from `AGENTS.md`. The import rules are the load-bearing part; the tables and the
seam notes are reference.

## Package layout — and the rule that holds it together

| Package | Contains | May import |
|---|---|---|
| `@troedler/core` | **Pure, zero deps.** `Listing`, `SearchQuery`, the `MarketProvider` port and its capability object, normalisation, post-filtering, dedup, grouping, ranking, price statistics, the fan-out | nothing |
| `@troedler/compliance` | **Pure.** robots.txt parser and matcher, the gate, the source register, the opt-out list | `core` |
| `@troedler/http` | The honest UA, per-host rate limiter, robots loader, gate-checked fetch | `core`, `compliance` |
| `@troedler/html` | The only façade over HTML parsing and CSS selectors | nothing |
| `@troedler/<marketplace>` | One `MarketProvider` each | `core`, `http`, `compliance`, `html` |
| `@troedler/store` | SQLite, XDG paths, config manifest, saved searches, seen index, price history | `core`, `node:*` |
| `troedler-cli` (`app/`) | yargs CLI, MCP server, the Adwaita app. Injects the providers | all of the above |

**`store` must never import a provider package, and `core` must import nothing.** The fan-out runs
through the `MarketProvider` port, injected by `app`. That is the only reason the parts with
judgement in them — merge, dedup, ranking, post-filtering, new-versus-seen — are unit-testable on
Node against fake providers and `:memory:`, with no network and no GJS. Wanting to import an
adapter from the kernel means a method is missing on the port.

**Parsing is pure.** Every adapter keeps `parse.ts` free of `fetch`; I/O lives in `request.ts`.
That split is what lets the parsers be tested against fixture HTML without a socket.

## The three surfaces, and the seam under them

CLI, MCP server and the **native GNOME app** are three renderings of the same actions in
`app/src/core/actions/`. Three rules keep them from drifting, and each has an incident behind it:

- **Every sentence a person could quote comes from `@troedler/core`'s `present.ts`.** A view
  decides ANSI codes, column widths and Pango classes — nothing else. Before the extraction the
  provider tri-state already said „an" in one view and „bereit" in another, and „ inkl. Versand"
  stood three times in one file.
- **The GUI is its OWN bundle** (`dist/troedler-app.gjs.mjs`), because `import Adw` becomes a
  top-level `gi://Adw`: folding it into the CLI would make every `troedler search` in a terminal
  load GTK and fail without a display. Measured after the split — `gi://Adw|gi://Gtk` appears 0×
  in the CLI bundle and 1× in the app bundle.
- **A view never lets a core sentence be parsed.** `Adw.PreferencesRow` takes title and subtitle as
  Pango markup by DEFAULT, so `new Adw.ActionRow({ subtitle })` runs a German sentence through an
  XML parser. Justiz-Auktion's ends in `<Auktions-ID>`; Pango refused the whole string and the row
  rendered EMPTY — the one explanation somebody opened that expander to read, with only a
  Gtk-WARNING on a stderr nobody reads. Pass `useMarkup: false` in the CONSTRUCTOR: the parse
  happens on assignment, so a later `set_use_markup(false)` is too late (measured — the warning
  survived it). The same trap is waiting on any row that would carry a listing title, which is
  text other people wrote.
