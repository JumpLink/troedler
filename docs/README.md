# docs/

Two kinds of document live here: the per-source records (one per marketplace, the evidence a fetch
decision rests on) and the notes behind rules that [AGENTS.md](../AGENTS.md) states. A source record is what makes an
adapter admissible at all — no adapter without one.

## Source records — `quellen/`

One file per source, named after its host. Each holds the robots.txt findings, the terms clause
quoted, whether an official API exists, what bot protection answers, the measurements taken against
live pages, and the date a human last checked. `troedler terms` and the CLI's skip messages point
here, so the file a reader lands on is the one the program quotes.

| Source | Access | Default |
|---|---|---|
| [`quellen/ebay.de.md`](./quellen/ebay.de.md) | official Browse API | on |
| [`quellen/discogs.com.md`](./quellen/discogs.com.md) | official API | on |
| [`quellen/booklooker.de.md`](./quellen/booklooker.de.md) | official API | on |
| [`quellen/zoll-auktion.de.md`](./quellen/zoll-auktion.de.md) | public HTML | on |
| [`quellen/justiz-auktion.de.md`](./quellen/justiz-auktion.de.md) | public HTML | on |
| [`quellen/quoka.de.md`](./quellen/quoka.de.md) | public HTML | on |
| [`quellen/markt.de.md`](./quellen/markt.de.md) | public HTML | **off** (terms forbid automated access) |
| [`quellen/kleinanzeigen.de.md`](./quellen/kleinanzeigen.de.md) | public HTML | **off** (terms forbid it; robots.txt blocks the filter paths too) |

## Notes behind rules

| File | Holds |
|---|---|
| [gui-toolbar-layout.md](./gui-toolbar-layout.md) | The search toolbar: the `⊗` incident, the pixel arithmetic that removed the breakpoint, the measured entry widths, and the properties that must survive in `search-view.blp`. |
| [gui-icons-and-templates.md](./gui-icons-and-templates.md) | Why the funnel icon is bundled as base64 and checked against the installed theme, and why `guard-template-types.mjs` exists — the four defects a screenshot found. |
| [gui-devtools.md](./gui-devtools.md) | Driving the window as an agent: the devtools plane, `TR_APP_QUERY`/`TR_APP_VIEW`/`TR_APP_LAYOUT`, and measuring geometry from a PNG. |
| [running-and-stopping.md](./running-and-stopping.md) | Launching the MCP server or the window detached, and the two `pkill` shortcuts that kill the desktop. |
| [gjsify-gaps-and-bump-probes.md](./gjsify-gaps-and-bump-probes.md) | The upstream gaps fixed in gjsify, what the shim markers mean at bump time, and how each version bump was measured. |

The rules these support stay in [AGENTS.md](../AGENTS.md) — this repo's context file is a router, not a handbook: the rule
and one link, with the reasoning one hop away.
