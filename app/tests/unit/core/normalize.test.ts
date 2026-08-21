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
    // `now` is injected, so this test says the same thing at 23:59 as at 00:01.
    const now = new Date('2026-08-21T12:00:00');

    await it('resolves "Heute" against the given now', async () => {
      const iso = parseGermanDate('Heute, 17:08', now);
      expect(iso !== null).toBe(true);
      expect(new Date(iso!).getHours()).toBe(17);
      expect(new Date(iso!).getDate()).toBe(21);
    });

    await it('resolves "Gestern" to the previous day', async () => {
      const iso = parseGermanDate('Gestern, 14:29', now);
      expect(new Date(iso!).getDate()).toBe(20);
      expect(new Date(iso!).getMinutes()).toBe(29);
    });

    await it('reads an explicit dd.mm.yyyy', async () => {
      const iso = parseGermanDate('26.04.2026', now);
      expect(new Date(iso!).getMonth()).toBe(3);
      expect(new Date(iso!).getDate()).toBe(26);
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
