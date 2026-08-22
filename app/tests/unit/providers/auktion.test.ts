/**
 * zoll-auktion.de and justiz-auktion.de.
 *
 * Every fixture is written by hand. None of it is a captured page: what is
 * reproduced is the STRUCTURE measured against both live sites on 2026-08-21 —
 * the `#za-search-result-list` wrapper, the `aria-label`ed detail list, the
 * `&shy;` inside the visible link text, the `<p>Keine Treffer.</p>` marker, the
 * `&period;`/`&comma;` entity soup Justiz-Auktion emits, and the two blocks
 * that name people and must therefore never reach a `Listing`.
 *
 * Each case asserts a value that only holds if the thing under test worked.
 * "It parsed something" is not a discriminator here: this adapter's signature
 * failure is a page that still has a results container after a redesign and
 * yields zero rows, which reads as "nothing on offer" and is never questioned.
 */

import { describe, expect, it } from '@gjsify/unit';
import { HttpClient, RateLimiter } from '@troedler/http';
import { ProviderError, type ProviderErrorKind } from '@troedler/core';
import {
  buildSearchUrl,
  createJustizAuktionProvider,
  createZollAuktionProvider,
  absoluteEndFrom,
  endsAtFrom,
  isoOffsetMinutes,
  parseBidAmount,
  parseJustizDetailPage,
  parseRemainingSeconds,
  parseZollDetailPage,
  parseZollSearchPage,
  splitGermanLocation,
} from '@troedler/auktion';

/** Pinned, because every end time in this package is "now plus a countdown". */
const NOW = new Date('2026-08-21T18:30:00+02:00');

function expectThrows(fn: () => unknown, kind: ProviderErrorKind): ProviderError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe(kind);
    return err as ProviderError;
  }
  throw new Error(`erwartet: ProviderError(${kind}) — es wurde nichts geworfen`);
}

async function expectRejects(promise: Promise<unknown>, kind: ProviderErrorKind): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe(kind);
    return err as ProviderError;
  }
  throw new Error(`erwartet: ProviderError(${kind}) — die Zusage wurde erfüllt`);
}

// ─── Zoll-Auktion: hand-written pages ─────────────────────────────────────

/**
 * One result card.
 *
 * The nesting is the measured one, including the two facts a naive fixture
 * would smooth over: the visible link text carries soft hyphens while the
 * `h4.sr-only` does not, and the "Nur Abholung möglich!" row is OMITTED rather
 * than negated for lots that ship.
 */
function zollCard(o: {
  id: string;
  title: string;
  price: string;
  place: string;
  remaining: string;
  bids: string;
  pickupOnly?: boolean;
  softTitle?: string;
}): string {
  const slug = o.title.replace(/[^A-Za-z0-9]+/g, '_');
  return `<li class="mb-2"><article class="row">
    <div class="col-6 col-md-4 col-lg-3">
      <h4 class="sr-only">${o.title}</h4>
      <a href="/auktion/produkt/${slug}/${o.id}" title="${o.title}">
        <img class="img-thumbnail" src="/auktion/bilder/${slug}/t_${o.id}_abc1234/${o.id}_Vorn.jpg"
             alt="Vorn" width="239" height="179" />
      </a>
    </div>
    <div class="pl-0 col-6 col-md-8 col-lg-9 d-flex flex-column">
      <div><div class="float-right">
        <form class="show_no_legend_infos d-inline" action="/bieterbereich/beobachtete_auktionen_verarbeitung.php" method="post">
          <input type="hidden" name="auktionen_id" value="${o.id}" />
        </form></div>
        <div class="kachel_auktion_link mb-2"><a href="/auktion/produkt/${slug}/${o.id}" title="${o.title}">${
          o.softTitle ?? o.title
        }\t</a></div>
        <ul class="fa-ul ml-3" aria-label="Auktionsdetails">
          <li class="small border-0 pb-0"><span class="fa-li"><span class="fa fa-map-marker-alt fa-fw" aria-label="Artikelstandort"></span></span> ${
            o.place
          }</li>
          ${
            o.pickupOnly === false
              ? ''
              : '<li class="small border-0 pb-0"><span class="fa-li"><span class="fas fa-dolly fa-fw" aria-label="Lieferinformationen"></span></span>Nur Abholung möglich!</li>'
          }
          <li class="small border-0 pb-0"><span class="fa-li"><span class="far fa-clock fa-fw" aria-label="Restlaufzeit"></span></span> ${
            o.remaining
          }</li>
          <li class="small border-0 pb-0"><span class="fa-li"><span class="fas fa-gavel" aria-label="Gebotsstatus"></span></span> ${
            o.bids
          }</li>
        </ul></div>
      <p class="text-right m-0 mt-auto"><span class="font-weight-bold">${o.price}</span></p>
    </div>
  </article></li>`;
}

function zollPage(o: { breadcrumb: string; body: string; next?: string | null }): string {
  const next =
    o.next === undefined ? '/auktion/auktionsuebersicht.php?n0=search&n2=rad&pagination=2' : o.next;
  return `<!DOCTYPE html><html lang="de"><head><title>Zoll-Auktion</title></head><body>
    <ol class="breadcrumb"><li class="breadcrumb-item"><a href="/auktion/index.php">Start</a></li>
      <li class="breadcrumb-item active">${o.breadcrumb}</li></ol>
    <div id="za-search-result-list" class="container ml-0 mr-0 pl-0 pr-0">${o.body}</div>
    ${next ? `<nav aria-label="Suchergebnis Paginierung"><a rel="next" href="${next}">weiter</a></nav>` : ''}
  </body></html>`;
}

