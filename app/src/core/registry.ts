/**
 * Where the marketplaces are wired in — the only file that knows they exist.
 *
 * Everything below `app/` talks to the `MarketProvider` port; nothing in
 * `@troedler/core` or `@troedler/store` may import an adapter package. This
 * file is the seam that keeps that true, and it is deliberately dull: a list of
 * factories, a resolved `enabled` flag, no logic about searching.
 *
 * Adding a marketplace means adding one line here and one source record under
 * `docs/quellen/`. If it needed anything else, the port would be wrong.
 */

import { createBooklookerProvider } from '@troedler/booklooker';
import { createDiscogsProvider } from '@troedler/discogs';
import { createEbayProvider } from '@troedler/ebay';
import { createJustizAuktionProvider, createZollAuktionProvider } from '@troedler/auktion';
import { createKleinanzeigenProvider } from '@troedler/kleinanzeigen';
import { createMarktDeProvider, createQuokaProvider } from '@troedler/markt';
import type { MarketProvider, ProviderId } from '@troedler/core';
import type { HttpClient } from '@troedler/http';
import type { TroedlerConfig } from '@troedler/store';

export interface RegistryDeps {
  readonly http: HttpClient;
  readonly env: Record<string, string | undefined>;
  readonly config: TroedlerConfig;
}

/**
 * Is this source switched on?
 *
 * Two conditions, and the second one only applies where it must. An explicit
 * setting in the config always wins. When the config is silent, the source's
 * own `enabledByDefault` decides — and a source that is off by default is off
 * because its operator forbids automated access, so switching it on
 * additionally requires the recorded acknowledgement that a person read the
 * source record. Without that second condition, editing one line of JSON would
 * quietly opt someone into breaking a contract they never saw.
 */
export function resolveEnabled(config: TroedlerConfig, id: ProviderId, enabledByDefault: boolean): boolean {
  const entry = config.providers[id];
  const on = entry?.enabled ?? enabledByDefault;
  if (!on) return false;
  if (enabledByDefault) return true;
  return Boolean(entry?.acknowledged);
}

/**
 * Build every provider with its resolved `enabled` flag.
 *
 * Two passes, because the flag depends on `capabilities.enabledByDefault` and
 * the capabilities live on the instance. The probe pass is free: a provider
 * constructor stores its dependencies and does nothing else — no I/O, no
 * network, no disk. That is a property worth keeping; a constructor that
 * reached for the network would make `troedler providers list` fire requests
 * just by starting up.
 *
 * Keeping the default on the capability object rather than in a table here is
 * the point: one definition, in the package that knows why.
 */
export function buildProviders(deps: RegistryDeps): MarketProvider[] {
  const build = <T>(factory: (d: T) => MarketProvider, base: T): MarketProvider => {
    const probe = factory({ ...base, enabled: false });
    const enabled = resolveEnabled(deps.config, probe.capabilities.id, probe.capabilities.enabledByDefault);
    return enabled ? factory({ ...base, enabled: true }) : probe;
  };

  const http = deps.http;
  const env = deps.env;

  return [
    build(createEbayProvider, { http, env, enabled: false }),
    build(createKleinanzeigenProvider, { http, env, enabled: false }),
    build(createDiscogsProvider, { http, env, enabled: false }),
    build(createBooklookerProvider, { http, env, enabled: false }),
    build(createZollAuktionProvider, { http, env, enabled: false }),
    build(createJustizAuktionProvider, { http, env, enabled: false }),
    build(createMarktDeProvider, { http, env, enabled: false }),
    build(createQuokaProvider, { http, env, enabled: false }),
  ];
}
