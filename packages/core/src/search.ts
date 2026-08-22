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
import {
  dedupeWithinProvider,
  groupByIdentity,
  interleaveByProvider,
  sortListings,
  type ListingGroup,
} from './merge.ts';
import { ProviderError, type ProviderErrorKind } from './errors.ts';
import { RESULTS_PER_PROVIDER, RESULTS_TOTAL, clamp } from './limits.ts';
import { activeFilters, type SearchQuery, type SortKey } from './query.ts';
import type { Listing, ProviderId } from './listing.ts';
import type { MarketProvider } from './port.ts';

export type ProviderOutcome = 'ok' | 'empty' | 'skipped' | 'failed';

/** Whether a row carries the field a given order compares on. */
function hasSortKey(l: Listing, sort: SortKey): boolean {
  switch (sort) {
    case 'price-asc':
    case 'price-desc':
      return (l.totalPrice ?? l.price) !== null;
    case 'newest':
      return l.listedAt !== null;
    case 'ending-soonest':
      return l.priceKind === 'auction' && l.endsAt !== null;
    default:
      return true;
  }
}

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
  /** HTTP requests this search cost. `null` when the provider cannot account for them — never a stand-in zero. */
  readonly requests: number | null;
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
  /**
   * Providers whose rows were kept OUT of `merged` because their licence
   * forbids interleaving them with other sources' rows. Their rows are in
   * `grouped` as always — this is a layout rule, not a filter, and a surface
   * that shows `merged` has to say which sources are missing from it.
   */
  readonly mergeExcluded: readonly ProviderId[];
  /**
   * The same rows grouped by PRODUCT identity across sources — "what does this
   * thing cost where". Built only when asked (`SearchOptions.group`), because
   * it costs a pass over every row and most callers want the per-source view.
   *
   * Named apart from `grouped` on purpose: that one is per SOURCE, this one is
   * per THING, and two fields a letter apart would be read as the same field.
   */
  readonly products: readonly ListingGroup[] | null;
  readonly reports: readonly ProviderReport[];
  readonly startedAt: string;
}

/** One provider's finished work, as `onSettled` hands it over. */
export interface SettledProvider {
  readonly report: ProviderReport;
  readonly listings: readonly Listing[];
}

export interface SearchOptions {
  /** Produce the flat list too. Off by default. */
  readonly merge?: boolean;
  /** Produce cross-source product groups too. Off by default. */
  readonly group?: boolean;
  readonly totalLimit?: number;
  readonly signal?: AbortSignal;
  /** Injected so tests can pin time. */
  readonly now?: () => number;
  /**
   * Fired once per provider, in the order the providers were given, before any
   * of them is asked.
   *
   * A CLI can wait: it has scrollback and a prompt that comes back. A window
   * cannot. Eight sources at a two-second-per-host floor means nothing is
   * observable until the slowest one settles, and a pane that shows nothing is
   * pixel-identical to a pane that is broken — this project's own failure mode,
   * in the one surface with no way to scroll back and check.
   */
  readonly onStarted?: (provider: ProviderId, label: string) => void;
  /**
   * Fired as each provider settles, in COMPLETION order.
   *
   * The reports returned at the end are still the record; this is the same data
   * arriving earlier. A surface that renders from here and then re-renders from
   * the return value shows the same thing twice, which is the property that
   * makes it safe.
   */
  readonly onSettled?: (settled: SettledProvider) => void;
}

/**
 * Call a surface's callback without letting it break the search.
 *
 * Exactly the rule one provider's failure already follows: a GTK handler that
 * throws must not reject a fan-out that five sources have already answered.
 * There is nowhere to report it to that is not itself a surface, so it is
 * swallowed — deliberately, and this comment is the record of that decision.
 */
