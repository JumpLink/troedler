/**
 * Saved searches, the local index and price history.
 *
 * `market_watch_save` MUTATES, so it carries `readOnlyHint: false` and the gate
 * in runtime.ts drops it unless `TROEDLER_MCP_ALLOW_WRITE=1`. That is the
 * point of the gate: the annotation is the truth, and forgetting it costs a
 * missing tool rather than a silent write.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { fmtMinor, parseListingKey } from '@troedler/core';

import { addSearch, listSearches, removeSearch } from '../../../core/actions/index.ts';
import type { Context } from '../../../core/context.ts';
import { mcpError, mcpErrorFrom, mcpSuccess } from '../types.ts';

export function registerWatchTools(server: McpServer, context: Context): void {
  server.registerTool(
    'market_watch_list',
    {
      title: 'List saved searches',
      description:
        'Saved searches with their last run and how many new offers it turned up, plus the individually watched offers. Reads the local database only — no network.',
      inputSchema: {
        name: z.string().optional().describe('Restrict to one saved search'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const all = listSearches(context);
        const searches = params.name ? all.filter((s) => s.name === params.name) : all;
        return mcpSuccess({
          count: searches.length,
          searches: searches.map((s) => ({
            name: s.name,
            query: s.query,
            providers: s.providers,
            created_at: s.createdAt,
            last_run_at: s.lastRunAt,
            last_run_new: s.lastRunNew,
          })),
          watched: context.store().listWatched(),
        });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'market_search_local',
    {
      title: 'Search what has already been seen',
      description:
        'Query the local index of offers previous watch runs recorded — no network, no marketplace request. Answers "did this come up before, and at what price".',
      inputSchema: {
        saved_search: z.string().describe('Name of the saved search whose history to read'),
        limit: z.number().int().positive().max(500).optional().describe('Rows to return (default 50)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const rows = context.store().listSeen(params.saved_search, params.limit ?? 50);
        return mcpSuccess({
          count: rows.length,
          listings: rows.map((r) => ({
            key: `${r.provider}:${r.listingId}`,
            title: r.title,
            url: r.url,
            price: r.priceMinor === null ? null : fmtMinor(r.priceMinor, r.currency),
            first_seen_at: r.firstSeenAt,
            last_seen_at: r.lastSeenAt,
            gone_at: r.goneAt,
          })),
        });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'market_price_history',
    {
      title: 'Price history of one offer',
      description:
        'Observed price changes for a watched offer, oldest first. Only records what troedler itself saw — marketplaces do not serve history, so there is nothing before the first observation.',
      inputSchema: {
        key: z.string().describe('Listing key as `<provider>:<id>`'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const parsed = parseListingKey(params.key);
        if (!parsed) return mcpError(`"${params.key}" ist kein gültiger Schlüssel.`);
        const rows = context.store().priceHistory(parsed.provider, parsed.id);
        return mcpSuccess({
          count: rows.length,
          observations: rows.map((r) => ({
            observed_at: r.observedAt,
            price: fmtMinor(r.minor, r.currency),
          })),
        });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'market_watch_save',
    {
      title: 'Create, change or remove a saved search',
      description:
        'Persist a search so `troedler watch run` can report only what is new since last time. Writes to the local database.',
      inputSchema: {
        action: z.enum(['add', 'remove']).describe('What to do'),
        name: z.string().describe('Name of the saved search'),
        query: z.string().optional().describe('Free text (required for add)'),
        providers: z
          .array(z.string())
          .optional()
          .describe('Marketplaces to query; omit for every enabled one'),
        min_price_eur: z.number().nonnegative().optional(),
        max_price_eur: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        if (params.action === 'remove') {
          return mcpSuccess({ removed: removeSearch(context, params.name) });
        }
        if (!params.query) return mcpError('Für "add" wird query gebraucht.');
        const saved = addSearch(
          context,
          params.name,
          {
            text: params.query,
            minPriceMinor:
              params.min_price_eur === undefined ? undefined : Math.round(params.min_price_eur * 100),
            maxPriceMinor:
              params.max_price_eur === undefined ? undefined : Math.round(params.max_price_eur * 100),
          },
          (params.providers ?? []) as never,
        );
        return mcpSuccess({ saved });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
