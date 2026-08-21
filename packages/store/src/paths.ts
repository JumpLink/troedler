/**
 * Where troedler keeps things.
 *
 * One promise: **nothing is ever written inside the repository.** The index
 * holds other people's classified ads — titles, towns, free text — and this
 * repo is public. `.gitignore` is the second line of defence; not writing here
 * is the first, and it lives in this file.
 *
 * Every function takes `env` as a parameter rather than reading `process.env`
 * directly. That is what makes them testable, and it is why the tests can
 * prove the XDG fallbacks without touching a real home directory.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

function xdg(env: Env, variable: string, fallback: string[]): string {
  const explicit = env[variable]?.trim();
  return explicit && explicit.startsWith('/') ? explicit : join(homedir(), ...fallback);
}

export function dataDir(env: Env = process.env): string {
  return env.TROEDLER_DATA_DIR?.trim() || join(xdg(env, 'XDG_DATA_HOME', ['.local', 'share']), 'troedler');
}

export function configDir(env: Env = process.env): string {
  return env.TROEDLER_CONFIG_DIR?.trim() || join(xdg(env, 'XDG_CONFIG_HOME', ['.config']), 'troedler');
}

export function cacheDir(env: Env = process.env): string {
  return env.TROEDLER_CACHE_DIR?.trim() || join(xdg(env, 'XDG_CACHE_HOME', ['.cache']), 'troedler');
}

export function configPath(env: Env = process.env): string {
  return env.TROEDLER_CONFIG?.trim() || join(configDir(env), 'config.json');
}

/**
 * Path of the SQLite database.
 *
 * The `.db` suffix is REQUIRED, not conventional. gjsify's `node:sqlite` is a
 * libgda wrapper and libgda appends `.db` to the database name it is given:
 * a file called `index.sqlite` lands on disk as `index.sqlite.db`, and the next
 * open creates `index.sqlite.db.db`. Newer gjsify strips a trailing `.db`
 * before handing the name over, which makes passing one the safe spelling in
 * both directions.
 */
export function dbPath(env: Env = process.env): string {
  const explicit = env.TROEDLER_DB_PATH?.trim();
  if (explicit) return explicit.endsWith('.db') ? explicit : `${explicit}.db`;
  return join(dataDir(env), 'index.db');
}