const ZOLL_PAGE_1 = zollPage({
  breadcrumb: 'Auktionssuche: 83 Treffer',
  body: `<ul class="list-unstyled auktionen_kachel_list">${[
    zollCard({
      id: '974356',
      title: 'VW ID.7 Pro S',
      // The thousands dot: read the English way this is forty-one euros eighty-four.
      price: '41.840,00&nbsp;EUR',
      place: '50823 Köln',
      remaining: '1&nbsp;Tag 12&nbsp;Std. 55&nbsp;Min.',
      bids: '0 Gebote',
    }),
    zollCard({
      id: '971850',
      title: 'AMG E Bike U3 Klapprad',
      price: '410,00&nbsp;EUR',
      place: '33334 Gütersloh',
      remaining: 'noch 55&nbsp;Sekunden',
      bids: '20 Gebote',
      softTitle: 'AMG E Bike U3 Klapp&shy;rad',
    }),
    zollCard({
      id: '974602',
      title: 'Konvolut TT Modelleisenbahn',
      price: '150,00&nbsp;EUR',
      place: '02708 Löbau',
      remaining: 'noch 37&nbsp;Minuten',
      bids: '1 Gebot',
      pickupOnly: false,
    }),
  ].join('')}</ul>`,
});

const ZOLL_PAGE_2 = zollPage({
  breadcrumb: 'Auktionssuche: 83 Treffer',
  next: null,
  body: `<ul class="list-unstyled auktionen_kachel_list">${zollCard({
    id: '975754',
    title: 'Herren Crossrad CUBE',
    price: '135,00&nbsp;EUR',
    place: '60326 Frankfurt am Main',
    remaining: '2 Tage 17&nbsp;Std. 3&nbsp;Min.',
    bids: '15 Gebote',
  })}</ul>`,
});

/** The site's own zero-hit page: the container stays, the breadcrumb drops the count. */
const ZOLL_EMPTY = zollPage({ breadcrumb: 'Auktionssuche', next: null, body: '<p>Keine Treffer.</p>' });

/** Container intact, cards gone, and no "Keine Treffer" — a redesign, not a zero. */
const ZOLL_MOVED = zollPage({
  breadcrumb: 'Auktionssuche: 83 Treffer',
  next: null,
  body: '<ul class="list-unstyled auktionen_kachel_list"><li class="mb-2"><div class="row"><h4>VW ID.7</h4></div></li></ul>',
});

/** Cards intact, the product link renamed — the failure one level deeper. */
const ZOLL_RENAMED = zollPage({
  breadcrumb: 'Auktionssuche: 83 Treffer',
  next: null,
  body: '<ul class="list-unstyled auktionen_kachel_list"><li class="mb-2"><article class="row"><a href="/auktion/lot/x/974356">VW ID.7</a></article></li></ul>',
});

/**
 * A detail page.
 *
 * Carries the Ansprechpartner block on purpose: on the live site it sits on the
 * same page as the item text and names an official with a direct line and an
 * e-mail address. A fixture without it could not prove that the parser stays
 * out of it.
 */
const ZOLL_DETAIL = `<!DOCTYPE html><html lang="de"><head><title>x</title>
  <link rel="canonical" href="https://www.zoll-auktion.de/auktion/produkt/1_AMG_E_Bike_U3_Klapprad/971850" />
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","url":"https://www.zoll-auktion.de"}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"AMG - E Bike U3 Klapprad","sku":"971850",
    "offers":{"@type":"Offer","priceCurrency":"EUR","price":"410.00","availabilityStarts":"2026-07-27T09:00:00+02:00",
    "availableAtOrFrom":{"@type":"Place","address":{"@type":"PostalAddress","postalCode":"33334","addressLocality":"Gütersloh","addressCountry":"Deutschland"}}}}</script>
  </head><body>
  <div id="auk_carousel" class="carousel lazy">
    <div class="carousel-inner">
      <div class="carousel-item active"><a href="/auktion/bilder/1_AMG/971850_c243e35/971850_Vorn.jpg"><img src="/auktion/bilder/1_AMG/galerie_large_971850_c243e35/971850_Vorn.jpg" alt="Vorn" /></a></div>
      <div class="carousel-item"><a href="/auktion/bilder/1_AMG/971850_f86187b/971850_Hinten.jpg"><img src="/gui/images/ajax-loader.gif" alt="Hinten" /></a></div>
    </div>
  </div>
  <div id="auktionsinfobox" aria-live="polite">
    <div class="small">Auktions-ID: <span id="bilder_auktionen_id">971850</span> / Charge: ZA 1.2 22.57.02.17-15/26</div>
    <h4 id="ueberschrift_auktion">1 AMG - E Bike U3 Klapprad</h4>
    <dl class="row">
      <dt class="col-4">Auktionsende:</dt><dd class="col-8" id="auktions_ende">So., 23.08.2026 - 09:00 Uhr</dd>
      <dt class="col-4">verbleibende Zeit:</dt><dd class="col-8" id="verbleibende_zeit">1&nbsp;Tag 14&nbsp;Std. 38&nbsp;Min.</dd>
    </dl>
    <div id="gebotsinfo_box">
      <span id="hoechstgebot" class="h4 font-weight-bold">410,00&nbsp;EUR</span>
      <span id="anz_gebote_gesamt"><a id="historylink" href="/auktion/auktion_gebotsverlauf.php?id=971850"><span id="anz_gebote_zahl">20</span> <span id="anz_gebote_text">Gebote</span></a></span>
    </div>
    <dl class="row">
      <dt class="col-4">Anbieter:</dt><dd class="col-8"><a href="/auktion/anbieter/Kreispolizeibehoerde/1131">Der Landrat als Kreispolizeibehörde Gütersloh</a></dd>
      <dt class="col-4">Ort:</dt><dd class="col-8">33334 Gütersloh</dd>
      <dt class="col-4">Abholung:</dt><dd class="col-8">Ja</dd>
      <dt class="col-4">Versand:</dt><dd class="col-8">Nein</dd>
      <dt class="col-4">Zahlungsart:</dt><dd class="col-8">Überweisung</dd>
    </dl>
  </div>
  <section><h4>Gegenstandsbeschreibung</h4>
    <div id="gegenstandsbeschreibung"><p>Hersteller: AMG</p><p>Reifengröße: 16 Zoll</p>
      <p>Nur Abholung - kein Versand. Rückfragen an 05241 869 2238 oder rad@example.org.</p></div>
  </section>
  <section><h4>Besichtigung, Abholung, Versand, Zahlung</h4>
    <dl class="row">
      <dt class="col-5">Straße:</dt><dd class="col-7">Herzebrocker Str. 142</dd>
      <dt class="col-5">PLZ / Ort:</dt><dd class="col-7">33334 Gütersloh</dd>
      <dt class="col-5">Ansprechpartner:</dt><dd class="col-7">D. Wesselmann<br />Telefon: 05241 869 2238<br />E-Mail: <a href="mailto:d.wesselmann@example.org">d.wesselmann@example.org</a></dd>
    </dl>
  </section>
</body></html>`;

