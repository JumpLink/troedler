# gjsify gaps: what was fixed upstream, and how each bump was measured

gjsify is a first-party dependency here, not vendored third-party code: a missing capability gets
fixed in the `gjsify/gjsify` submodule with a test, and troedler picks it up on a version bump. This
file is the record behind that rule — which gaps went that way, what the two shim markers mean at
bump time, and how each version bump was measured. The rule itself and the marker list stay in [AGENTS.md](../AGENTS.md).

## The three gaps that went this way, all closed — the last two at gjsify 0.52.0

They stay written down because they are what the rule is for, and because every one bit on GJS while
Node stayed green:

- **`URL` was immutable.** Every setter threw, and `url.searchParams` handed back a DETACHED copy
  whose `set`/`append`/`delete` reported success and were discarded. Discogs' `/database/search`
  therefore went out with no query at all and answered with 34.7 million rows of everything.
  PR #1245 (0.42.0) fixed `searchParams` and the `search` setter — **and only those**, which is the
  part worth remembering: at the 0.47.0 bump a 21-check probe still printed all nine other setters
  as `setting getter-only property`. #1678 (0.52.0) fixed the nine; re-measured on 0.52.0, all ten
  are green, so `scripts/guard-url-setters.mjs` was deleted WHOLE. Its predecessor had been deleted
  the same way at 0.42.0 — on a PARTIAL fix, which is how the remaining nine spent five releases
  unguarded. **Delete a guard when the measurement has no red line left, not when one line turned.**
- **`@gjsify/domparser` was an XML parser.** No HTML5 tree construction, no entity decoding, and
  `querySelectorAll` matched tag names only — on a real 329 KB results page, `.aditem` → 0 hits.
  `@troedler/html` wrapped three npm parsers until PR #1250 landed an HTML5 tokenizer, a tree
  builder and a CSS Selectors 4 engine. The façade is narrow precisely so that swap was one file.
- **`node:sqlite` swallowed every SQL error.** `all()` and `get()` caught and returned `[]` /
  `undefined`, so a query against a column that does not exist reported "nothing found" forever.
  #1674 (0.52.0) lets a rejected query raise; #1756 made `undefined` bind NULL like Node 26.10.
  The canary in `packages/store/src/db.ts` STAYS — it cost three statements at open, and a read
  path that quietly returns nothing was never only about swallowed exceptions. Three MORE libgda
  gaps closed at 0.53.0 and this store sits on two of them (#1841, #1893 — measured below).

## Measuring a bump

**Neither marker is a substitute for measuring.** A bump re-measures the behaviour and believes the
result, not the note — and the measurement has to be able to FAIL. For the URL fix that meant
running the same 13-check probe against 0.41.0 (6 red) and 0.42.0 (all green); for the parser swap
it meant running both parsers over the same live pages and diffing what the adapters made of them
(byte-identical over 10 auction cards, one full detail page and 20 classified ads).

A probe that only covers what the release note mentions measures the note. The 0.42.0 → 0.47.0 bump
was checked with a 25-check capability probe built and run under gjs on BOTH versions; output was
byte-identical, 22 green and 3 red on each. No regression, and the three reds are two open gaps
nobody had written down (the URL setters above, and `all()` / `get()` still swallowing SQL errors —
see the marker in `packages/store/src/db.ts`).

**0.47.0 → 0.52.0, same method, opposite outcome.** The 21-check probe on both versions, and this
time the diff IS the result: **14 red of 21 on 0.47.0, 0 red on 0.52.0** — the nine setters,
`all()`/`get()` raising (missing table, missing column), `undefined` binding NULL. Also the honest
reading of the gap markers: both had said "unfixed", and both were true until the release that
carried the fix. The HTML5 parser checks were covered by the adapters' own suites, on gjs AND node.

**0.52.0 → 0.53.0: the probe became a committed file, because a probe that lives only in a
conversation cannot be re-run by the next person.** `scripts/probe-gjsify-0.53.mjs` holds it, and
it gates CI on both runtimes. Measured, same method:

| gjs | result |
|---|---|
| 0.52.0 | 21 green, **3 red** |
| 0.53.0 | **24 green**, 0 red |

The three that turned are the parts of `node:sqlite` this store actually leans on. **#1841** read an
INTEGER above 2^31 as "Ganzzahlwert ist zu groß" — an outright refusal — and `price_minor` is an
INTEGER column, so a five-figure bike price was the shape that would have hit it; timestamps are
TEXT and were never affected, which is why the mistake was available to make. **#1893** made an
`EXISTS` subquery parse at all. Neither is a shim in this repo and neither needed code here: the
point is that the probe found them, which a release-note reading would not have.

The probe also earns its place by catching **its own** wrong assumption. `undefined` binding NULL
was asserted as a cross-runtime equality and came back red on Node — because node 24, the version
that bootstraps this toolchain, REFUSES it while gjsify binds NULL like Node 26.10. Since no
statement in `packages/store` binds `undefined` (every nullable column is bound as a literal
`null`), that check now asserts what the code does and prints the difference as a note instead of
pretending the two runtimes agree.

## What did NOT change at 0.53.0, and why the markers stay

Not one shim in this repo had its fix in 0.53.0, so none was deleted — and the reason each stays is
its own, not affection:

- The canary in `packages/store/src/db.ts`. The gap closed at 0.52.0; the check outlived it
  because swallowed exceptions were never the only way a write goes in and a read comes back
  empty.
- The composed-URL shapes in `packages/markt/src/shared.ts` and
  `packages/discogs/src/request.ts`. Mutation works and always did after 0.52.0; the shape says
  what it builds instead of subtracting from something else.
- `btoa` over GLib's base64 in `packages/ebay` — still polyfilled by `@gjsify/node-globals`
  0.53.0, confirmed by reading the shipped `register/encoding.js`, not by remembering 0.52.0.
- The 404-message sniffs in `packages/auktion/src/justiz.ts` and `packages/ebay/src/provider.ts`.
  Not gjsify gaps at all: the fix belongs in `@troedler/core` / `@troedler/http`, which should
  carry the HTTP status on the error.

Watch for spec differences the old library papered over. The one that bit: `tagName` is UPPERCASE in
the DOM and was lowercase in `domhandler`, so `node.tagName === 'dt'` silently stopped matching and
a whole `<dl>` came back empty. Prefer `localName`.

## `@gjsify/mcp`: the extraction at 0.54.0

`app/src/frontends/mcp/runtime.ts` was a **verbatim copy** of postbote's, which carried it as an
extraction candidate for `@gjsify/mcp`. At 0.54.0 it IS that package: gate, stdio lifecycle and
uniform tool result moved upstream, `runtime.ts` and `types.ts` are gone, and nothing was
re-implemented on the way in — same helpers, same signatures, so no client surface moved. **The
tests do NOT move with it** — `gate.test.ts` imports the gate from `@gjsify/mcp` and still pins the
fail-closed direction, because an upstream flip would otherwise surface only as a mutating tool in
`tools/list`; `npm run test:mcp` asserts the same on the wire.

`build:app` writes a `<name>.d.blp.ts` beside every `.blp` (ADR 0088 § 4) and those are COMMITTED,
so the drift gate reads a real artifact; `.oxfmtrc.json` excludes them, because a formatter that
rewrote a file two producers already write would make `blueprint types --check` unsatisfiable.
