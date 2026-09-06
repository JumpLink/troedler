/**
 * The config manifest — `$XDG_CONFIG_HOME/troedler/config.json`.
 *
 * Versioned from the first line (`version: 1`) so a later change is a
 * migration rather than a guess about which shape a file on disk has. Written
 * atomically via a temporary file plus rename, because a half-written config
 * is the difference between "one setting is wrong" and "the tool will not
 * start".
 *
 * The interesting field is `enabled`. A source whose terms forbid automated
 * access is never switched on by the software; the user turns it on here, and
 * `acknowledged` records that they were shown what they were agreeing to. That
 * is the mechanism, not a comment: it is what lets this be a public MIT
 * project without shipping a violation as a default.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderId } from '@troedler/core';

export interface ProviderConfig {
  readonly enabled?: boolean;
  /**
   * ISO date on which the user confirmed they read the source record for a
   * provider whose terms forbid automated access. Required before such a
   * provider will run, however `enabled` is set.
   */
  readonly acknowledged?: string;
}

/**
 * How the window lays results out.
 *
 * `grid` — one wrapping grid over every source, cheapest first, each card
 * carrying the badge of the market it came from.
 * `sections` — a block per source, the layout this project started from,
 * because „40 € here, 120 € there" is only visible while the two stay apart.
 *
 * Both are honest; they answer different questions, which is why this is a
 * setting and not a decision made once in the code. The CLI ignores it — it
 * has one layout and always groups.
 */
export type ResultLayout = 'grid' | 'sections';

export interface UiConfig {
  readonly layout?: ResultLayout;
}

export interface TroedlerConfig {
  readonly version: 1;
  readonly providers: Partial<Record<ProviderId, ProviderConfig>>;
  readonly defaults: {
    readonly postalCode?: string;
    readonly radiusKm?: number;
    readonly currency?: string;
  };
  /** Window-only preferences. Absent for anybody who only uses the CLI. */
  readonly ui?: UiConfig;
}

export const EMPTY_CONFIG: TroedlerConfig = { version: 1, providers: {}, defaults: {} };

/** The layout a window opens with when nothing was ever chosen. */
export const DEFAULT_LAYOUT: ResultLayout = 'grid';

export function layoutOf(config: TroedlerConfig): ResultLayout {
  return config.ui?.layout === 'sections' ? 'sections' : DEFAULT_LAYOUT;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function validate(raw: unknown, path: string): TroedlerConfig {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError(`${path}: kein JSON-Objekt.`);
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new ConfigError(`${path}: version ${String(obj.version)} unbekannt — erwartet 1.`);
  }
  const providers = (obj.providers ?? {}) as TroedlerConfig['providers'];
  const defaults = (obj.defaults ?? {}) as TroedlerConfig['defaults'];
  if (typeof providers !== 'object' || providers === null)
    throw new ConfigError(`${path}: providers ist kein Objekt.`);
  if (typeof defaults !== 'object' || defaults === null)
    throw new ConfigError(`${path}: defaults ist kein Objekt.`);
  const ui = (obj.ui ?? {}) as UiConfig;
  if (typeof ui !== 'object' || ui === null) throw new ConfigError(`${path}: ui ist kein Objekt.`);
  // Every section has to be named here, and that is the point rather than a
  // chore: this function REBUILDS the object instead of passing the parsed one
  // through, so a field it does not mention is silently dropped on load. `ui`
  // was added to the type, written by the settings dialog, and then thrown away
  // by this line on the very next read — the whole setting was inert, and the
  // type check, the lint and the build were all green while it was.
  return { version: 1, providers, defaults, ui };
}

/** A missing file is not an error — it is a first run. */
export function loadConfig(path: string): TroedlerConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return EMPTY_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${path}: ungültiges JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  return validate(parsed, path);
}

export function saveConfig(path: string, config: TroedlerConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Read, change, write — re-validating the result.
 *
 * Re-validation matters: a mutation that produces a config this program would
 * refuse to load is a bug worth catching while the old file is still on disk,
 * not on the next start.
 */
export function mutateConfig(
  path: string,
  change: (config: TroedlerConfig) => TroedlerConfig,
): TroedlerConfig {
  const next = validate(change(loadConfig(path)), path);
  saveConfig(path, next);
  return next;
}
