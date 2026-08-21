/**
 * The `MarketProvider` port — the seam the whole project hangs on.
 *
 * Pure: no gi://, no node:*, no dependencies. That is what lets the parts with
 * actual judgement in them — post-filtering, dedup, grouping, ranking — be
 * unit-tested on Node against fake providers, with no network and no GJS.
 *
 * The rule that keeps it that way, borrowed verbatim from postbote's store:
 * **nothing below `app/` may import a provider package.** The kernel talks to
 * providers only through this interface, and `app` injects them. Wanting to
 * import an adapter from the kernel means a method is missing here.
 */

import type { Listing, ProviderId } from './listing.ts';
import type { FilterKey, SearchQuery } from './query.ts';
import type { ProviderErrorKind } from './errors.ts';

/** How a source is reached — the single most important thing to know about it. */
export type AccessKind =
  /** A documented API the operator offers and we are licensed to call. */
  | 'official-api'
  /** Public HTML, fetched within what robots.txt permits. */
  | 'html';

/** How fresh the data is by construction. */
export type Freshness = 'live' | 'snapshot';

export interface CachePolicy {
  /**
   * Seconds a result may be reused. `0` forbids persisting it at all.
   *
   * This is a contractual number, not a performance knob: eBay's API licence
   * caps displayed listing data at six hours. It lives in the capability
   * object so the cache layer enforces it without knowing which provider it is
   * holding.
   */
  readonly ttlSeconds: number;
  /** When true the result may only live in memory for the current process. */
  readonly memoryOnly: boolean;
}

export interface ProviderCapabilities {
  readonly id: ProviderId;
  /** Human-readable name, for CLI, MCP and the future GUI alike. */
  readonly label: string;
  /** The marketplace's own host — the key robots.txt and the terms record hang off. */
  readonly host: string;
  readonly access: AccessKind;
  readonly freshness: Freshness;

  /**
   * Filters this provider applies SERVER-side. Everything else in the query is
   * the kernel's job. Declaring it here — rather than each surface guessing —
   * is what makes `--explain` truthful.
   */
  readonly serverFilters: readonly FilterKey[];
  /** Sort orders the provider can do itself. */
  readonly serverSorts: readonly SearchQuery['sort'][];
  /** Most rows one search can ever return from this source, after paging. */
  readonly maxResults: number;

  readonly cache: CachePolicy;

  /**
   * Off unless the user says otherwise.
   *
   * True for sources with an API we are plainly licensed to call. False where
   * using the source at all is the user's call to make — kleinanzeigen.de
   * forbids automated access in its terms, so troedler will not switch it on
   * for anybody, ever, and this flag is where that refusal lives.
   */
  readonly enabledByDefault: boolean;

  /** Path of the source record under `docs/quellen/`. No adapter without one. */
  readonly termsDoc: string;
  /**
   * A sentence the surfaces must show whenever this provider's rows are
   * displayed, e.g. a required trademark notice. Data, not an `if` chain, so
   * the GUI can render it without knowing which provider it is.
   */
  readonly disclaimer: string | null;
  /** Why this provider is off / what the user must do to use it. Shown by `providers show`. */
  readonly note: string | null;
}

/** What one provider hands back for one query. */
export interface ProviderResult {
  readonly provider: ProviderId;
  readonly listings: readonly Listing[];
  /** Which of the query's filters this provider applied itself. */
  readonly applied: readonly FilterKey[];
  /** True when the source had more rows than it would give us (paging cap, robots limit). */
  readonly truncated: boolean;
  /**
   * The source's own count of matches, when it publishes one. Often an
   * estimate — eBay says so explicitly — so never used for arithmetic, only
   * shown.
   */
  readonly totalEstimate: number | null;
  /** How many HTTP requests this cost. Feeds the rate-limit budget and `--explain`. */
  readonly requests: number;
  /** Non-fatal complaints, including a remote that ignored a filter and said so. */
  readonly warnings: readonly string[];
}

export interface ProviderStatus {
  readonly configured: boolean;
  /** `null` when configured and believed usable; otherwise why not. */
  readonly problem: { readonly kind: ProviderErrorKind; readonly message: string } | null;
}

export interface MarketProvider {
  readonly capabilities: ProviderCapabilities;

  /**
   * Three states, never two: configured and working, configured and broken,
   * not configured. A boolean here is how "nothing found" and "never asked"
   * become indistinguishable.
   */
  status(): Promise<ProviderStatus>;

  /** Throws `ProviderError`. Never returns an empty list to mean failure. */
  search(query: SearchQuery, signal?: AbortSignal): Promise<ProviderResult>;

  /** One offer in full. `null` when the id is gone — that is an answer, not an error. */
  getListing?(id: string, signal?: AbortSignal): Promise<Listing | null>;

  /** Remaining budget at the source, when it publishes one. */
  quota?(
    signal?: AbortSignal,
  ): Promise<{ remaining: number | null; limit: number | null; resetAt: string | null }>;
}
