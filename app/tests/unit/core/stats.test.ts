import { describe, expect, it } from '@gjsify/unit';

import { money, priceBand, verdictFor, type PriceStats } from '@troedler/core';

import { listing } from './fixtures.ts';

export default async () => {
  const priced = (id: string, minor: number, currency = 'EUR') =>
    listing({ provider: 'ebay', id, price: money(minor, currency), totalPrice: money(minor, currency) });

  /** The band, or a failure naming the reason it refused. */
  const band = (rows: Parameters<typeof priceBand>[0]): PriceStats => {
    const result = priceBand(rows);
    if (result.kind !== 'band') throw new Error(`kein Band: ${result.reason}`);
    return result.stats;
  };

  await describe('priceBand', async () => {
    await it('reports the median, not the mean', async () => {
      // Second-hand prices have a long right tail: one mint collector's piece
      // among forty ordinary ones drags a mean somewhere nothing is for sale.
      const stats = band([priced('a', 1000), priced('b', 2000), priced('c', 3000), priced('d', 100000)]);
      expect(stats.median.minor).toBe(2500);
      expect(stats.count).toBe(4);
    });

    await it('refuses below three prices — and says why', async () => {
      const none = priceBand([priced('a', 1000), priced('b', 2000)]);
      expect(none.kind).toBe('none');
      // A band that is simply absent reads as "nothing to say about the price".
      // The reason is what makes it readable as "not enough to say it with".
      expect(none.kind === 'none' && none.reason.length > 0).toBe(true);
    });

    await it('ignores unpriced rows instead of counting them as zero', async () => {
      const stats = band([
        priced('a', 1000),
        priced('b', 2000),
        priced('c', 3000),
        listing({ provider: 'ebay', id: 'd', price: null, totalPrice: null }),
      ]);
      expect(stats.count).toBe(3);
      expect(stats.considered).toBe(4);
      expect(stats.caveats.length).toBe(1);
    });

    await it('picks the majority currency rather than converting', async () => {
      // A made-up exchange rate would make the median quietly wrong, which is
      // worse than visibly absent.
      const stats = band([
        priced('a', 1000),
        priced('b', 2000),
        priced('c', 3000),
        priced('d', 500000, 'USD'),
      ]);
      expect(stats.currency).toBe('EUR');
      expect(stats.count).toBe(3);
      // The old band shrank 23 rows to 15 and printed neither number.
      expect(stats.considered).toBe(4);
      expect(stats.caveats.length).toBe(1);
    });

    await it('never mixes an aggregate minimum into a field of asking prices', async () => {
      // The measured nonsense: a Discogs "from 0,40 €" (cheapest of 191 copies
      // worldwide, converted by Discogs) as the floor of a band whose median
      // was a Quoka asking price. The discriminator is `count`: mixing gives 4.
      const rows = [
        priced('a', 10000),
        priced('b', 20000),
        priced('c', 30000),
        listing({ provider: 'discogs', id: 'agg', price: money(40), priceKind: 'from' }),
      ];
      const stats = band(rows);
      expect(stats.basis).toBe('asking');
      expect(stats.count).toBe(3);
      expect(stats.min.minor).toBe(10000);
    });

    await it('never mixes a live bid into a field of asking prices', async () => {
      const rows = [
        listing({ provider: 'zoll-auktion', id: 'x', price: money(2100000), priceKind: 'auction' }),
        listing({ provider: 'zoll-auktion', id: 'y', price: money(4380000), priceKind: 'auction' }),
        listing({ provider: 'zoll-auktion', id: 'z', price: money(3000000), priceKind: 'auction' }),
        priced('a', 1000),
      ];
      const stats = band(rows);
      expect(stats.basis).toBe('auction');
      expect(stats.count).toBe(3);
    });

    await it('drops back to bare prices when only some rows know their postage', async () => {
      // `totalPrice ?? price` silently compared end prices against prices
      // without postage — measured on 41 of 46 rows, where only Booklooker
      // supplied shipping. One notion of money for the whole band, or none.
      const rows = [
        listing({ provider: 'booklooker', id: 'a', price: money(1000), totalPrice: money(1300) }),
        priced('b', 2000),
        priced('c', 3000),
      ];
      // `priced` sets totalPrice === price, so row b and c "know" their
      // postage as zero; make them genuinely unknown instead.
      const mixed = [
        rows[0],
        listing({ provider: 'quoka', id: 'b', price: money(2000), totalPrice: null }),
        listing({ provider: 'quoka', id: 'c', price: money(3000), totalPrice: null }),
      ];
      const stats = band(mixed);
      expect(stats.shippingIncluded).toBe(false);
      // 1000, not 1300 — the discriminator that it did not take totalPrice
      // for the one row that had it.
      expect(stats.min.minor).toBe(1000);
      expect(stats.caveats.length).toBe(1);
    });

    await it('uses end prices when every row knows its postage', async () => {
      const rows = [
        listing({ provider: 'booklooker', id: 'a', price: money(1000), totalPrice: money(1300) }),
        listing({ provider: 'booklooker', id: 'b', price: money(2000), totalPrice: money(2300) }),
        listing({ provider: 'booklooker', id: 'c', price: money(3000), totalPrice: money(3300) }),
      ];
      const stats = band(rows);
      expect(stats.shippingIncluded).toBe(true);
      expect(stats.min.minor).toBe(1300);
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
    const stats = band(rows);

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

    await it('refuses to judge a row that is a different kind of number', async () => {
      // A "from 76,80 €" measured against a field of asking prices comes out a
      // bargain every single time — not because it is cheap, but because a
      // minimum over 66 copies is competing in the wrong contest. Without the
      // basis check this returns 'bargain'.
      const aggregate = listing({ provider: 'discogs', id: 'x', price: money(768), priceKind: 'from' });
      expect(verdictFor(aggregate, stats)).toBe('unknown');
    });
  });
};
