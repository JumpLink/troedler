import { describe, expect, it } from '@gjsify/unit';

import {
  bestOf,
  dedupeWithinProvider,
  groupByIdentity,
  identityKey,
  interleaveByProvider,
  normalizeGtin,
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

  await describe('normalizeGtin', async () => {
    await it('reads a padded UPC-A and a bare one as the same barcode', async () => {
      // Both spellings sit in the SAME Discogs `barcode[]` array. Comparing the
      // strings made a row match or miss depending on which one that source
      // printed first — measured on two of five rows of one search.
      expect(normalizeGtin('0190295272432')).toBe(normalizeGtin('190295272432'));
      expect(normalizeGtin('5 099996 601419')).toBe('5099996601419');
      // Not a barcode: too short after stripping. `null`, not a truncated key
      // that would group unrelated rows.
      expect(normalizeGtin('00042')).toBe(null);
      expect(normalizeGtin(null)).toBe(null);
    });
  });

  await describe('groupByIdentity', async () => {
    await it('puts the same product from two sources into one group', async () => {
      const rows = [
        // `totalPrice` set explicitly: the fixture defaults it to 289,00 € and
        // ranking keys on it, so leaving it out would compare two equal totals
        // and make this pass for the wrong reason.
        listing({
          provider: 'ebay',
          id: 'a',
          gtin: '0190295272432',
          price: money(12000),
          totalPrice: money(12000),
        }),
        listing({
          provider: 'quoka',
          id: 'b',
          gtin: '190295272432',
          price: money(4000),
          totalPrice: money(4000),
        }),
      ];
      const groups = groupByIdentity(rows);
      expect(groups.length).toBe(1);
      expect(groups[0].listings.length).toBe(2);
      expect(groups[0].ambiguous).toBe(false);
      // The whole point: cheapest across the sources.
      expect(bestOf(groups[0])?.id).toBe('b');
    });

    await it('marks a group ambiguous when one source contributed several CATALOGUE rows', async () => {
      // Measured on Discogs: barcode 5099996601419 covers the 2009 UK pressing,
      // the 2015 European one and a 2025 tour edition. All three are that
      // barcode; only one of them is 11,18 €. Each Discogs row is an aggregate
      // over the offers of ONE pressing — `priceKind: 'from'` — so three of them
      // under a single barcode means the barcode is not the product.
      const rows = ['2047018', '7000941', '35822047'].map((id, i) =>
        listing({
          provider: 'discogs',
          id,
          gtin: '5099996601419',
          price: money([1720, 1118, 3100][i]),
          totalPrice: null,
          priceKind: 'from',
        }),
      );
      const groups = groupByIdentity(rows);
      expect(groups[0].listings.length).toBe(3);
      expect(groups[0].ambiguous).toBe(true);
      // The discriminator. Before, this answered `11,18 €` for a bucket that
      // holds a 31,00 € signed edition — and a caller would have printed it.
      expect(bestOf(groups[0])).toBe(null);
    });

    await it('does NOT call several offers of one book ambiguous', async () => {
      // The counter-case, found by running `--compare` against the live source:
      // three Booklooker sellers offering the same ISBN are one product and
      // three offers, and naming the cheapest is exactly the answer wanted.
      // Keying ambiguity on "several rows from one source" flagged this too.
      const rows = ['a', 'b', 'c'].map((id, i) =>
        listing({
          provider: 'booklooker',
          id,
          gtin: '9783638760218',
          price: money([1795, 1495, 2295][i]),
          totalPrice: money([1795, 1495, 2295][i]),
        }),
      );
      const groups = groupByIdentity(rows);
      expect(groups[0].listings.length).toBe(3);
      expect(groups[0].ambiguous).toBe(false);
      expect(bestOf(groups[0])?.id).toBe('b');
    });

    await it('leaves a row without a trustworthy identity on its own', async () => {
      const rows = [
        listing({ provider: 'quoka', id: 'a', gtin: null, title: 'Rad', price: money(1000) }),
        listing({ provider: 'quoka', id: 'b', gtin: null, title: 'Rad', price: money(1000) }),
      ];
      // Titles under twelve characters do not identify anything, so these must
      // NOT merge — that is how two different bicycles become one.
      const groups = groupByIdentity(rows);
      expect(groups.length).toBe(2);
      expect(groups.every((g) => g.identity === null)).toBe(true);
    });

    await it('does not let postage move a product identity', async () => {
      // Identity keys on the bare price, ranking on what you pay. The same book
      // at 10,00 € from two shops is one product and two offers.
      const rows = [
        listing({
          provider: 'booklooker',
          id: 'a',
          gtin: null,
          title: 'Die Elementarteilchen',
          price: money(1000),
          totalPrice: money(1300),
        }),
        listing({
          provider: 'quoka',
          id: 'b',
          gtin: null,
          title: 'Die Elementarteilchen',
          price: money(1000),
          totalPrice: money(1000),
        }),
      ];
      const groups = groupByIdentity(rows);
      expect(groups.length).toBe(1);
      expect(bestOf(groups[0])?.id).toBe('b');
    });
  });

  await describe('bestOf', async () => {
    await it('prefers cheaper, then better condition', async () => {
      const group = {
        identity: 'gtin:1',
        ambiguous: false,
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
      expect(bestOf(group)?.id).toBe('b');
    });
  });
};
