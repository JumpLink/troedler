# AGENTS.md — troedler

Operating guide for AI agents in the **troedler** repo. Follows the
[agents.md](https://agents.md/) convention; human overview in [README.md](README.md). This repo is
a submodule of **werkstatt**, whose [AGENTS.md](../../AGENTS.md) carries the broader workspace
rules — this file is the troedler-specific layer and wins where they differ.

## What this is

Search several second-hand marketplaces with one query, as a CLI and an MCP server. A TypeScript
monorepo that **runs on GJS via gjsify** (not Node), following the postbote pattern: pure-TS
`packages/*` plus one `app` workspace that carries the gjsify toolchain and picks a frontend at
the yargs entrypoint. A native GNOME/Adwaita GUI is planned and the seams are already cut for it.

**v1 is read-only towards every marketplace.** No account, no login, no listing, no bidding, no
messaging. It reads what is public and tells you what it found.

## Leitplanken (hard rules)

These are not style. Each one is the reason some part of the code looks the way it does, and
removing one silently changes what this project *is*.

|**Local, per user, never central.** No hosted crawler, no shared index, no server endpoint, no
pooling of other people's searches. That is the line between local multi-marketplace software
(BGH I ZR 159/10, permitted) and a hosted meta-search engine (CJEU C-202/12 *Innoweb*,
prohibited). It is why the MCP server speaks stdio and there is no HTTP transport.
|**An official API beats HTML, always.** Where a marketplace offers one, the HTML path is not
implemented at all — not as a fallback, not "for later".
|**robots.txt is a gate, not a hint.** Parsed per host, cached, checked before every request in
`@troedler/http`. Crawl-delay honoured, otherwise ≥2 s and one connection per host. Never build a
URL the gate would refuse: a disallowed filter path is not a feature that unfortunately blocks, it
is the thing the operator forbade.
|**Never logged in.** No cookie jar, no session handling, no account. Without registration there
is no contract of use to breach; with a login, every clause applies.
|**Never circumvent.** No browser user-agent spoofing, no captcha/Cloudflare/Akamai/TLS-fingerprint
bypass, no proxy rotation, no retry with altered headers. **403 and 429 end the attempt with a
plain-language error.** A refusal is a decision, not a hiccup.
|**Never reverse-engineered credentials.** No tokens or keys extracted from apps or binaries, no
private endpoints behind auth. This is the one line here with criminal exposure (§ 202a StGB,
Modern-Solution line of cases through BVerfG 2025) and it is not close to the edge.
|**Cache is query-scoped TTL, never a mirror.** Only queries a user actually made. No paging
through a catalogue, no building a local picture of a market. eBay listing data: ≤6 h by licence.
|**Personal data is filtered while parsing, not cleaned up later.** No seller names or ids, no
profiles, no histories; phone numbers and e-mail addresses stripped from free text at the parser.
Images are URLs — never downloaded, never rehosted.
|**Honest user agent**, `troedler/<version> (+repo-url)`, with a reachable contact. No spoofing.
It is also how an operator who objects can reach us at all.
|**`OPT_OUT_HOSTS` in `@troedler/compliance` is binding.** A host that objects is refused by the
gate and removed in the next release.
|**A new source means a source record first.** `docs/quellen/<host>.md` — robots.txt findings,
the terms clause quoted, whether an API exists, bot protection, date checked — then an entry in
`SOURCES`, then the adapter. No adapter without one.
|**Fixtures are synthetic.** Never commit a real listing, page capture, or database. Measure
against live pages locally; commit only HTML you wrote yourself.

Sources whose terms forbid automated access ship **off**. They are still OFFERED — this project
does not decide for anybody what they may fetch from their own machine — but `providers enable`
prints the operator's clause in full and refuses without `--acknowledge`, and the date lands in the
config.

That split is the point and must not be "simplified" away in either direction. **The request
violates the terms, not the program**: troedler is non-commercial, runs locally, and never fetches
such a source on its own initiative, so a user switching one on does it in their own name and
carries it. Removing the refusal would make the project ship the decision as a default; removing
the source would make it decide for the user instead. Neither is ours to do.

No permission is sought from any operator, and none is implied. What the project offers instead is
accuracy: the clause quoted, robots.txt still enforced even where the terms are not, the pace kept,
and an agent string that says what it is.

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

## The failure mode this project is built against

**Green, and it checked nothing.** A marketplace that changed its markup, refused us, or was never
configured all look identical to "no matches" — and "no matches" is an answer people act on. So:

- `ProviderReport.outcome` is `ok | empty | skipped | failed`, never a row count.
- An adapter that got a page but matched **zero** elements with its selectors throws
  `parse-failed`; it does not return an empty list.
- `openDatabase` writes and reads back a canary row, because gjsify's `node:sqlite` **swallows
  exceptions in `all()`/`get()`** and would otherwise report an empty watchlist forever.
- `searchAll` reports `noSourceAnswered` separately, and the CLI says so in words.
- Every test needs a discriminator: would it still pass if the parser returned nothing?
- `scripts/guard-unused-kernel.mjs` fails CI when an exported `@troedler/core` function is
  unreachable from production. No test can cover this: a test proves a function WORKS, never that
  anything USES it — and the cross-source grouping this project exists for sat dead behind two
  green tests until a live check asked who called it.

`--explain` belongs to the same idea. Where a source cannot push a filter down, the kernel applies
it to the rows that came back — a materially weaker guarantee, and the user has to be able to see
that they got it. It has to be complete about it, too: a filter the kernel applied but did not
name, or one it named that could not remove a row on this source, is the same failure wearing a
report.

## Check against the source, not against your own fixture

Every adapter here was once green against fixtures its own author had written, and a live check
found something wrong in **all four** running sources. Not one number was copied incorrectly — the
defects were all in a response shape that had been *inferred* and then pinned by a fixture built
from the same guess. Zoll-Auktion's `Versand:` row was documented as `Ja`/`Nein` in the DTO, in the
source record and in the fixture; the page prints `Nein` or `Deutschland (10,00 EUR)`, so the
adapter reported every shipping lot as collection-only and its own tests held that in place.

So: a claim about what a page or an API returns is worth what its measurement is worth. Write the
date and the sample into the source record (`docs/quellen/<host>.md`), and when a claim turns out
to be inference, **mark it as inference rather than deleting it** — the trail is what stops the
next person re-deriving the same guess.

## Run / build / test

- Deps: **`gjsify install`** — never `npm install`, it prunes the gjsify deps. Node 24 to
  bootstrap (gjsify's install-backend prebuilds target 24; Fedora's 22 segfaults).
- All five `@gjsify/*` packages are pinned to the **same exact version**. gjsify ships as one
  release train and a CLI ↔ libs skew produces silently broken bundles. Bump them together.
- `typescript` is pinned `^6.0.3`, **not** 7: `gjsify tsc` runs a bundle with TypeScript 6.0.3
  baked in, so a local 7 would give a different diagnostic set than CI.

```bash
gjsify foreach -A check                     # type-check everything (-A includes private workspaces)
gjsify workspace troedler-cli build         # both bundles
gjsify workspace troedler-cli build:app     # → app/dist/troedler-app.gjs.mjs (the GUI)
gjsify workspace troedler-cli test          # @gjsify/unit, on gjs AND node
gjsify run app/dist/troedler.gjs.mjs check
```

The `-A` is load-bearing: without it every `packages/*` is skipped and the check silently covers
only the app. Tests run on **both** runtimes — a change that makes the Node run impossible is in
the wrong file.

A long-running FOREGROUND GJS process is killed by the werkstatt sandbox (Exit 144). Launch the
MCP server or the GUI via **run_in_background**, fully detached
(`(setsid env … npx gjsify run … >log 2>&1 </dev/null &)`) — and kill it with `pkill -x gjs`,
never `pkill -f troedler-app`, which matches the launching shell and kills that instead.

## The three surfaces, and the seam under them

CLI, MCP server and the **native GNOME app** are three renderings of the same actions in
`app/src/core/actions/`. Two rules keep them from drifting, and both have an incident behind them:

- **Every sentence a person could quote comes from `@troedler/core`'s `present.ts`.** A view
  decides ANSI codes, column widths and Pango classes — nothing else. Before the extraction the
  provider tri-state already said „an" in one view and „bereit" in another, and „ inkl. Versand"
  stood three times in one file.
- **The GUI is its OWN bundle** (`dist/troedler-app.gjs.mjs`), because `import Adw` becomes a
  top-level `gi://Adw`: folding it into the CLI would make every `troedler search` in a terminal
  load GTK and fail without a display. Measured after the split — `gi://Adw|gi://Gtk` appears 0×
  in the CLI bundle and 1× in the app bundle.

The app entry point starts with `import 'dotenv/config'` for the same reason the CLI's does.
Leaving it out was a real defect: `troedler check` reported Booklooker „bereit" while the window
beside it said „Kein BOOKLOOKER_API_KEY gesetzt" — same machine, same `.env`.

**Driving it as an agent.** `GJSIFY_DEVTOOLS=1` exports `org.gjsify.Devtools` at
`/eu/jumplink/Troedler/devtools`; `Screenshot`, `DumpTree`, `FindWidget` and `ActivateWidget` work
over `gdbus`. The devtools plane cannot type into an entry — `SendKey` takes accelerators — so
**`TR_APP_QUERY=<begriff>` runs a search at startup**, and `TR_APP_VIEW=suche|quellen` opens a
view. Without the query hook the only screenshottable state of the search view is the empty one,
and every state worth checking is on the other side of a query.

## Fix gjsify gaps at the core

gjsify is a first-party dependency, not vendored third-party code. A missing capability gets fixed
in the `gjsify/gjsify` submodule with a test, and troedler picks it up on a version bump.

**Two gaps went this way and both are closed as of gjsify 0.42.0** — worth keeping because they
are what the rule is for, and because both bit on GJS while Node stayed green:

- **`URL` was immutable.** Every setter threw, and `url.searchParams` handed back a DETACHED copy
  whose `set`/`append`/`delete` reported success and were discarded. Discogs' `/database/search`
  therefore went out with no query at all and answered with 34.7 million rows of everything.
  Fixed upstream (PR #1245).
- **`@gjsify/domparser` was an XML parser.** No HTML5 tree construction, no entity decoding, and
  `querySelectorAll` matched tag names only — on a real 329 KB results page, `.aditem` → 0 hits.
  `@troedler/html` wrapped three npm parsers until PR #1250 landed an HTML5 tokenizer, a tree
  builder and a CSS Selectors 4 engine. The façade is narrow precisely so that swap was one file.

Unavoidable shims carry **one of two markers, and they mean opposite things at bump time**:

- `// fixed upstream in gjsify: …` — the fix LANDED. Delete the shim at the next bump.
- `// gjsify gap (unfixed, <PR>): …` — no upstream fix yet. The shim is **load-bearing**.

**Neither marker is a substitute for measuring.** A bump re-measures the behaviour and believes the
result, not the note — and the measurement has to be able to FAIL. For the URL fix that meant
running the same 13-check probe against 0.41.0 (6 red) and 0.42.0 (all green); for the parser swap
it meant running both parsers over the same live pages and diffing what the adapters made of them
(byte-identical over 10 auction cards, one full detail page and 20 classified ads).

Watch for spec differences the old library papered over. The one that bit: `tagName` is UPPERCASE
in the DOM and was lowercase in `domhandler`, so `node.tagName === 'dt'` silently stopped matching
and a whole `<dl>` came back empty. Prefer `localName`.

`app/src/frontends/mcp/runtime.ts` is a **verbatim copy** of postbote's, which carries it as an
extraction candidate for `@gjsify/mcp`. This is the second copy, so the duplication rule now
applies: change it in both or in neither, and prefer extracting it.

## Conventions

- Conventional commits (`feat(ebay): …`, `fix(store): …`), imperative, subject ≤ 50 chars.
  Run `gjsify foreach -A check` and the tests before committing. No `--no-verify`.
- **No TypeScript parameter properties** (`constructor(private x: T)`). Node's
  `--experimental-strip-types` rejects them, which silently breaks the Node test run.
- User-facing strings are German; code comments and docs are English. Comments explain **why**.
- Presentation constants (labels, formatting) live in `@troedler/core`, never in a view — a second
  copy is how the CLI and the GUI end up disagreeing about the same offer.
- This repo is a **submodule of werkstatt**: commit here on `main`, push, *then* bump the pointer
  in the parent. Never stage across that boundary in one commit.
