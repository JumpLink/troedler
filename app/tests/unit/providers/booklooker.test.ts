import { describe, expect, it } from '@gjsify/unit';

import { ProviderError, type SearchQuery } from '@troedler/core';
import {
  BooklookerSession,
  buildSearchParams,
  createBooklookerProvider,
  parseApiPrice,
  parseSearchResponse,
  toGtin13,
  type BooklookerConfig,
  type BooklookerHttp,
} from '@troedler/booklooker';

/**
 * Booklooker's REST API v2.0.
 *
 * Every fixture here is written by hand. Two of them reproduce behaviour
 * measured against `api.booklooker.de` on 2026-08-21 and they are the reason
 * this suite exists at all:
 *
 *   - **Everything is HTTP 200.** A missing key, an unknown token and an
 *     exhausted quota all arrive as `200 OK` with `{"status":"NOK", …}`, so
 *     the transport layer cannot tell success from failure for this source.
 *   - **`200 OK` with an empty body is a real answer here.** The legacy
 *     interface returns exactly that when the `pid` is missing — zero bytes,
 *     status 200. That is "green and empty" in its purest form, and the whole
 *     point of the first two tests below is that the adapter cannot report it
 *     as "keine Treffer".
 *
 * Each block carries its discriminator: for every "this must fail loudly"
 * there is a neighbouring case that must still succeed, so a parser that
 * simply threw at everything would not pass either.
 */

const NOW = new Date('2026-08-21T12:00:00.000Z');
const CTX = { now: NOW, currency: 'EUR' } as const;

/** One synthetic offer, in the element notation the `extraFields` table uses. */
const XML_ONE_OFFER = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<ArticleList>',
  '  <Article>',
  '    <Title>Die Elementarteilchen</Title>',
  '    <Author>Michel Houellebecq</Author>',
  '    <Publisher>DuMont</Publisher>',
  '    <Year>1999</Year>',
  '    <ISBN>3-7701-4831-2</ISBN>',
  '    <Price>4,50</Price>',
  '    <ShippingPrice>2,25</ShippingPrice>',
  '    <Condition>gebraucht, gut</Condition>',
  '    <SellerType>1</SellerType>',
  '    <SellerCountry>de</SellerCountry>',
  '    <DateOfEntry>2026-07-14</DateOfEntry>',
  '    <DetailLinkUrl>https://www.booklooker.de/angebot?id=A02HuK3Z01ZZc</DetailLinkUrl>',
  '  </Article>',
  '</ArticleList>',
].join('\n');

/**
 * What `/search` ACTUALLY answers — measured against the live API on 2026-08-22
 * with a real key, which is the first time anyone could.
 *
 * Two encodings, not one: the envelope's `returnValue` is a STRING holding
 * JSON. The adapter's first real answer was `parse-failed` because it assumed a
 * string had to be markup — correctly reported, which is the only reason the
 * gap cost minutes instead of producing plausible nonsense.
 *
 * The field names are transcribed, not invented: `Author`, `Title`, `Price`,
 * `ShippingPrice`, `ISBN`, `New`, `Publisher`, `Edition`, `PicURL`, `Country`,
 * `Year`, `DetailLinkUrl`, `Offerer`, `ArticleId`, `OffererId`, `RatePositive`,
 * `Infotext`. Occurrence over 149 rows: `ArticleId` 143, `ISBN` 88, `Year` 125 —
 * so the absent ones are the normal case, not an edge.
 */
const REAL_BOOK = {
  Author: 'Hesse, Hermann',
  Title: 'Der Steppenwolf',
  Price: '17.50',
  ShippingPrice: '2.90',
  ISBN: '9783518411049',
  New: '0',
  Publisher: 'Suhrkamp',
  Edition: 'Taschenbuch',
  PicURL: 'http://images.booklooker.de/cover/isbn/standard/97835/18/41/1049.jpg',
  Country: 'DE',
  Year: '2001',
  DetailLinkUrl: 'https://www.booklooker.de/app/detail.php?id=A02SIk5a01ZZs',
  Offerer: 'Ein Antiquariat',
  ArticleId: 'A02SIk5a01ZZs',
  OffererId: '12345',
  RatePositive: '99',
  Infotext: 'Guter Zustand, Rufnummer 0176 1234567 im Text.',
};

