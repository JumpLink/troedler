/**
 * Saved searches, the seen index, price history and the watchlist.
 *
 * The one discipline that makes this coherent: **`troedler search` never
 * writes here.** Only `watch run` and `watch check` do. Two reasons — a search
 * that quietly marked results as "seen" would make the next alert lie by
 * omission, and a read that grows a database is a surprise nobody wants from a
 * search command.
 *
 * No provider package is imported here, and none ever may be. The port lives
 * in `@troedler/core`; this package deals in rows. It is the only reason the
 * new-versus-seen logic — the fiddliest code in the project — can be tested on
 * Node against `:memory:` with fabricated listings and no network at all.
 */

import type { Listing, ProviderId, SearchQuery } from '@troedler/core';
import { normalizeTitle } from '@troedler/core';
import type { Database } from './db.ts';

export interface SavedSearch {
  readonly name: string;
  readonly query: SearchQuery;
  readonly providers: readonly ProviderId[];
  readonly createdAt: string;
  readonly lastRunAt: string | null;
  readonly lastRunNew: number;
}

export interface SeenRow {
  readonly provider: ProviderId;
  readonly listingId: string;
  readonly title: string;
  readonly url: string;
  readonly priceMinor: number | null;
  readonly currency: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly goneAt: string | null;
}

export class Store {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  // ── saved searches ──────────────────────────────────────────────────────

