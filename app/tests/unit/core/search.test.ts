import { describe, expect, it } from '@gjsify/unit';

import { ProviderError, allSourcesUnavailable, money, searchAll } from '@troedler/core';
import { getListing } from '../../../src/core/actions/index.ts';
import type {
  MarketProvider,
  ProviderCapabilities,
  ProviderId,
  ProviderResult,
  SearchQuery,
} from '@troedler/core';

import { listing } from './fixtures.ts';

/**
 * Fake providers. The reason the port is dependency-free: the fan-out, the
 * isolation of a failing source and the honesty of the reports are all
 * testable here with no network, no GJS and no marketplace.
 */
function caps(id: ProviderId, over: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    id,
    label: id,
    host: `${id}.invalid`,
    access: 'official-api',
    freshness: 'live',
    serverFilters: [],
    serverSorts: [],
    maxResults: 100,
    cache: { ttlSeconds: 600, memoryOnly: false },
    enabledByDefault: true,
    termsDoc: `docs/quellen/${id}.md`,
    disclaimer: null,
    note: null,
    noCoMingling: false,
    ...over,
  };
}

function fake(
  id: ProviderId,
  behaviour: {
    configured?: boolean;
    problem?: { kind: 'not-configured'; message: string } | null;
    result?: Partial<ProviderResult>;
    throws?: Error;
    /** Requests the source spends before it answers — or before it throws. */
    spends?: number;
    /** Microtask turns to wait before answering, so completion order is controllable. */
    turns?: number;
    caps?: Partial<ProviderCapabilities>;
  },
): MarketProvider {
  let spent = 0;
  return {
    capabilities: caps(id, {
      ...(behaviour.result?.applied ? { serverFilters: behaviour.result.applied } : {}),
      ...behaviour.caps,
    }),
    requestsUsed: () => spent,
    async status() {
      return { configured: behaviour.configured ?? true, problem: behaviour.problem ?? null };
    },
    async search(): Promise<ProviderResult> {
      for (let i = 0; i < (behaviour.turns ?? 0); i += 1) await Promise.resolve();
      // Spent BEFORE the throw, exactly like a real socket: the request went
      // out, the quota is gone, and only then did the remote refuse.
      spent += behaviour.spends ?? 0;
      if (behaviour.throws) throw behaviour.throws;
      return {
        provider: id,
        listings: [],
        applied: [],
        truncated: false,
        totalEstimate: null,
        requests: 1,
        warnings: [],
        ...behaviour.result,
      };
    },
  };
}