/**
 * The same page with the shipping row as Zoll-Auktion really prints it.
 *
 * The DTO, the source record and the only fixture all said this row reads
 * `Ja` / `Nein`. It was inferred from the `Abholung:` row above it and never
 * measured. The page prints `Nein` — or a destination with the flat rate, and
 * `/ja/i` matches neither, so `ships` was permanently false and every lot that
 * ships was reported as collection-only.
 */
const ZOLL_DETAIL_SHIPS = ZOLL_DETAIL.replace(
  '<dt class="col-4">Versand:</dt><dd class="col-8">Nein</dd>',
  '<dt class="col-4">Versand:</dt><dd class="col-8">Deutschland (10,00 EUR)</dd>',
);

// ─── Justiz-Auktion: hand-written pages ───────────────────────────────────

/**
 * A detail page, with the entity soup the live site really emits — `&period;`,
 * `&comma;`, `&colon;`, `&lowbar;`, `&NewLine;` — and both blocks that name
 * someone: the selling court and the masked high bidder.
 */
const JUSTIZ_DETAIL = `<!DOCTYPE html><html lang="de"><head><title>Justiz-Auktion</title>
  <link rel="canonical" href="https://www.justiz-auktion.de/2-Notebooks-Lifebook-Fujitsu-E546-211622" />
  <script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"3 Notebooks Lifebook Fujitsu U759"}</script>
  </head><body><main>
  <h3 id="zuordnung">Auktion #211751</h3>
  <div class="swiper-wrapper">
    <div class="swiper-slide"><img src="uplimg/mb7295&lowbar;00b45&lowbar;pic1w&period;jpg" class="auctionImg" alt="Notebook"></div>
    <div class="swiper-slide"><img src="uplimg/mb7295&lowbar;c7647&lowbar;pic2w&period;jpg" class="auctionImg" alt="R&uuml;ckseite"></div>
  </div>
  <h2 class="auktionstitel">3 Notebooks Lifebook Fujitsu U759 u&period;a&period;</h2>
  <span class="land clearfix"><img src="images/deutschland.png" alt="Deutschland Fahne"/></span>
  <div id="auk_id" class="clearfix">Auktion ID<span>211751</span></div>
  <dl class="geb_top clearfix">
    <dt>Startgebot:</dt><dd>20,00 &euro;</dd>
    <dt>Aktuelles Gebot:</dt><dd class="aktuell">0,00 &euro;</dd>
  </dl>
  <dl id="geb_uebersicht" class="pull-right">
    <dt>H&ouml;chstbietender</dt><dd>g**o**1</dd>
    <dt>Anzahl Gebote</dt><dd>0</dd>
    <dt>Anzahl Klicks</dt><dd>66</dd>
  </dl>
  <article class="mobile_only" id="artbeschr"><h3>Artikelbeschreibung</h3>
    <p>Zustand&colon; Gebraucht<p>
    <p>Sie bieten auf 3 St&uuml;ck Notebook Fujitsu Limited&comma; Modell U759&period;</p>
    <p>R&uuml;ckfragen unter 0231 1234567&period;</p>
  </article>
  <dl id="auk_uebersicht">
    <dt>Auktion endet in</dt><dd class="bold">24 Tage, 1 Stunde, 31 Minuten</dd>
    <dt>Endet am:</dt><dd>14.09.2026 20&colon;00&colon;00</dd>
    <dt>Artikelstandort:</dt><dd>58097 Hagen</dd>
    <dt>Bundesland:</dt><dd>Nordrhein-Westfalen</dd>
    <dt>Verk&auml;ufer:</dt><dd><span><a href="seller-7295">Landgericht Hagen</a></span></dd>
    <dt>Versandart:</dt><dd>Selbstabholung</dd>
    <dt>Bezahlung:</dt><dd>Vorkasse durch Bank&uuml;berweisung</dd>
  </dl>
  </main></body></html>`;

/** The 404 page: same chrome, no lot. */
const JUSTIZ_404 = `<!DOCTYPE html><html><head><title>Fehler</title></head><body><main>
  <h3 id="zuordnung">Error 404</h3><p>Die Auktion wurde nicht gefunden.</p></main></body></html>`;

// ─── HTTP doubles ─────────────────────────────────────────────────────────

/** Both robots.txt bodies as served on 2026-08-21. */
const ROBOTS: Record<string, string> = {
  'www.zoll-auktion.de': 'User-agent: *\nAllow: /\n\nSitemap: https://www.zoll-auktion.de/sitemap.xml',
  // The empty `Disallow:` is the interesting half: read as a rule it would ban
  // every path on the site.
  'www.justiz-auktion.de':
    'User-agent: *\nDisallow:\nSitemap: https://www.justiz-auktion.de/sitemap-auktionen.php\nSitemap: https://www.justiz-auktion.de/sitemap.php',
};

interface Call {
  readonly url: string;
}

