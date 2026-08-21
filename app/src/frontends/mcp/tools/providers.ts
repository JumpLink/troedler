/**
 * The capability matrix as a tool.
 *
 * An agent should gate on this exactly as a UI would: which sources exist,
 * which are on, which filters each one can push down, how long its results may
 * be reused, and what notice must accompany its rows. Without it, an agent has
 * no way to tell "Kleinanzeigen is switched off because its terms forbid this"
 * from "Kleinanzeigen found nothing" — and it will report the second.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { listProviders, quotas } from '../../../core/actions/index.ts';
import type { Context } from '../../../core/context.ts';
import { mcpErrorFrom, mcpSuccess } from '../types.ts';

export function registerProviderTools(server: McpServer, context: Context): void {
  server.registerTool(
    'market_providers',
    {
      title: 'List marketplaces and what each can do',
      description:
        'Capability matrix for every marketplace troedler knows: enabled state, whether credentials are present, which filters the source applies itself versus which troedler applies afterwards, result caps, cache lifetime, the source record, and any notice that must be shown with its listings.',
      inputSchema: {
        provider: z.string().optional().describe('Restrict to one marketplace id'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const views = await listProviders(context, params.provider as never);
        return mcpSuccess({ count: views.length, providers: views });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'market_quota',
    {
      title: 'Remaining request budget',
      description:
        'How much of each marketplace API budget is left today. Useful before a broad search: eBay allows 5000 calls a day and its OAuth endpoint only 1000.',
      inputSchema: {
        provider: z.string().optional().describe('Restrict to one marketplace id'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return mcpSuccess({ quotas: await quotas(context, params.provider as never) });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
