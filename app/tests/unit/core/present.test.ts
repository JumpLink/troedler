/**
 * The German sentence set — the one thing two surfaces must never disagree on.
 *
 * These sentences moved out of `cli/output.ts` because a GUI written against
 * the same data would have written its own, slightly different, and the two
 * would have disagreed about whether a source answered. What is asserted here
 * is not the wording for its own sake: it is that `skipped`, `empty` and
 * `failed` produce three DIFFERENT sentences, that a filter which could not
 * take effect is marked as the one line a reader must not skim, and that a
 * day-precise date is not rendered as a distance the source never gave.
 *
 * `now` is a parameter everywhere, so every boundary below is pinned rather
 * than sampled from the machine's clock.
 */

import { describe, expect, it } from '@gjsify/unit';

import {
  bandText,
  emptinessNotice,
  explainLines,
  fmtLocation,
  fmtMinor,
  groupIdentityLabel,
  mergeExcludedNotice,
  money,
  providerLabel,
  providerState,
  listingFacts,
  reportLine,
  sourceHeading,
  type PriceBand,
  type ProviderReport,
} from '@troedler/core';

import { listing } from './fixtures.ts';

/** 2026-08-22, 12:00 local — every relative wording below is measured against it. */
const NOW = Date.parse('2026-08-22T12:00:00+02:00');

/**
 * `Intl` puts U+00A0 between the amount and the currency sign, and the exact
 * space is not what any of these tests are about. Normalising it keeps the
 * expectations readable as the strings a person sees, without pinning an ICU
 * detail that differs between the two runtimes this suite runs on.
 */
function plain(text: string | undefined): string {
  return (text ?? '').replace(/\u00A0/g, ' ');
}

function report(over: Partial<ProviderReport> = {}): ProviderReport {
  return {
    provider: 'quoka',
    label: 'Quoka',
    outcome: 'ok',
    count: 3,
    errorKind: null,
    message: null,
    truncated: false,
    totalEstimate: 13,
    requests: 2,
    durationMs: 3716,
    warnings: [],
    filters: {
      serverSide: ['sellerType'],
      clientSide: [],
      unenforced: [],
      before: 20,
      after: 20,
      dropped: 0,
    },
    disclaimer: null,
    ...over,
  };
}

