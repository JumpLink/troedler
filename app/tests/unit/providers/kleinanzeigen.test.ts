/**
 * kleinanzeigen.de adapter.
 *
 * Every fixture below is written by hand. None of it is a copy of a real
 * result page: this source's terms forbid reproducing their content, and a
 * checked-in copy of somebody's ad would be exactly that. What the fixtures do
 * carry is the STRUCTURE that was measured against the live site on
 * 2026-08-21 — the `li`/`article` nesting, the `is-topad` marker, the
 * zero-width space inside a place name, the „Es wurden keine Ergebnisse"
 * sentence — because those are what the parser is allowed to depend on.
 *
 * Each case asserts a value that only holds when the thing under test worked.
 * "It did not throw" is not a discriminator: this adapter's signature failure
 * is a run that succeeds and returns nothing, so a test that could pass on an
 * empty list proves nothing about it.
 */

import { describe, expect, it } from '@gjsify/unit';
import { HttpClient, RateLimiter } from '@troedler/http';
import { ProviderError } from '@troedler/core';
import {
  MAX_PAGE,
  NO_SCOPE,
  createKleinanzeigenProvider,
  keywordSlug,
  listingIdFrom,
  parseListingPage,
  parseSearchPage,
  parseTotal,
  resolveCategory,
  searchPath,
  type KleinanzeigenScope,
} from '@troedler/kleinanzeigen';

/** Pinned so „Heute" and „Gestern" mean something a test can name. */
const NOW = new Date('2026-08-21T18:30:00+02:00');

const FAHRRAEDER: KleinanzeigenScope = { category: { slug: 'fahrraeder', id: 217 }, location: null };
const HAMBURG: KleinanzeigenScope = { category: null, location: { slug: 'hamburg', id: 9409 } };
const BOTH: KleinanzeigenScope = { category: FAHRRAEDER.category, location: HAMBURG.location };

/** The zero-width space that really sits inside place names in this markup. */
const ZWSP = '​';

function ad(options: {
  id: string;
  title: string;
  price: string;
  place: string;
  date: string;
  topAd?: boolean;
  pro?: boolean;
  versand?: boolean;
  teaser?: string;
  json?: string;
}): string {
  return `
    <li class="ad-listitem fully-clickable-card ${options.topAd ? 'badge-topad is-topad' : ''}">
      <article class="aditem" data-adid="${options.id}" data-href="/s-anzeige/ein-slug/${options.id}-217-9409">
        <div class="aditem-image">
          ${options.json ?? `<script type="application/ld+json">{"@type":"ImageObject","contentUrl":"https://img.example/${options.id}?rule=$_59.AUTO","description":"${options.teaser ?? ''}"}</script>`}
          <img src="https://img.example/${options.id}?rule=$_2.AUTO">
          <div class="galleryimage--counter">3</div>
        </div>
        <div class="aditem-main--top">
          <div class="aditem-main--top--left"><i class="icon-pin-gray"></i> ${options.place} </div>
          <div class="aditem-main--top--right"><i class="icon-calendar-open"></i> ${options.date} </div>
        </div>
        <div class="aditem-main--middle">
          <h2 class="text-module-begin"><a href="/s-anzeige/ein-slug/${options.id}-217-9409">${options.title}</a></h2>
          <p class="aditem-main--middle--description">${options.teaser ?? 'Teaser.'}</p>
          <div class="aditem-main--middle--price-shipping">
            <p class="aditem-main--middle--price-shipping--old-price">999 €</p>
            <p class="aditem-main--middle--price-shipping--price">${options.price}</p>
          </div>
        </div>
        <div class="aditem-main--bottom">
          <span class="simpletag">M (38)</span>
          ${options.versand ? '<span class="simpletag tag-with-icon">Versand möglich</span>' : ''}
          ${options.pro ? '<div class="badge-hint-pro-small-srp">PRO</div>' : ''}
        </div>
      </article>
    </li>`;
}

