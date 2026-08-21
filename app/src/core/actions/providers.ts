/**
 * Everything about "which sources exist and may I use them".
 *
 * The capability matrix is data, and every surface renders it rather than
 * hard-coding what it knows: the CLI prints it, the MCP server exposes it as a
 * tool so an agent can gate on it exactly like a UI would, and the future GUI
 * will draw its provider list from the same rows. A second copy of "eBay can
 * filter by price" in a view is how the surfaces start disagreeing.
 */

import type { ProviderId } from '@troedler/core';
import { mutateConfig } from '@troedler/store';

import { isEnabled, type Context } from '../context.ts';

export interface ProviderView {
  readonly id: ProviderId;
  readonly label: string;
  readonly host: string;
  readonly access: string;
  readonly enabled: boolean;
  readonly enabledByDefault: boolean;
  readonly configured: boolean;
  readonly problem: string | null;
  readonly serverFilters: readonly string[];
  readonly serverSorts: readonly string[];
  readonly maxResults: number;
  readonly cacheTtlSeconds: number;
  readonly termsDoc: string;
  readonly disclaimer: string | null;
  readonly note: string | null;
}

export async function listProviders(context: Context, only?: ProviderId): Promise<ProviderView[]> {
  const wanted = context.providers.filter((p) => !only || p.capabilities.id === only);
  return Promise.all(
    wanted.map(async (p) => {
      const caps = p.capabilities;
      // A status probe talks to the network for some providers, so one failing
      // must not take the whole listing down with it.
      let configured = false;
      let problem: string | null = null;
      try {
        const status = await p.status();
        configured = status.configured;
        problem = status.problem?.message ?? null;
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
      return {
        id: caps.id,
        label: caps.label,
        host: caps.host,
        access: caps.access,
        enabled: isEnabled(context.config, p),
        enabledByDefault: caps.enabledByDefault,
        configured,
        problem,
        serverFilters: caps.serverFilters.map(String),
        serverSorts: caps.serverSorts.filter(Boolean).map(String),
        maxResults: caps.maxResults,
        cacheTtlSeconds: caps.cache.ttlSeconds,
        termsDoc: caps.termsDoc,
        disclaimer: caps.disclaimer,
        note: caps.note,
      };
    }),
  );
}

export class AcknowledgementRequired extends Error {
  readonly termsDoc: string;
  constructor(id: ProviderId, termsDoc: string, note: string | null) {
    super(
      `${id} lässt sich nicht ohne Bestätigung einschalten.\n\n${note ?? ''}\n\n` +
        `Lies ${termsDoc} und schalte dann mit --acknowledge frei. Diese Entscheidung trifft der Mensch, nicht das Programm.`,
    );
    this.name = 'AcknowledgementRequired';
    this.termsDoc = termsDoc;
  }
}

/**
 * Switch a provider on or off.
 *
 * A source that is off by default is off because its operator's terms forbid
 * automated access. Turning it on therefore requires `--acknowledge`, and the
 * date is written to the config. That is the whole mechanism by which this can
 * be a public MIT project without shipping somebody else's terms violation as
 * a default: the software refuses, and a person overrides it on the record.
 */
export function setProviderEnabled(
  context: Context,
  id: ProviderId,
  enabled: boolean,
  acknowledge = false,
  now = new Date(),
): void {
  const provider = context.providers.find((p) => p.capabilities.id === id);
  if (!provider) throw new Error(`Unbekannte Quelle "${id}".`);
  const caps = provider.capabilities;

  if (enabled && !caps.enabledByDefault && !acknowledge && !context.config.providers[id]?.acknowledged) {
    throw new AcknowledgementRequired(id, caps.termsDoc, caps.note);
  }

  mutateConfig(context.configPath, (config) => ({
    ...config,
    providers: {
      ...config.providers,
      [id]: {
        ...config.providers[id],
        enabled,
        acknowledged:
          enabled && acknowledge ? now.toISOString().slice(0, 10) : config.providers[id]?.acknowledged,
      },
    },
  }));
}

export async function quotas(
  context: Context,
  only?: ProviderId,
): Promise<
  Array<{
    id: ProviderId;
    remaining: number | null;
    limit: number | null;
    resetAt: string | null;
    error: string | null;
  }>
> {
  const wanted = context.providers.filter((p) => (!only || p.capabilities.id === only) && p.quota);
  return Promise.all(
    wanted.map(async (p) => {
      try {
        const q = await p.quota!();
        return { id: p.capabilities.id, ...q, error: null };
      } catch (err) {
        return {
          id: p.capabilities.id,
          remaining: null,
          limit: null,
          resetAt: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