function notify(run: () => void): void {
  try {
    run();
  } catch {
    /* a view's callback must not fail the search */
  }
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
    warnings: [] as string[],
    disclaimer: caps.disclaimer,
    filters: {
      serverSide: [] as string[],
      clientSide: [] as never[],
      unenforced: [] as never[],
      before: 0,
      after: 0,
      dropped: 0,
    },
  };

  // Snapshot before and after, so the count comes from the socket layer rather
  // than from an adapter remembering to update a field before it throws.
  const spentBefore = provider.requestsUsed?.() ?? null;
  const spent = (): number | null => {
    const after = provider.requestsUsed?.() ?? null;
    return spentBefore === null || after === null ? null : after - spentBefore;
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
          requests: spent() ?? 0,
          durationMs: now() - started,
        },
      };
    }

    const result = await provider.search(query, options.signal);
    const deduped = dedupeWithinProvider(result.listings);
    const { listings, report } = applyPostFilters(deduped, query, result.applied, active, {
      limit: query.limit ?? deduped.length,
    });

    return {
      listings,
      report: {
        ...base,
        outcome: listings.length > 0 ? 'ok' : 'empty',
        count: listings.length,
        errorKind: null,
        message: null,
        truncated: result.truncated || report.dropped > 0,
        totalEstimate: result.totalEstimate,
        requests: spent() ?? result.requests,
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
        requests: spent(),
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
  //
  // `onStarted` runs before the first `await` inside the callback, so it fires
  // for every provider in declaration order while the map is still synchronous —
  // which is what lets a view lay out one pending panel per source BEFORE any of
  // them answers. `onSettled` then fires in completion order, and the return
  // value below still carries everything: a surface that renders from the
  // callbacks and re-renders from the result shows the same thing twice.
  const settled = await Promise.all(
    providers.map(async (p) => {
      const caps = p.capabilities;
      if (options.onStarted) notify(() => options.onStarted?.(caps.id, caps.label));
      const one = await runOne(p, scoped, options);
      if (options.onSettled) notify(() => options.onSettled?.(one));
      return one;
    }),
  );

  // Already filtered, ordered and cut by `applyPostFilters` — either the kernel
  // sorted or the provider did, and re-sorting here would overrule whichever it
  // was. That mattered for `relevance`, the one order no cross-provider
  // comparison can reconstruct.
  const grouped = new Map<ProviderId, readonly Listing[]>();
  for (const { report, listings } of settled) {
    if (report.outcome === 'ok') grouped.set(report.provider, listings);
  }

  const mergeExcluded = providers
    .filter((p) => p.capabilities.noCoMingling && grouped.has(p.capabilities.id))
    .map((p) => p.capabilities.id);

  let merged: Listing[] | null = null;
  if (options.merge) {
    const total = clamp(options.totalLimit, RESULTS_TOTAL);
    const mixable = new Map(
      [...grouped].filter(([id]) => !mergeExcluded.includes(id)),
    );
    const flat =
      query.sort && query.sort !== 'relevance'
        ? sortListings([...mixable.values()].flat(), query.sort)
        : interleaveByProvider(mixable);
    merged = flat.slice(0, total);
  }

  // A cross-provider sort compares one field, and a source that never fills it
  // does not take part in that comparison — it lands at the end. Zoll-Auktion
  // sorts `newest` server-side and prints no date on its result cards, so with
  // `--merge --sort newest` every one of its rows sinks below a kleinanzeigen
  // ad from 2020 while `--explain` reports the sort as applied. True, and
  // useless without this.
  if (options.merge && query.sort && query.sort !== 'relevance') {
    for (const { report, listings } of settled) {
      if (report.outcome !== 'ok' || listings.length === 0) continue;
      if (listings.some((l) => hasSortKey(l, query.sort as SortKey))) continue;
      (report.warnings as string[]).push(
        `${report.label} liefert das Feld nicht, nach dem hier sortiert wird (${query.sort}) — ` +
          'in der gemischten Liste stehen diese Zeilen deshalb hinten, unabhängig davon, wie gut sie passen.',
      );
    }
  }

  // Grouping reads across sources, so eBay rows belong in it — the licence
  // rule is about one INTERLEAVED list, and a group that names its sources per
  // row is the isolated presentation, not the mingled one.
  const products = options.group ? groupByIdentity([...grouped.values()].flat()) : null;

  return {
    query,
    grouped,
    merged,
    mergeExcluded: options.merge ? mergeExcluded : [],
    products,
    reports: settled.map((s) => s.report),
    startedAt,
  };
}

/** True when every provider either failed or was skipped — "no results" would be a lie. */
export function allSourcesUnavailable(outcome: SearchOutcome): boolean {
  return (
    outcome.reports.length > 0 &&
    outcome.reports.every((r) => r.outcome === 'failed' || r.outcome === 'skipped')
  );
}