function page(options: { summary: string; rows: string; next?: string | null }): string {
  const next = options.next === undefined ? '/s-seite:2/testrad/k0' : options.next;
  return `<!DOCTYPE html><html lang="de"><head><title>Test</title>
    ${next ? `<link rel="next" href="${next}">` : ''}
    </head><body>
    <h1 class="breadcrump-summary">${options.summary}</h1>
    <ul id="srchrslt-adtable">${options.rows}</ul>
  </body></html>`;
}

const FULL_PAGE = page({
  summary: '1 - 25 von 12.345 Ergebnissen für „testrad“ in Deutschland',
  rows: [
    ad({
      id: '900000001',
      title: 'Bezahlte Platzierung',
      price: '999 €',
      place: '10115 Berlin',
      date: '',
      topAd: true,
    }),
    ad({
      id: '100000001',
      title: 'Herrenrad 28 Zoll',
      price: '3.550 € VB',
      place: `22083 Hamburg Barmbek-${ZWSP}Süd`,
      date: 'Heute, 17:08',
      versand: true,
      teaser: 'Guter Zustand, Rechnung liegt bei.',
    }),
    ad({
      id: '100000002',
      title: 'Kinderrad',
      price: 'Zu verschenken',
      place: '83627 Warngau',
      date: 'Gestern, 14:29',
      pro: true,
    }),
    ad({ id: '100000003', title: 'Rahmen', price: 'VB', place: '36179 Bebra', date: '26.04.2026' }),
  ].join(''),
});

const EMPTY_PAGE = `<!DOCTYPE html><html><head><title>x</title></head><body>
  <h1 class="breadcrump-summary">Es wurden keine Ergebnisse für „qxzvwlkjhgfdsayy“ in Deutschland gefunden.</h1>
</body></html>`;

/** The list is there, the rows are not — the markup moved. */
const MOVED_MARKUP = `<!DOCTYPE html><html><head><title>x</title></head><body>
  <h1 class="breadcrump-summary">1 - 25 von 12.345 Ergebnissen für „testrad“ in Deutschland</h1>
  <ul id="srchrslt-adtable"><li class="result-card"><span>Herrenrad</span></li></ul>
</body></html>`;

/** Ads are there, but the row container was renamed. */
const RENAMED_ROWS = `<!DOCTYPE html><html><head><title>x</title></head><body>
  <h1 class="breadcrump-summary">1 - 25 von 12.345 Ergebnissen für „testrad“ in Deutschland</h1>
  <ul id="srchrslt-adtable"><li class="result-card"><article data-adid="100000001"></article></li></ul>
</body></html>`;

const VIP_PAGE = `<!DOCTYPE html><html lang="de"><head><title>x</title></head><body>
  <h1 id="viewad-title">Herrenrad 28 Zoll</h1>
  <h2 id="viewad-price">3.550 € VB</h2>
  <div class="boxedarticle--details">
    <span id="viewad-locality">22083 Hamburg Barmbek - Hamburg Barmbek-${ZWSP}Süd</span>
    <span class="boxedarticle--details--shipping">Versand möglich</span>
    <div id="viewad-extra-info"><span>21.08.2026</span></div>
  </div>
  <div id="viewad-ad-id-box">Anzeigen-ID 100000001</div>
  <ul id="viewad-details">
    <li class="addetailslist--detail">Art<span class="addetailslist--detail--value">Herren</span></li>
    <li class="addetailslist--detail">Zustand<span class="addetailslist--detail--value">Sehr Gut</span></li>
  </ul>
  <p id="viewad-description-text">Guter Zustand. Erreichbar unter 0176 1234567 oder rad@example.org.</p>
  <div id="viewad-contact">
    <span class="userprofile-vip">Ein Name Der Hier Nichts Zu Suchen Hat</span>
    <span class="userprofile-vip-details">Privater Nutzer</span>
    <span class="userprofile-vip-details">Aktiv seit 28.03.2015</span>
  </div>
  <img id="viewad-image" src="https://img.example/a?rule=$_59.AUTO">
  <img id="viewad-image" src="https://img.example/b?rule=$_59.AUTO">
</body></html>`;

/**
 * What the site really serves for an id that is gone: its own front page,
 * `HTTP 200`, no 404 and no marker. Measured against `/s-anzeige/1`.
 */