export default async () => {
  const query: SearchQuery = { text: 'bandsaege' };

  await describe('searchAll', async () => {
    await it('keeps a failing source from taking the search down with it', async () => {
      // Six marketplaces means six ways to have a bad day. A search that dies
      // because one of them timed out is useless.
      const ok = fake('ebay', { result: { listings: [listing({ provider: 'ebay', id: '1' })] } });
      const bad = fake('quoka', { throws: new ProviderError('quoka', 'unreachable', 'Zeitüberschreitung') });

      const outcome = await searchAll([ok, bad], query);
      expect(outcome.grouped.get('ebay')?.length).toBe(1);
      expect(outcome.reports.find((r) => r.provider === 'quoka')?.outcome).toBe('failed');
      expect(outcome.reports.find((r) => r.provider === 'quoka')?.errorKind).toBe('unreachable');
    });

    await it('meldet jede Quelle an, bevor eine antwortet — in der Reihenfolge der Liste', async () => {
      // A CLI can wait; a window cannot. Eight sources at a two-second-per-host
      // floor means nothing is observable until the slowest settles, and a pane
      // that shows nothing is pixel-identical to one that is broken.
      const started: string[] = [];
      const settled: string[] = [];
      const slow = fake('ebay', { turns: 6, result: { listings: [listing({ provider: 'ebay', id: '1' })] } });
      const quick = fake('quoka', {
        turns: 0,
        result: { listings: [listing({ provider: 'quoka', id: '2' })] },
      });

      const outcome = await searchAll([slow, quick], query, {
        onStarted: (provider) => started.push(provider),
        onSettled: (s) => settled.push(s.report.provider),
      });

      // Announced in declaration order, before any of them answered.
      expect(started).toEqualArray(['ebay', 'quoka']);
      // Delivered in COMPLETION order — which is the whole reason the two
      // callbacks exist separately. If this equalled `started`, the search
      // would be handing everything over at the end and the panel would still
      // be blank until then.
      expect(settled).toEqualArray(['quoka', 'ebay']);
      // And the return value still carries everything, in the stable order, so
      // a surface that renders from the callbacks and re-renders from the
      // result shows the same thing twice.
      expect(outcome.reports.map((r) => r.provider)).toEqualArray(['ebay', 'quoka']);
      expect(settled.length).toBe(outcome.reports.length);
    });

    await it('lässt einen werfenden Rückruf die Suche nicht mitreißen', async () => {
      // Exactly the rule one provider's failure already follows: a GTK handler
      // that throws must not reject a fan-out five sources have answered.
      const ok = fake('ebay', { result: { listings: [listing({ provider: 'ebay', id: '1' })] } });
      const outcome = await searchAll([ok], query, {
        onStarted: () => {
          throw new Error('die View ist explodiert');
        },
        onSettled: () => {
          throw new Error('und noch einmal');
        },
      });
      expect(outcome.grouped.get('ebay')?.length).toBe(1);
      expect(outcome.reports[0].outcome).toBe('ok');
    });

    await it('tells "empty", "skipped" and "failed" apart', async () => {
      // This is the whole point of the enum. All three look identical as a row
      // count of zero, and "no matches" is the one people act on.
      const empty = fake('ebay', {});
      const skipped = fake('kleinanzeigen', {
        configured: false,
        problem: { kind: 'not-configured', message: 'abgeschaltet' },
      });
      const failed = fake('quoka', { throws: new ProviderError('quoka', 'refused', 'HTTP 403') });

      const outcome = await searchAll([empty, skipped, failed], query);
      const by = new Map(outcome.reports.map((r) => [r.provider, r.outcome]));
      expect(by.get('ebay')).toBe('empty');
      expect(by.get('kleinanzeigen')).toBe('skipped');
      expect(by.get('quoka')).toBe('failed');
    });

    await it('flags that nobody answered — which is not the same as nothing matched', async () => {
      const skipped = fake('kleinanzeigen', {
        configured: false,
        problem: { kind: 'not-configured', message: 'abgeschaltet' },
      });
      const failed = fake('quoka', { throws: new ProviderError('quoka', 'refused', 'HTTP 403') });
      expect(allSourcesUnavailable(await searchAll([skipped, failed], query))).toBe(true);

      const empty = fake('ebay', {});
      expect(allSourcesUnavailable(await searchAll([empty], query))).toBe(false);
    });

    await it('books the requests a failing source spent', async () => {
      // Measured: a Booklooker run that spent one request, burned quota and came
      // back AUTHENTICATION_FAILED was reported as "0 Anfragen, 1189 ms". The
      // count now comes from the socket layer on both paths, so the catch branch
      // cannot lose it.
      const bad = fake('booklooker', {
        spends: 1,
        throws: new ProviderError('booklooker', 'refused', 'AUTHENTICATION_FAILED'),
      });
      const report = (await searchAll([bad], query)).reports[0];
      expect(report.outcome).toBe('failed');
      expect(report.requests).toBe(1);
    });

    await it('says "not booked" rather than zero when a source cannot account for its requests', async () => {
      // `0` is a claim. A provider without `requestsUsed` has not made it.
      const silent: MarketProvider = {
        capabilities: caps('quoka'),
        async status() {
          return { configured: true, problem: null };
        },
        async search(): Promise<ProviderResult> {
          throw new ProviderError('quoka', 'unreachable', 'weg');
        },
      };
      expect((await searchAll([silent], query)).reports[0].requests).toBe(null);
    });

    await it('keeps a source that may not be co-mingled out of the merged list', async () => {
      // eBay's API licence requires its rows to be "visually isolated from
      // third-party listings". `merge.ts` named that as the reason `grouped` is
      // primary — and nothing enforced it, so `--merge` interleaved eBay like
      // everything else and would have shipped that with the keyset.
      const ebay = fake('ebay', {
        caps: { noCoMingling: true },
        result: { listings: [listing({ provider: 'ebay', id: 'e1' })] },
      });
      const quoka = fake('quoka', { result: { listings: [listing({ provider: 'quoka', id: 'q1' })] } });

      const outcome = await searchAll([ebay, quoka], query, { merge: true });
      expect(outcome.merged?.map((l) => l.key)).toEqualArray(['quoka:q1']);
      expect(outcome.mergeExcluded).toEqualArray(['ebay']);
      // Not hidden — only kept out of the ONE layout the licence forbids.
      expect(outcome.grouped.get('ebay')?.length).toBe(1);
    });

    await it('groups the same product across sources only when asked', async () => {
      const ebay = fake('ebay', {
        result: {
          listings: [listing({ provider: 'ebay', id: 'e1', gtin: '0190295272432', price: money(12000) })],
        },
      });
      const quoka = fake('quoka', {
        result: {
          listings: [listing({ provider: 'quoka', id: 'q1', gtin: '190295272432', price: money(4000) })],
        },
      });

      expect((await searchAll([ebay, quoka], query)).products).toBe(null);

      const grouped = await searchAll([ebay, quoka], query, { group: true });
      expect(grouped.products?.length).toBe(1);
      expect(grouped.products?.[0].listings.length).toBe(2);
    });

    await it('tells "gone" apart from "cannot be looked up"', async () => {
      // The Justiz-Auktion adapter advertises `troedler show justiz-auktion:<id>`
      // under every search, for the one source that cannot be searched at all.
      // The command did not exist, and the only route to a single offer was
      // `item watch`, which WRITES. This is that route, read-only, shared by the
      // CLI and the MCP tool so there is one answer and not two.
      const ctx = {
        providers: [
          {
            capabilities: caps('zoll-auktion', { disclaimer: 'Höchstgebot, kein Kaufpreis.' }),
            async status() {
              return { configured: true, problem: null };
            },
            async search(): Promise<ProviderResult> {
              throw new Error('nicht benutzt');
            },
            async getListing(id: string) {
              return id === '1' ? listing({ provider: 'zoll-auktion', id: '1' }) : null;
            },
          },
        ],
      } as unknown as Parameters<typeof getListing>[0];

      const found = await getListing(ctx, 'zoll-auktion:1');
      expect(found.listing?.id).toBe('1');
      expect(found.problem).toBe(null);
      expect(found.disclaimer).toBe('Höchstgebot, kein Kaufpreis.');

      // Gone: an answer, not a failure — `problem` stays null.
      const gone = await getListing(ctx, 'zoll-auktion:2');
      expect(gone.listing).toBe(null);
      expect(gone.problem).toBe(null);

      // Not an answer at all: three different reasons, none of them "gone".
      expect((await getListing(ctx, 'nonsense')).problem !== null).toBe(true);
      expect((await getListing(ctx, 'ebay:1')).problem !== null).toBe(true);
    });

    await it('warns when a source cannot take part in the cross-provider order', async () => {
      // Zoll-Auktion sorts `newest` server-side and prints no date on its result
      // cards. In a merged list every one of its rows therefore sinks below a
      // kleinanzeigen ad from 2020, while `--explain` reports the sort as
      // applied — true, and useless without this being said.
      const dated = fake('kleinanzeigen', {
        result: {
          listings: [listing({ provider: 'kleinanzeigen', id: 'k', listedAt: '2020-01-01T00:00:00Z' })],
        },
      });
      const undated = fake('zoll-auktion', {
        result: {
          listings: [listing({ provider: 'zoll-auktion', id: 'z', listedAt: null })],
          applied: ['sort'],
        },
      });

      const outcome = await searchAll([dated, undated], { text: 'x', sort: 'newest' }, { merge: true });
      const zoll = outcome.reports.find((r) => r.provider === 'zoll-auktion');
      expect(zoll?.warnings.length).toBe(1);
      // And the source that CAN take part is not warned about.
      expect(outcome.reports.find((r) => r.provider === 'kleinanzeigen')?.warnings.length).toBe(0);
    });

    await it('applies a filter the provider did not, and says which side did it', async () => {
      const cheap = listing({ provider: 'ebay', id: 'cheap', price: money(5000), totalPrice: money(5000) });
      const dear = listing({ provider: 'ebay', id: 'dear', price: money(90000), totalPrice: money(90000) });
      const provider = fake('ebay', { result: { listings: [cheap, dear], applied: [] } });

      const outcome = await searchAll([provider], { text: 'x', maxPriceMinor: 10000 });
      expect(outcome.grouped.get('ebay')?.length).toBe(1);
      const report = outcome.reports[0];
      expect(report.filters.clientSide).toEqualArray(['maxPrice']);
      expect(report.filters.before).toBe(2);
      expect(report.filters.after).toBe(1);
    });

    await it('drops a repeated id before counting', async () => {
      const twice = [listing({ provider: 'ebay', id: '1' }), listing({ provider: 'ebay', id: '1' })];
      const outcome = await searchAll([fake('ebay', { result: { listings: twice } })], query);
      expect(outcome.reports[0].count).toBe(1);
    });

    await it('produces the merged list only when asked', async () => {
      const provider = fake('ebay', { result: { listings: [listing({ provider: 'ebay', id: '1' })] } });
      expect((await searchAll([provider], query)).merged).toBe(null);
      expect((await searchAll([provider], query, { merge: true })).merged?.length).toBe(1);
    });

    await it('turns an unexpected exception into a report rather than a crash', async () => {
      // A provider that throws a plain Error — a bug in an adapter, not a
      // ProviderError — must not escape the fan-out.
      const provider = fake('ebay', { throws: new Error('boom') });
      const outcome = await searchAll([provider], query);
      expect(outcome.reports[0].outcome).toBe('failed');
      expect(outcome.reports[0].message).toBe('boom');
    });
  });

  await describe('searchAll: Barcodes zurück an die Quellen, die danach suchen können', async () => {
    /**
     * A source that answers a text query with one row and a barcode query with
     * a different row. The point of the pass in one fake: eBay's Browse API
     * returns no GTIN in a search summary (measured 2026-08-24), so a group can
     * only ever span eBay and another market if somebody asks eBay by barcode.
     */
    function byGtin(
      id: ProviderId,
      forText: readonly string[],
      forGtin: Record<string, string>,
    ): MarketProvider {
      const asked: string[] = [];
      const provider: MarketProvider & { asked: string[] } = {
        asked,
        capabilities: caps(id, { serverFilters: ['gtin'] }),
        requestsUsed: () => asked.length,
        async status() {
          return { configured: true, problem: null };
        },
        async search(q: SearchQuery): Promise<ProviderResult> {
          const hit = q.gtin ? forGtin[q.gtin] : undefined;
          if (q.gtin) asked.push(q.gtin);
          return {
            provider: id,
            listings: q.gtin
              ? hit
                ? [listing({ provider: id, id: hit, gtin: q.gtin })]
                : []
              : forText.map((row, i) => listing({ provider: id, id: row, gtin: `400000000000${i}` })),
            applied: q.gtin ? ['gtin'] : [],
            truncated: false,
            totalEstimate: null,
            requests: 1,
            warnings: [],
          };
        },
      };
      return provider;
    }

    await it('fragt genau die Quellen, die den Barcode noch nicht haben', async () => {
      const discogs = byGtin('discogs', ['a'], {});
      const ebay = byGtin('ebay', [], { '4000000000000': 'e1' });

      const outcome = await searchAll([discogs, ebay], query, { group: true, crossCheckGtins: 6 });

      // The whole promise of `--compare`, and what it could not do before: one
      // group, two markets.
      const spanning = outcome.products?.filter((g) => new Set(g.listings.map((l) => l.provider)).size > 1);
      expect(spanning?.length).toBe(1);
      expect(outcome.crossCheck?.added).toBe(1);
      expect(outcome.crossCheck?.asked).toBe(1);
      // Never asked about a barcode it contributed itself — that request could
      // only return rows already in hand.
      expect((discogs as unknown as { asked: string[] }).asked.length).toBe(0);
    });

    await it('lässt die Quellenlisten und ihre Berichte unberührt', async () => {
      const discogs = byGtin('discogs', ['a'], {});
      const ebay = byGtin('ebay', [], { '4000000000000': 'e1' });

      const outcome = await searchAll([discogs, ebay], query, { group: true, crossCheckGtins: 6 });

      // The added row answered a barcode, not the query text. Counting it in
      // `grouped` would make eBay's report claim a hit for a search eBay
      // answered with nothing — this project's own failure mode, inverted.
      expect(outcome.grouped.get('ebay')).toBe(undefined);
      const ebayReport = outcome.reports.find((r) => r.provider === 'ebay');
      expect(ebayReport?.outcome).toBe('empty');
      expect(ebayReport?.count).toBe(0);
    });

    await it('nennt die Barcodes, die die Obergrenze übrig lässt', async () => {
      const discogs = byGtin('discogs', ['a', 'b', 'c'], {});
      const ebay = byGtin('ebay', [], { '4000000000000': 'e1', '4000000000001': 'e2' });

      const outcome = await searchAll([discogs, ebay], query, { group: true, crossCheckGtins: 1 });

      expect(outcome.crossCheck?.gtins).toBe(1);
      // A cap that silently dropped the rest would make a partial comparison
      // look like a complete one.
      expect(outcome.crossCheck?.skipped).toBe(2);
      expect(outcome.crossCheck?.added).toBe(1);
    });

    await it('schreibt den abgefragten Barcode auf Zeilen, die keinen tragen', async () => {
      // The defect that made the first live run useless: eBay answers
      // `item_summary/search?gtin=` with matching items whose summaries carry
      // NO product code. Six barcodes, twelve requests, thirteen rows added —
      // and every one of them fell back to the title-and-price identity, so
      // not a single group spanned two markets. The pass had run, the numbers
      // looked like work, and nothing had changed.
      const discogs = byGtin('discogs', ['a'], {});
      const mute: MarketProvider = {
        capabilities: caps('ebay', { serverFilters: ['gtin'] }),
        requestsUsed: () => 1,
        async status() {
          return { configured: true, problem: null };
        },
        async search(q: SearchQuery): Promise<ProviderResult> {
          return {
            provider: 'ebay',
            // Answers the barcode, does not repeat it. eBay, exactly.
            listings: q.gtin ? [listing({ provider: 'ebay', id: 'e1', gtin: null })] : [],
            applied: q.gtin ? ['gtin'] : [],
            truncated: false,
            totalEstimate: null,
            requests: 1,
            warnings: [],
          };
        },
      };

      const outcome = await searchAll([discogs, mute], query, { group: true, crossCheckGtins: 6 });
      const spanning = outcome.products?.filter((g) => new Set(g.listings.map((l) => l.provider)).size > 1);
      expect(spanning?.length).toBe(1);
      expect(spanning?.[0]?.identity).toBe('gtin:4000000000000');
    });

    await it('schreibt ihn NICHT, wenn die Quelle nicht selbst danach gefiltert hat', async () => {
      // The barcode is the source's own answer to "items with this code", or
      // it is our inference about a row it happened to return. Only the first
      // may be written onto a row — otherwise a source that ignored the
      // parameter and sent back its usual results would have its rows silently
      // relabelled as that product.
      const discogs = byGtin('discogs', ['a'], {});
      const ignores: MarketProvider = {
        capabilities: caps('ebay', { serverFilters: ['gtin'] }),
        requestsUsed: () => 1,
        async status() {
          return { configured: true, problem: null };
        },
        async search(q: SearchQuery): Promise<ProviderResult> {
          return {
            provider: 'ebay',
            // A different item entirely — so the only thing that could put it
            // in the Discogs row's group is a barcode written onto it here.
            // Answers the barcode lookup only, like the source it stands for.
            listings: q.gtin
              ? [
                  listing({
                    provider: 'ebay',
                    id: 'e1',
                    gtin: null,
                    title: 'Etwas ganz anderes',
                    price: money(999),
                  }),
                ]
              : [],
            // Says nothing about having honoured `gtin`.
            applied: [],
            truncated: false,
            totalEstimate: null,
            requests: 1,
            warnings: [],
          };
        },
      };

      const outcome = await searchAll([discogs, ignores], query, { group: true, crossCheckGtins: 6 });
      const spanning = outcome.products?.filter((g) => new Set(g.listings.map((l) => l.provider)).size > 1);
      expect(spanning?.length).toBe(0);
      // The row is still added and still shown — `gtin` keeps rows whose field
      // is unknown, deliberately. It is just not claimed to be that product.
      expect(outcome.crossCheck?.added).toBe(1);
    });

    await it('läuft gar nicht ohne group und nicht bei 0', async () => {
      const discogs = byGtin('discogs', ['a'], {});
      const ebay = byGtin('ebay', [], { '4000000000000': 'e1' });

      const off = await searchAll([discogs, ebay], query, { crossCheckGtins: 6 });
      expect(off.crossCheck).toBe(null);
      expect((ebay as unknown as { asked: string[] }).asked.length).toBe(0);

      const zero = await searchAll([discogs, ebay], query, { group: true, crossCheckGtins: 0 });
      expect(zero.crossCheck).toBe(null);
      expect((ebay as unknown as { asked: string[] }).asked.length).toBe(0);
    });
  });
};
