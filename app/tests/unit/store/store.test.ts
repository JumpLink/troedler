import { describe, expect, it } from '@gjsify/unit';

import { money } from '@troedler/core';
import { Store, openDatabase } from '@troedler/store';

import { listing } from '../core/fixtures.ts';

/**
 * Against `:memory:`, which is the payoff of `store` never importing a provider
 * package: the new-versus-seen logic — the fiddliest code here — is exercised
 * with fabricated listings, no network and no marketplace.
 */
export default async () => {
  const fresh = () => new Store(openDatabase(':memory:'));

  await describe('openDatabase', async () => {
    await it('proves reads work before anything trusts it', async () => {
      // The canary. gjsify's node:sqlite swallows exceptions in all()/get(),
      // so a broken read path would otherwise report an empty watchlist
      // forever, with no error anywhere.
      const store = fresh();
      expect(store.stats().searches).toBe(0);
    });
  });

  await describe('saved searches', async () => {
    await it('round-trips a search and keeps createdAt across an update', async () => {
      const store = fresh();
      store.saveSearch('werkzeug', { text: 'bandsaege' }, ['ebay'], '2026-08-01T00:00:00.000Z');
      store.saveSearch('werkzeug', { text: 'bandsaege gebraucht' }, ['ebay'], '2026-08-21T00:00:00.000Z');
      const saved = store.getSearch('werkzeug')!;
      expect(saved.query.text).toBe('bandsaege gebraucht');
      expect(saved.createdAt).toBe('2026-08-01T00:00:00.000Z');
    });

    await it('removes its seen rows along with the search', async () => {
      const store = fresh();
      store.saveSearch('x', { text: 'a' }, [], '2026-08-01T00:00:00.000Z');
      store.recordRun('x', [listing({ provider: 'ebay', id: '1' })], '2026-08-01T00:00:00.000Z');
      expect(store.stats().seen).toBe(1);
      store.removeSearch('x');
      expect(store.stats().seen).toBe(0);
    });
  });

  await describe('recordRun', async () => {
    await it('reports everything as new the first time and nothing the second', async () => {
      const store = fresh();
      store.saveSearch('x', { text: 'a' }, [], '2026-08-01T00:00:00.000Z');
      const rows = [listing({ provider: 'ebay', id: '1' }), listing({ provider: 'ebay', id: '2' })];

      expect(store.recordRun('x', rows, '2026-08-01T00:00:00.000Z').length).toBe(2);
      expect(store.recordRun('x', rows, '2026-08-02T00:00:00.000Z').length).toBe(0);
    });

    await it('reports only the addition on a later run', async () => {
      const store = fresh();
      store.saveSearch('x', { text: 'a' }, [], '2026-08-01T00:00:00.000Z');
      store.recordRun('x', [listing({ provider: 'ebay', id: '1' })], '2026-08-01T00:00:00.000Z');
      const fresh2 = store.recordRun(
        'x',
        [listing({ provider: 'ebay', id: '1' }), listing({ provider: 'ebay', id: '2' })],
        '2026-08-02T00:00:00.000Z',
      );
      expect(fresh2.map((l) => l.id)).toEqualArray(['2']);
    });

    await it('keeps the seen index per saved search', async () => {
      // Two searches can legitimately match the same offer, and each should
      // announce it once — announcing it in neither would be the bug.
      const store = fresh();
      store.saveSearch('a', { text: 'a' }, [], '2026-08-01T00:00:00.000Z');
      store.saveSearch('b', { text: 'b' }, [], '2026-08-01T00:00:00.000Z');
      const row = [listing({ provider: 'ebay', id: '1' })];
      expect(store.recordRun('a', row, '2026-08-01T00:00:00.000Z').length).toBe(1);
      expect(store.recordRun('b', row, '2026-08-01T00:00:00.000Z').length).toBe(1);
    });

    await it('records the run summary on the search', async () => {
      const store = fresh();
      store.saveSearch('x', { text: 'a' }, [], '2026-08-01T00:00:00.000Z');
      store.recordRun('x', [listing({ provider: 'ebay', id: '1' })], '2026-08-05T00:00:00.000Z');
      const saved = store.getSearch('x')!;
      expect(saved.lastRunAt).toBe('2026-08-05T00:00:00.000Z');
      expect(saved.lastRunNew).toBe(1);
    });
  });

  await describe('price history', async () => {
    await it('records a change and ignores a repeat', async () => {
      // A row per observation would grow without bound and say nothing; the
      // event worth keeping is the change.
      const store = fresh();
      store.recordPrice('ebay', '1', 28900, 'EUR', '2026-08-01T00:00:00.000Z');
      store.recordPrice('ebay', '1', 28900, 'EUR', '2026-08-02T00:00:00.000Z');
      store.recordPrice('ebay', '1', 24900, 'EUR', '2026-08-03T00:00:00.000Z');
      const history = store.priceHistory('ebay', '1');
      expect(history.length).toBe(2);
      expect(history[1].minor).toBe(24900);
    });
  });

  await describe('watchlist', async () => {
    await it('watches, checks and reports gone', async () => {
      const store = fresh();
      const row = listing({ provider: 'ebay', id: '1', price: money(28900), totalPrice: money(28900) });
      store.watch(row, 'vielleicht', '2026-08-01T00:00:00.000Z');
      expect(store.listWatched().length).toBe(1);

      store.recordCheck(
        'ebay',
        '1',
        { minor: null, currency: 'EUR', gone: true },
        '2026-08-05T00:00:00.000Z',
      );
      expect(store.listWatched()[0].goneAt).toBe('2026-08-05T00:00:00.000Z');

      expect(store.unwatch('ebay', '1')).toBe(true);
      expect(store.unwatch('ebay', '1')).toBe(false);
    });
  });

  await describe('purge', async () => {
    await it('removes one search or everything', async () => {
      const store = fresh();
      store.saveSearch('a', { text: 'a' }, [], '2026-08-01T00:00:00.000Z');
      store.saveSearch('b', { text: 'b' }, [], '2026-08-01T00:00:00.000Z');
      store.recordRun('a', [listing({ provider: 'ebay', id: '1' })], '2026-08-01T00:00:00.000Z');
      store.recordRun('b', [listing({ provider: 'ebay', id: '2' })], '2026-08-01T00:00:00.000Z');

      expect(store.purge({ search: 'a' })).toBe(1);
      expect(store.stats().seen).toBe(1);
      store.purge();
      expect(store.stats().seen).toBe(0);
      expect(store.stats().prices).toBe(0);
    });
  });
};