const FRONT_PAGE = `<!DOCTYPE html><html><head><title>Kleinanzeigen</title></head><body>
  <h1>Kleinanzeigen entdecken</h1>
</body></html>`;

/** An ad page whose title selector stopped matching — broken, not gone. */
const VIP_TITLE_MOVED = VIP_PAGE.replace('id="viewad-title"', 'id="viewad-headline"');

/** Mirrors the rules this adapter has to live under, so the gate is really exercised. */
const ROBOTS = `User-agent: *
Disallow: /api
Disallow: /*.json
Disallow: /s-feed.rss
Disallow: /*/preis:*
Disallow: /*/sortierung:*
Disallow: /*/anbieter:*
Disallow: /*versand:*
Disallow: /*/k0*r20
Disallow: /*/seite:6*
Sitemap: https://www.kleinanzeigen.de/sitemap_index.xml
`;

interface Call {
  readonly url: string;
}

/** A fetch that serves the fixtures and records what was asked for. */
function fakeFetch(
  pages: Record<string, string>,
  calls: Call[],
  redirects: Record<string, string> = {},
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url });
    if (url.endsWith('/robots.txt')) return new Response(ROBOTS, { status: 200 });
    const body = pages[new URL(url).pathname];
    if (body === undefined) return new Response('nope', { status: 404 });
    const res = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    // `Response.url` is empty on a hand-built response; the adapter reads it to
    // tell a redirected-away ad from a broken one, so the fake has to carry it.
    Object.defineProperty(res, 'url', { value: redirects[new URL(url).pathname] ?? url });
    return res;
  }) as typeof fetch;
}

function client(
  pages: Record<string, string>,
  calls: Call[],
  redirects: Record<string, string> = {},
): HttpClient {
  return new HttpClient({
    version: '0.0.0-test',
    // No real seconds spent proving a gap was kept — that is the limiter's own test.
    limiter: new RateLimiter({ sleep: async () => {} }),
    fetchImpl: fakeFetch(pages, calls, redirects),
  });
}

