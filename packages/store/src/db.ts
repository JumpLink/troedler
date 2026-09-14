/**
 * Opening the database — and proving it works before anything trusts it.
 *
 * `DatabaseSync` looks like Node's `node:sqlite` because that is the API it
 * implements, but under GJS it is a libgda wrapper, and one of its behaviours
 * makes an ordinary bug invisible: **`all()` and `get()` catch exceptions and
 * return `[]` / `undefined`.** A query against a column that does not exist
 * therefore reports "nothing found" for the rest of the process's life.
 *
 * That is the expensive failure class — green, and it checked nothing. The
 * defence is not to wrap every read in a retry, it is to make the condition
 * impossible to reach silently: `openDatabase` verifies the schema and
 * round-trips a canary row at startup. If reads are being swallowed, the
 * program says so on the first command rather than reporting an empty
 * watchlist forever.
 *
 * // gjsify gap (unfixed, gjsify#1674): still true on 0.47.0. Measured under gjs
 * // 1.88.1 at the bump — `db.prepare('SELECT * FROM does_not_exist').get()`
 * // returns `undefined` instead of throwing, where Node throws. So the canary
 * // below is LOAD-BEARING and must not be "simplified" away as a startup cost.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SCHEMA_VERSION, STATEMENTS, UPGRADES } from './schema.ts';

export type Database = DatabaseSync;

export class StoreUnusableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreUnusableError';
  }
}

function tableNames(db: Database): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
    name: string;
  }>;
  return rows.map((r) => r.name);
}

/**
 * The canary: write a row, read it back, delete it.
 *
 * Cheap, and it is the only check that actually exercises the read path the
 * rest of the code depends on. A schema that exists but whose reads come back
 * empty passes every `sqlite_master` check and fails this one.
 */
function assertReadsWork(db: Database): void {
  const stamp = `canary-${Date.now()}`;
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run('canary', stamp);
  const back = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get('canary') as
    | { value: string }
    | undefined;
  db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run('canary');

  if (back?.value !== stamp) {
    throw new StoreUnusableError(
      'Die lokale Datenbank nimmt Schreibvorgänge an, liefert sie aber nicht zurück. ' +
        'Unter GJS verschluckt der libgda-Wrapper Fehler in all()/get() — bis das geklärt ist, ' +
        'wäre jede Antwort still leer. Prüfe die Datei und libgda-sqlite.',
    );
  }
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const db = new DatabaseSync(path);
  // WAL and foreign keys are set one statement at a time: exec() splits a
  // multi-statement string itself and its splitter is not something to lean on.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  for (const statement of STATEMENTS) db.exec(statement);

  const existing = new Set(tableNames(db));
  const missing = [
    'schema_meta',
    'saved_searches',
    'seen_listings',
    'price_history',
    'watched_listings',
  ].filter((t) => !existing.has(t));
  if (missing.length > 0) {
    throw new StoreUnusableError(`Tabellen fehlen nach dem Anlegen: ${missing.join(', ')}.`);
  }

  assertReadsWork(db);
  migrate(db);
  return db;
}

function currentVersion(db: Database): number {
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as
    | { value: string }
    | undefined;
  const n = row ? Number.parseInt(row.value, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function migrate(db: Database): void {
  const from = currentVersion(db);
  for (let v = from + 1; v <= SCHEMA_VERSION; v += 1) {
    for (const statement of UPGRADES[v] ?? []) db.exec(statement);
  }
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)`).run(
    String(SCHEMA_VERSION),
  );
}
