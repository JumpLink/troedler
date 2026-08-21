/**
 * The fan-out: ask every enabled provider, keep them isolated, report honestly.
 *
 * Two rules govern this file.
 *
 * **One source failing must not fail the search.** Six marketplaces means six
 * ways to have a bad day; a search that dies because Booklooker timed out is
 * useless. Each provider is awaited inside its own catch and lands in the
 * outcome as a report either way.
 *
 * **A provider that returned nothing must be distinguishable from one that was
 * never asked, refused, or broke.** That is why `ProviderReport.outcome` is an
 * enum rather than a row count. A meta-search whose failures look like "no
 * results" is worse than no meta-search: it answers confidently and wrongly,
 * and the user has no way to see it.
 */

import { applyPostFilters, type PostFilterReport } from './filter.ts';
import { dedupeWithinProvider, interleaveByProvider, sortListings } from './merge.ts';
import { ProviderError, type ProviderErrorKind } from './errors.ts';
import { RESULTS_PER_PROVIDER, RESULTS_TOTAL, clamp } from './limits.ts';
import { activeFilters, type SearchQuery } from './query.ts';
import type { Listing, ProviderId } from './listing.ts';
import type { MarketProvider } from './port.ts';

export type ProviderOutcome = 'ok' | 'empty' | 'skipped' | 'failed';

export interface ProviderReport {
  readonly provider: ProviderId;
  readonly label: string;
  readonly outcome: ProviderOutcome;
  readonly count: number;
  /** Present when `outcome === 'failed'` or `'skipped'`. */
  readonly errorKind: ProviderErrorKind | null;
  readonly message: string | null;
  readonly truncated: boolean;
  readonly totalEstimate: number | null;
  readonly requests: number;
  readonly durationMs: number;
  readonly warnings: readonly string[];
  /** Which filters the source honoured, and which this process had to finish. */
  readonly filters: PostFilterReport & { readonly serverSide: readonly string[] };
  /** Required notice for this source's rows, when it has one. */
  readonly disclaimer: string | null;
}

export interface SearchOutcome {
  readonly query: SearchQuery;
  /** Rows per provider, in the requested order. The primary shape — see merge.ts. */
  readonly grouped: ReadonlyMap<ProviderId, readonly Listing[]>;
  /** One flat list. Opt-in; see the eBay co-mingling note in merge.ts. */
  readonly merged: readonly Listing[] | null;
  readonly reports: readonly ProviderReport[];
  readonly startedAt: string;
}

export interface SearchOptions {
  /** Produce the flat list too. Off by default. */
  readonly merge?: boolean;
  readonly totalLimit?: number;
  readonly signal?: AbortSignal;
  /** Injected so tests can pin time. */
  readonly now?: () => number;
}

async function runOne(
  provider: MarketProvider,
  query: SearchQuery,
  options: SearchOptions,
): Promise<{ report: ProviderReport; listings: Listing[] }> {
  const caps = provider.capabilities;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const active = activeFilters(query);

  const base = {
    provider: caps.id,
    label: caps.label,
    truncated: false,
    totalEstimate: null,
    requests: 0,
    warnings: [] as string[],
    disclaimer: caps.disclaimer,
    filters: {
      serverSide: [] as string[],
      clientSide: [] as never[],
      unenforced: [] as never[],
      before: 0,
      after: 0,
    },
  };

  try {
    const status = await provider.status();
    if (!status.configured || status.problem) {
      return {
        listings: [],
        report: {
          ...base,
          outcome: 'skipped',
          count: 0,
          errorKind: status.problem?.kind ?? 'not-configured',
          message: status.problem?.message ?? 'nicht konfiguriert',
          durationMs: now() - started,
        },
      };
    }

    const result = await provider.search(query, options.signal);
    const deduped = dedupeWithinProvider(result.listings);
    const { listings, report } = applyPostFilters(deduped, query, result.applied, active);

    return {
      listings,
      report: {
        ...base,
        outcome: listings.length > 0 ? 'ok' : 'empty',
        count: listings.length,
        errorKind: null,
        message: null,
        truncated: result.truncated,
        totalEstimate: result.totalEstimate,
        requests: result.requests,
        durationMs: now() - started,
        warnings: [...result.warnings],
        filters: { ...report, serverSide: result.applied.map(String) },
      },
    };
  } catch (err) {
    const pe =
      err instanceof ProviderError
        ? err
        : new ProviderError(caps.id, 'remote-error', err instanceof Error ? err.message : String(err));
    return {
      listings: [],
      report: {
        ...base,
        outcome: 'failed',
        count: 0,
        errorKind: pe.kind,
        message: pe.message,
        durationMs: now() - started,
      },
    };
  }
}

export async function searchAll(
  providers: readonly MarketProvider[],
  query: SearchQuery,
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const now = options.now ?? (() => Date.now());
  const startedAt = new Date(now()).toISOString();
  const perProvider = clamp(query.limit, RESULTS_PER_PROVIDER);
  const scoped: SearchQuery = { ...query, limit: perProvider };

  // Concurrent across providers, never within one: the per-host rate limiter in
  // @troedler/http serialises requests to a single marketplace. Different hosts
  // are different budgets, so there is nothing to gain by making them wait.
  const settled = await Promise.all(providers.map((p) => runOne(p, scoped, options)));

  const grouped = new Map<ProviderId, readonly Listing[]>();
  for (const { report, listings } of settled) {
    if (report.outcome === 'ok') grouped.set(report.provider, sortListings(listings, query.sort));
  }

  let merged: Listing[] | null = null;
  if (options.merge) {
    const total = clamp(options.totalLimit, RESULTS_TOTAL);
    const flat =
      query.sort && query.sort !== 'relevance'
        ? sortListings([...grouped.values()].flat(), query.sort)
        : interleaveByProvider(grouped);
    merged = flat.slice(0, total);
  }

  return { query, grouped, merged, reports: settled.map((s) => s.report), startedAt };
}

/** True when every provider either failed or was skipped — "no results" would be a lie. */
export function allSourcesUnavailable(outcome: SearchOutcome): boolean {
  return (
    outcome.reports.length > 0 &&
    outcome.reports.every((r) => r.outcome === 'failed' || r.outcome === 'skipped')
  );
}
