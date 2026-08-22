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
};
