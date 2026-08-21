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
  const config = loadConfig(path);
  // 64 rather than the default 40: Discogs needs one search plus one price
  // lookup per release to fill a page, so a source that advertises 57 results
  // spends 58 requests on one host. A cap below the number a provider promises
  // is a promise the tool cannot keep.
  const http = new HttpClient({ version: VERSION, maxRequestsPerHost: 64 });

  const providers = buildProviders({ http, env, config });

  let store: Store | null = null;
  let db: ReturnType<typeof openDatabase> | null = null;

  return {
    config,
    configPath: path,
    http,
    providers,
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
