/**
 * Discogs adapter — unit tests, no network.
 *
 * Every case here has a discriminator: something that would still be green if
 * the check were removed is not a test, it is decoration. The ones that matter
 * most are the three that guard measured traps —
 *
 *   - a matrix inscription that reduces to thirteen digits and would pass any
 *     length-only GTIN check,
 *   - `country`, which is the pressing plant and not the seller,
 *   - a Universal catalogue number, which the shared phone-number filter eats
 *     if it is routed through it,
 *
 * — because each one produces a plausible, wrong answer rather than a failure.
 *
 * The fixtures are written by hand. They carry the STRUCTURE measured against
 * `api.discogs.com` on 2026-08-21 (field names, the mixed `barcode[]` array,
 * the empty `thumb` of an unauthenticated search, the `{value, currency}` shape
 * of `marketplace/stats`) with invented content — no foreign listing data is
 * copied into this repository.
 */

import { describe, expect, it } from '@gjsify/unit';
import { ProviderError } from '@troedler/core';
import { HttpClient } from '@troedler/http';
import {
  buildReleaseUrl,
  buildSearchUrl,
  buildStatsUrl,
  createDiscogsProvider,
  extractGtin,
  isValidGtin,
  mapReleases,
  normalizeCurrency,
  parseSearchResponse,
  plainNotes,
  readRateLimit,
  releaseToRow,
  type DiscogsMarketplaceStats,
  type DiscogsSearchResponse,
  type DiscogsSearchRow,
} from '@troedler/discogs';

const FETCHED_AT = '2026-08-21T12:00:00.000Z';

/** Structure as measured; every value invented. */
function row(over: Partial<DiscogsSearchRow> = {}): DiscogsSearchRow {
  return {
    id: 4242,
    title: 'Beispielband - Beispielplatte',
    uri: '/release/4242-Beispielband-Beispielplatte',
    year: '1979',
    country: 'Germany',
    format: ['Vinyl', 'LP', 'Album'],
    label: ['Beispiellabel'],
    genre: ['Electronic'],
    style: ['Krautrock'],
    catno: 'BSP 001',
    barcode: [],
    // Measured: an unauthenticated search returns empty strings here.
    cover_image: '',
    thumb: '',
    ...over,
  };
}

function stats(over: Partial<DiscogsMarketplaceStats> = {}): DiscogsMarketplaceStats {
  return {
    num_for_sale: 7,
    lowest_price: { value: 12.5, currency: 'EUR' },
    blocked_from_sale: false,
    ...over,
  };
}

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
}

interface Reply {
  readonly status?: number;
  readonly body?: unknown;
  /** `x-discogs-ratelimit-remaining` for this reply. */
  readonly remaining?: number;
  readonly limit?: number;
}

/**
 * A fetch that answers from a routing table — and the client under test is the
 * REAL `HttpClient`, so these cases run through the compliance gate, the
 * per-host limiter and the 401/403/429 rules rather than around them.
 */
function rig(
  route: (url: string, n: number) => Reply,
  maxRequestsPerHost = 200,
): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({ url, headers });
    const reply = route(url, calls.length);
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: {
        'content-type': 'application/json',
        'x-discogs-ratelimit': String(reply.limit ?? 25),
        'x-discogs-ratelimit-remaining': String(reply.remaining ?? 25),
        'x-discogs-ratelimit-used': String((reply.limit ?? 25) - (reply.remaining ?? 25)),
      },
    });
  }) as typeof fetch;
  return { http: new HttpClient({ version: '9.9.9', fetchImpl, maxRequestsPerHost }), calls };
}

function searchBody(rows: readonly DiscogsSearchRow[], items = rows.length): DiscogsSearchResponse {
  return { pagination: { page: 1, pages: 1, per_page: rows.length, items }, results: rows };
}

async function caught(fn: () => Promise<unknown>): Promise<ProviderError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw new Error(`Erwartet wurde ein ProviderError, geworfen wurde: ${String(err)}`);
  }
  throw new Error('Es wurde nichts geworfen.');
}

