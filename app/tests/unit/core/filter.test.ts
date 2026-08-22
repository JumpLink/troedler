import { describe, expect, it } from '@gjsify/unit';

import { activeFilters, applyPostFilters, money } from '@troedler/core';
import type { SearchQuery } from '@troedler/core';

import { listing } from './fixtures.ts';

export default async () => {
  await describe('activeFilters', async () => {
    await it('reports only the filters the query actually constrains', async () => {
      const q: SearchQuery = { text: 'x', maxPriceMinor: 5000, sellerType: 'private' };
      const keys = activeFilters(q);
      expect(keys.includes('maxPrice')).toBe(true);
      expect(keys.includes('sellerType')).toBe(true);
      expect(keys.includes('minPrice')).toBe(false);
    });

    await it('ignores a radius without a postcode — half a radius is not a filter', async () => {
      expect(activeFilters({ text: 'x', radiusKm: 20 }).includes('radius')).toBe(false);
      expect(activeFilters({ text: 'x', radiusKm: 20, postalCode: '21762' }).includes('radius')).toBe(true);
    });
  });

  await describe('applyPostFilters', async () => {
    const rows = [
      listing({ provider: 'ebay', id: 'a', price: money(10000), totalPrice: money(10000) }),
      listing({ provider: 'ebay', id: 'b', price: money(50000), totalPrice: money(50000) }),
      listing({ provider: 'ebay', id: 'c', price: null, totalPrice: null, priceKind: 'unknown' }),
    ];

    await it('skips what the provider already did', async () => {
      const q: SearchQuery = { text: 'x', maxPriceMinor: 20000 };
      const done = applyPostFilters(rows, q, ['maxPrice'], activeFilters(q), { limit: 100 });
      // The provider says it filtered, so the kernel must not filter again —
      // otherwise a source that returns a superset for good reason gets
      // second-guessed and the report would lie about where filtering happened.
      expect(done.listings.length).toBe(3);
      expect(done.report.clientSide.length).toBe(0);
    });

    await it('finishes what the provider could not', async () => {
      const q: SearchQuery = { text: 'x', maxPriceMinor: 20000 };
      const done = applyPostFilters(rows, q, [], activeFilters(q), { limit: 100 });
      expect(done.listings.map((l) => l.id)).toEqualArray(['a']);
      expect(done.report.clientSide).toEqualArray(['maxPrice']);
      expect(done.report.before).toBe(3);
      expect(done.report.after).toBe(1);
    });

    await it('drops unpriced rows from a price filter rather than treating them as zero', async () => {
      const q: SearchQuery = { text: 'x', minPriceMinor: 1 };
      const done = applyPostFilters(rows, q, [], activeFilters(q), { limit: 100 });
      expect(done.listings.some((l) => l.id === 'c')).toBe(false);
    });

    await it('keeps listings whose condition is unknown', async () => {
      // Most classified ads state no condition. Dropping them would hide the
      // majority of one entire marketplace behind a filter the user thought
      // was narrow.
      const unknown = listing({ provider: 'kleinanzeigen', id: 'u', condition: 'unknown' });
      const q: SearchQuery = { text: 'x', condition: ['new'] };
      const done = applyPostFilters([unknown], q, [], activeFilters(q), { limit: 100 });
      expect(done.listings.length).toBe(1);
    });

    await it('reports radius as unenforced instead of silently passing everything', async () => {
      const q: SearchQuery = { text: 'x', postalCode: '21762', radiusKm: 20 };
      const done = applyPostFilters(rows, q, [], activeFilters(q), { limit: 100 });
      expect(done.report.unenforced).toEqualArray(['radius']);
      expect(done.listings.length).toBe(3);
    });

    await it('cuts to the limit AFTER filtering, not before', async () => {
      // The measured bug, in one assertion. When the adapter cut first,
      // `--max-price 200 --limit 1` handed the kernel only the 500-EUR row and
      // the answer was "keine Treffer" — with a matching row in the same
      // response, already paid for. The discriminator is that `a` comes back
      // at all: a pre-filter cut returns nothing here.
      const q: SearchQuery = { text: 'x', maxPriceMinor: 20000 };
      const done = applyPostFilters([rows[1], rows[0], rows[2]], q, [], activeFilters(q), { limit: 1 });
      expect(done.listings.map((l) => l.id)).toEqualArray(['a']);
    });

    await it('cuts to the limit AFTER sorting, not before', async () => {
      // "the cheapest two" must not mean "the first two the source listed,
      // reordered". The cheapest row sits at position THREE on purpose: with a
      // cut before the sort it never reaches the comparison, and the answer is
      // the two most expensive in price order — which is what Discogs actually
      // returned for `--sort price-asc --limit 4` out of 31 408 matches.
      const q: SearchQuery = { text: 'x', sort: 'price-asc' };
      const done = applyPostFilters([rows[1], rows[2], rows[0]], q, [], activeFilters(q), { limit: 2 });
      expect(done.listings.map((l) => l.id)).toEqualArray(['a', 'b']);
    });

    await it('counts rows that matched and still fell to the limit', async () => {
      // `dropped` is the discriminator between "this is all there was" and
      // "there are five more". Without it both print the same line.
      const q: SearchQuery = { text: 'x' };
      const done = applyPostFilters(rows, q, [], activeFilters(q), { limit: 1 });
      expect(done.report.after).toBe(3);
      expect(done.report.dropped).toBe(2);
    });

    await it('names sort as done here when the provider did not do it', async () => {
      // `sort` used to fall out of BOTH lists, so `--explain` printed two
      // dashes for an ordering the kernel had performed — on results where the
      // difference is "cheapest of 31 408" versus "cheapest of 4".
      const q: SearchQuery = { text: 'x', sort: 'price-asc' };
      const here = applyPostFilters(rows, q, [], activeFilters(q), { limit: 100 });
      expect(here.report.clientSide.includes('sort')).toBe(true);

      const there = applyPostFilters(rows, q, ['sort'], activeFilters(q), { limit: 100 });
      expect(there.report.clientSide.includes('sort')).toBe(false);
    });

    await it('leaves a provider-sorted list in the order the provider chose', async () => {
      // Re-sorting a server-ordered list overrules the one ranking the source
      // could give. Input order is not price order; it must survive.
      const q: SearchQuery = { text: 'x', sort: 'price-asc' };
      const done = applyPostFilters([rows[1], rows[0]], q, ['sort'], activeFilters(q), {
        limit: 100,
      });
      expect(done.listings.map((l) => l.id)).toEqualArray(['b', 'a']);
    });

    await it('calls a filter unenforced when the source never fills its field', async () => {
      // Measured: `--condition new --since heute` over four sources put twelve
      // rows in and twelve out — three of them cars — while `--explain` said
      // "Filter hier nachgezogen: condition, since". Both filters ran; both
      // keep the unknown, and every row was unknown.
      const blank = [
        listing({ provider: 'quoka', id: 'p', condition: 'unknown', listedAt: null }),
        listing({ provider: 'quoka', id: 'q', condition: 'unknown', listedAt: null }),
      ];
      const q: SearchQuery = { text: 'x', condition: ['new'], since: '2026-08-22T00:00:00Z' };
      const done = applyPostFilters(blank, q, [], activeFilters(q), { limit: 100 });
      expect(done.listings.length).toBe(2);
      expect(done.report.clientSide.length).toBe(0);
      expect(done.report.unenforced.includes('condition')).toBe(true);
      expect(done.report.unenforced.includes('since')).toBe(true);
    });

    await it('still enforces such a filter as soon as ONE row carries the field', async () => {
      // The discriminator for the rule above: it must key on the rows, not on
      // the provider. One row with a real condition makes the filter live
      // again — and it then removes the row that does not match.
      const mixed = [
        listing({ provider: 'quoka', id: 'p', condition: 'unknown' }),
        listing({ provider: 'quoka', id: 'q', condition: 'used-good' }),
      ];
      const q: SearchQuery = { text: 'x', condition: ['new'] };
      const done = applyPostFilters(mixed, q, [], activeFilters(q), { limit: 100 });
      expect(done.report.clientSide).toEqualArray(['condition']);
      expect(done.listings.map((l) => l.id)).toEqualArray(['p']);
    });

    await it('keeps a price filter live even where nothing is priced', async () => {
      // Price filters DROP the unknown, so they act on any source. They must
      // never be swept into `unenforced` by the rule above.
      const q: SearchQuery = { text: 'x', minPriceMinor: 1 };
      const done = applyPostFilters([rows[2]], q, [], activeFilters(q), { limit: 100 });
      expect(done.report.clientSide).toEqualArray(['minPrice']);
      expect(done.listings.length).toBe(0);
    });
  });
};