export default async () => {
  await describe('kleinanzeigen: URL-Grammatik', async () => {
    await it('setzt das Stichwort als LETZTES Segment vor das k-Token', async () => {
      // The measured trap: /s-fahrrad/hamburg/k0l9409 is answered with 200 and
      // 27 plausible ads for „hamburg in Hamburg". Order is not cosmetic here.
      expect(searchPath('fahrrad', HAMBURG)).toBe('/s-hamburg/fahrrad/k0l9409');
      expect(searchPath('fahrrad', HAMBURG).endsWith('/fahrrad/k0l9409')).toBe(true);
      expect(searchPath('fahrrad', HAMBURG).startsWith('/s-hamburg/')).toBe(true);
    });

    await it('kennt beide Paginierungs-Schreibweisen — als eine Regel', async () => {
      expect(searchPath('fahrrad', NO_SCOPE, 1)).toBe('/s-fahrrad/k0');
      expect(searchPath('fahrrad', NO_SCOPE, 2)).toBe('/s-seite:2/fahrrad/k0');
      expect(searchPath('rennrad', FAHRRAEDER, 2)).toBe('/s-fahrraeder/seite:2/rennrad/k0c217');
      expect(searchPath('fahrrad', HAMBURG, 3)).toBe('/s-hamburg/seite:3/fahrrad/k0l9409');
      expect(searchPath('fahrrad', BOTH, 2)).toBe('/s-fahrraeder/hamburg/seite:2/fahrrad/k0c217l9409');
    });

    await it('lässt Umlaute stehen und kodiert sie, statt sie zu übersetzen', async () => {
      // Measured: /s-b%C3%BCrostuhl/k0 echoes „bürostuhl", /s-buerostuhl/k0
      // echoes „buerostuhl". Transliterating searches a different word.
      expect(searchPath('Bürostuhl')).toBe('/s-b%C3%BCrostuhl/k0');
      expect(keywordSlug('Bürostuhl')).toBe('bürostuhl');
    });

    await it('macht die von robots.txt gesperrten Tokens unschreibbar', async () => {
      // A raw term goes straight into the path, and our own robots matcher
      // would ALLOW /s-preis:100/k0 — the disallow needs a slash in front.
      expect(searchPath('preis:100 sortierung:neu')).toBe('/s-preis-100-sortierung-neu/k0');
      expect(searchPath('e-bike 28"/zoll')).toBe('/s-e-bike-28-zoll/k0');
      expect(keywordSlug('a/b+c:d')).toBe('a-b-c-d');
    });

    await it('baut keine Seite über der Kappe und keine Suche ohne Stichwort', async () => {
      expect(MAX_PAGE).toBe(5);
      expect(() => searchPath('fahrrad', NO_SCOPE, 6)).toThrow(/Seite 6/);
      expect(() => searchPath('   ')).toThrow(/Suchbegriff/);
      expect(() => searchPath('+++')).toThrow(/Suchbegriff/);
    });

    await it('liest die Anzeigen-ID aus beiden Schreibweisen', async () => {
      expect(listingIdFrom('/s-anzeige/ein-slug/3490401536-217-9485')).toBe('3490401536');
      expect(listingIdFrom('/s-anzeige/3490401536')).toBe('3490401536');
      expect(listingIdFrom('/s-fahrrad/k0')).toBeNull();
    });
  });

  await describe('kleinanzeigen: Kategorien', async () => {
    await it('löst Slug und Nummer auf', async () => {
      expect(resolveCategory('fahrraeder').id).toBe(217);
      expect(resolveCategory('c217').slug).toBe('fahrraeder');
      expect(resolveCategory('217').slug).toBe('fahrraeder');
    });

    await it('meldet mehrdeutige Slugs, statt einen davon zu raten', async () => {
      // `haus-garten` is both the top-level category 80 and the services
      // subcategory 291. A Record<string, number> would have picked one.
      expect(() => resolveCategory('haus-garten')).toThrow(/mehrdeutig/);
      expect(() => resolveCategory('gibtesnicht')).toThrow(/Unbekannte/);
    });
  });

  await describe('kleinanzeigen: Trefferliste parsen', async () => {
    await it('liest jedes Feld einer Anzeige', async () => {
      const parsed = parseSearchPage(FULL_PAGE, { now: NOW });
      const first = parsed.listings[0];

      expect(parsed.listings).toHaveLength(3);
      expect(first.key).toBe('kleinanzeigen:100000001');
      expect(first.id).toBe('100000001');
      expect(first.title).toBe('Herrenrad 28 Zoll');
      expect(first.url).toBe('https://www.kleinanzeigen.de/s-anzeige/ein-slug/100000001-217-9409');
      expect(first.price?.minor).toBe(355000);
      expect(first.priceKind).toBe('negotiable');
      expect(first.delivery).toBe('both');
      expect(first.sellerType).toBe('private');
      expect(first.images[0]).toBe('https://img.example/100000001?rule=$_59.AUTO');
      // No condition field exists on a result page, and guessing one from the
      // title is how the kernel's condition filter starts acting on fiction.
      expect(first.condition).toBe('unknown');
      expect(first.conditionRaw).toBeNull();
      // Postage is never printed here; `null` means unknown, not free.
      expect(first.shippingCost).toBeNull();
    });

    await it('nimmt den Zero-Width-Space aus dem Ortsnamen', async () => {
      const first = parseSearchPage(FULL_PAGE, { now: NOW }).listings[0];
      expect(first.location.postalCode).toBe('22083');
      expect(first.location.city).toBe('Hamburg Barmbek-Süd');
      expect(first.location.city?.includes(ZWSP)).toBe(false);
    });

    await it('rechnet „Heute" und „Gestern" gegen das übergebene Jetzt', async () => {
      const listings = parseSearchPage(FULL_PAGE, { now: NOW }).listings;
      // NOW is 18:30 local on 2026-08-21, so 17:08 local is 15:08 UTC.
      expect(listings[0].listedAt).toBe('2026-08-21T15:08:00.000Z');
      expect(listings[1].listedAt).toBe('2026-08-20T12:29:00.000Z');
      expect(listings[2].listedAt).toBe('2026-04-25T22:00:00.000Z');
    });

    await it('liest VB, „Zu verschenken" und den nackten VB-Preis', async () => {
      const listings = parseSearchPage(FULL_PAGE, { now: NOW }).listings;
      expect(listings[1].price?.minor).toBe(0);
      expect(listings[1].priceKind).toBe('free');
      expect(listings[2].price).toBeNull();
      expect(listings[2].priceKind).toBe('negotiable');
      // The struck-through former price sits in the same block and must not win.
      expect(listings[0].price?.minor).toBe(355000);
    });

    await it('wirft Top-Anzeigen weg, weil sie auf jeder Seite wiederkommen', async () => {
      const parsed = parseSearchPage(FULL_PAGE, { now: NOW });
      expect(parsed.seen).toBe(4);
      expect(parsed.topAds).toBe(1);
      expect(parsed.listings.map((l) => l.id)).toEqualArray(['100000001', '100000002', '100000003']);
      expect(parsed.listings.some((l) => l.id === '900000001')).toBe(false);
    });

    await it('erkennt gewerbliche Anbieter am PRO-Badge', async () => {
      const listings = parseSearchPage(FULL_PAGE, { now: NOW }).listings;
      expect(listings[1].sellerType).toBe('commercial');
      expect(listings[0].sellerType).toBe('private');
    });

    await it('liest die Gesamtzahl und den Link auf die nächste Seite', async () => {
      const parsed = parseSearchPage(FULL_PAGE, { now: NOW });
      expect(parsed.totalEstimate).toBe(12345);
      expect(parsed.nextPath).toBe('/s-seite:2/testrad/k0');
      expect(parseTotal('1 - 25 von 921.982 Ergebnissen für „fahrrad“ in Deutschland')).toBe(921982);
      expect(parseTotal('Es wurden keine Ergebnisse gefunden.')).toBeNull();
    });
  });

  await describe('kleinanzeigen: leer heißt leer, kaputt heißt kaputt', async () => {
    await it('nimmt „Es wurden keine Ergebnisse" als echte Null', async () => {
      const parsed = parseSearchPage(EMPTY_PAGE, { now: NOW });
      expect(parsed.listings).toHaveLength(0);
      expect(parsed.totalEstimate).toBe(0);
      expect(parsed.nextPath).toBeNull();
    });

    await it('wirft parse-failed, wenn die Liste da ist und keine Anzeige trifft', async () => {
      // This is the failure the reference implementation calls "silent empty
      // results on pages 2+". Returning [] here would report success.
      let caught: ProviderError | null = null;
      try {
        parseSearchPage(MOVED_MARKUP, { now: NOW });
      } catch (err) {
        caught = err as ProviderError;
      }
      expect(caught).toBeInstanceOf(ProviderError);
      expect(caught?.kind).toBe('parse-failed');
      expect(caught?.message).toMatch(/Markup/);
    });

    await it('wirft parse-failed, wenn nur der Zeilen-Container umbenannt wurde', async () => {
      let kind: string | null = null;
      try {
        parseSearchPage(RENAMED_ROWS, { now: NOW });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('parse-failed');
    });

    await it('wirft parse-failed bei einer ganz fremden Seite', async () => {
      let kind: string | null = null;
      try {
        parseSearchPage('<html><body><h1>Access Denied</h1></body></html>', { now: NOW });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('parse-failed');
    });
  });

  await describe('kleinanzeigen: Anzeigenseite', async () => {
    await it('liest Zustand, Anbietertyp und Versand aus dem DOM', async () => {
      // There is no schema.org Product/Offer on this page — only ImageObject —
      // so every one of these has to come out of the markup.
      const listing = parseListingPage(VIP_PAGE, '100000001', { now: NOW });
      expect(listing?.title).toBe('Herrenrad 28 Zoll');
      expect(listing?.price?.minor).toBe(355000);
      expect(listing?.priceKind).toBe('negotiable');
      expect(listing?.conditionRaw).toBe('Sehr Gut');
      expect(listing?.condition).toBe('used-excellent');
      expect(listing?.sellerType).toBe('private');
      expect(listing?.delivery).toBe('both');
      expect(listing?.location.postalCode).toBe('22083');
      expect(listing?.images).toHaveLength(2);
    });

    await it('wirft Telefonnummer und E-Mail beim Parsen weg, nicht später', async () => {
      const listing = parseListingPage(VIP_PAGE, '100000001', { now: NOW });
      expect(listing?.description).toMatch(/Guter Zustand/);
      expect(listing?.description?.includes('0176')).toBe(false);
      expect(listing?.description?.includes('@example.org')).toBe(false);
    });

    await it('nimmt den Verkäufernamen nirgends mit', async () => {
      const listing = parseListingPage(VIP_PAGE, '100000001', { now: NOW });
      const dump = JSON.stringify(listing);
      expect(dump.includes('Ein Name Der Hier Nichts Zu Suchen Hat')).toBe(false);
    });

    await it('meldet eine verschwundene Anzeige als null, nicht als Fehler', async () => {
      // Measured: /s-anzeige/1 answers HTTP 200 with the front page. There is
      // no 404 and no marker — only the URL we ended up on says what happened.
      const gone = parseListingPage(FRONT_PAGE, '1', {
        now: NOW,
        finalUrl: 'https://www.kleinanzeigen.de/',
      });
      expect(gone).toBeNull();
    });

    await it('meldet eine kaputte Anzeigenseite als parse-failed, nicht als verschwunden', async () => {
      let kind: string | null = null;
      try {
        parseListingPage(VIP_TITLE_MOVED, '100000001', {
          now: NOW,
          finalUrl: 'https://www.kleinanzeigen.de/s-anzeige/100000001',
        });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      // Same empty title as the case above, opposite answer — that is the whole
      // point of carrying the final URL.
      expect(kind).toBe('parse-failed');
    });
  });

  await describe('kleinanzeigen: Provider', async () => {
    await it('ist aus, sagt warum, und verweist auf das Quellendokument', async () => {
      const calls: Call[] = [];
      const provider = createKleinanzeigenProvider({
        http: client({}, calls),
        env: {},
        enabled: false,
        now: () => NOW,
      });
      const status = await provider.status();

      expect(provider.capabilities.enabledByDefault).toBe(false);
      expect(provider.capabilities.termsDoc).toBe('docs/quellen/kleinanzeigen.de.md');
      expect(status.configured).toBe(false);
      expect(status.problem?.kind).toBe('not-configured');
      expect(status.problem?.message).toMatch(/§ 5/);
      expect(provider.capabilities.note).toMatch(/docs\/quellen\/kleinanzeigen\.de\.md/);
      // Off means no socket, not "asked and got nothing".
      expect(calls).toHaveLength(0);
    });

    await it('meldet keinen einzigen serverseitigen Filter', async () => {
      const caps = createKleinanzeigenProvider({
        http: client({}, []),
        env: {},
        enabled: true,
        now: () => NOW,
      }).capabilities;
      // Price, radius, sort, seller type and shipping are all behind URLs
      // robots.txt disallows — the kernel finishes them and says so.
      expect(caps.serverFilters).toHaveLength(0);
      expect(caps.maxResults).toBe(125);
      expect(caps.access).toBe('html');
      expect(caps.cache.memoryOnly).toBe(true);
    });

    await it('behauptet „newest" nur ohne Ort', async () => {
      const withoutPlace = createKleinanzeigenProvider({ http: client({}, []), env: {}, enabled: true });
      const withPlace = createKleinanzeigenProvider({
        http: client({}, []),
        env: { TROEDLER_KLEINANZEIGEN_LOCATION: 'hamburg/9409' },
        enabled: true,
      });
      expect(withoutPlace.capabilities.serverSorts).toEqualArray(['newest']);
      expect(withPlace.capabilities.serverSorts).toHaveLength(0);
    });

    await it('holt zwei Seiten, entdoppelt und meldet truncated', async () => {
      const calls: Call[] = [];
      const secondPage = page({
        summary: '26 - 50 von 12.345 Ergebnissen für „testrad“ in Deutschland',
        // The same top ad AND one repeat of a page-1 ad — both must vanish.
        rows: [
          ad({
            id: '900000001',
            title: 'Bezahlte Platzierung',
            price: '999 €',
            place: '10115 Berlin',
            date: '',
            topAd: true,
          }),
          ad({ id: '100000003', title: 'Rahmen', price: 'VB', place: '36179 Bebra', date: '26.04.2026' }),
          ad({
            id: '100000004',
            title: 'Sattel',
            price: '12 €',
            place: '10627 Charlottenburg',
            date: 'Heute, 09:00',
          }),
        ].join(''),
        next: '/s-seite:3/testrad/k0',
      });
      const provider = createKleinanzeigenProvider({
        http: client({ '/s-testrad/k0': FULL_PAGE, '/s-seite:2/testrad/k0': secondPage }, calls),
        env: {},
        enabled: true,
        now: () => NOW,
      });

      const result = await provider.search({ text: 'testrad', limit: 50 });

      expect(result.requests).toBe(2);
      expect(result.listings.map((l) => l.id)).toEqualArray([
        '100000001',
        '100000002',
        '100000003',
        '100000004',
      ]);
      expect(result.totalEstimate).toBe(12345);
      expect(result.truncated).toBe(true);
      expect(result.applied).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(calls.map((c) => c.url)).toEqualArray([
        'https://www.kleinanzeigen.de/robots.txt',
        'https://www.kleinanzeigen.de/s-testrad/k0',
        'https://www.kleinanzeigen.de/s-seite:2/testrad/k0',
      ]);
    });

    await it('warnt, wenn die Seiten-URL des Anbieters von der eigenen abweicht', async () => {
      const calls: Call[] = [];
      const drifted = page({
        summary: '1 - 25 von 12.345 Ergebnissen',
        rows: FULL_PAGE,
        next: '/s-testrad/page-2',
      });
      const provider = createKleinanzeigenProvider({
        http: client({ '/s-testrad/k0': drifted, '/s-seite:2/testrad/k0': EMPTY_PAGE }, calls),
        env: {},
        enabled: true,
        now: () => NOW,
      });

      const result = await provider.search({ text: 'testrad', limit: 50 });
      // A silently wrong page URL answers 200 with the wrong query — measured
      // on this source. The mismatch has to reach the user.
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/URL-Grammatik/);
    });

    await it('lässt eine von robots.txt gesperrte URL gar nicht erst raus', async () => {
      const calls: Call[] = [];
      const http = client({}, calls);
      let kind: string | null = null;
      try {
        await http.get('https://www.kleinanzeigen.de/s-fahrrad/preis:100:200/k0', {
          provider: 'kleinanzeigen',
          enabled: true,
        });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('blocked-by-policy');
      // robots.txt was fetched, the search URL never was.
      expect(calls).toHaveLength(1);
    });

    await it('gibt getListing für eine verschwundene Anzeige als null zurück', async () => {
      const calls: Call[] = [];
      const provider = createKleinanzeigenProvider({
        http: client({ '/s-anzeige/100000001': VIP_PAGE, '/s-anzeige/1': FRONT_PAGE }, calls, {
          '/s-anzeige/1': 'https://www.kleinanzeigen.de/',
        }),
        env: {},
        enabled: true,
        now: () => NOW,
      });

      expect((await provider.getListing('100000001'))?.title).toBe('Herrenrad 28 Zoll');
      expect(await provider.getListing('1')).toBeNull();
    });

    await it('meldet eine kaputte Kategorie über status(), statt beim Start zu sterben', async () => {
      const provider = createKleinanzeigenProvider({
        http: client({}, []),
        env: { TROEDLER_KLEINANZEIGEN_CATEGORY: 'gibtesnicht' },
        enabled: true,
      });
      const status = await provider.status();
      expect(status.configured).toBe(false);
      expect(status.problem?.message).toMatch(/Unbekannte/);
    });
  });
};
