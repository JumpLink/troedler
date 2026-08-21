/**
 * The database schema, as one statement per string.
 *
 * Three constraints from gjsify's `node:sqlite` (a libgda wrapper) shape how
 * this file is written, and none of them is optional:
 *
 *  1. **One statement per string, no SQL comments.** `exec()` splits a
 *     multi-statement string on top-level `;` itself. A comment or a
 *     `BEGIN … END` body gets chopped in the middle.
 *  2. **No BLOBs.** Parameters that are not strings are rendered as SQL
 *     literals rather than bound.
 *  3. **`all()` and `get()` swallow exceptions** and return `[]` / `undefined`.
 *     A broken query is indistinguishable from "nothing matched" — which is why
 *     `db.ts` wraps every read in a probe rather than trusting the result.
 *
 * Migrations are additive: `STATEMENTS` is the baseline with `IF NOT EXISTS`
 * throughout, `UPGRADES` carries only what needs an `ALTER`.
 */

export const SCHEMA_VERSION = 1;

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS saved_searches (
     name TEXT PRIMARY KEY,
     query_json TEXT NOT NULL,
     providers_json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     last_run_at TEXT,
     last_run_new INTEGER NOT NULL DEFAULT 0
   )`,

  /* One row per offer we have ever seen for a saved search. This is the memory
     that makes "only tell me what is new" possible, and it is also why the
     watch command is the only writer: a plain search must never change what
     counts as new. */
  `CREATE TABLE IF NOT EXISTS seen_listings (
     saved_search TEXT NOT NULL,
     provider TEXT NOT NULL,
     listing_id TEXT NOT NULL,
     title TEXT NOT NULL,
     title_norm TEXT NOT NULL,
     url TEXT NOT NULL,
     price_minor INTEGER,
     currency TEXT,
     condition TEXT,
     first_seen_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     gone_at TEXT,
     PRIMARY KEY (saved_search, provider, listing_id)
   )`,

  /* Price observations. This is the one table whose loss is irreplaceable:
     marketplaces do not serve history, so a gap here can never be filled in
     afterwards. That is why the backup manifest classifies the database as
     `state` and not as a regenerable cache. */
  `CREATE TABLE IF NOT EXISTS price_history (
     provider TEXT NOT NULL,
     listing_id TEXT NOT NULL,
     observed_at TEXT NOT NULL,
     price_minor INTEGER NOT NULL,
     currency TEXT NOT NULL,
     PRIMARY KEY (provider, listing_id, observed_at)
   )`,

  /* Items the user is watching individually, independent of any saved search. */
  `CREATE TABLE IF NOT EXISTS watched_listings (
     provider TEXT NOT NULL,
     listing_id TEXT NOT NULL,
     title TEXT NOT NULL,
     url TEXT NOT NULL,
     added_at TEXT NOT NULL,
     last_checked_at TEXT,
     last_price_minor INTEGER,
     currency TEXT,
     gone_at TEXT,
     note TEXT,
     PRIMARY KEY (provider, listing_id)
   )`,

  `CREATE INDEX IF NOT EXISTS seen_by_search ON seen_listings (saved_search, first_seen_at)`,
  `CREATE INDEX IF NOT EXISTS price_by_listing ON price_history (provider, listing_id, observed_at)`,
];

/** Additive migrations, keyed by the version they upgrade TO. */
export const UPGRADES: Record<number, readonly string[]> = {};
