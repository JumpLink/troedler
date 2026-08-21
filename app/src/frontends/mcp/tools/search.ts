/**
 * Search tools.
 *
 * Two things are deliberately absent from this surface, and both are
 * structural rather than policy:
 *
 *  - **No image bytes.** Images are URLs; the tool cannot return a picture
 *    because there is nothing in the pipeline that ever downloads one.
 *  - **No "what is this worth" tool.** eBay's API licence forbids using eBay
 *    content to suggest or model prices for items listed on eBay. What the
 *    search does return is a description of the offers currently in front of
 *    the user — a median and a band — which is a different claim.
 *
 * Every response carries the per-provider report. An agent that sees `"outcome":
 * "failed"` can say "Kleinanzeigen antwortete nicht" instead of concluding the
 * item does not exist second-hand.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CONDITION_ORDER, fmtMoney, RESULTS_PER_PROVIDER, RESULTS_TOTAL } from '@troedler/core';
import type { Condition, ProviderId } from '@troedler/core';

import { allListings, search } from '../../../core/actions/index.ts';
import type { Context } from '../../../core/context.ts';
import { mcpErrorFrom, mcpSuccess } from '../types.ts';

const PROVIDER_IDS: readonly ProviderId[] = [
  'ebay',
  'kleinanzeigen',
  'discogs',
  'booklooker',
  'zoll-auktion',
  'justiz-auktion',
  'markt-de',
  'quoka',
];

export function registerSearchTools(server: McpServer, context: Context): void {
  server.registerTool(
    'market_search',
    {
      title: 'Search second-hand marketplaces',
      description:
        'Search every enabled marketplace at once and return offers grouped by source, plus a price band over the results. ' +
        'Results are grouped per marketplace by default — check the `reports` array before concluding an item is unavailable: ' +
        'a source can be switched off, unconfigured or failing, which is not the same as having no matches.',
      inputSchema: {
        query: z.string().describe('Free text, e.g. "Bandsäge Metabo". Required unless gtin is given.'),
        providers: z
          .array(z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]))
          .optional()
          .describe('Restrict to these marketplaces; omit for every enabled one'),
        min_price_eur: z.number().nonnegative().optional().describe('Lower bound, euros'),
        max_price_eur: z.number().positive().optional().describe('Upper bound, euros'),
        condition: z
          .array(z.enum(CONDITION_ORDER as unknown as [Condition, ...Condition[]]))
          .optional()
          .describe('Acceptable conditions; listings with an unknown condition are always kept'),
        seller_type: z.enum(['private', 'commercial']).optional().describe('Private or commercial sellers'),
        delivery: z.enum(['shipping', 'pickup']).optional().describe('Shipped or collection only'),
        postal_code: z.string().optional().describe('Origin for a radius search'),
        radius_km: z.number().positive().optional().describe('Radius in km; only some sources honour it'),
        since: z.string().optional().describe('ISO timestamp — only offers listed at or after it'),
        gtin: z.string().optional().describe('EAN/ISBN/GTIN for an exact product match'),
        sort: z
          .enum(['relevance', 'price-asc', 'price-desc', 'newest', 'ending-soonest'])
          .optional()
          .describe('Order within each group'),
        limit: z
          .number()
          .int()
          .positive()
          .max(RESULTS_PER_PROVIDER.max)
          .optional()
          .describe(`Rows per marketplace (default ${RESULTS_PER_PROVIDER.default})`),
        total: z
          .number()
          .int()
          .positive()
          .max(RESULTS_TOTAL.max)
          .optional()
          .describe(`Rows in the merged list (default ${RESULTS_TOTAL.default})`),
        merge: z
          .boolean()
          .optional()
          .describe('Also return one interleaved list across marketplaces (default false)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const result = await search(context, {
          text: params.query,
          providers: params.providers,
          minPriceMinor:
            params.min_price_eur === undefined ? undefined : Math.round(params.min_price_eur * 100),
          maxPriceMinor:
            params.max_price_eur === undefined ? undefined : Math.round(params.max_price_eur * 100),
          condition: params.condition,
          sellerType: params.seller_type,
          delivery: params.delivery,
          postalCode: params.postal_code,
          radiusKm: params.radius_km,
          since: params.since,
          gtin: params.gtin,
          sort: params.sort,
          limit: params.limit,
          total: params.total,
          merge: params.merge ?? false,
        });

        const groups = [...result.outcome.grouped].map(([provider, listings]) => ({
          provider,
          count: listings.length,
          listings: listings.map((l) => ({
            key: l.key,
            title: l.title,
            price: fmtMoney(l.totalPrice ?? l.price),
            price_kind: l.priceKind,
            condition: l.condition,
            seller_type: l.sellerType,
            delivery: l.delivery,
            location: [l.location.postalCode, l.location.city].filter(Boolean).join(' '),
            listed_at: l.listedAt,
            ends_at: l.endsAt,
            url: l.url,
            verdict: result.verdicts.get(l.key),
          })),
        }));

        return mcpSuccess({
          query: params.query,
          no_source_answered: result.noSourceAnswered,
          total: allListings(result.outcome).length,
          price_band: result.stats && {
            count: result.stats.count,
            min: fmtMoney(result.stats.min),
            p25: fmtMoney(result.stats.p25),
            median: fmtMoney(result.stats.median),
            p75: fmtMoney(result.stats.p75),
            max: fmtMoney(result.stats.max),
          },
          groups,
          merged: result.outcome.merged?.map((l) => l.key) ?? null,
          reports: result.outcome.reports.map((r) => ({
            provider: r.provider,
            outcome: r.outcome,
            count: r.count,
            message: r.message,
            truncated: r.truncated,
            warnings: r.warnings,
            filters_applied_by_source: r.filters.serverSide,
            filters_applied_locally: r.filters.clientSide,
            filters_not_applied: r.filters.unenforced,
            disclaimer: r.disclaimer,
          })),
        });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'market_get_listing',
    {
      title: 'Fetch one offer',
      description:
        'Retrieve a single offer in full — description, attributes and image URLs — by the key returned from market_search (e.g. "ebay:v1|123|0"). Returns null when the offer is gone, which is an answer rather than an error.',
      inputSchema: {
        key: z.string().describe('Listing key as `<provider>:<id>`'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const at = params.key.indexOf(':');
        if (at <= 0) return mcpErrorFrom(new Error(`"${params.key}" ist kein gültiger Schlüssel.`));
        const id = params.key.slice(at + 1);
        const provider = context.providers.find((p) => p.capabilities.id === params.key.slice(0, at));
        if (!provider) return mcpErrorFrom(new Error(`Unbekannte Quelle in "${params.key}".`));
        if (!provider.getListing) {
          return mcpErrorFrom(
            new Error(`${provider.capabilities.label} kann einzelne Angebote nicht nachschlagen.`),
          );
        }
        const listing = await provider.getListing(id);
        return mcpSuccess({ listing, disclaimer: provider.capabilities.disclaimer });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