/** An aggregate row: no ArticleId, a `resultnew.php` link, many sellers behind one price. */
const AGGREGATE_BOOK = {
  Author: 'Hesse, Hermann',
  Title: 'Der Steppenwolf (Sammelangebot)',
  Price: '10.30',
  ShippingPrice: '0.00',
  New: '1',
  Country: 'DE',
  DetailLinkUrl: 'https://www.booklooker.de/app/resultnew.php?id=2361811528',
  Offerer: 'verschiedene Anbieter',
};

/** The real envelope: JSON inside a JSON string. */
const REAL_ENVELOPE = (books: readonly unknown[]) => ({
  status: 'OK',
  returnValue: JSON.stringify({ Book: books }),
});

const OK = (returnValue: unknown) => ({ status: 'OK', returnValue });
const NOK = (returnValue: string) => ({ status: 'NOK', returnValue });

/** The error, not just the fact that there was one — `kind` is what callers branch on. */
function thrown(run: () => unknown): ProviderError {
  try {
    run();
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error('Erwartet wurde ein ProviderError, es kam ein Ergebnis zurück.');
}

async function rejected(run: () => Promise<unknown>): Promise<ProviderError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error('Erwartet wurde ein ProviderError, es kam ein Ergebnis zurück.');
}

interface Script {
  readonly post?: unknown[];
  readonly get?: unknown[];
}

/**
 * A scripted stand-in for the shared HTTP client.
 *
 * Possible only because the adapter depends on the narrow `BooklookerHttp`
 * port: `HttpClient` itself carries `#private` fields and is therefore
 * nominally typed, so nothing could ever stand in for it.
 */
function fakeHttp(script: Script): { http: BooklookerHttp; calls: string[] } {
  const post = [...(script.post ?? [])];
  const get = [...(script.get ?? [])];
  const calls: string[] = [];

  const next = (queue: unknown[], verb: string, url: string): unknown => {
    calls.push(`${verb} ${url}`);
    if (queue.length === 0) throw new Error(`Unerwarteter ${verb} auf ${url}`);
    const value = queue.shift();
    if (value instanceof Error) throw value;
    return value;
  };

  const http: BooklookerHttp = {
    async getJson<T>(url: string): Promise<T> {
      return next(get, 'GET', url) as T;
    },
    async postJson<T>(url: string): Promise<T> {
      return next(post, 'POST', url) as T;
    },
  };
  return { http, calls };
}

const CONFIG: BooklookerConfig = { apiKey: 'k', medium: 'book', shippingCountry: 'de', enabled: true };
const q = (extra: Partial<SearchQuery> = {}): SearchQuery => ({ text: 'Elementarteilchen', ...extra });

