/**
 * Building the world once, from the environment and the config file.
 *
 * Everything downstream — CLI commands, MCP tools, and one day the GUI — takes
 * a `Context` rather than reaching for `process.env` or opening its own
 * database. That is what keeps the three surfaces from drifting: there is one
 * definition of "which providers are on", not one per frontend.
 *
 * The store is opened LAZILY. Most commands never touch it, and a search
 * should not create a database file as a side effect of being run once.
 */

import { HttpClient } from '@troedler/http';
import type { MarketProvider, ProviderId } from '@troedler/core';
import { Store, configPath, dbPath, loadConfig, openDatabase, type TroedlerConfig } from '@troedler/store';

import { buildProviders, resolveEnabled } from './registry.ts';
import { VERSION } from './runtime.ts';

export interface Context {
  readonly config: TroedlerConfig;
  readonly configPath: string;
  readonly http: HttpClient;
  readonly providers: readonly MarketProvider[];
  /** Opens the database on first use, then reuses it. */
  store(): Store;
  closeStore(): void;
  /**
   * Re-read the config file and rebuild the providers from it.
   *
   * `config` is a snapshot taken at startup, and `setProviderEnabled` writes the
   * FILE. A command exits before that matters; a window does not. Without this,
   * a source switched on in the GUI would show its switch in the new position
   * and the next search would still use the old value — a surface that agrees
   * with itself and not with the program, which is the shape of defect this
   * project spends most of its comments on.
   */
  reload(): void;
}

/**
 * Is this provider switched on?
 *
 * Two conditions, and both must hold for a source whose terms forbid automated
 * access: the user enabled it AND acknowledged the source record. The
 * acknowledgement is not ceremony — it is the difference between software that
 * ships a terms violation as a default and software where a person made that
 * call knowingly.
 */
export function isEnabled(config: TroedlerConfig, provider: MarketProvider): boolean {
  return resolveEnabled(config, provider.capabilities.id, provider.capabilities.enabledByDefault);
}

export function createContext(env: Record<string, string | undefined> = process.env): Context {
  const path = configPath(env);
  // 64 rather than the default 40: Discogs needs one search plus one price
  // lookup per release to fill a page, so a source that advertises 57 results
  // spends 58 requests on one host. A cap below the number a provider promises
  // is a promise the tool cannot keep.
  const http = new HttpClient({ version: VERSION, maxRequestsPerHost: 64 });

  let config = loadConfig(path);
  let providers = buildProviders({ http, env, config });

  let store: Store | null = null;
  let db: ReturnType<typeof openDatabase> | null = null;

  return {
    // Getters rather than fields, so `reload()` is visible to everything that
    // already holds the context — a view that captured `context.config` once
    // would otherwise keep the stale snapshot after the switch was flipped.
    get config() {
      return config;
    },
    get providers() {
      return providers;
    },
    configPath: path,
    http,
    reload() {
      config = loadConfig(path);
      providers = buildProviders({ http, env, config });
    },
    store() {
      if (!store) {
        db = openDatabase(dbPath(env));
        store = new Store(db);
      }
      return store;
    },
    closeStore() {
      db?.close();
      db = null;
      store = null;
    },
  };
}

/** The providers a command should actually query, after config and an explicit `--provider`. */
export function selectProviders(context: Context, wanted?: readonly ProviderId[]): readonly MarketProvider[] {
  const enabled = context.providers.filter((p) => isEnabled(context.config, p));
  if (!wanted || wanted.length === 0) return enabled;
  // An explicitly named provider is returned even when disabled, so that
  // `--provider kleinanzeigen` reports "switched off, here is why" instead of
  // silently searching nothing.
  return context.providers.filter((p) => wanted.includes(p.capabilities.id));
}