  saveSearch(name: string, query: SearchQuery, providers: readonly ProviderId[], now: string): void {
    const existing = this.getSearch(name);
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO saved_searches
           (name, query_json, providers_json, created_at, last_run_at, last_run_new)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        JSON.stringify(query),
        JSON.stringify(providers),
        existing?.createdAt ?? now,
        existing?.lastRunAt ?? null,
        existing?.lastRunNew ?? 0,
      );
  }

  getSearch(name: string): SavedSearch | null {
    const row = this.#db.prepare(`SELECT * FROM saved_searches WHERE name = ?`).get(name) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToSearch(row) : null;
  }

  listSearches(): SavedSearch[] {
    const rows = this.#db.prepare(`SELECT * FROM saved_searches ORDER BY name`).all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToSearch);
  }

  removeSearch(name: string): boolean {
    const before = this.getSearch(name);
    this.#db.prepare(`DELETE FROM seen_listings WHERE saved_search = ?`).run(name);
    this.#db.prepare(`DELETE FROM saved_searches WHERE name = ?`).run(name);
    return before !== null;
  }

  // ── the seen index ──────────────────────────────────────────────────────

  /**
   * Fold a run's results into the index and report what is genuinely new.
   *
   * "New" means: not in the index for this saved search. Not "listed since the
   * last run" — a marketplace's own timestamps are unreliable enough (relative
   * dates, relists that keep their original date, indexing lag) that trusting
   * them would either miss offers or re-announce old ones. Identity is the
   * source's own id, which is the one thing that does not drift.
   *
   * Returns the new rows. Everything already known has its `last_seen_at`
   * refreshed and a price observation recorded when the price moved, which is
   * what makes the history worth keeping.
   */
  recordRun(name: string, listings: readonly Listing[], now: string): Listing[] {
    const known = this.#db.prepare(
      `SELECT listing_id FROM seen_listings WHERE saved_search = ? AND provider = ?`,
    );
    const insert = this.#db.prepare(
      `INSERT OR REPLACE INTO seen_listings
         (saved_search, provider, listing_id, title, title_norm, url,
          price_minor, currency, condition, first_seen_at, last_seen_at, gone_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const touch = this.#db.prepare(
      `UPDATE seen_listings SET last_seen_at = ?, price_minor = ?, currency = ?, gone_at = NULL
       WHERE saved_search = ? AND provider = ? AND listing_id = ?`,
    );

    const byProvider = new Map<ProviderId, Set<string>>();
    for (const l of listings) {
      if (byProvider.has(l.provider)) continue;
      const rows = known.all(name, l.provider) as Array<{ listing_id: string }>;
      byProvider.set(l.provider, new Set(rows.map((r) => r.listing_id)));
    }

    const fresh: Listing[] = [];
    for (const l of listings) {
      const seen = byProvider.get(l.provider)!;
      const price = l.totalPrice ?? l.price;
      if (seen.has(l.id)) {
        touch.run(now, price?.minor ?? null, price?.currency ?? null, name, l.provider, l.id);
      } else {
        insert.run(
          name,
          l.provider,
          l.id,
          l.title,
          normalizeTitle(l.title),
          l.url,
          price?.minor ?? null,
          price?.currency ?? null,
          l.condition,
          now,
          now,
        );
        seen.add(l.id);
        fresh.push(l);
      }
      if (price) this.recordPrice(l.provider, l.id, price.minor, price.currency, now);
    }

    this.#db
      .prepare(`UPDATE saved_searches SET last_run_at = ?, last_run_new = ? WHERE name = ?`)
      .run(now, fresh.length, name);
    return fresh;
  }

  listSeen(name: string, limit: number): SeenRow[] {
    const rows = this.#db
      .prepare(`SELECT * FROM seen_listings WHERE saved_search = ? ORDER BY first_seen_at DESC LIMIT ?`)
      .all(name, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToSeen);
  }

  // ── price history ───────────────────────────────────────────────────────

  /**
   * Record a price only when it CHANGED.
   *
   * A row per observation would grow without bound and say nothing: the
   * interesting event is the change, and the last known value plus its
   * timestamp already answers "what does it cost now".
   */
  recordPrice(provider: ProviderId, listingId: string, minor: number, currency: string, now: string): void {
    const last = this.#db
      .prepare(
        `SELECT price_minor FROM price_history
         WHERE provider = ? AND listing_id = ? ORDER BY observed_at DESC LIMIT 1`,
      )
      .get(provider, listingId) as { price_minor: number } | undefined;
    if (last?.price_minor === minor) return;
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO price_history (provider, listing_id, observed_at, price_minor, currency)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(provider, listingId, now, minor, currency);
  }

  priceHistory(
    provider: ProviderId,
    listingId: string,
  ): Array<{ observedAt: string; minor: number; currency: string }> {
    const rows = this.#db
      .prepare(
        `SELECT observed_at, price_minor, currency FROM price_history
         WHERE provider = ? AND listing_id = ? ORDER BY observed_at`,
      )
      .all(provider, listingId) as Array<{ observed_at: string; price_minor: number; currency: string }>;
    return rows.map((r) => ({ observedAt: r.observed_at, minor: r.price_minor, currency: r.currency }));
  }

  // ── watchlist ───────────────────────────────────────────────────────────

  watch(listing: Listing, note: string | null, now: string): void {
    const price = listing.totalPrice ?? listing.price;
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO watched_listings
           (provider, listing_id, title, url, added_at, last_checked_at, last_price_minor, currency, gone_at, note)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
      )
      .run(
        listing.provider,
        listing.id,
        listing.title,
        listing.url,
        now,
        price?.minor ?? null,
        price?.currency ?? null,
        note,
      );
    if (price) this.recordPrice(listing.provider, listing.id, price.minor, price.currency, now);
  }

  unwatch(provider: ProviderId, listingId: string): boolean {
    const before = this.#db
      .prepare(`SELECT provider FROM watched_listings WHERE provider = ? AND listing_id = ?`)
      .get(provider, listingId);
    this.#db
      .prepare(`DELETE FROM watched_listings WHERE provider = ? AND listing_id = ?`)
      .run(provider, listingId);
    return before !== undefined;
  }

  listWatched(): Array<{
    provider: ProviderId;
    listingId: string;
    title: string;
    url: string;
    addedAt: string;
    lastCheckedAt: string | null;
    lastPriceMinor: number | null;
    currency: string | null;
    goneAt: string | null;
    note: string | null;
  }> {
    const rows = this.#db.prepare(`SELECT * FROM watched_listings ORDER BY added_at DESC`).all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      provider: r.provider as ProviderId,
      listingId: r.listing_id as string,
      title: r.title as string,
      url: r.url as string,
      addedAt: r.added_at as string,
      lastCheckedAt: (r.last_checked_at as string | null) ?? null,
      lastPriceMinor: (r.last_price_minor as number | null) ?? null,
      currency: (r.currency as string | null) ?? null,
      goneAt: (r.gone_at as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
  }

  /**
   * Update one watched item after a check.
   *
   * `gone` is a separate argument rather than "price is null" because they mean
   * different things: an offer that was taken down is a result the user wants
   * to see, and an offer whose price we simply failed to read is not.
   */
  recordCheck(
    provider: ProviderId,
    listingId: string,
    result: { minor: number | null; currency: string | null; gone: boolean },
    now: string,
  ): void {
    this.#db
      .prepare(
        `UPDATE watched_listings
         SET last_checked_at = ?, last_price_minor = ?, currency = ?, gone_at = ?
         WHERE provider = ? AND listing_id = ?`,
      )
      .run(now, result.minor, result.currency, result.gone ? now : null, provider, listingId);
    if (result.minor !== null && result.currency) {
      this.recordPrice(provider, listingId, result.minor, result.currency, now);
    }
  }

  // ── housekeeping ────────────────────────────────────────────────────────

  /** Forget everything about a search, or everything older than a cutoff. */
  purge(options: { search?: string; olderThan?: string } = {}): number {
    if (options.search) {
      const rows = this.#db
        .prepare(`SELECT COUNT(*) AS n FROM seen_listings WHERE saved_search = ?`)
        .get(options.search) as { n: number } | undefined;
      this.#db.prepare(`DELETE FROM seen_listings WHERE saved_search = ?`).run(options.search);
      return rows?.n ?? 0;
    }
    if (options.olderThan) {
      const rows = this.#db
        .prepare(`SELECT COUNT(*) AS n FROM seen_listings WHERE last_seen_at < ?`)
        .get(options.olderThan) as { n: number } | undefined;
      this.#db.prepare(`DELETE FROM seen_listings WHERE last_seen_at < ?`).run(options.olderThan);
      this.#db.prepare(`DELETE FROM price_history WHERE observed_at < ?`).run(options.olderThan);
      return rows?.n ?? 0;
    }
    const rows = this.#db.prepare(`SELECT COUNT(*) AS n FROM seen_listings`).get() as
      | { n: number }
      | undefined;
    this.#db.exec(`DELETE FROM seen_listings`);
    this.#db.exec(`DELETE FROM price_history`);
    return rows?.n ?? 0;
  }

  stats(): { searches: number; seen: number; prices: number; watched: number } {
    const one = (sql: string): number => {
      const row = this.#db.prepare(sql).get() as { n: number } | undefined;
      return row?.n ?? 0;
    };
    return {
      searches: one(`SELECT COUNT(*) AS n FROM saved_searches`),
      seen: one(`SELECT COUNT(*) AS n FROM seen_listings`),
      prices: one(`SELECT COUNT(*) AS n FROM price_history`),
      watched: one(`SELECT COUNT(*) AS n FROM watched_listings`),
    };
  }
}

function rowToSearch(row: Record<string, unknown>): SavedSearch {
  return {
    name: row.name as string,
    query: JSON.parse(row.query_json as string) as SearchQuery,
    providers: JSON.parse(row.providers_json as string) as ProviderId[],
    createdAt: row.created_at as string,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastRunNew: (row.last_run_new as number | null) ?? 0,
  };
}

function rowToSeen(row: Record<string, unknown>): SeenRow {
  return {
    provider: row.provider as ProviderId,
    listingId: row.listing_id as string,
    title: row.title as string,
    url: row.url as string,
    priceMinor: (row.price_minor as number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    firstSeenAt: row.first_seen_at as string,
    lastSeenAt: row.last_seen_at as string,
    goneAt: (row.gone_at as string | null) ?? null,
  };
}
