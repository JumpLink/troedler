# Running and stopping the GJS processes

How to start the MCP server or the window so they survive, and how to stop exactly one of them
without taking the desktop with it. The rule (a foreground GJS process is killed by the werkstatt
sandbox) is one line in [AGENTS.md](../AGENTS.md); the incidents are here, because the obvious two shortcuts both kill
something else.

A long-running FOREGROUND GJS process is killed by the werkstatt sandbox (Exit 144). Launch the MCP
server or the GUI via **run_in_background**, fully detached (`(setsid env … npx gjsify run … >log
2>&1 </dev/null &)`).

Kill it by PID, and find that PID by reading `/proc/<pid>/cmdline`:

```bash
for p in $(pgrep -x gjs); do tr '\0' ' ' < /proc/$p/cmdline | grep -q troedler && kill $p; done
```

Neither shortcut works. `pkill -f troedler-app` matches the launching shell and kills that instead. And
`pkill -x gjs` is worse than it looks: on a werkstatt workstation that command matched 52 processes —
`org.gnome.Shell.Notifications`, `org.gnome.ScreenSaver`, the postbote and buchhaltung MCP servers, and
the map-editor's signalling server. It kills the desktop to close one window.