export default async () => {
  await describe('Discogs · URL-Grammatik', async () => {
    await it('sucht nur nach Releases und klemmt per_page auf Discogs’ Maximum', async () => {
      const url = new URL(buildSearchUrl({ text: 'kraftwerk', perPage: 250 }));
      expect(url.host).toBe('api.discogs.com');
      expect(url.pathname).toBe('/database/search');
      expect(url.searchParams.get('type')).toBe('release');
      // Gemessen: Discogs kappt 250 still auf 100. Wer sich darauf verlässt,
      // bekommt eine andere Seitengröße als er glaubt.
      expect(url.searchParams.get('per_page')).toBe('100');
      expect(url.searchParams.get('q')).toBe('kraftwerk');
    });

    await it('schiebt einen GTIN als barcode-Parameter serverseitig durch', async () => {
      const url = new URL(buildSearchUrl({ text: '', gtin: '888837168618', perPage: 10 }));
      expect(url.searchParams.get('barcode')).toBe('888837168618');
      // Ohne Text darf kein leeres q mitfahren — Discogs würde es als Suche nach "" lesen.
      expect(url.searchParams.has('q')).toBe(false);
    });

    await it('setzt curr_abbr auf die Preis-URL und ausdrücklich nicht auf die Release-URL', async () => {
      expect(buildStatsUrl(125204, 'EUR')).toContain('curr_abbr=EUR');
      // Gemessen: /releases/{id} ignoriert curr_abbr und antwortet in USD. Ein
      // curr_abbr dort wäre ein Versprechen, das der Endpunkt nicht hält.
      expect(buildReleaseUrl(125204)).toBe('https://api.discogs.com/releases/125204');
      expect(buildReleaseUrl(125204)).not.toContain('curr_abbr');
    });

    await it('fällt auf EUR zurück, wenn Discogs die Währung nicht kennt', async () => {
      expect(normalizeCurrency('gbp')).toStrictEqual({ currency: 'GBP', fallback: false });
      expect(normalizeCurrency(undefined)).toStrictEqual({ currency: 'EUR', fallback: false });
      expect(normalizeCurrency('BTC')).toStrictEqual({ currency: 'EUR', fallback: true });
    });
  });

  await describe('Discogs · GTIN aus dem barcode-Sammelsurium', async () => {
    await it('findet den echten Barcode zwischen Labelcode, Rechteverwerter und Matrix', async () => {
      expect(
        extractGtin([
          '8 88837 16861 8',
          '888837168618',
          'LC00162',
          'BIEM/GEMA',
          'AL88883716861-2 BD11929-01 A2',
        ]),
      ).toBe('888837168618');
    });

    await it('weist eine Matrixnummer zurück, die nur zufällig 13 Ziffern hat', async () => {
      // Der Diskriminator dieses Tests: eine reine Längenprüfung gäbe hier
      // '1063050581320' zurück — eine erfundene Identität, auf die merge.ts
      // dann zwei verschiedene Platten zusammenzieht.
      expect(extractGtin(['10 6305058 1 320'])).toBeNull();
    });

    await it('weist alles zurück, was Buchstaben enthält', async () => {
      expect(extractGtin(['LC00162', 'BIEM/GEMA', 'GEMA', 'D'])).toBeNull();
    });

    await it('prüft die GS1-Prüfziffer über alle vier gültigen Längen', async () => {
      expect(isValidGtin('888837168618')).toBe(true); // UPC-A
      expect(isValidGtin('5099969959929')).toBe(true); // EAN-13
      expect(isValidGtin('888837168617')).toBe(false); // Prüfziffer verdreht
      expect(isValidGtin('88883716861')).toBe(false); // 11 Stellen: keine GTIN-Länge
      expect(isValidGtin('')).toBe(false);
    });

    await it('meldet die GTIN, nach der gesucht wurde, wenn die Zeile sie trägt', async () => {
      // Measured on `--gtin 5099996601419`: two of five rows came back naming
      // `0190295272432` — a different, equally real barcode on the same release
      // — because the rule was "longest wins" and the padded UPC-A is longer.
      // The row the user searched for then looked like it did not carry the
      // code it had matched on, and `identityKey` grouped it with nothing.
      const both = ['0190295272432', '5099996601419'];
      expect(extractGtin(both, '5099996601419')).toBe('5099996601419');
      // Padded and bare are ONE barcode, so either spelling of the wish finds it.
      expect(extractGtin(both, '190295272432')).toBe('0190295272432');
    });

    await it('nimmt sonst die Reihenfolge der Quelle, statt die Polsterung zu bevorzugen', async () => {
      // Without a wish there is no non-arbitrary choice — the DTO has one slot
      // and the release genuinely carries several. Source order at least is the
      // source's own priority; "longest" was a guess about specificity that
      // selected the zero-padding instead.
      expect(extractGtin(['888837168618', '5099969959929'])).toBe('888837168618');
      // A wish that this row does not carry changes nothing.
      expect(extractGtin(['888837168618'], '5099969959929')).toBe('888837168618');
      // And an invalid check digit is still no identity at all.
      expect(extractGtin(['10 6305058 1 320'])).toBe(null);
    });
  });

  await describe('Discogs · Mapping', async () => {
    await it('glaubt der Zeile, nicht der URL, dass sie ein Release ist', async () => {
      // Every row carries `type`, and the adapter never read it — it relied on
      // `type=release` being in the URL it built. That is exactly the assumption
      // that fell away when `searchParams.set()` turned out to be a silent
      // no-op under GJS: the query never left the process, `/database/search`
      // answered with everything, and nothing here could have noticed that the
      // ids were artists being priced as records.
      const m = mapReleases(
        [row({ type: 'artist' }), row({ id: 99, type: 'release' })],
        () => stats(),
        FETCHED_AT,
      );
      expect(m.listings).toHaveLength(1);
      expect(m.listings[0].id).toBe('99');
      expect(m.unmappable).toBe(1);
    });

    await it('trennt "verkauft gerade niemand" von "darf nicht verkauft werden"', async () => {
      // Measured on five unofficial releases: `blocked_from_sale: true` with
      // `num_for_sale: null` — and `null`, not the `0` the type comment claimed.
      // Discogs bans the sale of these permanently, so "derzeit nicht
      // angeboten" invited coming back for something that will never be there.
      const m = mapReleases(
        [row({ id: 1 }), row({ id: 2 })],
        (id) =>
          id === 1
            ? { num_for_sale: null as unknown as number, lowest_price: null, blocked_from_sale: true }
            : { num_for_sale: 0, lowest_price: null, blocked_from_sale: false },
        FETCHED_AT,
      );
      expect(m.listings).toHaveLength(0);
      expect(m.withoutOffers).toBe(2);
      expect(m.blocked).toBe(1);
    });

    await it('behält im Titel, was die Pressungen unterscheidet', async () => {
      // Measured over five rows of one search: the first three format terms
      // were identical five times out of five — `Vinyl, LP, Album` — while what
      // told the editions apart sat behind them and was cut. The qualifier
      // exists BECAUSE the edition is the identity on this source.
      const reissue = row({
        format: ['Vinyl', 'LP', 'Album', 'Limited Edition', 'Reissue', 'Remastered'],
      });
      const title = mapReleases([reissue], () => stats(), FETCHED_AT).listings[0].title;
      expect(title.includes('Limited Edition')).toBe(true);
      // And it still says what the object is.
      expect(title.includes('Vinyl')).toBe(true);
      expect(title.includes('1979')).toBe(true);
    });

    await it('erfindet keine Währung, wenn Discogs keine nennt', async () => {
      // The default this used to carry is the very thing the source record
      // warns about for the release endpoint: labelling dollars as euros. All
      // twelve measured responses named EUR, so the path never fired — which is
      // exactly why nothing would have caught it.
      const m = mapReleases([row()], () => ({ num_for_sale: 3, lowest_price: { value: 9.99 } }), FETCHED_AT);
      expect(m.listings).toHaveLength(0);
      expect(m.withoutOffers).toBe(1);
    });

    await it('macht aus Release plus Aggregat ein Listing mit Ab-Preis', async () => {
      const m = mapReleases([row()], () => stats(), FETCHED_AT);
      expect(m.listings).toHaveLength(1);
      const l = m.listings[0];
      expect(l.key).toBe('discogs:4242');
      expect(l.provider).toBe('discogs');
      expect(l.url).toBe('https://www.discogs.com/sell/release/4242');
      expect(l.price).toStrictEqual({ minor: 1250, currency: 'EUR' });
      // 'from' und nicht 'fixed': der Wert ist das Minimum aus sieben Angeboten.
      expect(l.priceKind).toBe('from');
      expect(l.shippingCost).toBeNull();
      expect(l.totalPrice).toBeNull();
      expect(l.condition).toBe('unknown');
      expect(l.delivery).toBe('shipping');
      expect(l.fetchedAt).toBe(FETCHED_AT);
      expect(l.description).toContain('7 Angebote');
    });

    await it('unterscheidet zwei gleichnamige Pressungen über Format, Jahr und Land', async () => {
      const m = mapReleases(
        [
          row({ id: 1, title: 'Band - Platte', year: '1970', country: 'Germany', format: ['Vinyl', 'LP'] }),
          row({ id: 2, title: 'Band - Platte', year: '1994', country: 'Japan', format: ['CD', 'Album'] }),
        ],
        () => stats(),
        FETCHED_AT,
      );
      expect(m.listings[0].title).toBe('Band - Platte (Vinyl, LP, 1970, Germany)');
      expect(m.listings[1].title).toBe('Band - Platte (CD, Album, 1994, Japan)');
      // Der Diskriminator: ohne die Qualifizierung wären beide Titel gleich —
      // und merge.ts würde sie über title+price zu einer Zeile falten.
      expect(m.listings[0].title).not.toBe(m.listings[1].title);
    });

    await it('lässt die Location leer, weil country das Presswerk ist und nicht der Verkäufer', async () => {
      const l = mapReleases([row({ country: 'Germany' })], () => stats(), FETCHED_AT).listings[0];
      expect(l.location).toStrictEqual({ postalCode: null, city: null, country: null, distanceKm: null });
      // Ausdrücklich: das Presswerkland darf nirgends als Verkäuferland landen.
      expect(l.location.country).not.toBe('Germany');
    });

    await it('hängt die Katalognummer an, ohne sie durch den Kontaktfilter zu schicken', async () => {
      // Gemessen: stripContactDetails() frisst '0602557531336' — der
      // Telefon-Regex trifft jede Ziffernfolge, die mit 0 beginnt. Genau diese
      // Form haben Universal-Katalognummern.
      const l = mapReleases([row({ catno: '0602557531336' })], () => stats(), FETCHED_AT).listings[0];
      expect(l.description).toContain('0602557531336');
      expect(l.description).not.toContain('[…]');
    });

    await it('entfernt Kontaktdaten aus den Release-Notes, dem einzigen Freitextfeld', async () => {
      const l = mapReleases(
        [{ ...row(), notes: 'Presswerk-Info, Rückfragen an info@beispiel.test oder 0176 12345678.' }],
        () => stats(),
        FETCHED_AT,
      );
      expect(l.listings[0].description).toContain('[…]');
      expect(l.listings[0].description).not.toContain('info@beispiel.test');
      expect(l.listings[0].description).not.toContain('0176 12345678');
    });

    await it('rendert Discogs’ Wiki-Markup zu lesbarem Text', async () => {
      // Gemessen auf Release 35822047: "Identical to [r=7000941] with the
      // addition of a signature". Eine nackte ID sagt einem Menschen nichts.
      // Eine Release-Referenz wird zum Handle, das die CLI selbst versteht.
      expect(plainNotes('Identical to [r=7000941] with a signature')).toBe(
        'Identical to discogs:7000941 with a signature',
      );
      // Für Master, Künstler und Label gibt es kein Handle — die nackte ID fliegt raus.
      expect(plainNotes('See [m=2745] for versions')).toBe('See for versions');
      expect(plainNotes('Produced by [a=Conny Plank]')).toBe('Produced by Conny Plank');
      expect(plainNotes('[b]Gatefold[/b] sleeve')).toBe('Gatefold sleeve');
      expect(plainNotes(undefined)).toBe('');
    });

    await it('nennt dasselbe Label nicht zweimal', async () => {
      const l = mapReleases([row({ label: ['Vertigo', 'Vertigo'] })], () => stats(), FETCHED_AT).listings[0];
      expect(l.description).toContain('Label: Vertigo');
      expect(l.description).not.toContain('Vertigo, Vertigo');
    });

    await it('verwirft Releases ohne Angebot — zählt sie aber, damit „leer“ erklärbar bleibt', async () => {
      const m = mapReleases([row()], () => stats({ num_for_sale: 0, lowest_price: null }), FETCHED_AT);
      expect(m.listings).toHaveLength(0);
      expect(m.withoutOffers).toBe(1);
      // Der Diskriminator gegen „grün und leer": kein Angebot ist etwas völlig
      // anderes als eine Zeile, die wir nicht lesen konnten.
      expect(m.unmappable).toBe(0);
    });

    await it('zählt Zeilen ohne id oder title als unmappable', async () => {
      const m = mapReleases([row({ id: undefined }), row({ title: '  ' })], () => stats(), FETCHED_AT);
      expect(m.unmappable).toBe(2);
      expect(m.listings).toHaveLength(0);
    });

    await it('behandelt eine Zeile ohne Preisabfrage nicht als Formfehler', async () => {
      // Ein knappes Anfragebudget lässt Zeilen ohne stats zurück. Würden die als
      // unmappable zählen, sähe ein kleines Budget wie eine Layoutänderung aus.
      const m = mapReleases(
        [row({ id: 1 }), row({ id: 2 })],
        (id) => (id === 1 ? stats() : undefined),
        FETCHED_AT,
      );
      expect(m.listings).toHaveLength(1);
      expect(m.unmappable).toBe(0);
      expect(m.withoutOffers).toBe(0);
    });

    await it('übernimmt Bilder nur als https-URL', async () => {
      const l = mapReleases(
        [row({ cover_image: 'https://i.discogs.test/gross.jpg', thumb: '' })],
        () => stats(),
        FETCHED_AT,
      ).listings[0];
      expect(l.images).toStrictEqual(['https://i.discogs.test/gross.jpg']);
      expect(mapReleases([row()], () => stats(), FETCHED_AT).listings[0].images).toHaveLength(0);
    });

    await it('formt eine Detailantwort in dieselbe Zeile wie ein Suchtreffer', async () => {
      const mapped = releaseToRow({
        id: 4242,
        title: 'Beispielplatte',
        artists_sort: 'Beispielband',
        year: 1979,
        country: 'Germany',
        formats: [{ name: 'Vinyl', descriptions: ['LP', 'Album'] }],
        labels: [{ name: 'Beispiellabel', catno: 'BSP 001' }],
        identifiers: [
          { type: 'Matrix / Runout', value: '10 6305058 1 320' },
          { type: 'Barcode', value: '8 88837 16861 8' },
        ],
        genres: ['Electronic'],
        styles: ['Krautrock'],
        images: [{ type: 'primary', uri: 'https://i.discogs.test/gross.jpg' }],
      });
      // Der Titel muss exakt so lauten wie aus der Suche, sonst zerfällt ein
      // Listing beim Öffnen der Detailansicht in zwei verschiedene Zeilen.
      const fromDetail = mapReleases([mapped], () => stats(), FETCHED_AT).listings[0];
      const fromSearch = mapReleases([row()], () => stats(), FETCHED_AT).listings[0];
      expect(fromDetail.title).toBe(fromSearch.title);
      expect(fromDetail.key).toBe(fromSearch.key);
      // Auch ein als "Barcode" ausgezeichneter Wert geht durch die Prüfziffer.
      expect(fromDetail.gtin).toBe('888837168618');
    });
  });

  await describe('Discogs · Antwort-Diskriminatoren', async () => {
    await it('wirft parse-failed, wenn results kein Array ist', async () => {
      const err = await caught(async () => parseSearchResponse({ pagination: { items: 5 } }));
      expect(err.kind).toBe('parse-failed');
    });

    await it('wirft parse-failed, wenn Discogs Treffer meldet, aber keine Zeile liefert', async () => {
      const err = await caught(async () => parseSearchResponse(searchBody([], 4711)));
      expect(err.kind).toBe('parse-failed');
      expect(err.message).toContain('4711');
    });

    await it('liefert beim echten Null-Treffer eine leere Liste statt eines Fehlers', async () => {
      // Gemessene Gestalt einer erfolglosen Suche: items 0 UND results leer.
      const parsed = parseSearchResponse({
        pagination: { page: 1, pages: 1, per_page: 5, items: 0 },
        results: [],
      });
      expect(parsed.rows).toHaveLength(0);
      expect(parsed.totalItems).toBe(0);
    });
  });

  await describe('Discogs · Rate-Limit-Header', async () => {
    await it('liest die drei X-Discogs-Ratelimit-Header', async () => {
      const bag = new Map([
        ['x-discogs-ratelimit', '25'],
        ['x-discogs-ratelimit-remaining', '19'],
        ['x-discogs-ratelimit-used', '6'],
      ]);
      expect(readRateLimit({ get: (n) => bag.get(n) ?? null })).toStrictEqual({
        limit: 25,
        remaining: 19,
        used: 6,
      });
    });

    await it('meldet fehlende Header als null, nicht als 0', async () => {
      // Der Diskriminator: mit `?? 0` sähe „unbekannt" wie ein erschöpftes
      // Budget aus, und der Adapter würde ohne Not aufhören zu fragen.
      expect(readRateLimit({ get: () => null })).toStrictEqual({ limit: null, remaining: null, used: null });
    });
  });

  await describe('Discogs · Provider ohne Zugangsdaten', async () => {
    await it('meldet sich ohne Token als konfiguriert — das ist der Sinn dieser Quelle', async () => {
      const { http } = rig(() => ({ body: {} }));
      const p = createDiscogsProvider({ http, env: {}, enabled: true });
      expect(await p.status()).toStrictEqual({ configured: true, problem: null });
    });

    await it('meldet blocked-by-policy, wenn die Quelle abgeschaltet ist', async () => {
      const { http } = rig(() => ({ body: {} }));
      const status = await createDiscogsProvider({ http, env: {}, enabled: false }).status();
      expect(status.configured).toBe(true);
      expect(status.problem?.kind).toBe('blocked-by-policy');
    });

    await it('nennt die Trefferobergrenze, die das jeweilige Ratelimit hergibt', async () => {
      const { http } = rig(() => ({ body: {} }));
      expect(createDiscogsProvider({ http, env: {}, enabled: true }).capabilities.maxResults).toBe(22);
      expect(
        createDiscogsProvider({ http, env: { DISCOGS_TOKEN: 'abc' }, enabled: true }).capabilities.maxResults,
      ).toBe(57);
    });

    await it('erwähnt im Hinweis, dass es Aggregate und keine Einzelangebote sind', async () => {
      const { http } = rig(() => ({ body: {} }));
      const caps = createDiscogsProvider({ http, env: {}, enabled: true }).capabilities;
      expect(caps.note).toContain('keine Einzelangebote');
      expect(caps.note).toContain('DISCOGS_TOKEN');
      expect(caps.access).toBe('official-api');
      expect(caps.enabledByDefault).toBe(true);
      // Von Discogs' API-Nutzungsbedingungen wörtlich verlangt.
      expect(caps.disclaimer).toContain('Data provided by Discogs.');
      expect(caps.disclaimer).toContain('Zink Media, LLC');
      // Sechs Stunden — dieselbe Frist, die eBay vertraglich setzt.
      expect(caps.cache.ttlSeconds).toBe(21600);
    });

    await it('schickt ohne Token keinen Authorization-Header, mit Token den Discogs-token-Header', async () => {
      const body = searchBody([row()]);
      const anon = rig((url) => ({ body: url.includes('/database/search') ? body : stats() }));
      await createDiscogsProvider({ http: anon.http, env: {}, enabled: true }).search({
        text: 'a',
        limit: 1,
      });
      expect(anon.calls[0].headers.authorization).toBeUndefined();

      const auth = rig((url) => ({
        body: url.includes('/database/search') ? body : stats(),
        limit: 60,
        remaining: 60,
      }));
      await createDiscogsProvider({
        http: auth.http,
        env: { DISCOGS_TOKEN: 'geheim' },
        enabled: true,
      }).search({
        text: 'a',
        limit: 1,
      });
      expect(auth.calls[0].headers.authorization).toBe('Discogs token=geheim');
    });

    await it('schickt den sprechenden User-Agent, den Discogs verlangt', async () => {
      const anon = rig((url) => ({ body: url.includes('/database/search') ? searchBody([row()]) : stats() }));
      await createDiscogsProvider({ http: anon.http, env: {}, enabled: true }).search({
        text: 'a',
        limit: 1,
      });
      const ua = anon.calls[0].headers['user-agent'];
      // Discogs' Doku nennt 'curl/7.9.8' und 'Mozilla/5.0 …' ausdrücklich als
      // schlechte Beispiele und verlangt Name/Version plus Kontaktadresse.
      expect(ua).toMatch(/^troedler\/9\.9\.9 \(\+https:\/\/github\.com\/JumpLink\/troedler\)$/);
      expect(anon.calls[0].headers.accept).toBe('application/vnd.discogs.v2.discogs+json');
    });
  });

  await describe('Discogs · Suche ohne Netz', async () => {
    await it('bezahlt eine Anfrage für die Suche und je eine pro Treffer', async () => {
      const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })];
      const r = rig((url) => ({ body: url.includes('/database/search') ? searchBody(rows, 900) : stats() }));
      const res = await createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({
        text: 'a',
        limit: 3,
      });

      expect(res.listings).toHaveLength(3);
      expect(res.requests).toBe(4);
      expect(r.calls[0].url).toContain('/database/search');
      expect(r.calls[1].url).toBe('https://api.discogs.com/marketplace/stats/1?curr_abbr=EUR');
      expect(res.totalEstimate).toBe(900);
      // 900 Releases passen, drei kamen — das MUSS als abgeschnitten gelten.
      expect(res.truncated).toBe(true);
    });

    await it('meldet gtin als serverseitig angewandt, sonst nichts', async () => {
      const r = rig((url) => ({ body: url.includes('/database/search') ? searchBody([row()]) : stats() }));
      const p = createDiscogsProvider({ http: r.http, env: {}, enabled: true });
      expect((await p.search({ text: '', gtin: '888837168618', limit: 1 })).applied).toStrictEqual(['gtin']);

      const r2 = rig((url) => ({ body: url.includes('/database/search') ? searchBody([row()]) : stats() }));
      const p2 = createDiscogsProvider({ http: r2.http, env: {}, enabled: true });
      // Preis, Zustand und Sortierung kann dieser Endpunkt nicht — das darf
      // nirgends als „erledigt" gemeldet werden, sonst lügt --explain.
      expect((await p2.search({ text: 'a', maxPriceMinor: 500, limit: 1 })).applied).toStrictEqual([]);
    });

    await it('hört mit den Preisabfragen auf, wenn das Fenster zur Neige geht, und sagt es', async () => {
      const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), row({ id: 4 }), row({ id: 5 })];
      // Nur noch 6 Anfragen im Fenster: nach Abzug der Reserve von 3 bleiben 3.
      const r = rig((url) => ({
        body: url.includes('/database/search') ? searchBody(rows) : stats(),
        remaining: 6,
      }));
      const res = await createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({
        text: 'a',
        limit: 5,
      });

      expect(res.listings).toHaveLength(3);
      expect(res.requests).toBe(4);
      expect(res.truncated).toBe(true);
      expect(res.warnings.join(' ')).toContain('DISCOGS_TOKEN');
      // Der Diskriminator: ohne die Budgetprüfung wären es 5 Treffer und keine
      // Warnung — und der nächste Aufruf liefe in ein 429.
      expect(res.warnings.some((w) => w.includes('3'))).toBe(true);
    });

    await it('rechnet das Budget in Anfragen, nicht in gelungenen Preisabfragen', async () => {
      // Discogs charges for a 404 exactly as for a hit — "Release not found."
      // is a measured, documented answer. The stop condition read `stats.size`,
      // the count of SUCCESSES, so a run of 404s never reached it: a budget of
      // three would have sent one request per row, all five of them, and only
      // stopped when the rows ran out. The window it was protecting is a moving
      // average, so overspending it is how a 403 arrives.
      const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), row({ id: 4 }), row({ id: 5 })];
      const r = rig((url) =>
        url.includes('/database/search')
          ? { body: searchBody(rows), remaining: 6 }
          : { status: 404, body: { message: 'Release not found.' }, remaining: 6 },
      );
      const err = await caught(() =>
        createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({ text: 'a', limit: 5 }),
      );
      // Every price lookup failed, so the endpoint is reported as broken — the
      // guard that already existed. What this test pins is the COST of getting
      // there: one search plus three attempts, not one search plus five.
      expect(err.kind).toBe('remote-error');
      expect(r.calls).toHaveLength(4);
    });

    await it('meldet ein ausgeschöpftes Fenster als rate-limited, nicht als leeres Ergebnis', async () => {
      // Der teuerste denkbare Ausgang: 5 Treffer liegen bereit, das Budget
      // reicht für keine einzige Preisabfrage — und der Nutzer liest „nichts
      // gefunden". `rate-limited` ist transient und sagt genau das Gegenteil.
      const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), row({ id: 4 }), row({ id: 5 })];
      const r = rig(() => ({ body: searchBody(rows), remaining: 2 }));
      const err = await caught(() =>
        createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({ text: 'a', limit: 5 }),
      );
      expect(err.kind).toBe('rate-limited');
      expect(err.retryAfterSeconds).toBe(60);
      // Nur die Suche selbst wurde bezahlt, keine vergebliche Preisabfrage.
      expect(r.calls).toHaveLength(1);
    });

    await it('gibt zurück, was es hat, wenn das lokale Anfragebudget vorher ausgeht', async () => {
      // Der andere Deckel: nicht Discogs' Fenster, sondern maxRequestsPerHost im
      // HttpClient. Mit Token verspricht capabilities.maxResults 57 Treffer —
      // die Voreinstellung des Clients ist 40 Anfragen pro Lauf. Das MUSS ein
      // gekürztes Ergebnis mit Warnung ergeben, nicht einen leeren Fehlschlag.
      const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), row({ id: 4 })];
      const r = rig(
        (url) => ({
          body: url.includes('/database/search') ? searchBody(rows) : stats(),
          limit: 60,
          remaining: 60,
        }),
        3,
      );
      const res = await createDiscogsProvider({
        http: r.http,
        env: { DISCOGS_TOKEN: 'geheim' },
        enabled: true,
      }).search({ text: 'a', limit: 4 });

      expect(res.listings).toHaveLength(2);
      expect(res.truncated).toBe(true);
      expect(res.warnings.join(' ')).toContain('Preisabfragen abgebrochen');
    });

    await it('überlebt einzelne 404er und nennt sie', async () => {
      const rows = [row({ id: 1 }), row({ id: 2 })];
      const r = rig((url) => {
        if (url.includes('/database/search')) return { body: searchBody(rows) };
        // Gemessen: {"message":"Release not found."} mit HTTP 404.
        if (url.endsWith('/2?curr_abbr=EUR')) return { status: 404, body: { message: 'Release not found.' } };
        return { body: stats() };
      });
      const res = await createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({
        text: 'a',
        limit: 2,
      });
      expect(res.listings).toHaveLength(1);
      expect(res.warnings.join(' ')).toContain('Preisabfragen');
    });

    await it('wirft, wenn keine einzige Preisabfrage gelingt — das ist kein leeres Ergebnis', async () => {
      const rows = [row({ id: 1 }), row({ id: 2 })];
      const r = rig((url) =>
        url.includes('/database/search')
          ? { body: searchBody(rows) }
          : { status: 500, body: { message: 'boom' } },
      );
      const err = await caught(() =>
        createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({ text: 'a', limit: 2 }),
      );
      expect(err.kind).toBe('remote-error');
      expect(err.message).toContain('marketplace/stats');
    });

    await it('wirft parse-failed, wenn keine Zeile id und title trägt', async () => {
      const rows = [{ uri: '/release/1' }, { uri: '/release/2' }];
      const r = rig(() => ({ body: searchBody(rows, 2) }));
      const err = await caught(() =>
        createDiscogsProvider({ http: r.http, env: {}, enabled: true }).search({ text: 'a', limit: 2 }),
      );
      // Der teuerste Fehler dieses Projekts wäre hier eine leere Liste.
      expect(err.kind).toBe('parse-failed');
    });

    await it('erklärt einen abgelehnten Token, statt ihn als Anbieterentscheidung auszugeben', async () => {
      // Gemessen: ein ungültiger Token bekommt 401 mit "Invalid consumer token".
      const r = rig(() => ({ status: 401, body: { message: 'Invalid consumer token.' } }));
      const err = await caught(() =>
        createDiscogsProvider({ http: r.http, env: { DISCOGS_TOKEN: 'falsch' }, enabled: true }).search({
          text: 'a',
        }),
      );
      expect(err.kind).toBe('refused');
      expect(err.message).toContain('DISCOGS_TOKEN');
    });

    await it('wird vom Gate gestoppt, wenn die Quelle abgeschaltet ist', async () => {
      const r = rig(() => ({ body: searchBody([row()]) }));
      const err = await caught(() =>
        createDiscogsProvider({ http: r.http, env: {}, enabled: false }).search({ text: 'a' }),
      );
      expect(err.kind).toBe('blocked-by-policy');
      // Und zwar bevor irgendetwas das Netz erreicht.
      expect(r.calls).toHaveLength(0);
    });
  });

  await describe('Discogs · Detail und Kontingent', async () => {
    await it('holt die Metadaten aus /releases und den Preis aus /marketplace/stats', async () => {
      const r = rig((url) =>
        url.includes('/marketplace/stats/')
          ? { body: stats() }
          : { body: { id: 4242, title: 'Beispielplatte', artists_sort: 'Beispielband', year: 1979 } },
      );
      const l = await createDiscogsProvider({ http: r.http, env: {}, enabled: true }).getListing('4242');
      expect(l?.key).toBe('discogs:4242');
      expect(l?.price).toStrictEqual({ minor: 1250, currency: 'EUR' });
      expect(r.calls[0].url).toBe('https://api.discogs.com/releases/4242');
      // Der Diskriminator gegen den gemessenen USD-Fehler: der Preis darf NIE
      // aus der Release-Antwort kommen, also muss stats zwingend abgerufen werden.
      expect(r.calls[1].url).toBe('https://api.discogs.com/marketplace/stats/4242?curr_abbr=EUR');
    });

    await it('antwortet auf eine verschwundene Release-ID mit null statt mit einem Fehler', async () => {
      const r = rig(() => ({ status: 404, body: { message: 'Release not found.' } }));
      expect(
        await createDiscogsProvider({ http: r.http, env: {}, enabled: true }).getListing('999999999'),
      ).toBeNull();
    });

    await it('gibt keine erfundene ID an das Netz weiter', async () => {
      const r = rig(() => ({ body: {} }));
      const p = createDiscogsProvider({ http: r.http, env: {}, enabled: true });
      expect(await p.getListing('nicht-numerisch')).toBeNull();
      expect(await p.getListing('12abc')).toBeNull();
      expect(r.calls).toHaveLength(0);
    });

    await it('leitet resetAt aus dem dokumentierten 60-Sekunden-Fenster ab', async () => {
      const r = rig(() => ({ body: stats(), limit: 25, remaining: 19 }));
      const p = createDiscogsProvider({
        http: r.http,
        env: {},
        enabled: true,
        now: () => new Date('2026-08-21T12:00:00.000Z'),
      });
      expect(await p.quota()).toStrictEqual({
        remaining: 19,
        limit: 25,
        resetAt: '2026-08-21T12:01:00.000Z',
      });
      // Ein einziger Ping, und der billigste, den die API hat.
      expect(r.calls).toHaveLength(1);
      expect(r.calls[0].url).toContain('/marketplace/stats/1');
    });
  });
};
