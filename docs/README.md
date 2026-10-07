# troedler — documentation

Master index. `AGENTS.md` is the router an agent reads first; these files are one hop further out and
are linked from it at the point where each matters.

| File | What it carries |
|---|---|
| [leitplanken.md](leitplanken.md) | The hard rules in full, the case law behind them, and the image rule that was deliberately reversed on 2026-09-06 |
| [architektur.md](architektur.md) | Package layout and what each package may import; the three surfaces (CLI, MCP, GUI) and the seam under them |
| [gruen-und-nichts-geprueft.md](gruen-und-nichts-geprueft.md) | The failure mode this project is built against, every mechanism, and the incidents that produced them |
| [gui.md](gui.md) | Layout incidents with their measurements, the icon-resource trap, and the four guards that now catch what a screenshot used to |
| [development.md](development.md) | Build, test and type-check in full; backgrounding a GJS process; the two commands that kill the desktop |
| [gjsify.md](gjsify.md) | Gaps fixed at the core, the capability probes and the tables they produced, and which shims stay and why |
| [quellen/](quellen/) | One source record per marketplace — robots.txt findings, the terms clause quoted, whether an API exists, bot protection, date checked |

`quellen/` is the one directory an adapter may not exist without: a new source means a source record
first, then an entry in `SOURCES`, then the adapter.

The rule the whole set follows: **an incident is never compressed away.** Every measurement table and
every failure narrative here was moved out of `AGENTS.md` verbatim, not rewritten, because the next
change to the code has to argue with the measurement and not with a line of prose.