import { describe, expect, it } from '@gjsify/unit';

import {
  bestOf,
  dedupeWithinProvider,
  groupByIdentity,
  identityKey,
  interleaveByProvider,
  money,
  sortListings,
} from '@troedler/core';
import type { Listing, ProviderId } from '@troedler/core';

import { listing } from './fixtures.ts';

export default async () => {
  await describe('dedupeWithinProvider', async () => {
    await it('collapses the same id seen on several pages', async () => {
      // Classified sites repeat their promoted slots on every page. Without
      // this the user is told there are three of a thing when there is one.
      const rows = [
        listing({ provider: 'kleinanzeigen', id: '1' }),
        listing({ provider: 'kleinanzeigen', id: '2' }),
        listing({ provider: 'kleinanzeigen', id: '1' }),
      ];
      expect(dedupeWithinProvider(rows).length).toBe(2);
    });
  });

  await describe('identityKey', async () => {
    await it('trusts a GTIN', async () => {
      const a = listing({ provider: 'ebay', id: 'a', gtin: '4006381333931' });
      const b = listing({
        provider: 'booklooker',
        id: 'b',
        gtin: '4006381333931',
        title: 'Ganz anderer Titel',
      });
      expect(identityKey(a)).toBe(identityKey(b));
    });

    await it('falls back to title plus price, and only when the title is long enough', async () => {
      const a = listing({ provider: 'ebay', id: 'a', title: 'Metabo Bandsaege BAS 318' });
      const b = listing({ provider: 'markt-de', id: 'b', title: 'metabo  bandsaege bas-318' });
      expect(identityKey(a)).toBe(identityKey(b));
      // A short title plus a price is not evidence of anything: "Fahrrad" at
      // 50 EUR describes thousands of unrelated bicycles.
      expect(identityKey(listing({ provider: 'ebay', id: 'c', title: 'Rad' }))).toBe(null);
    });

    await it('does not group two things that merely look similar', async () => {
      const a = listing({
        provider: 'ebay',
        id: 'a',
        title: 'Metabo Bandsaege BAS 318',
        price: money(28900),
      });
      const b = listing({
        provider: 'ebay',
        id: 'b',
        title: 'Metabo Bandsaege BAS 318',
        price: money(19900),
      });
      expect(identityKey(a) === identityKey(b)).toBe(false);
    });
  });

  await describe('groupByIdentity', async () => {
    await it('puts rows without a trustworthy identity in groups of their own', async () => {
      const rows = [
        listing({ provider: 'ebay', id: 'a', gtin: '1' }),
        listing({ provider: 'quoka', id: 'b', gtin: '1' }),
        listing({ provider: 'ebay', id: 'c', title: 'Rad' }),
        listing({ provider: 'ebay', id: 'd', title: 'Rad' }),
      ];
      const groups = groupByIdentity(rows);
      expect(groups.filter((g) => g.listings.length === 2).length).toBe(1);
      expect(groups.filter((g) => g.identity === null).length).toBe(2);
    });
  });

  await describe('sortListings', async () => {
    const priced = listing({ provider: 'ebay', id: 'p', price: money(10000), totalPrice: money(10000) });
    const dear = listing({ provider: 'ebay', id: 'd', price: money(90000), totalPrice: money(90000) });
    const unpriced = listing({ provider: 'ebay', id: 'u', price: null, totalPrice: null });

    await it('sorts unpriced rows last under BOTH price orders', async () => {
      // The naive `?? 0` puts them first under ascending, where they look like
      // the best offers on the page.
      expect(sortListings([unpriced, dear, priced], 'price-asc').map((l) => l.id)).toEqualArray([
        'p',
        'd',
        'u',
      ]);
      expect(sortListings([unpriced, priced, dear], 'price-desc').map((l) => l.id)).toEqualArray([
        'd',
        'p',
        'u',
      ]);
    });

    await it('ignores the end date of fixed-price listings when sorting by ending soonest', async () => {
      // A fixed-price listing's end date rolls forward forever; sorting it in
      // would bury an auction closing in ten minutes.
      const auction = listing({
        provider: 'ebay',
        id: 'auction',
        priceKind: 'auction',
        endsAt: '2026-08-22T10:00:00.000Z',
      });
      const evergreen = listing({ provider: 'ebay', id: 'fix', endsAt: '2026-08-21T10:00:00.000Z' });
      expect(sortListings([evergreen, auction], 'ending-soonest').map((l) => l.id)).toEqualArray([
        'auction',
        'fix',
      ]);
    });

    await it('leaves relevance order alone', async () => {
      // There is no shared meaning of relevance across marketplaces; each ranks
      // by its own opaque score, so inventing one here would dress a guess up
      // as a ranking.
      const rows = [dear, priced, unpriced];
      expect(sortListings(rows, 'relevance').map((l) => l.id)).toEqualArray(['d', 'p', 'u']);
    });
  });

  await describe('interleaveByProvider', async () => {
    await it('gives every source a turn instead of letting the fastest fill the page', async () => {
      const grouped = new Map<ProviderId, readonly Listing[]>([
        [
          'ebay',
          [
            listing({ provider: 'ebay', id: '1' }),
            listing({ provider: 'ebay', id: '2' }),
            listing({ provider: 'ebay', id: '3' }),
          ],
        ],
        ['quoka', [listing({ provider: 'quoka', id: '1' })]],
      ]);
      expect(interleaveByProvider(grouped).map((l) => l.key)).toEqualArray([
        'ebay:1',
        'quoka:1',
        'ebay:2',
        'ebay:3',
      ]);
    });
  });

  await describe('bestOf', async () => {
    await it('prefers cheaper, then better condition', async () => {
      const group = {
        identity: 'gtin:1',
        listings: [
          listing({
            provider: 'ebay',
            id: 'a',
            price: money(20000),
            totalPrice: money(20000),
            condition: 'new',
          }),
          listing({
            provider: 'quoka',
            id: 'b',
            price: money(10000),
            totalPrice: money(10000),
            condition: 'used-good',
          }),
        ],
      };
      expect(bestOf(group).id).toBe('b');
    });
  });
};
