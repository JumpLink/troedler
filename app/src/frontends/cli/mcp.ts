/**
 * `troedler mcp` — the long-lived stdio server.
 *
 * Deliberately NOT wrapped in `runAndExit`: every other command finishes and
 * exits, this one serves until the client closes stdin. `serveStdio` owns that
 * lifecycle, including the exit — see the reparenting note in mcp/runtime.ts
 * for what happens when nobody does.
 */

import type { CommandModule } from 'yargs';

import { startMcpServer } from '../mcp/server.ts';

export const mcpCommand: CommandModule = {
  command: 'mcp',
  describe: 'Als MCP-Server über stdio laufen',
  builder: (yargs) => yargs,
  handler: () => {
    startMcpServer().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
  },
};
