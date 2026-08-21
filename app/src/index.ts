import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import {
  cacheCommand,
  checkCommand,
  configCommand,
  itemCommand,
  mcpCommand,
  providersCommand,
  quotaCommand,
  robotsCommand,
  searchCommand,
  termsCommand,
  watchCommand,
} from './frontends/cli/index.ts';

function reportError(err: unknown): void {
  // With yargs' `.fail(false)` (below) yargs no longer prints its own usage dump on a
  // validation/demandCommand failure — so we surface every error's message here, exactly once.
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

const parseArgs = () =>
  yargs(hideBin(process.argv))
    .command(searchCommand)
    .command(watchCommand)
    .command(itemCommand)
    .command(providersCommand)
    .command(quotaCommand)
    .command(robotsCommand)
    .command(termsCommand)
    .command(configCommand)
    .command(cacheCommand)
    .command(checkCommand)
    .command(mcpCommand)
    .demandCommand(1, 'Bitte ein Kommando angeben — `troedler --help` listet alle auf.')
    // Reject unknown commands instead of silently resolving — on GJS an unmatched command
    // would otherwise leave the main loop running forever (hang); on Node it would exit 0.
    .strictCommands()
    .scriptName('troedler')
    // Pin the locale: yargs otherwise translates its own chrome ("Commands:", "Options:") from
    // $LANG while every describe string here is fixed, so the help screen would be half in one
    // language and half in the other depending on the machine.
    .locale('de')
    .help()
    // Don't let yargs print its own multi-line usage dump on a validation failure — it doubles
    // with the hint reportError prints. `.fail(false)` makes yargs THROW instead.
    .fail(false)
    .exitProcess(false)
    .parseAsync();

// yargs (with exitProcess(false) + fail(false)) can throw *synchronously* for some nested
// demandCommand failures instead of rejecting. On GJS that surfaces as an uncaught "Module threw
// an exception". Normalize it to a rejection so the handlers below report it exactly once.
let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs();
} catch (err) {
  parsed = Promise.reject(err);
}

// Runtime detection, inlined rather than imported from core/runtime.ts because this must not pull
// a module graph in before the loop is established.
const runningOnGjs = typeof (globalThis as { imports?: unknown }).imports !== 'undefined';

if (runningOnGjs) {
  // GJS has no always-on event loop, so a GLib main loop keeps async command handlers (and the
  // long-lived MCP stdio server) alive and pumps their I/O.
  //
  // Most commands kick off async work and call process.exit() themselves when it finishes (via
  // runAndExit), relying on the loop running in the meantime. So the loop runs until that
  // happens — we must NOT quit it merely because parseAsync settled: a synchronous,
  // fire-and-forget handler settles it long before its work completes. We only step in where
  // nothing else will exit:
  //   - parse/validation errors (rejection) → report + exit;
  //   - yargs' built-in --help / --version → they resolve with no command running.
  //
  // Always exit via process.exit() (gjsify idle-schedules GLib.MainLoop.quit() + system.exit());
  // a bare imports.system.exit() from an async continuation sets GJS's exit flag without quitting
  // the loop and would hang.
  const GLib = (
    globalThis as unknown as {
      imports: { gi: { GLib: { MainLoop: new (ctx: unknown, running: boolean) => { run(): void } } } };
    }
  ).imports.gi.GLib;
  const loop = new GLib.MainLoop(null, false);
  parsed.then(
    (argv) => {
      const a = argv as Record<string, unknown> | undefined;
      if (a?.help || a?.version) process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    },
    (err) => {
      reportError(err);
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 1);
    },
  );
  loop.run();
} else {
  parsed.catch(reportError);
}