export default async () => {
  await describe('Booklooker: der Umschlag ist die einzige Wahrheit', async () => {
    await it('meldet OK mit leerem Rumpf als parse-failed, nicht als null Treffer', async () => {
      const err = thrown(() => parseSearchResponse(OK(''), CTX));
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/leeren Rumpf/);
    });

    await it('liefert für eine echte leere Liste null Treffer', async () => {
      // Der Diskriminator zum Test darüber: ohne ihn würde ein Parser, der
      // grundsätzlich wirft, genauso „bestehen".
      const result = parseSearchResponse(OK([]), CTX);
      expect(result.listings).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    await it('bildet jeden NOK-Code auf seine Fehlerklasse ab', async () => {
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['TOKEN_EXPIRED', 'refused'],
        ['TOKEN_MISSING', 'refused'],
        ['AUTHENTICATION_FAILED', 'refused'],
        ['TEMPORARILY_BLOCKED', 'refused'],
        ['QUOTA_EXCEEDED', 'rate-limited'],
        ['SERVER_DOWN', 'unreachable'],
        ['API_KEY_MISSING', 'not-configured'],
        ['ENCODING_ERROR', 'remote-error'],
      ];
      for (const [code, kind] of cases) {
        const err = thrown(() => parseSearchResponse(NOK(code), CTX));
        expect(`${code}=${err.kind}`).toBe(`${code}=${kind}`);
      }
    });

    await it('erkennt einen Umschlag ohne status als Formatwechsel', async () => {
      const err = thrown(() => parseSearchResponse({ items: [] }, CTX));
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/status/);
    });
  });

  await describe('Booklooker: XML-Zweig', async () => {
    await it('bildet ein Angebot Feld für Feld ab', async () => {
      const { listings } = parseSearchResponse(OK(XML_ONE_OFFER), CTX);
      expect(listings).toHaveLength(1);
      const l = listings[0];
      expect(l.key).toBe('booklooker:A02HuK3Z01ZZc');
      expect(l.title).toBe('Die Elementarteilchen');
      expect(l.price).toStrictEqual({ minor: 450, currency: 'EUR' });
      expect(l.shippingCost).toStrictEqual({ minor: 225, currency: 'EUR' });
      // Vorberechnet, weil billig plus teures Porto nicht billig ist.
      expect(l.totalPrice).toStrictEqual({ minor: 675, currency: 'EUR' });
      expect(l.condition).toBe('used-good');
      expect(l.conditionRaw).toBe('gebraucht, gut');
      expect(l.sellerType).toBe('commercial');
      expect(l.delivery).toBe('shipping');
      expect(l.location.country).toBe('DE');
      expect(l.listedAt).toBe('2026-07-14T00:00:00.000Z');
      expect(l.fetchedAt).toBe('2026-08-21T12:00:00.000Z');
      // Die ISBN-10 der Quelle, auf 13 geweitet: nur so trifft sie die EAN von eBay.
      expect(l.gtin).toBe('9783770148318');
    });

    await it('hält nichts über den Verkäufer fest', async () => {
      const xml = XML_ONE_OFFER.replace(
        '<Title>',
        '<uID>4711</uID><SellerName>Antiquariat Beispiel</SellerName><Title>',
      );
      const { listings } = parseSearchResponse(OK(xml), CTX);
      const dump = JSON.stringify(listings[0]);
      expect(dump).not.toContain('4711');
      expect(dump).not.toContain('Antiquariat Beispiel');
    });

    await it('meldet eine Antwort ohne <DetailLinkUrl> als Formatwechsel', async () => {
      const err = thrown(() =>
        parseSearchResponse(OK('<ArticleList><Article><Title>X</Title></Article></ArticleList>'), CTX),
      );
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/DetailLinkUrl/);
      // Die Elementzahl gehört in die Meldung: sie unterscheidet „nichts
      // empfangen" von „empfangen, aber anders gebaut".
      expect(err.message).toMatch(/3 Elemente/);
    });

    await it('nennt es beim Namen, wenn der Deep-Link zum Attribut wird', async () => {
      const err = thrown(() =>
        parseSearchResponse(OK('<List><Article detailLinkUrl="https://x/y">A</Article></List>'), CTX),
      );
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/Attribut/);
    });

    await it('wirft, wenn Datensätze da sind, aber keiner ein Angebot ergibt', async () => {
      const xml =
        '<List><Article><DetailLinkUrl>https://www.booklooker.de/a?id=A0</DetailLinkUrl></Article></List>';
      const err = thrown(() => parseSearchResponse(OK(xml), CTX));
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/1 Datensatz/);
    });

    await it('verschmelzt flach nebeneinander liegende Angebote nicht zu einem', async () => {
      // Ohne diese Schranke würden zwei Angebote zu einem Treffer, dessen
      // Felder alle Arrays sind — 150 Bücher als ein Buch, ohne Fehler.
      const flat =
        '<List><Title>A</Title><DetailLinkUrl>https://www.booklooker.de/a?id=A1111111111</DetailLinkUrl>' +
        '<Title>B</Title><DetailLinkUrl>https://www.booklooker.de/b?id=B2222222222</DetailLinkUrl></List>';
      const err = thrown(() => parseSearchResponse(OK(flat), CTX));
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/2 Deep-Links/);
    });

    await it('kommt mit mehreren, je umschlossenen Angeboten zurecht', async () => {
      // Diskriminator zum Test darüber: richtig geschachtelt muss es gehen.
      const two = XML_ONE_OFFER.replace(
        '</ArticleList>',
        '<Article><Title>Plattform</Title>' +
          '<DetailLinkUrl>https://www.booklooker.de/b?id=A02ItXa601ZZx</DetailLinkUrl></Article></ArticleList>',
      );
      expect(parseSearchResponse(OK(two), CTX).listings).toHaveLength(2);
    });

    await it('wirft bei Text, der gar keine Liste ist', async () => {
      const err = thrown(() => parseSearchResponse(OK('Wartungsarbeiten'), CTX));
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toMatch(/Wartungsarbeiten/);
    });
  });

  await describe('Booklooker: JSON-Zweig', async () => {
    const record = {
      title: 'Der Zauberberg',
      author: 'Thomas Mann',
      isbn: '9783596294336',
      price: 3.9,
      shippingPrice: 2.2,
      condition: 'sehr gut',
      sellerType: 0,
      sellerCountry: 'at',
      imageUrl: '//img.booklooker.de/x.jpg',
      detailLinkUrl: 'https://www.booklooker.de/angebot?id=A02ItXa601ZZx',
      comment: 'Kleine Gebrauchsspuren. Rueckfragen an foo@example.org oder 0176 1234567.',
    };

    await it('liest dieselben Felder aus Objekten', async () => {
      const { listings } = parseSearchResponse(OK([record]), CTX);
      expect(listings).toHaveLength(1);
      expect(listings[0].id).toBe('A02ItXa601ZZx');
      expect(listings[0].price).toStrictEqual({ minor: 390, currency: 'EUR' });
      expect(listings[0].totalPrice).toStrictEqual({ minor: 610, currency: 'EUR' });
      expect(listings[0].condition).toBe('used-excellent');
      expect(listings[0].sellerType).toBe('private');
      expect(listings[0].images).toStrictEqual(['https://img.booklooker.de/x.jpg']);
    });

    await it('entfernt Telefonnummer und E-Mail beim Parsen, nicht hinterher', async () => {
      const { listings } = parseSearchResponse(OK([record]), CTX);
      expect(listings[0].description).not.toContain('foo@example.org');
      expect(listings[0].description).not.toContain('0176');
      // Diskriminator: der Rest des Textes muss stehen bleiben.
      expect(listings[0].description).toMatch(/Gebrauchsspuren/);
    });

    await it('nimmt auch die Liste in einem Umschlagobjekt an', async () => {
      const { listings } = parseSearchResponse(OK({ articles: [record] }), CTX);
      expect(listings).toHaveLength(1);
    });
  });

  await describe('Booklooker: die gemessene Antwort', async () => {
    await it('parst den doppelt kodierten Umschlag', async () => {
      // The bug this pins: `returnValue` is a STRING containing JSON, and the
      // parser assumed a string had to be markup. Every field below travels
      // through both decodings, so a regression here cannot be silent.
      const { listings } = parseSearchResponse(REAL_ENVELOPE([REAL_BOOK]), CTX);
      expect(listings.length).toBe(1);
      expect(listings[0].title).toBe('Der Steppenwolf');
      expect(listings[0].price?.minor).toBe(1750);
      expect(listings[0].shippingCost?.minor).toBe(290);
      expect(listings[0].totalPrice?.minor).toBe(2040);
      expect(listings[0].gtin).toBe('9783518411049');
      expect(listings[0].images.length).toBe(1);
      expect(listings[0].location.country).toBe('DE');
    });

    await it('liest den Zustand aus New, ohne eine Note zu erfinden', async () => {
      // `New: 1` is a statement. `New: 0` says only "not new" — inventing
      // `used-good` from it would be a grade nobody wrote, and the ranking
      // would act on it. The fact travels in conditionRaw instead.
      const used = parseSearchResponse(REAL_ENVELOPE([REAL_BOOK]), CTX).listings[0];
      expect(used.condition).toBe('unknown');
      expect(used.conditionRaw).toBe('gebraucht');

      const fresh = parseSearchResponse(REAL_ENVELOPE([{ ...REAL_BOOK, New: '1' }]), CTX).listings[0];
      expect(fresh.condition).toBe('new');
      expect(fresh.conditionRaw).toBe('neu');
    });

    await it('nennt eine Sammelzeile einen Ab-Preis', async () => {
      // No ArticleId and a `resultnew.php` link: that row is a GROUP of offers,
      // and its price is the cheapest of them. Calling it a fixed price would
      // promise something no single seller offers.
      const [aggregate] = parseSearchResponse(REAL_ENVELOPE([AGGREGATE_BOOK]), CTX).listings;
      expect(aggregate.priceKind).toBe('from');
      const [single] = parseSearchResponse(REAL_ENVELOPE([REAL_BOOK]), CTX).listings;
      expect(single.priceKind).toBe('fixed');
    });

    await it('wirft die Rufnummer aus dem Infotext', async () => {
      const [listing] = parseSearchResponse(REAL_ENVELOPE([REAL_BOOK]), CTX).listings;
      expect(listing.description?.includes('1234567')).toBe(false);
      expect(listing.description?.includes('Guter Zustand')).toBe(true);
    });

    await it('speichert nichts über den Anbieter', async () => {
      // Offerer, OffererId and RatePositive are in every real row. None of them
      // may reach a Listing — asserted over the whole serialised object, so a
      // new field cannot smuggle one in.
      const [listing] = parseSearchResponse(REAL_ENVELOPE([REAL_BOOK]), CTX).listings;
      const serialised = JSON.stringify(listing);
      expect(serialised.includes('Ein Antiquariat')).toBe(false);
      expect(serialised.includes('12345')).toBe(false);
      expect(serialised.includes('RatePositive')).toBe(false);
    });

    await it('bleibt bei fehlender ISBN und fehlendem Jahr verwertbar', async () => {
      // Measured: ISBN on 88 of 149 rows, Year on 125. The absent ones are the
      // normal case, so a row without them must still be a listing.
      const sparse = { ...REAL_BOOK };
      delete (sparse as Record<string, unknown>).ISBN;
      delete (sparse as Record<string, unknown>).Year;
      const [listing] = parseSearchResponse(REAL_ENVELOPE([sparse]), CTX).listings;
      expect(listing.gtin).toBe(null);
      expect(listing.title).toBe('Der Steppenwolf');
    });

    await it('meldet einen returnValue, der wie JSON beginnt und keines ist', async () => {
      const err = thrown(() => parseSearchResponse({ status: 'OK', returnValue: '{kaputt' }, CTX));
      expect(err.kind).toBe('parse-failed');
    });
  });

  await describe('Booklooker: ISBN wird zur GTIN-13', async () => {
    await it('weitet eine ISBN-10 auf 13', async () => {
      expect(toGtin13('3-7701-4831-2')).toBe('9783770148318');
      expect(toGtin13('9783770148318')).toBe('9783770148318');
    });

    await it('verwirft eine ISBN mit falscher Prüfziffer', async () => {
      // Der teuerste Fehler wäre eine falsche Identität: sie würde zwei
      // verschiedene Bücher zu einem Angebot verschmelzen.
      expect(toGtin13('9783770148319')).toBeNull();
      expect(toGtin13('3-7701-4831-9')).toBeNull();
      expect(toGtin13('keine-isbn')).toBeNull();
    });
  });

  await describe('Booklooker: Preise in beiden Schreibweisen', async () => {
    await it('liest die deutsche und die dezimale Notation je richtig', async () => {
      expect(parseApiPrice('12.50', 'EUR').price).toStrictEqual({ minor: 1250, currency: 'EUR' });
      expect(parseApiPrice('1.234,56', 'EUR').price).toStrictEqual({ minor: 123456, currency: 'EUR' });
      expect(parseApiPrice('4,50', 'EUR').price).toStrictEqual({ minor: 450, currency: 'EUR' });
      expect(parseApiPrice(null, 'EUR').price).toBeNull();
    });

    await it('erkennt VB als Verhandlungsbasis', async () => {
      expect(parseApiPrice('4,50 € VB', 'EUR').kind).toBe('negotiable');
    });
  });

  await describe('Booklooker: der Suchplan', async () => {
    await it('schickt Titel, Verkäufertyp und Sortierung', async () => {
      const plan = buildSearchParams(q({ sellerType: 'private', sort: 'price-asc' }), CONFIG);
      expect(plan.params.get('title')).toBe('Elementarteilchen');
      expect(plan.params.get('privOnly')).toBe('1');
      // pricePlusShipping, weil der Kern nach totalPrice ordnet.
      expect(plan.params.get('sortOrder')).toBe('pricePlusShipping');
      expect(plan.applied).toStrictEqual(['sellerType', 'sort']);
    });

    await it('meldet gröber gepushte Filter NICHT als angewandt', async () => {
      const plan = buildSearchParams(q({ condition: ['used-good'], since: '2026-08-01T10:00:00Z' }), CONFIG);
      // Beides geht raus, um die 150 Zeilen besser zu nutzen …
      expect(plan.params.get('usedOnly')).toBe('1');
      expect(plan.params.get('dateFrom')).toBe('2026-08-01');
      // … aber booklooker kennt nur neu/gebraucht und ganze Tage, also muss der
      // Kern nachfiltern. Ein „applied" hier wäre ein stiller Genauigkeitsverlust.
      expect(plan.applied).toStrictEqual([]);
    });

    await it('lässt eine ISBN alle anderen Kriterien verdrängen', async () => {
      const plan = buildSearchParams(q({ gtin: '3-7701-4831-2', sellerType: 'private' }), CONFIG);
      expect(plan.params.get('isbn')).toBe('3770148312');
      expect(plan.params.get('title')).toBeNull();
      expect(plan.params.get('privOnly')).toBeNull();
      expect(plan.applied).toStrictEqual(['gtin']);
      expect(plan.warnings.join(' ')).toMatch(/ISBN-Suche/);
    });

    await it('erklärt eine unbeantwortbare Anfrage, statt sie zu stellen', async () => {
      const plan = buildSearchParams({ text: '', gtin: '0885909950805' }, CONFIG);
      expect(plan.answerable).toBe(false);
      expect(plan.warnings.join(' ')).toMatch(/ISBN/);
    });

    await it('begrenzt limit auf die 150 der Schnittstelle', async () => {
      expect(buildSearchParams(q({ limit: 500 }), CONFIG).params.get('limit')).toBe('150');
      expect(buildSearchParams(q({ limit: 5 }), CONFIG).params.get('limit')).toBe('5');
    });
  });

  await describe('Booklooker: Token-Lebenszyklus', async () => {
    const params = new URLSearchParams({ medium: 'book' });

    await it('authentifiziert einmal und behält den Token', async () => {
      const { http, calls } = fakeHttp({ post: [OK('T1')], get: [OK([]), OK([])] });
      const session = new BooklookerSession(http, CONFIG, () => 0);
      await session.search(params);
      const second = await session.search(params);
      expect(second.requests).toBe(1);
      expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
    });

    await it('authentifiziert nach zehn Minuten Stille neu', async () => {
      let clock = 0;
      const { http, calls } = fakeHttp({ post: [OK('T1'), OK('T2')], get: [OK([]), OK([])] });
      const session = new BooklookerSession(http, CONFIG, () => clock);
      await session.search(params);
      clock = 10 * 60 * 1000;
      expect(session.hasFreshToken()).toBe(false);
      await session.search(params);
      expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(2);
      expect(calls.at(-1)).toMatch(/token=T2/);
    });

    await it('erneuert den Token bei TOKEN_EXPIRED genau einmal', async () => {
      const { http, calls } = fakeHttp({
        post: [OK('T1'), OK('T2')],
        get: [NOK('TOKEN_EXPIRED'), OK(XML_ONE_OFFER)],
      });
      const session = new BooklookerSession(http, CONFIG, () => 0);
      const call = await session.search(params);
      // Zwei Authentifizierungen, zwei Suchen — und keine dritte Runde.
      expect(call.requests).toBe(4);
      expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(2);
      expect(parseSearchResponse(call.envelope, CTX).listings).toHaveLength(1);
    });

    await it('dreht sich nicht im Kreis, wenn auch der frische Token abgelehnt wird', async () => {
      const { http, calls } = fakeHttp({
        post: [OK('T1'), OK('T2')],
        get: [NOK('TOKEN_EXPIRED'), NOK('TOKEN_EXPIRED')],
      });
      const session = new BooklookerSession(http, CONFIG, () => 0);
      const call = await session.search(params);
      expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(2);
      expect(thrown(() => parseSearchResponse(call.envelope, CTX)).kind).toBe('refused');
    });

    await it('gibt bei einem abgelehnten Schlüssel sofort auf', async () => {
      const { http, calls } = fakeHttp({ post: [NOK('AUTHENTICATION_FAILED')] });
      const session = new BooklookerSession(http, CONFIG, () => 0);
      const err = await rejected(() => session.search(params));
      expect(err.kind).toBe('refused');
      // Eine Ablehnung ist eine Entscheidung: genau ein Versuch, keine Suche.
      expect(calls).toHaveLength(1);
    });

    await it('lässt den API-Key nicht in eine Fehlermeldung durchsickern', async () => {
      const secret = 'geheimer-api-key-4711';
      const { http } = fakeHttp({
        post: [new ProviderError('booklooker', 'unreachable', `connect ECONNREFUSED …apiKey=${secret}`)],
      });
      const session = new BooklookerSession(http, { ...CONFIG, apiKey: secret }, () => 0);
      const err = await rejected(() => session.search(params));
      expect(err.message).not.toContain(secret);
      expect(err.message).toMatch(/geheim/);
    });
  });

  await describe('Booklooker: der Provider', async () => {
    const provider = (env: Record<string, string | undefined>, script: Script = {}, enabled = true) => {
      const { http, calls } = fakeHttp(script);
      return { p: createBooklookerProvider({ http, env, enabled, now: () => NOW.getTime() }), calls };
    };

    await it('ist ohne Schlüssel nicht konfiguriert und fragt nichts', async () => {
      const { p, calls } = provider({});
      const state = await p.status();
      expect(state.configured).toBe(false);
      expect(state.problem?.kind).toBe('not-configured');
      expect((await rejected(() => p.search(q()))).kind).toBe('not-configured');
      expect(calls).toHaveLength(0);
    });

    await it('meldet eine abgeschaltete Quelle als Richtlinienentscheidung', async () => {
      const { p } = provider({ BOOKLOOKER_API_KEY: 'k' }, {}, false);
      expect((await p.status()).problem?.kind).toBe('blocked-by-policy');
    });

    await it('bricht bei unbekanntem Medientyp ab, statt still Bücher zu suchen', async () => {
      const { p, calls } = provider({ BOOKLOOKER_API_KEY: 'k', BOOKLOOKER_MEDIUM: 'vinyl' });
      const err = await rejected(() => p.search(q()));
      expect(err.kind).toBe('not-configured');
      expect(err.message).toMatch(/vinyl/);
      expect(calls).toHaveLength(0);
    });

    await it('gibt Treffer mit angewandten Filtern und Anfragezahl zurück', async () => {
      const { p } = provider({ BOOKLOOKER_API_KEY: 'k' }, { post: [OK('T1')], get: [OK(XML_ONE_OFFER)] });
      const result = await p.search(q({ sort: 'price-asc', limit: 5 }));
      expect(result.listings).toHaveLength(1);
      expect(result.applied).toStrictEqual(['sort']);
      expect(result.requests).toBe(2);
      expect(result.totalEstimate).toBeNull();
      expect(result.truncated).toBe(false);
    });

    await it('kostet keine Anfrage, wenn booklooker die Frage nicht beantworten kann', async () => {
      const { p, calls } = provider({ BOOKLOOKER_API_KEY: 'k' });
      const result = await p.search({ text: '', gtin: '0885909950805' });
      expect(result.listings).toHaveLength(0);
      // Sichtbar folgenlos statt still leer: `requests: 0` sagt in --explain,
      // dass hier nichts gesucht wurde.
      expect(result.requests).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(calls).toHaveLength(0);
    });

    await it('stellt keine Fähigkeit in Aussicht, die die Quelle nicht hat', async () => {
      const { p } = provider({ BOOKLOOKER_API_KEY: 'k' });
      const caps = p.capabilities;
      expect(caps.access).toBe('official-api');
      expect(caps.enabledByDefault).toBe(true);
      expect(caps.maxResults).toBe(150);
      expect(caps.serverFilters).toStrictEqual(['sellerType', 'gtin', 'sort']);
      expect(caps.serverSorts).toStrictEqual(['price-asc', 'price-desc']);
      expect(caps.termsDoc).toBe('docs/quellen/booklooker.de.md');
    });
  });
};
