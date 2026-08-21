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
      const done = applyPostFilters(rows, q, ['maxPrice'], activeFilters(q));
      // The provider says it filtered, so the kernel must not filter again —
      // otherwise a source that returns a superset for good reason gets
      // second-guessed and the report would lie about where filtering happened.
      expect(done.listings.length).toBe(3);
      expect(done.report.clientSide.length).toBe(0);
    });

    await it('finishes what the provider could not', async () => {
      const q: SearchQuery = { text: 'x', maxPriceMinor: 20000 };
      const done = applyPostFilters(rows, q, [], activeFilters(q));
      expect(done.listings.map((l) => l.id)).toEqualArray(['a']);
      expect(done.report.clientSide).toEqualArray(['maxPrice']);
      expect(done.report.before).toBe(3);
      expect(done.report.after).toBe(1);
    });

    await it('drops unpriced rows from a price filter rather than treating them as zero', async () => {
      const q: SearchQuery = { text: 'x', minPriceMinor: 1 };
      const done = applyPostFilters(rows, q, [], activeFilters(q));
      expect(done.listings.some((l) => l.id === 'c')).toBe(false);
    });

    await it('keeps listings whose condition is unknown', async () => {
      // Most classified ads state no condition. Dropping them would hide the
      // majority of one entire marketplace behind a filter the user thought
      // was narrow.
      const unknown = listing({ provider: 'kleinanzeigen', id: 'u', condition: 'unknown' });
      const q: SearchQuery = { text: 'x', condition: ['new'] };
      const done = applyPostFilters([unknown], q, [], activeFilters(q));
      expect(done.listings.length).toBe(1);
    });

    await it('reports radius as unenforced instead of silently passing everything', async () => {
      const q: SearchQuery = { text: 'x', postalCode: '21762', radiusKm: 20 };
      const done = applyPostFilters(rows, q, [], activeFilters(q));
      expect(done.report.unenforced).toEqualArray(['radius']);
      expect(done.listings.length).toBe(3);
    });
  });
};