function fakeFetch(pages: Record<string, string>, calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') {
      const body = ROBOTS[parsed.host];
      return new Response(body ?? '', { status: body ? 200 : 404 });
    }
    calls.push({ url });
    const body = pages[parsed.pathname + parsed.search] ?? pages[parsed.pathname];
    if (body === undefined) return new Response('nicht gefunden', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

function client(pages: Record<string, string>, calls: Call[]): HttpClient {
  return new HttpClient({
    version: '0.0.0-test',
    limiter: new RateLimiter({ sleep: async () => {} }),
    fetchImpl: fakeFetch(pages, calls),
  });
}

function zollProvider(pages: Record<string, string>, calls: Call[] = [], enabled = true) {
  return createZollAuktionProvider({ http: client(pages, calls), env: {}, enabled, now: () => NOW });
}

function justizProvider(pages: Record<string, string>, calls: Call[] = [], enabled = true) {
  return createJustizAuktionProvider({ http: client(pages, calls), env: {}, enabled, now: () => NOW });
}

const SEARCH = '/auktion/auktionsuebersicht.php';

export default async () => {
  await describe('auktion: Restlaufzeit', async () => {
    await it('liest alle vier Schreibweisen, die die beiden Seiten drucken', async () => {
      // Measured 2026-08-21; each line is a form one of the two sites emits.
      expect(parseRemainingSeconds('noch 55 Sekunden')).toBe(55);
      expect(parseRemainingSeconds('noch 37 Minuten')).toBe(37 * 60);
      expect(parseRemainingSeconds('noch 23 Std. 40 Min.')).toBe(23 * 3600 + 40 * 60);
      expect(parseRemainingSeconds('1 Tag 12 Std. 55 Min.')).toBe(86400 + 12 * 3600 + 55 * 60);
      expect(parseRemainingSeconds('2 Tage 17 Std. 3 Min.')).toBe(2 * 86400 + 17 * 3600 + 3 * 60);
      expect(parseRemainingSeconds('Restzeit: 3 T, 1 Std, 47 Min')).toBe(3 * 86400 + 3600 + 47 * 60);
      expect(parseRemainingSeconds('24 Tage, 1 Stunde, 31 Minuten')).toBe(24 * 86400 + 3600 + 31 * 60);
    });

    await it('hält "Std." und "Sekunden" auseinander, obwohl beide mit S beginnen', async () => {
      expect(parseRemainingSeconds('2 Std.')).toBe(7200);
      expect(parseRemainingSeconds('2 Sekunden')).toBe(2);
      expect(parseRemainingSeconds('2 Std. 2 Sek.')).toBe(7202);
    });

    await it('meldet "nicht lesbar" statt "0 Sekunden"', async () => {
      // A countdown that stopped parsing must not look like an auction ending
      // this instant — that is a bid decision made on a parser bug.
      expect(parseRemainingSeconds('beendet')).toBeNull();
      expect(parseRemainingSeconds('')).toBeNull();
      expect(parseRemainingSeconds(null)).toBeNull();
      expect(parseRemainingSeconds('0 Min.')).toBe(0);
    });

    await it('rechnet den Countdown gegen die übergebene Uhr, nicht gegen die Ortszeit', async () => {
      // The countdown path stays for a page without JSON-LD; where the offset
      // IS readable, `absoluteEndFrom` wins — see the detail tests.
      expect(endsAtFrom('1 Tag 14 Std. 38 Min.', NOW)).toBe('2026-08-23T07:08:00.000Z');
      expect(endsAtFrom('noch 55 Sekunden', NOW)).toBe('2026-08-21T16:30:55.000Z');
      expect(endsAtFrom('beendet', NOW)).toBeNull();
    });

    await it('rundet auf die Körnung, in der der Countdown gedruckt wurde', async () => {
      // The countdown is FLOORED: measured against the server clock, a page
      // reading `noch 3 Std. 9 Min.` had 3 h 09 min 49 s left. Taken at face
      // value the end lands up to a minute early, and our clock is read after
      // the response, which shifts it again the other way — 21 seconds of
      // spread across four runs on a value the source keeps constant.
      const odd = new Date('2026-08-21T16:30:37.000Z');
      expect(endsAtFrom('37 Minuten', odd)).toBe('2026-08-21T17:08:00.000Z');
      // Seconds granularity is already exact and must NOT be rounded to a
      // minute — that would move the value by up to 30 s in the one case where
      // the source was precise.
      expect(endsAtFrom('noch 55 Sekunden', odd)).toBe('2026-08-21T16:31:32.000Z');
    });

    await it('nimmt den Offset aus dem Dokument, statt die Zone zu raten', async () => {
      expect(isoOffsetMinutes('2026-07-27T09:00:00+02:00')).toBe(120);
      expect(isoOffsetMinutes('2026-01-27T09:00:00Z')).toBe(0);
      expect(isoOffsetMinutes('2026-01-27T09:00:00')).toBeNull();
      // Without an offset there is no answer — and no fallback to the local
      // clock, which is the assumption this whole path exists to avoid.
      expect(absoluteEndFrom('So., 23.08.2026 - 09:00 Uhr', null)).toBeNull();
      expect(absoluteEndFrom('So., 23.08.2026 - 09:00 Uhr', 120)).toBe('2026-08-23T07:00:00.000Z');
      expect(absoluteEndFrom('So., 23.08.2026 - 09:00 Uhr', 60)).toBe('2026-08-23T08:00:00.000Z');
      expect(absoluteEndFrom('irgendwas', 120)).toBeNull();
    });
  });

  await describe('auktion: Beträge und Orte', async () => {
    await it('hält die Entfernung aus dem Ortsnamen heraus und behält sie', async () => {
      // On a radius search the site appends its own distance to the location:
      // `60320 Frankfurt am Main (ca. 4 km)`. Left in place it made the city
      // useless for any cross-provider comparison AND threw away a distance the
      // source had computed, while `distanceKm` — which exists for exactly this
      // — stayed null. Nothing is computed here; this reads a printed number.
      const near = splitGermanLocation('60320 Frankfurt am Main (ca. 4 km)', null);
      expect(near.postalCode).toBe('60320');
      expect(near.city).toBe('Frankfurt am Main');
      expect(near.distanceKm).toBe(4);

      // Without the suffix nothing changes, and no distance is invented.
      const plain = splitGermanLocation('33334 Gütersloh', 'Deutschland');
      expect(plain.city).toBe('Gütersloh');
      expect(plain.distanceKm).toBeNull();

      // A comma decimal, as German pages print it.
      expect(splitGermanLocation('60320 Frankfurt (ca. 12,5 km)', null).distanceKm).toBe(12.5);
    });

    await it('liest den Tausenderpunkt deutsch, nicht englisch', async () => {
      // 41.840,00 read the English way is 41,84 € — which sorts to the top of a
      // price-ascending search and looks like the bargain of the year.
      expect(parseBidAmount('41.840,00 EUR')?.minor).toBe(4184000);
      expect(parseBidAmount('410,00 EUR')?.minor).toBe(41000);
      expect(parseBidAmount('20,00 €')?.minor).toBe(2000);
      expect(parseBidAmount('13,00 EUR')?.currency).toBe('EUR');
      expect(parseBidAmount('—')).toBeNull();
    });

    await it('trennt Postleitzahl und Ort, auch vierstellig für Österreich', async () => {
      expect(splitGermanLocation('33334 Gütersloh', 'Deutschland').postalCode).toBe('33334');
      expect(splitGermanLocation('33334 Gütersloh', 'Deutschland').city).toBe('Gütersloh');
      expect(splitGermanLocation('1220 Wien', 'Österreich').postalCode).toBe('1220');
      expect(splitGermanLocation('60326 Frankfurt am Main', null).city).toBe('Frankfurt am Main');
      // Never invented: no geocoder in this project, so no distance.
      expect(splitGermanLocation('33334 Gütersloh', null).distanceKm).toBeNull();
    });
  });

  await describe('zoll-auktion: URL-Grammatik', async () => {
    await it('setzt genau die Felder, die das Formular kennt', async () => {
      const built = buildSearchUrl({ text: 'fahrrad' }, 1);
      expect(built.url).toBe(`https://www.zoll-auktion.de${SEARCH}?n0=search&n2=fahrrad`);
      expect(built.applied).toStrictEqual([]);
    });

    await it('schiebt Preis, Umkreis, Lieferart und Sortierung serverseitig durch', async () => {
      const built = buildSearchUrl(
        {
          text: 'uhr',
          minPriceMinor: 1000,
          maxPriceMinor: 10000,
          postalCode: '30159',
          radiusKm: 50,
          delivery: 'pickup',
          sort: 'price-asc',
        },
        1,
      );
      expect(built.url).toContain('n8=10');
      expect(built.url).toContain('n7=100');
      expect(built.url).toContain('n6=30159');
      expect(built.url).toContain('n4=2');
      expect(built.url).toContain('n5%5B%5D=a');
      expect(built.url).toContain('s=11');
      expect(built.applied).toStrictEqual(['minPrice', 'maxPrice', 'radius', 'delivery', 'sort']);
      expect(built.warnings).toStrictEqual([]);
    });

    await it('rundet krumme Preisgrenzen nach AUSSEN und meldet sie dann nicht als erfüllt', async () => {
      // Rounding a ceiling down would drop rows the user wanted, and claiming
      // the filter was applied would stop the kernel from finishing the job.
      const built = buildSearchUrl({ text: 'x', minPriceMinor: 1050, maxPriceMinor: 12550 }, 1);
      expect(built.url).toContain('n8=10');
      expect(built.url).toContain('n7=126');
      expect(built.applied).toStrictEqual([]);
    });

    await it('rundet den Umkreis auf die nächste Stufe und sagt es', async () => {
      const built = buildSearchUrl({ text: 'x', postalCode: '30159', radiusKm: 30 }, 1);
      expect(built.url).toContain('n4=2');
      expect(built.applied).toStrictEqual([]);
      expect(built.warnings.length).toBe(1);
      expect(built.warnings[0]).toContain('50 km');

      const far = buildSearchUrl({ text: 'x', postalCode: '30159', radiusKm: 900 }, 1);
      expect(far.url).toContain('n4=6');
      expect(far.applied).toStrictEqual([]);
    });

    await it('behauptet keine Relevanzsortierung, die das Formular nicht hat', async () => {
      // Unsorted the site answers "Auktionsende aufsteigend". Listing
      // `relevance` here would put that claim into `--explain`.
      const provider = zollProvider({});
      expect(provider.capabilities.serverSorts.includes('relevance')).toBe(false);
      expect(provider.capabilities.serverSorts.includes('ending-soonest')).toBe(true);
    });

    await it('kennt die Sortierwerte des Formulars und nur die', async () => {
      expect(buildSearchUrl({ text: 'x', sort: 'ending-soonest' }, 1).url).toContain('s=12');
      expect(buildSearchUrl({ text: 'x', sort: 'price-desc' }, 1).url).toContain('s=21');
      expect(buildSearchUrl({ text: 'x', sort: 'newest' }, 1).url).toContain('s=24');
      const relevance = buildSearchUrl({ text: 'x', sort: 'relevance' }, 1);
      expect(relevance.url).not.toContain('s=');
      expect(relevance.applied).toStrictEqual([]);
    });

    await it('hängt die Seite als pagination an, nicht als offset', async () => {
      expect(buildSearchUrl({ text: 'rad' }, 1).url).not.toContain('pagination');
      expect(buildSearchUrl({ text: 'rad' }, 3).url).toContain('pagination=3');
    });
  });

  await describe('zoll-auktion: Trefferseite', async () => {
    await it('liest jede Kachel über ihre Barrierefreiheits-Namen aus', async () => {
      const page = parseZollSearchPage(ZOLL_PAGE_1, 'zoll-auktion');
      expect(page.cards.length).toBe(3);
      expect(page.totalEstimate).toBe(83);
      expect(page.hasNextPage).toBe(true);

      const [vw, bike, bahn] = page.cards;
      expect(vw.id).toBe('974356');
      expect(vw.priceText).toBe('41.840,00 EUR');
      expect(vw.locationText).toBe('50823 Köln');
      expect(vw.bidsText).toBe('0 Gebote');
      expect(bike.remainingText).toBe('noch 55 Sekunden');
      // The badge is present for pickup-only lots and simply absent otherwise.
      expect(bike.deliveryText).toBe('Nur Abholung möglich!');
      expect(bahn.deliveryText).toBeNull();
    });

    await it('nimmt den Titel aus der sr-only-Überschrift, nicht aus dem Linktext', async () => {
      // The visible link carries soft hyphens; they would survive into the DTO
      // and break every later comparison on the title.
      const page = parseZollSearchPage(ZOLL_PAGE_1, 'zoll-auktion');
      expect(page.cards[1].title).toBe('AMG E Bike U3 Klapprad');
      expect(page.cards[1].title.includes('\u00AD')).toBe(false);
    });

    await it('zieht die sr-only-Überschrift dem title-Attribut vor', async () => {
      // Constructed to pull the two sources apart, which the live page keeps
      // identical. Without a difference the precedence is untestable — and an
      // untested precedence is one somebody reorders during a cleanup.
      const divergent = zollPage({
        breadcrumb: 'Auktionssuche: 1 Treffer',
        next: null,
        body: `<ul class="list-unstyled auktionen_kachel_list"><li class="mb-2"><article class="row">
          <h4 class="sr-only">Barrierefreier Titel</h4>
          <a href="/auktion/produkt/x/1" title="Titel-Attribut"><img src="/auktion/bilder/x/t_1_a/1.jpg" /></a>
          <ul class="fa-ul" aria-label="Auktionsdetails"></ul>
        </article></li></ul>`,
      });
      expect(parseZollSearchPage(divergent, 'zoll-auktion').cards[0].title).toBe('Barrierefreier Titel');

      const noHeading = divergent.replace('<h4 class="sr-only">Barrierefreier Titel</h4>', '');
      expect(parseZollSearchPage(noHeading, 'zoll-auktion').cards[0].title).toBe('Titel-Attribut');
    });

    await it('meldet "keine Treffer" als leere Liste, nicht als Fehler', async () => {
      const page = parseZollSearchPage(ZOLL_EMPTY, 'zoll-auktion');
      expect(page.cards).toStrictEqual([]);
      expect(page.totalEstimate).toBeNull();
      expect(page.hasNextPage).toBe(false);
    });

    await it('wirft parse-failed, wenn die Liste da ist und der Hinweis fehlt', async () => {
      // The expensive failure: a redesign leaves the container standing, the
      // cards are gone, and "0 Treffer" is a perfectly believable answer.
      const err = expectThrows(() => parseZollSearchPage(ZOLL_MOVED, 'zoll-auktion'), 'parse-failed');
      expect(err.message).toContain('Keine Treffer');
    });

    await it('wirft parse-failed, wenn die Kacheln stehen und keine lesbar ist', async () => {
      const err = expectThrows(() => parseZollSearchPage(ZOLL_RENAMED, 'zoll-auktion'), 'parse-failed');
      expect(err.message).toContain('keine einzige lesbar');
    });

    await it('wirft parse-failed, wenn der Ergebnisbereich ganz fehlt', async () => {
      expectThrows(
        () => parseZollSearchPage('<html><body><p>Wartung</p></body></html>', 'zoll-auktion'),
        'parse-failed',
      );
    });
  });

  await describe('zoll-auktion: Suche', async () => {
    await it('blättert bis zum Limit und meldet Zahl, Rest und Kosten', async () => {
      const calls: Call[] = [];
      const provider = zollProvider(
        {
          [`${SEARCH}?n0=search&n2=rad`]: ZOLL_PAGE_1,
          [`${SEARCH}?n0=search&n2=rad&pagination=2`]: ZOLL_PAGE_2,
        },
        calls,
      );
      const result = await provider.search({ text: 'rad', limit: 20 });

      expect(result.listings.length).toBe(4);
      expect(result.requests).toBe(2);
      expect(calls.length).toBe(2);
      expect(result.totalEstimate).toBe(83);
      // 83 on offer, four in hand: saying otherwise would make the client-side
      // filters look like they had searched the whole inventory.
      expect(result.truncated).toBe(true);
    });

    await it('macht aus einer Kachel eine vollständige Auktions-Zeile', async () => {
      const provider = zollProvider({ [`${SEARCH}?n0=search&n2=rad`]: ZOLL_PAGE_1 });
      const [vw, bike, bahn] = (await provider.search({ text: 'rad', limit: 3 })).listings;

      expect(vw.key).toBe('zoll-auktion:974356');
      expect(vw.price?.minor).toBe(4184000);
      expect(vw.priceKind).toBe('auction');
      expect(vw.bidCount).toBe(0);
      expect(vw.endsAt).toBe('2026-08-23T05:25:00.000Z');
      expect(vw.location.postalCode).toBe('50823');
      expect(vw.url).toBe('https://www.zoll-auktion.de/auktion/produkt/VW_ID_7_Pro_S/974356');
      // A public office, never a person — and the DTO has nowhere to put one.
      expect(vw.sellerType).toBe('commercial');
      // Unknown, not guessed from the title.
      expect(vw.condition).toBe('unknown');
      // The card carries no item text at all.
      expect(vw.description).toBeNull();
      // Unknown postage must stay unknown; `0` would mean free.
      expect(vw.shippingCost).toBeNull();
      expect(vw.totalPrice).toBeNull();

      expect(bike.delivery).toBe('pickup');
      // No badge is NOT a claim. Measured on `n2=uhr`, the operator's own
      // collection filter returns 1 056 of 1 086 lots, so for 30 of them the
      // source says collection is impossible — and none of those carries a
      // badge. `both` asserted collection for exactly those thirty.
      expect(bahn.delivery).toBe('unknown');
      expect(bike.bidCount).toBe(20);
    });

    await it('verlinkt die größte Bildvariante — und nur eine je Foto', async () => {
      // Measured on one photo: t_ 17 KB, the carousel's own link 180 KB,
      // galerie_ 77 KB, galerie_large_ 191 KB. Padding the list with three
      // sizes of the same picture would make `images.length` mean "Varianten"
      // here and "Fotos" everywhere else.
      const provider = zollProvider({ [`${SEARCH}?n0=search&n2=rad`]: ZOLL_PAGE_1 });
      const [vw] = (await provider.search({ text: 'rad', limit: 1 })).listings;
      expect(vw.images.length).toBe(1);
      expect(vw.images[0]).toBe(
        'https://www.zoll-auktion.de/auktion/bilder/VW_ID_7_Pro_S/galerie_large_974356_abc1234/974356_Vorn.jpg',
      );
    });

    await it('bringt jede Variante auf dieselbe Adresse, damit beide Seitenarten vergleichbar sind', async () => {
      // The result card links `t_…`, the detail page's carousel the bare
      // `<id>_<hash>`. Without one shape the same photo has two URLs and
      // nothing downstream can tell that it is the same photo.
      const provider = zollProvider({ '/auktion/produkt/x/971850': ZOLL_DETAIL });
      const listing = await provider.getListing?.('971850');
      expect(listing?.images.length).toBe(2);
      expect(listing?.images[0]).toBe(
        'https://www.zoll-auktion.de/auktion/bilder/1_AMG/galerie_large_971850_c243e35/971850_Vorn.jpg',
      );
      expect(listing?.images[1]).toContain('/galerie_large_971850_f86187b/');
    });

    await it('gibt eine echte Null-Treffer-Suche als leere, nicht abgeschnittene Liste zurück', async () => {
      const provider = zollProvider({ [`${SEARCH}?n0=search&n2=gibtesnicht`]: ZOLL_EMPTY });
      const result = await provider.search({ text: 'gibtesnicht' });
      expect(result.listings).toStrictEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.totalEstimate).toBeNull();
    });

    await it('lässt einen Layoutwechsel als Fehler durch, nicht als leeres Ergebnis', async () => {
      const provider = zollProvider({ [`${SEARCH}?n0=search&n2=rad`]: ZOLL_MOVED });
      await expectRejects(provider.search({ text: 'rad' }), 'parse-failed');
    });

    await it('meldet sich als nicht aktiviert und kommt gar nicht erst ans Netz', async () => {
      const calls: Call[] = [];
      const provider = zollProvider({ [`${SEARCH}?n0=search&n2=rad`]: ZOLL_PAGE_1 }, calls, false);
      const status = await provider.status();
      expect(status.configured).toBe(false);
      expect(status.problem?.kind).toBe('not-configured');
      await expectRejects(provider.search({ text: 'rad' }), 'blocked-by-policy');
      expect(calls.length).toBe(0);
    });
  });

  await describe('zoll-auktion: Detailseite', async () => {
    await it('liest Preis, Gebote, Start, Land und Lieferart aus der Infobox', async () => {
      const raw = parseZollDetailPage(ZOLL_DETAIL);
      expect(raw?.id).toBe('971850');
      expect(raw?.priceText).toBe('410,00 EUR');
      expect(raw?.bidsText).toBe('20');
      expect(raw?.pickupText).toBe('Ja');
      expect(raw?.shippingText).toBe('Nein');
      expect(raw?.locationText).toBe('33334 Gütersloh');
      // The one field taken from JSON-LD, because it carries a real UTC offset.
      expect(raw?.startsAtIso).toBe('2026-07-27T09:00:00+02:00');
      expect(raw?.country).toBe('Deutschland');
    });

    await it('holt keinen einzigen Wert aus dem Ansprechpartner-Block', async () => {
      // The block sits on the same page and names an official with a direct
      // line. The parser never walks it, which is why nothing has to be
      // deleted afterwards.
      const raw = parseZollDetailPage(ZOLL_DETAIL);
      const serialised = JSON.stringify(raw);
      expect(serialised.includes('Wesselmann')).toBe(false);
      expect(serialised.includes('Herzebrocker')).toBe(false);
      expect(raw?.description?.includes('Reifengröße')).toBe(true);
    });

    await it('streicht Telefon und E-Mail auch aus der Gegenstandsbeschreibung', async () => {
      const provider = zollProvider({ '/auktion/produkt/x/971850': ZOLL_DETAIL });
      const listing = await provider.getListing?.('971850');
      expect(listing?.description?.includes('05241')).toBe(false);
      expect(listing?.description?.includes('example.org')).toBe(false);
      expect(listing?.description?.includes('Hersteller: AMG')).toBe(true);
    });

    await it('gibt die kanonische URL zurück, nicht die angefragte', async () => {
      const provider = zollProvider({ '/auktion/produkt/x/971850': ZOLL_DETAIL });
      const listing = await provider.getListing?.('971850');
      expect(listing?.url).toBe(
        'https://www.zoll-auktion.de/auktion/produkt/1_AMG_E_Bike_U3_Klapprad/971850',
      );
      expect(listing?.listedAt).toBe('2026-07-27T07:00:00.000Z');
      // `So., 23.08.2026 - 09:00 Uhr` at the +02:00 the JSON-LD carries — the
      // page's own answer, identical on every run. The countdown in the same
      // fixture would land on 07:08, and against a live page it drifted across
      // a 21-second spread on a value the source keeps constant.
      expect(listing?.endsAt).toBe('2026-08-23T07:00:00.000Z');
      expect(listing?.delivery).toBe('pickup');
    });

    await it('liest den Versand so, wie die Seite ihn druckt — nicht als Ja/Nein', async () => {
      // The discriminator: with `/ja/i` this stays `pickup`, which is what it
      // did for every shipping lot on the live site.
      const provider = zollProvider({ '/auktion/produkt/x/971850': ZOLL_DETAIL_SHIPS });
      const listing = await provider.getListing?.('971850');
      expect(listing?.delivery).toBe('both');
      // The quoted rate is real money. Dropped, a 100-€ lot plus 10 € postage
      // ranked below a 105-€ collection-only lot under every price order.
      expect(listing?.shippingCost?.minor).toBe(1000);
      expect(listing?.totalPrice?.minor).toBe(42000);
    });

    await it('macht aus "Nein" keine Versandkosten und keinen Endpreis', async () => {
      const provider = zollProvider({ '/auktion/produkt/x/971850': ZOLL_DETAIL });
      const listing = await provider.getListing?.('971850');
      expect(listing?.shippingCost).toBeNull();
      // `null`, never 0 — free postage and unknown postage are different facts.
      expect(listing?.totalPrice).toBeNull();
    });

    await it('meldet eine verschwundene Auktion als null, nicht als Fehler', async () => {
      const provider = zollProvider({});
      expect(await provider.getListing?.('1')).toBeNull();
    });
  });

  await describe('justiz-auktion: durchsucht nicht, und sagt warum', async () => {
    await it('meldet die Sperre über status(), damit die Suche sie als "übersprungen" zeigt', async () => {
      const status = await justizProvider({}).status();
      expect(status.configured).toBe(true);
      expect(status.problem?.kind).toBe('blocked-by-policy');
      expect(status.problem?.message).toContain('POST');
      expect(status.problem?.message).toContain('Sitzung');
    });

    await it('wirft, statt eine leere Liste zurückzugeben', async () => {
      // An empty result here would be the exact lie the port forbids: it is
      // indistinguishable from "die Justiz versteigert gerade nichts".
      await expectRejects(justizProvider({}).search({ text: 'fahrrad' }), 'blocked-by-policy');
    });

    await it('führt keine serverseitigen Filter und keine Trefferzahl ins Feld', async () => {
      const caps = justizProvider({}).capabilities;
      expect(caps.serverFilters).toStrictEqual([]);
      expect(caps.serverSorts).toStrictEqual([]);
      // Not 50: `providers show` must not promise rows that never arrive.
      expect(caps.maxResults).toBe(0);
      expect(caps.cache.memoryOnly).toBe(true);
    });
  });

  await describe('justiz-auktion: Einzelabruf', async () => {
    await it('holt eine Auktion allein über die ID, ohne Slug', async () => {
      const calls: Call[] = [];
      const provider = justizProvider({ '/auktion-211751': JUSTIZ_DETAIL }, calls);
      const listing = await provider.getListing?.('211751');
      expect(calls[0].url).toBe('https://www.justiz-auktion.de/auktion-211751');
      expect(listing?.key).toBe('justiz-auktion:211751');
      // Entities decoded rather than carried through: the live page writes
      // `u&period;a&period;` where a browser shows "u.a.".
      expect(listing?.title).toBe('3 Notebooks Lifebook Fujitsu U759 u.a.');
    });

    await it('nimmt das Startgebot, solange "Aktuelles Gebot" noch 0,00 € ist', async () => {
      // A 0 € "current bid" is a placeholder. Passed on, it sorts to the top of
      // a price-ascending search and reads as a giveaway.
      const provider = justizProvider({ '/auktion-211751': JUSTIZ_DETAIL });
      const listing = await provider.getListing?.('211751');
      expect(listing?.price?.minor).toBe(2000);
      expect(listing?.priceKind).toBe('auction');
      expect(listing?.bidCount).toBe(0);
    });

    await it('übernimmt Zustand, Ort, Land und Lieferart wie gedruckt', async () => {
      const provider = justizProvider({ '/auktion-211751': JUSTIZ_DETAIL });
      const listing = await provider.getListing?.('211751');
      expect(listing?.conditionRaw).toBe('Gebraucht');
      expect(listing?.condition).toBe('used-good');
      expect(listing?.location.postalCode).toBe('58097');
      expect(listing?.location.city).toBe('Hagen');
      expect(listing?.location.country).toBe('Deutschland');
      // Single-valued here, unlike Zoll-Auktion's badge — so it is not widened.
      expect(listing?.delivery).toBe('pickup');
      expect(listing?.endsAt).toBe('2026-09-14T18:01:00.000Z');
      expect(listing?.images[0]).toBe('https://www.justiz-auktion.de/uplimg/mb7295_00b45_pic1w.jpg');
    });

    await it('trägt weder das versteigernde Gericht noch den Höchstbietenden mit', async () => {
      const provider = justizProvider({ '/auktion-211751': JUSTIZ_DETAIL });
      const listing = await provider.getListing?.('211751');
      const serialised = JSON.stringify(listing);
      expect(serialised.includes('Landgericht')).toBe(false);
      expect(serialised.includes('g**o**1')).toBe(false);
      expect(listing?.sellerType).toBe('commercial');
      // …and the phone number in the item text is gone at parse time.
      expect(listing?.description?.includes('0231')).toBe(false);
      expect(listing?.description?.includes('Fujitsu Limited')).toBe(true);
    });

    await it('baut die URL nicht aus dem canonical der Seite', async () => {
      // Measured 2026-08-21: on lot 211751 the canonical pointed at 211622.
      // A URL taken from it would send the reader to a different auction.
      const provider = justizProvider({ '/auktion-211751': JUSTIZ_DETAIL });
      const listing = await provider.getListing?.('211751');
      expect(listing?.url).toBe('https://www.justiz-auktion.de/auktion-211751');
      expect(listing?.url.includes('211622')).toBe(false);
    });

    await it('erkennt die Fehlerseite, die mit HTTP 200 kommt', async () => {
      expect(parseJustizDetailPage(JUSTIZ_404)).toBeNull();
      const provider = justizProvider({ '/auktion-999999': JUSTIZ_404 });
      expect(await provider.getListing?.('999999')).toBeNull();
    });

    await it('meldet eine unbekannte ID (HTTP 404) als null', async () => {
      expect(await justizProvider({}).getListing?.('999999')).toBeNull();
    });

    await it('kommt am leeren "Disallow:" der robots.txt vorbei', async () => {
      // Read as a rule rather than as "nothing is disallowed", the empty value
      // would ban every path on the host — and this provider would go dark
      // without anyone noticing why.
      const http = client({ '/auktion-211751': JUSTIZ_DETAIL }, []);
      const robots = await http.robotsFor('www.justiz-auktion.de');
      expect(robots?.sitemaps.length).toBe(2);
      expect(robots?.groups[0].rules).toStrictEqual([]);
    });
  });
};
