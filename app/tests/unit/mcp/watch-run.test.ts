import { describe, expect, it } from '@gjsify/unit';

import type { MarketProvider, ProviderResult } from '@troedler/core';
import { Store, openDatabase } from '@troedler/store';

import { registerWatchTools } from '../../../src/frontends/mcp/tools/watch.ts';
import type { Context } from '../../../src/core/context.ts';
import { listing } from '../core/fixtures.ts';
import { createRecorder } from './recorder.ts';

/**
 * `market_watch_run` through its real handler, a real in-memory store and one fake source.
 *
 * What matters is the contract a scheduled caller leans on: the first call reports the offers,
 * the second reports none (they are marked seen), and a run in which no source answered is NOT
 * recorded, so the offers still count as new once a source is back.
 */
function source(rows: ReturnType<typeof listing>[], failing = false): MarketProvider {
  return {
    capabilities: {
      id: 'quoka',
      label: 'quoka',
      host: 'quoka.invalid',
      access: 'html',
      freshness: 'live',
      serverFilters: [],
      serverSorts: [],
      maxResults: 100,
      cache: { ttlSeconds: 600, memoryOnly: false },
      enabledByDefault: true,
      termsDoc: 'docs/quellen/quoka.de.md',
      disclaimer: 'Hinweis der Quelle.',
      note: null,
      noCoMingling: false,
    },
    async status() {
      return { configured: true, problem: null };
    },
    async search(): Promise<ProviderResult> {
      if (failing) throw new Error('nicht erreichbar');
      return {
        provider: 'quoka',
        listings: rows,
        applied: [],
        truncated: false,
        totalEstimate: null,
        requests: 1,
        warnings: [],
      };
    },
  };
}

function contextWith(provider: MarketProvider, store: Store): Context {
  return {
    config: { version: 1, providers: {}, defaults: {} },
    configPath: '/dev/null',
    http: {} as never,
    providers: [provider],
    store: () => store,
    closeStore: () => {},
  } as unknown as Context;
}

async function call(context: Context, name: string) {
  const rec = createRecorder();
  registerWatchTools(rec.server, context);
  const result = await rec.find('market_watch_run')!.handler!({ name });
  const text = result.content[0]!.text;
  return { isError: result.isError === true, body: result.isError ? null : JSON.parse(text) };
}

export default async () => {
  await describe('market_watch_run', async () => {
    await it('reports new offers once, with the source notice, and then stays quiet', async () => {
      const store = new Store(openDatabase(':memory:'));
      store.saveSearch('rad', { text: 'rad' }, [], '2026-10-12T00:00:00.000Z');
      const context = contextWith(source([listing({ provider: 'quoka', id: 'a' })]), store);

      const first = await call(context, 'rad');
      expect(first.body.new_count).toBe(1);
      expect(first.body.listings[0].key).toBe('quoka:a');
      expect(first.body.reports[0].disclaimer).toBe('Hinweis der Quelle.');

      const second = await call(context, 'rad');
      expect(second.body.new_count).toBe(0);
      expect(second.body.no_source_answered).toBe(false);
    });

    await it('does not record a run in which no source answered', async () => {
      const store = new Store(openDatabase(':memory:'));
      store.saveSearch('rad', { text: 'rad' }, [], '2026-10-12T00:00:00.000Z');
      const row = listing({ provider: 'quoka', id: 'a' });

      const down = await call(contextWith(source([row], true), store), 'rad');
      expect(down.body.no_source_answered).toBe(true);
      expect(down.body.new_count).toBe(0);

      const back = await call(contextWith(source([row]), store), 'rad');
      expect(back.body.new_count).toBe(1);
    });

    await it('answers an unknown saved search with an error, not an empty result', async () => {
      const store = new Store(openDatabase(':memory:'));
      const res = await call(contextWith(source([]), store), 'gibt-es-nicht');
      expect(res.isError).toBe(true);
    });
  });
};
