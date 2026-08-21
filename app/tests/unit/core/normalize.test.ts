import { describe, expect, it } from '@gjsify/unit';

import {
  conditionFromEbayId,
  conditionFromGerman,
  normalizeTitle,
  parseGermanDate,
  parseGermanPrice,
  stripContactDetails,
} from '@troedler/core';

export default async () => {
  await describe('normalizeTitle', async () => {
    await it('folds ß to ss BEFORE stripping diacritics', async () => {
      // The whole reason this function exists. Neither SQLite's FTS5
      // remove_diacritics nor Intl.Collator folds ß, so without this a search
      // for "grusse" never finds "Grüße" — and German listings are full of
      // Straße, Größe, Fußball, weiß.
      expect(normalizeTitle('Grüße')).toBe('grusse');
      expect(normalizeTitle('Große weiße Fußmatte')).toBe('grosse weisse fussmatte');
    });

    await it('folds umlauts and collapses punctuation', async () => {
      expect(normalizeTitle('Bandsäge  BAS-318, gebraucht!')).toBe('bandsage bas 318 gebraucht');
    });

    await it('strips zero-width characters', async () => {
      // Classified-ad markup puts them inside place names; a title that
      // compares unequal because of an invisible character is the kind of bug
      // nobody finds by reading the output.
      expect(normalizeTitle('Ham\u200Bburg')).toBe('hamburg');
    });

    await it('makes two spellings of the same thing equal', async () => {
      expect(normalizeTitle('Metabo BAS 318')).toBe(normalizeTitle('metabo  bas-318'));
    });
  });

  await describe('stripContactDetails', async () => {
    await it('removes e-mail addresses and German phone numbers', async () => {
      const text = 'Bei Interesse 0176 1234567 oder max.mustermann@example.com anrufen.';
      const cleaned = stripContactDetails(text);
      expect(cleaned.includes('@')).toBe(false);
      expect(cleaned.includes('1234567')).toBe(false);
      // The surrounding text survives — this filters contact details, it does
      // not redact the listing.
      expect(cleaned.includes('Bei Interesse')).toBe(true);
    });

    await it('handles the +49 and 0049 forms', async () => {
      expect(stripContactDetails('Tel +49 4751 90 12 34').includes('4751')).toBe(false);
      expect(stripContactDetails('0049 176 9876543').includes('9876543')).toBe(false);
    });

    await it('leaves prices and model numbers alone', async () => {
      // A model number is not a phone number, and over-eager stripping would
      // quietly damage every listing title it touched.
      expect(stripContactDetails('Metabo BAS 318 für 289 Euro')).toBe('Metabo BAS 318 für 289 Euro');
    });
  });

  await describe('parseGermanPrice', async () => {
    await it('reads the German thousands separator', async () => {
      // 3.550 € is three thousand five hundred fifty, not three euros fifty.
      // Getting it wrong sorts a bargain to the top of a price-ascending list.
      expect(parseGermanPrice('3.550 € VB').price?.minor).toBe(355000);
      expect(parseGermanPrice('1.200,50 €').price?.minor).toBe(120050);
      expect(parseGermanPrice('249 €').price?.minor).toBe(24900);
    });

    await it('recognises VB as negotiable', async () => {
      expect(parseGermanPrice('3.550 € VB').kind).toBe('negotiable');
      expect(parseGermanPrice('249 €').kind).toBe('fixed');
    });

    await it('recognises "Zu verschenken" as free, not as missing', async () => {
      const parsed = parseGermanPrice('Zu verschenken');
      expect(parsed.kind).toBe('free');
      expect(parsed.price?.minor).toBe(0);
    });

    await it('returns null for an absent price rather than zero', async () => {
      // Zero would pass a "max 50 €" filter and flood the results.
      expect(parseGermanPrice('').price).toBe(null);
      expect(parseGermanPrice('   ').kind).toBe('unknown');
    });

    await it('keeps VB even when no number is printed', async () => {
      const parsed = parseGermanPrice('VB');
      expect(parsed.price).toBe(null);
      expect(parsed.kind).toBe('negotiable');
    });
  });

  await describe('parseGermanDate', async () => {
    // Both parameters are injected, and for the same reason: the answer must not depend on when
    // or WHERE this runs. `now` is pinned, and the wall clock on the page is read in the
    // marketplace's zone rather than the reader's — asserted as exact instants, because a local
    // getter would agree with a wrong implementation on a Berlin machine.
    const now = new Date('2026-08-21T12:00:00.000Z'); // 14:00 in Berlin, CEST

    await it('reads "Heute" as a wall clock in the marketplace timezone', async () => {
      expect(parseGermanDate('Heute, 17:08', now)).toBe('2026-08-21T15:08:00.000Z');
    });

    await it('resolves "Gestern" to the previous day THERE', async () => {
      expect(parseGermanDate('Gestern, 14:29', now)).toBe('2026-08-20T12:29:00.000Z');
    });

    await it('uses the calendar day of the marketplace, not of the machine', async () => {
      // 23:30 UTC is already the 22nd in Berlin. A reader in UTC who resolved "Heute" against
      // its own date would be a day behind for half an hour every night.
      const lateEvening = new Date('2026-08-21T23:30:00.000Z');
      expect(parseGermanDate('Heute, 08:00', lateEvening)).toBe('2026-08-22T06:00:00.000Z');
    });

    await it('applies the right offset on both sides of the DST change', async () => {
      // Summer is +02:00, winter +01:00. An implementation with a hardcoded offset — or one that
      // used the machine's — gets exactly one of these two right.
      expect(parseGermanDate('26.04.2026', now)).toBe('2026-04-25T22:00:00.000Z');
      expect(parseGermanDate('15.01.2026', now)).toBe('2026-01-14T23:00:00.000Z');
    });

    await it('crosses a month boundary backwards for "Gestern"', async () => {
      const firstOfMonth = new Date('2026-09-01T10:00:00.000Z');
      expect(parseGermanDate('Gestern, 09:15', firstOfMonth)).toBe('2026-08-31T07:15:00.000Z');
    });

    await it('reads an explicit dd.mm.yyyy with a time', async () => {
      expect(parseGermanDate('26.04.2026, 09:30', now)).toBe('2026-04-26T07:30:00.000Z');
    });

    await it('returns null for something it does not understand', async () => {
      expect(parseGermanDate('irgendwann', now)).toBe(null);
      expect(parseGermanDate(null, now)).toBe(null);
    });
  });

  await describe('condition mapping', async () => {
    await it('maps eBay condition ids onto the shared scale', async () => {
      expect(conditionFromEbayId('1000')).toBe('new');
      expect(conditionFromEbayId('3000')).toBe('used-excellent');
      expect(conditionFromEbayId('7000')).toBe('for-parts');
    });

    await it('answers "unknown" for an id it does not know, never a guess', async () => {
      expect(conditionFromEbayId('9999')).toBe('unknown');
      expect(conditionFromEbayId(null)).toBe('unknown');
    });

    await it('reads German condition wording', async () => {
      expect(conditionFromGerman('Neu, originalverpackt')).toBe('new');
      expect(conditionFromGerman('neuwertig')).toBe('used-excellent');
      expect(conditionFromGerman('Defekt, für Bastler')).toBe('for-parts');
      expect(conditionFromGerman('Gebraucht, Gebrauchsspuren')).toBe('used-acceptable');
    });

    await it('stays "unknown" on silence instead of inventing a grade', async () => {
      // Most classified ads say nothing about condition. Inventing "used-good"
      // would make the ranking act on a fact nobody stated.
      expect(conditionFromGerman('')).toBe('unknown');
      expect(conditionFromGerman('Fahrrad 28 Zoll')).toBe('unknown');
    });
  });
};
