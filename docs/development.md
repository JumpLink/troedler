# Development — build, test and the sandbox

Commands in full, plus two ways this workstation will kill the desktop if you get them wrong.
Extracted verbatim from `AGENTS.md`.

## Run / build / test

- Deps: **`gjsify install`** — never `npm install`, it prunes the gjsify deps. Node 24 to
  bootstrap (gjsify's install-backend prebuilds target 24; Fedora's 22 segfaults).
- All six `@gjsify/*` packages are pinned to the **same exact version**. gjsify ships as one
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
(`(setsid env … npx gjsify run … >log 2>&1 </dev/null &)`).

Kill it by PID, and find that PID by reading `/proc/<pid>/cmdline`:

```bash
for p in $(pgrep -x gjs); do tr '\0' ' ' < /proc/$p/cmdline | grep -q troedler && kill $p; done
```

Neither shortcut works. `pkill -f troedler-app` matches the launching shell and kills that
instead. And `pkill -x gjs` is worse than it looks: on a werkstatt workstation that command
matched 52 processes — `org.gnome.Shell.Notifications`, `org.gnome.ScreenSaver`, the postbote and
buchhaltung MCP servers, and the map-editor's signalling server. It kills the desktop to close one
window.