export default async () => {
  await describe('present: wie lange her', async () => {
    // Through `listingFacts`, which is what a surface calls. The wording lives
    // in a private helper on purpose — a second entry point to the same
    // sentence is how two views start disagreeing about one row.
    const factsOf = (over: Parameters<typeof listing>[0]): string[] => listingFacts(listing(over), NOW);

    await it('sagt bei minutengenauen Angaben einen Abstand', async () => {
      const facts = factsOf({
        provider: 'quoka',
        id: 'a',
        listedAt: new Date(NOW - 5 * 3_600_000).toISOString(),
      });
      expect(facts.includes('vor 5 h')).toBe(true);
    });

    await it('sagt bei taggenauen Angaben KEINEN Abstand', async () => {
      // The discriminator, and a real defect it closes. Quoka prints `heute
      // 14:44` on some rows and `20 August` on others; the second resolves to
      // MIDNIGHT, the earliest instant that day could mean. On page 100 of a
      // query that form is 20 of 20 rows.
      const iso = new Date(Date.parse('2026-08-20T00:00:00+02:00')).toISOString();
      const base = { provider: 'quoka' as const, id: 'a', listedAt: iso };

      // 60 hours, which the hour arithmetic rounds to THREE days: an ad from
      // the 20th was announced as "vor 3 d" on the 22nd. Not a rounding nit —
      // it is a distance computed from a value that only ever meant a day.
      expect(factsOf({ ...base, listedAtPrecision: 'minute' }).includes('vor 3 d')).toBe(true);
      const day = factsOf({ ...base, listedAtPrecision: 'day' });
      expect(day.some((f) => f.replace(/\u00A0/g, ' ') === 'am 20. August')).toBe(true);
      expect(day.some((f) => f.startsWith('vor '))).toBe(false);

      const today = new Date(Date.parse('2026-08-22T00:00:00+02:00')).toISOString();
      expect(factsOf({ ...base, listedAt: today, listedAtPrecision: 'day' }).includes('heute')).toBe(true);
      const yesterday = new Date(Date.parse('2026-08-21T00:00:00+02:00')).toISOString();
      expect(factsOf({ ...base, listedAt: yesterday, listedAtPrecision: 'day' }).includes('gestern')).toBe(
        true,
      );
    });

    await it('sagt nichts, wenn es nichts zu sagen gibt', async () => {
      const facts = factsOf({ provider: 'quoka', id: 'a', listedAt: null });
      expect(facts.some((f) => f.startsWith('vor ') || f.startsWith('am '))).toBe(false);
      // An empty fact must never reach the list as an empty string — a surface
      // joining with " · " would print a stray separator.
      expect(facts.every((f) => f.length > 0)).toBe(true);
    });

    await it('zählt eine Auktion herunter, und nur eine Auktion', async () => {
      const running = factsOf({
        provider: 'zoll-auktion',
        id: 'a',
        priceKind: 'auction',
        endsAt: new Date(NOW + 5 * 3_600_000).toISOString(),
        bidCount: 17,
      });
      expect(running.includes('endet in 5 h')).toBe(true);
      expect(running.includes('17 Gebot(e)')).toBe(true);

      expect(
        factsOf({
          provider: 'zoll-auktion',
          id: 'b',
          priceKind: 'auction',
          endsAt: new Date(NOW - 60_000).toISOString(),
          bidCount: 0,
        }).includes('endet beendet'),
      ).toBe(true);

      // A fixed-price ad has no countdown, however many fields it carries.
      const fixed = factsOf({
        provider: 'quoka',
        id: 'c',
        priceKind: 'fixed',
        endsAt: new Date(NOW + 3_600_000).toISOString(),
        bidCount: 4,
      });
      expect(fixed.some((f) => f.startsWith('endet') || f.includes('Gebot'))).toBe(false);
    });

    await it('setzt die Überschrift einer Quelle genau einmal zusammen', async () => {
      expect(sourceHeading('quoka', 3)).toBe('Quoka (3)');
    });
  });

  await describe('present: übersprungen ≠ leer ≠ kaputt', async () => {
    await it('gibt jedem Ausgang seinen eigenen Satz', async () => {
      // The whole point of the file. Four outcomes, four sentences, and none of
      // them is a row count — "0 Treffer" is the answer people act on, and
      // three of these four do not mean it.
      const ok = reportLine(report({ outcome: 'ok', count: 3 }));
      const empty = reportLine(report({ outcome: 'empty', count: 0 }));
      const skipped = reportLine(report({ outcome: 'skipped', count: 0, message: 'kein Schlüssel' }));
      const failed = reportLine(
        report({ outcome: 'failed', count: 0, errorKind: 'parse-failed', message: 'Markup bewegt' }),
      );

      expect(ok).toBe('Quoka: 3 Treffer');
      expect(empty).toBe('Quoka: keine Treffer');
      expect(skipped.includes('übersprungen')).toBe(true);
      expect(skipped.includes('kein Schlüssel')).toBe(true);
      expect(failed.includes('FEHLER (parse-failed)')).toBe(true);
      expect(new Set([ok, empty, skipped, failed]).size).toBe(4);
    });

    await it('sagt bei einem wiederholbaren Fehler, dass er wiederholbar ist — und beim 403 nicht', async () => {
      const throttled = reportLine(report({ outcome: 'failed', errorKind: 'rate-limited', message: 'x' }));
      expect(throttled.includes('später erneut möglich')).toBe(true);
      // A 403 from a bot wall is a decision. Coming back with anything changed
      // is the circumvention this project refuses to do.
      const refused = reportLine(report({ outcome: 'failed', errorKind: 'refused', message: 'x' }));
      expect(refused.includes('später erneut möglich')).toBe(false);
    });

    await it('unterscheidet abgeschnitten von erschöpft', async () => {
      // Three different endings on the same "3 Treffer", because "there are
      // more" and "that was all" are answers a person acts on differently.
      expect(reportLine(report())).toBe('Quoka: 3 Treffer');
      expect(reportLine(report({ truncated: true }))).toBe(
        'Quoka: 3 Treffer (mehr vorhanden, abgeschnitten)',
      );
      const cut = reportLine(report({ filters: { ...report().filters, dropped: 10 } }));
      expect(cut.includes('10 weitere')).toBe(true);
    });
  });

  await describe('present: --explain', async () => {
    await it('markiert genau die Zeile, die ein Leser nicht überfliegen darf', async () => {
      const lines = explainLines(
        report({
          filters: { ...report().filters, serverSide: [], unenforced: ['sellerType'] },
        }),
      );
      const strong = lines.filter((l) => l.strong);
      expect(strong).toHaveLength(1);
      expect(strong[0].text.includes('NICHT angewandt: sellerType')).toBe(true);
      // Nothing unenforced → nothing emphasised. Otherwise the emphasis means
      // nothing, which is the same as not having it.
      expect(explainLines(report()).some((l) => l.strong)).toBe(false);
    });

    await it('sagt „nicht gebucht" statt null Anfragen', async () => {
      // A failed Booklooker run that HAD spent a request and burned quota was
      // booked as "0 Anfragen, 1189 ms". Zero is a claim; `null` is not.
      const unbooked = explainLines(report({ requests: null }));
      expect(unbooked.some((l) => l.text.includes('Anfragen nicht gebucht'))).toBe(true);
      expect(explainLines(report()).some((l) => l.text.startsWith('2 Anfragen'))).toBe(true);
    });
  });

  await describe('present: Preisband', async () => {
    const stats = {
      count: 3,
      considered: 3,
      currency: 'EUR',
      basis: 'asking' as const,
      shippingIncluded: false,
      min: money(95000),
      p25: money(97500),
      median: money(100000),
      p75: money(1050000),
      max: money(2000000),
      caveats: ['zwei Zeilen ohne Preis'],
    };

    await it('gibt die fünf Zahlen einzeln heraus, nicht als eine Zeile', async () => {
      const text = bandText({ kind: 'band', stats });
      expect(plain(text.quantiles?.median)).toBe('1.000,00 €');
      expect(plain(text.quantiles?.min)).toBe('950,00 €');
      expect(text.headline.includes('Preisband über 3')).toBe(true);
      expect(text.caveats).toEqualArray(['zwei Zeilen ohne Preis']);
    });

    await it('bleibt richtig, wenn alle fünf Zahlen gleich sind', async () => {
      // The discriminator for handing the parts over instead of one string: a
      // surface that emphasised the median by searching for it inside the line
      // marks the MINIMUM here, because `replace` takes the first match.
      const flat = {
        ...stats,
        min: money(500),
        p25: money(500),
        median: money(500),
        p75: money(500),
        max: money(500),
      };
      const text = bandText({ kind: 'band', stats: flat });
      expect(plain(text.quantiles?.median)).toBe('5,00 €');
      expect(plain(text.quantiles?.min)).toBe('5,00 €');
    });

    await it('sagt, warum es kein Band gibt', async () => {
      const none: PriceBand = { kind: 'none', reason: 'zu wenige Angebote mit Preis' };
      const text = bandText(none);
      expect(text.quantiles).toBe(null);
      expect(text.headline).toBe('kein Preisband — zu wenige Angebote mit Preis');
    });
  });

  await describe('present: der Rest, den zwei Oberflächen teilen', async () => {
    await it('kennt die vier Zustände einer Quelle — und nur diese vier', async () => {
      // Two views said this three ways and two of them disagreed: one printed
      // „an", the other „bereit" for the same state.
      expect(providerState({ enabled: false, configured: false, problem: null })).toBe('aus');
      expect(providerState({ enabled: false, configured: true, problem: null })).toBe('aus');
      expect(providerState({ enabled: true, configured: true, problem: null })).toBe('bereit');
      expect(providerState({ enabled: true, configured: false, problem: 'Schlüssel fehlt' })).toBe(
        'an, aber nicht konfiguriert',
      );
    });

    await it('nennt eine Quelle nicht „bereit", deren Probe fehlgeschlagen ist', async () => {
      // The state the two booleans could not express, and the reason this
      // function now takes a third field. eBay answered its own token request
      // with 401 — a keyset that existed, spelled correctly, and disabled at
      // eBay's end — and `check` printed „ebay bereit" directly above it.
      expect(
        providerState({
          enabled: true,
          configured: true,
          problem: 'eBay lehnte den Token-Abruf ab (HTTP 401).',
        }),
      ).toBe('an, aber nicht nutzbar');
      // Justiz-Auktion is the permanent, by-design member of the same state:
      // reachable, needs no credentials, and cannot be searched at all.
      expect(
        providerState({ enabled: true, configured: true, problem: 'Suche nur als POST mit Sitzung.' }),
      ).toBe('an, aber nicht nutzbar');
    });

    await it('unterscheidet „niemand hat geantwortet" von „nichts gefunden"', async () => {
      expect(emptinessNotice(true, 0)?.includes('NICHT dasselbe')).toBe(true);
      expect(emptinessNotice(false, 0)).toBe('Keine Treffer.');
      // Nothing to say when there are rows — a surface must not be handed a
      // reassurance it did not earn.
      expect(emptinessNotice(false, 5)).toBe(null);
    });

    await it('verschweigt keine Zeile, die die Lizenz aus der Mischliste hält', async () => {
      expect(mergeExcludedNotice([])).toBe(null);
      const notice = mergeExcludedNotice(['ebay']);
      expect(notice?.startsWith('eBay steht NICHT')).toBe(true);
    });

    await it('nennt die Identität einer Gruppe nur, wenn sie etwas verbunden hat', async () => {
      expect(groupIdentityLabel('gtin:0190295272432', 3)).toBe('GTIN 0190295272432');
      expect(groupIdentityLabel('title:x|price:y', 2)).toBe('gleicher Titel, gleicher Preis');
      // A group of one joined nothing, so there is nothing to name.
      expect(groupIdentityLabel('gtin:0190295272432', 1)).toBe(null);
      expect(groupIdentityLabel(null, 3)).toBe(null);
    });

    await it('setzt Ort und Geld genau einmal zusammen', async () => {
      const where = { country: 'DE', distanceKm: null };
      expect(fmtLocation({ postalCode: '30966', city: 'Hemmingen', ...where })).toBe('30966 Hemmingen');
      expect(fmtLocation({ postalCode: null, city: 'Hemmingen', ...where })).toBe('Hemmingen');
      expect(plain(fmtMinor(1999, 'EUR'))).toBe('19,99 €');
      // The store writes `currency` nullable; six call sites spelled the
      // fallback out themselves.
      expect(plain(fmtMinor(1999, null))).toBe('19,99 €');
      expect(fmtMinor(null, 'EUR')).toBe('—');
      expect(providerLabel('markt-de')).toBe('markt.de');
      expect(providerLabel('gibtesnicht')).toBe('gibtesnicht');
    });
  });
};
