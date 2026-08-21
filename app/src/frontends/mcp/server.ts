/**
 * The troedler MCP server — several second-hand marketplaces over stdio.
 *
 * v1 is read-only apart from saved searches, and the gate in runtime.ts
 * ENFORCES that rather than trusting it: a tool without `readOnlyHint: true`
 * is dropped unless writes are explicitly allowed. `market_watch_save` is the
 * one mutating tool and it is therefore invisible by default.
 *
 * There is no HTTP or SSE transport here and there must not be one. A local
 * process searching on its owner's behalf and a hosted endpoint answering for
 * many people are different things legally — the first is settled case law in
 * this country, the second is the one the courts struck down. stdio is the
 * shape that cannot accidentally become the second.
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createContext } from '../../core/context.ts';
import { VERSION } from '../../core/runtime.ts';
import { applyReadOnlyGate, serveStdio } from './runtime.ts';
import { registerProviderTools } from './tools/providers.ts';
import { registerSearchTools } from './tools/search.ts';
import { registerWatchTools } from './tools/watch.ts';

const SERVER_NAME = 'troedler';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  // Before any registration — the gate wraps registerTool, so anything
  // registered earlier would slip past it.
  applyReadOnlyGate(server, process.env.TROEDLER_MCP_ALLOW_WRITE === '1');

  const context = createContext();
  registerSearchTools(server, context);
  registerProviderTools(server, context);
  registerWatchTools(server, context);
  return server;
}

export async function startMcpServer(): Promise<void> {
  await serveStdio(createMcpServer(), SERVER_NAME);
}
