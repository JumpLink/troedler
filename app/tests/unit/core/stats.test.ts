import { describe, expect, it } from '@gjsify/unit';

import { money, priceStats, verdictFor } from '@troedler/core';

import { listing } from './fixtures.ts';

export default async () => {
  const priced = (id: string, minor: number, currency = 'EUR') =>
    listing({ provider: 'ebay', id, price: money(minor, currency), totalPrice: money(minor, currency) });

  await describe('priceStats', async () => {
    await it('reports the median, not the mean', async () => {
      // Second-hand prices have a long right tail: one mint collector's piece
      // among forty ordinary ones drags a mean somewhere nothing is for sale.
      const rows = [priced('a', 1000), priced('b', 2000), priced('c', 3000), priced('d', 100000)];
      const stats = priceStats(rows)!;
      expect(stats.median.minor).toBe(2500);
      expect(stats.count).toBe(4);
    });

    await it('returns null below three prices — a median of two is theatre', async () => {
      expect(priceStats([priced('a', 1000), priced('b', 2000)])).toBe(null);
    });

    await it('ignores unpriced rows instead of counting them as zero', async () => {
      const rows = [
        priced('a', 1000),
        priced('b', 2000),
        priced('c', 3000),
        listing({ provider: 'ebay', id: 'd', price: null, totalPrice: null }),
      ];
      expect(priceStats(rows)!.count).toBe(3);
    });

    await it('picks the majority currency rather than converting', async () => {
      // A made-up exchange rate would make the median quietly wrong, which is
      // worse than visibly absent.
      const rows = [priced('a', 1000), priced('b', 2000), priced('c', 3000), priced('d', 500000, 'USD')];
      const stats = priceStats(rows)!;
      expect(stats.currency).toBe('EUR');
      expect(stats.count).toBe(3);
    });
  });

  await describe('verdictFor', async () => {
    const rows = [
      priced('a', 10000),
      priced('b', 20000),
      priced('c', 30000),
      priced('d', 40000),
      priced('e', 50000),
    ];
    const stats = priceStats(rows)!;

    await it('places an offer in the field', async () => {
      // The band over 100/200/300/400/500 EUR is p25 = 200, median = 300, p75 = 400.
      expect(verdictFor(priced('x', 30000), stats)).toBe('typical');
      // 500 sits exactly on p75 + (p75 - median), i.e. the last euro that still
      // counts as merely "above". The boundary is asserted deliberately —
      // getting it wrong shifts every verdict by one bucket.
      expect(verdictFor(priced('x', 50000), stats)).toBe('above');
      expect(verdictFor(priced('x', 90000), stats)).toBe('expensive');
      expect(verdictFor(priced('x', 5000), stats)).toBe('bargain');
    });

    await it('says nothing when it cannot compare', async () => {
      expect(verdictFor(listing({ provider: 'ebay', id: 'x', price: null, totalPrice: null }), stats)).toBe(
        'unknown',
      );
      expect(verdictFor(priced('x', 30000, 'USD'), stats)).toBe('unknown');
      expect(verdictFor(priced('x', 30000), null)).toBe('unknown');
    });
  });
};
