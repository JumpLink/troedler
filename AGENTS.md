# AGENTS.md — troedler

Operating guide for AI agents in the **troedler** repo. Follows the
[agents.md](https://agents.md/) convention; human overview in [README.md](README.md). This repo is
a submodule of **werkstatt**, whose [AGENTS.md](../../AGENTS.md) carries the broader workspace
rules — this file is the troedler-specific layer and wins where they differ.

**This file is a router.** What an agent needs before it opens anything stays here; everything else
lives one hop away in [docs/](docs/README.md) and is linked at the point where it matters.

## What this is

Search several second-hand marketplaces with one query, as a CLI and an MCP server. A TypeScript
monorepo that **runs on GJS via gjsify** (not Node), following the postbote pattern: pure-TS
`packages/*` plus one `app` workspace that carries the gjsify toolchain and picks a frontend at
the yargs entrypoint. A native GNOME/Adwaita GUI is planned and the seams are already cut for it.

**v1 is read-only towards every marketplace.** No account, no login, no listing, no bidding, no
messaging. It reads what is public and tells you what it found.

## Leitplanken (hard rules)

Not style. Each one is the reason some part of the code looks the way it does, and removing one
silently changes what this project **is**. Full text, the case law and the incidents behind them:
[docs/leitplanken.md](docs/leitplanken.md).

| Rule | The line it draws |
|---|---|
| **Local, per user, never central** | No hosted crawler, no shared index, no HTTP transport — the line between permitted local software and a prohibited hosted meta-search engine (BGH I ZR 159/10 vs. CJEU C-202/12 *Innoweb*) |
| **An official API beats HTML, always** | Where a marketplace offers one, the HTML path is not implemented at all — not as a fallback, not "for later" |
| **robots.txt is a gate, not a hint** | Parsed per host, cached, checked before every request; never build a URL the gate would refuse |
| **Never logged in** | No cookie jar, no session, no account — without registration there is no contract of use to breach |
| **Never circumvent** | No UA spoofing, no captcha/bot/TLS-fingerprint bypass, no proxy rotation. **403 and 429 end the attempt** — a refusal is a decision, not a hiccup |
| **Never reverse-engineered credentials** | No tokens from apps or binaries, no private endpoints. The one line here with criminal exposure (§ 202a StGB) |
| **Cache is query-scoped TTL, never a mirror** | Only queries a user actually made; no paging a catalogue, no local picture of a market |
| **Personal data is filtered while parsing** | No seller names, profiles or histories; phone and e-mail stripped at the parser, not cleaned up later |
| **Images are fetched to be SHOWN, never kept** | Bytes go to a widget — never to disk, never rehosted, never redistributed. This rule was the OPPOSITE until 2026-09-06; [why it changed](docs/leitplanken.md) |
| **Honest user agent** | `troedler/<version> (+repo-url)` with a reachable contact. It is also how an operator who objects can reach us |
| **`OPT_OUT_HOSTS` is binding** | A host that objects is refused by the gate and removed in the next release |
| **A new source means a source record first** | `docs/quellen/<host>.md` — then `SOURCES`, then the adapter. No adapter without one |
| **Fixtures are synthetic** | Never commit a real listing, page capture or database. Measure against live pages locally |

Sources whose terms forbid automated access ship **off** — still offered, refused without
`--acknowledge`, with the operator's clause printed in full. **The request violates the terms, not the
program**, and that split must not be "simplified" away in either direction.

## The failure mode this project is built against

**Green, and it checked nothing.** A marketplace that changed its markup, refused us, or was never
configured all look identical to "no matches" — and "no matches" is an answer people act on. The
mechanisms, the measurements and the incidents behind them:
[docs/gruen-und-nichts-geprueft.md](docs/gruen-und-nichts-geprueft.md).

- `ProviderReport.outcome` is `ok | empty | skipped | failed`, **never a row count**.
- An adapter that got a page and matched **zero** elements throws `parse-failed`; it does not return
  an empty list.
- Every test needs a discriminator: would it still pass if the parser returned nothing?
- A pass that spends requests must report **what it spent AND what it left out**.
- `scripts/guard-unused-kernel.mjs` fails CI when an exported `@troedler/core` function is unreachable
  from production — a test proves a function WORKS, never that anything USES it.

## Package layout

Seven packages; the full table with what each may import:
[docs/architektur.md](docs/architektur.md). The invariant that holds it together:

**`store` must never import a provider package, and `core` must import nothing.** The fan-out runs
through the `MarketProvider` port, injected by `app`. Wanting to import an adapter from the kernel
means a method is missing on the port. **Parsing is pure** — every adapter keeps `parse.ts` free of
`fetch`; I/O lives in `request.ts`.

## Licence

App and repo root: AGPL-3.0-or-later. `packages/{core,http,html,store,compliance}`:
LGPL-3.0-or-later (`LICENSE` = LGPL text, `COPYING` = GPL text). The marketplace adapters
(`ebay`, `discogs`, `booklooker`, `auktion`, `kleinanzeigen`, `markt`) stay AGPL by decision: they
are adapters for third-party platforms. An LGPL package must never depend on an AGPL one. No SPDX
headers in sources.

## Run / build / test

```bash
gjsify foreach -A check                     # type-check everything (-A includes private workspaces)
gjsify workspace troedler-cli build         # both bundles
gjsify workspace troedler-cli build:app     # → app/dist/troedler-app.gjs.mjs (the GUI)
gjsify workspace troedler-cli test          # @gjsify/unit, on gjs AND node
gjsify run app/dist/troedler.gjs.mjs check
```

Deps with **`gjsify install`**, never `npm install` — it prunes the gjsify deps. All six
`@gjsify/*` packages stay pinned to the **same exact version**; they ship as one release train. The
`-A` is load-bearing: without it every `packages/*` is skipped and the check silently covers only the
app. Tests run on **both** runtimes.

Two ways this workstation will kill the desktop, and the full procedure for backgrounding a GJS
process: [docs/development.md](docs/development.md). Short version: `pkill -x gjs` is **not** a way
to stop one app, and a long-running FOREGROUND GJS process is killed by the sandbox (Exit 144).

## The three surfaces, and the seam under them

CLI, MCP server and the **native GNOME app** are three renderings of the same actions in
`app/src/core/actions/`. Three rules keep them from drifting, and each has an incident behind it —
[docs/architektur.md](docs/architektur.md#the-three-surfaces-and-the-seam-under-them):

- **Every sentence a person could quote comes from `@troedler/core`'s `present.ts`.** A view decides
  ANSI codes, column widths and Pango classes — nothing else.
- **The GUI is its OWN bundle** (`dist/troedler-app.gjs.mjs`), because `import Adw` becomes a
  top-level `gi://Adw`.
- **A view never lets a core sentence be parsed.** `Adw.PreferencesRow` takes title and subtitle as
  Pango markup **by default**, so `new Adw.ActionRow({ subtitle })` runs a German sentence through an
  XML parser. Pass `useMarkup: false` in the **constructor** — the parse happens on assignment.

GUI layout, the measured window/allocation tables, the icon-resource trap and the four guards that
now catch what a screenshot used to: [docs/gui.md](docs/gui.md).

## Fix gjsify gaps at the core

gjsify is a first-party dependency, not vendored third-party code. A missing capability gets fixed in
the `gjsify/gjsify` submodule with a test, and troedler picks it up on a version bump. Unavoidable
shims carry **one of two markers, and they mean opposite things at bump time**:

- `// fixed upstream in gjsify: …` — the fix LANDED. Delete the shim at the next bump.
- `// gjsify gap (unfixed, <PR>): …` — no upstream fix yet. The shim is **load-bearing**.

**Neither marker is a substitute for measuring** — a bump re-measures and believes the result, not the
note. Gap history, the capability probes and the tables they produced:
[docs/gjsify.md](docs/gjsify.md).

## Conventions

- Conventional commits (`feat(ebay): …`, `fix(store): …`), imperative, subject ≤ 50 chars. Run
  `gjsify foreach -A check` and the tests before committing. No `--no-verify`.
- **No TypeScript parameter properties** (`constructor(private x: T)`). Node's
  `--experimental-strip-types` rejects them, which silently breaks the Node test run.
- User-facing strings are German; code comments and docs are English. Comments explain **why**.
- Presentation constants (labels, formatting) live in `@troedler/core`, never in a view — a second
  copy is how the CLI and the GUI end up disagreeing about the same offer.
- This repo is a **submodule of werkstatt**: commit here on `main`, push, *then* bump the pointer
  in the parent. Never stage across that boundary in one commit.