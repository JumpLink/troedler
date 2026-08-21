/**
 * markt.de and Quoka adapters.
 *
 * Every fixture below is written by hand. None of it is a copy of a real page:
 * markt.de's terms forbid reproducing ad content outright, Quoka's permit only
 * personal use, and a checked-in copy of somebody's ad would breach both. What
 * the fixtures do carry is the STRUCTURE measured against the live sites on
 * 2026-08-21 — the `>`-nested result block and the `clsy-more-results`
 * recommendation section, the `data-articleid=""` on Quoka's zero-hit
 * suggestions, the space-grouped `2 099 EUR`, the `Heute, vor 3 Min.` wording,
 * the avatar URL that is the only private/commercial marker on a markt.de row.
 *
 * Each case asserts a value that only holds when the thing under test worked.
 * "It did not throw" is not a discriminator here: both of these sources answer
 * a zero-hit query with HTTP 200 and a full page of unrelated ads, so the
 * signature failure is a run that succeeds and returns the wrong twenty rows.
 * Half the tests below exist to make that failure impossible to pass.
 */

import { describe, expect, it } from '@gjsify/unit';
import { MARKETPLACE_TIME_ZONE, ProviderError } from '@troedler/core';
import { HttpClient, RateLimiter } from '@troedler/http';
import {
  MARKT_RADIUS_STEPS,
  buildMarktSearchUrl,
  buildQuokaSearchUrl,
  createMarktDeProvider,
  createQuokaProvider,
  germanizeAmount,
  marktKeywordPath,
  marktRadiusStep,
  marktScopeFromEnv,
  parseMarktSearchPage,
  parseQuokaSearchPage,
  quokaCategoryFromEnv,
  quokaIdFromUrl,
  quokaPlace,
  type MarktScope,
} from '@troedler/markt';

/** Pinned so „Heute", „gestern" and „vor 3 Min." mean something a test can name. */
const NOW = new Date('2026-08-21T18:30:00+02:00');
const NO_SCOPE: MarktScope = { region: null, category: null };

/**
 * The wall clock the SITE printed, read back in the site's own timezone.
 *
 * Not `date.getHours()`: that reads the reader's zone, so "heute 17:52" asserted as `h === 17`
 * held on a Berlin laptop and failed in CI — while agreeing with an implementation that never
 * did any zone arithmetic at all. What these tests mean is "the page said 17:52 and we kept
 * that meaning", and this is how to say it.
 */
function local(iso: string | null): { d: number; m: number; y: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKETPLACE_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso ?? ''));
  const read = (type: string): number =>
    Number.parseInt(parts.find((x) => x.type === type)?.value ?? 'x', 10);
  return { d: read('day'), m: read('month') - 1, y: read('year'), h: read('hour') % 24, min: read('minute') };
}

// ---------------------------------------------------------------------------
// markt.de fixtures
// ---------------------------------------------------------------------------

interface MarktAdOptions {
  id: string;
  title: string;
  amount?: string;
  label?: string;
  place?: string;
  distance?: string;
  date?: string;
  description?: string;
  /** `private` | `business` | `none` — the avatar is the only marker on a row. */
  seller?: 'private' | 'business' | 'none';
  /** Affiliate inventory: title is a POST button, so there is no `<a href>`. */
  partner?: boolean;
}

function marktAvatar(seller: MarktAdOptions['seller']): string {
  if (seller === 'none') return '';
  const src =
    seller === 'business'
      ? 'https://static.markt.de/bundles/x/image/markt/userprofile/default_business.svg'
      : 'https://static.markt.de/bundles/x/image/markt/userprofile/default_private.svg';
  return `<div class="clsy-c-user" title="Basis Mitglied"><img class="clsy-c-user__profile-image" src="${src}" alt=""></div>`;
}

function marktAd(options: MarktAdOptions): string {
  const title = options.title;
  const heading = options.partner
    ? `<button type="submit" form="prg_form" role="link" data-targeturl="EpFPH8ZMdummy">${title}</button>`
    : `<a href="https://www.markt.de/ein-slug/a/${options.id}/?geoUrlId=deutschland" class="clsy-c-result-list-item__link clsy-truncate-multi">${title}</a>`;
  const price =
    options.label === undefined && options.amount === undefined
      ? ''
      : `<div class="clsy-c-result-list-item__price">
           <div class="clsy-c-result-list-item__price-amount">${options.amount ?? ''}</div>
           <div class="clsy-c-result-list-item__price-label">${options.label ?? ''}</div>
         </div>`;
  return `
    <li class="clsy-c-result-list-item" data-onclick-url="/ein-slug/a/${options.id}/?keywords=testrad&amp;rView=list&amp;absIndex=1&amp;geoUrlId=deutschland" title="${title}" id="markt_result_${options.id}">
      <div class="clsy-c-result-list-item__thumbnail">
        <img src="https://img.example/${options.id}/260x340/image"
             srcset="https://img.example/${options.id}/130x170/image 130w, https://img.example/${options.id}/260x340/image 260w"
             class="clsy-c-result-list-item__thumbnail-img" width="130" height="170" alt="${title}">
      </div>
      <div class="clsy-c-result-list-item__content">
        <div class="clsy-c-result-list-item__content-top">
          <div class="clsy-c-result-list-item__content-top-left">
            <div class="clsy-c-result-list-item__date">${options.date ?? 'Heute, 16:51'}</div>
            ${options.partner ? '<div class="clsy-c-result-list-item__partner">Partner-Anzeige</div>' : ''}
          </div>
          <h2 class="clsy-c-result-list-item__title">${heading}</h2>
        </div>
        <div class="clsy-c-result-list-item__content-bottom">
          <div class="clsy-c-result-list-item__content-bottom-left">
            <div class="clsy-c-result-list-item__description clsy-truncate-multi">${options.description ?? 'Guter Zustand.'}</div>
            ${price}
            <div class="clsy-c-result-list-item__location clsy-truncate-one">${options.place ?? '22083 Hamburg'}${options.distance ? `<span>${options.distance}</span>` : ''}</div>
          </div>
          <div class="clsy-c-result-list-item__content-bottom-right">${marktAvatar(options.seller)}</div>
        </div>
      </div>
    </li>`;
}

/**
 * The recommendation block markt.de shows under a zero-hit search.
 *
 * Structurally identical rows, one level deeper. Present in EVERY fixture,
 * including the ones with hits, so that a selector that stopped anchoring on
 * `.clsy-c-search__blocks-results > ul` would fail loudly instead of returning
 * three extra ads nobody notices.
 */
const MARKT_RECOMMENDATIONS = `
  <div class="clsy-more-results">
    <section class="clsy-more-results__alternative-results clsy-contentsection">
      <ul class="clsy-c-result-list">
        ${marktAd({ id: '99999991', title: 'Empfehlung eins' })}
        ${marktAd({ id: '99999992', title: 'Empfehlung zwei' })}
        ${marktAd({ id: '99999993', title: 'Empfehlung drei' })}
      </ul>
    </section>
  </div>`;

function marktPage(options: {
  count: string;
  headline?: string;
  rows: string;
  next?: string | null;
}): string {
  const next = options.next === undefined ? 'https://www.markt.de/suche/testrad/?page=2' : options.next;
  return `<!DOCTYPE html><html lang="de"><head><title>Test</title>
    ${next ? `<link href="${next}" rel="next">` : ''}
    </head><body>
    <button class="clsy-c-search-menu__submit" type="button">Suchen (${options.count})</button>
    <main class="clsy-search"><div class="clsy-c-search"><div class="clsy-c-search__blocks">
      <div class="clsy-c-search__top-info">
        <span class="clsy-c-search__top-info-resultcount">${options.headline ?? options.count}</span>
      </div>
      <div class="clsy-c-search__blocks-results">
        <ul class="clsy-c-result-list">${options.rows}</ul>
        ${MARKT_RECOMMENDATIONS}
      </div>
    </div></div></main>
  </body></html>`;
}

const MARKT_FULL = marktPage({
  count: '9.933 Treffer',
  headline: 'über 1.000 Treffer',
  rows: [
    marktAd({
      id: '11111111',
      title: 'Herrenrad 28 Zoll',
      amount: '3.550 €',
      label: 'VB',
      place: '22083 Hamburg',
      date: 'Heute, 16:51',
      description: 'Guter Zustand. Erreichbar unter 0176 1234567 oder rad@example.org.',
      seller: 'private',
    }),
    marktAd({
      id: '22222222',
      title: 'Kinderrad',
      amount: '',
      label: 'Zu verschenken',
      place: '83627 Warngau',
      date: 'Heute, vor 3 Min.',
      seller: 'business',
    }),
    marktAd({
      id: '33333333',
      title: 'Zwei-Zimmer-Wohnung',
      amount: '2.040,00 €',
      label: 'Nettokaltmiete',
      place: '1010 Wien',
      date: '15.08.2026',
      seller: 'none',
    }),
    marktAd({
      id: '44444444',
      title: 'Industriemechaniker (m/w/d)',
      place: '',
      date: 'Gestern, 23:03',
      partner: true,
      seller: 'none',
    }),
    marktAd({
      id: '55555555',
      title: 'Damenrad',
      amount: '1.200 €',
      label: 'Festpreis',
      place: '30966 Hemmingen (Niedersachsen)',
      distance: '12 km',
      date: 'Gestern, 08:20',
      seller: 'private',
    }),
  ].join(''),
});

/** "0 Treffer" — and three recommendation ads underneath, exactly as the site does it. */
const MARKT_EMPTY = marktPage({ count: '0 Treffer', rows: '', next: null });

/** The count says there are hits; the row container was renamed. */
const MARKT_MOVED = `<!DOCTYPE html><html><head><title>x</title></head><body>
  <button class="clsy-c-search-menu__submit">Suchen (9.933 Treffer)</button>
  <div class="clsy-c-search__blocks-results"><ul class="result-cards"><li class="result-card">Herrenrad</li></ul></div>
</body></html>`;

// ---------------------------------------------------------------------------
// Quoka fixtures
// ---------------------------------------------------------------------------

interface QuokaAdOptions {
  id: string;
  title: string;
  price?: string;
  oldPrice?: string;
  place?: string;
  date?: string;
  description?: string;
  /** The zero-hit page's suggestions carry an EMPTY one. That is the discriminator. */
  articleId?: string;
}

function quokaAd(options: QuokaAdOptions): string {
  const href = `https://www.quoka.de/anzeigen/sport-wellness/fahrraeder/anzeige/ein-slug/${options.id}.html`;
  const priceBlock =
    options.price === undefined
      ? ''
      : options.oldPrice
        ? `<span class="article-price"><span class="new-price">${options.price}</span><span class="old-price">${options.oldPrice}</span></span>`
        : `<span class="article-price">${options.price}</span>`;
  return `
    <div class="article-item " data-articleid="${options.articleId ?? `GUID-${options.id}`}"
         onclick="javascript:window.location.href='${href}'" location="${options.id}" data-phencrypted="OBFUSCATED-PHONE-4711">
      <div class="article-txt-wrap"><div class="article-txt"><div class="article-content-wrap">
        <div class="art-img">
          <a href="${href}"><img src="https://s3.quoka.de/quoka/top/${options.id}.webp" alt="${options.title}" width="200" height="200"></a>
          <div class="article-img-count-wrap"><span class="article-img-count"><span class="article-img-count-number">2</span></span></div>
        </div>
        <div class="article-content">
          <h2 class="article-title"><a href="${href}">${options.title}</a></h2>
          <p class="article-description">${options.description ?? 'Nur Abholung.'}</p>
          <p class="article-short-info article-lbl article-short-info-empty"><span class="article-lbl-txt"></span></p>
          <p class="article-location"><span>${options.place ?? '73728 Esslingen, Baden-Württemberg'}</span></p>
          <p class="article-date"><span>${options.date ?? 'heute 17:52'}</span></p>
          <div class="article-info"><span class="article-lbl">${priceBlock}</span></div>
        </div>
      </div></div></div>
    </div>`;
}

function quokaPage(options: {
  count: number | null;
  rows: string;
  next?: string | null;
  noResults?: boolean;
}): string {
  const next = options.next === undefined ? 'https://www.quoka.de/anzeigen/?q=testrad&pag=2' : options.next;
  return `<!DOCTYPE html><html lang="de"><head><title>Test</title></head><body>
    ${options.noResults ? '<div class="no-result">Für die angegebenen Suchkriterien wurden keine Ergebnisse gefunden</div>' : ''}
    <div class="searchresult"><div class="article-list">${options.rows}</div></div>
    <ul class="pagination radius">
      <li class="arrow unavailable"><span class="pagination-arrow">&lsaquo;</span></li>
      <li class="current"><a href="https://www.quoka.de/anzeigen/?q=testrad">1</a></li>
      ${next ? `<li class="arrow"><a href="${next}">&rsaquo;</a></li>` : ''}
    </ul>
    ${options.count === null ? '' : `<script type="text/javascript">\n    var resultscount = ${options.count};\n  </script>`}
  </body></html>`;
}

const QUOKA_FULL = quokaPage({
  count: 3521,
  rows: [
    quokaAd({
      id: 'aaaa1111',
      title: 'Herrenrad 28 Zoll',
      price: '2 099 EUR',
      place: '80801 München, Bayern',
      date: 'heute 17:52',
      description: 'Sehr gepflegt. Tel. 0176 1234567, rad@example.org.',
    }),
    quokaAd({
      id: 'bbbb2222',
      title: 'Sattel',
      price: '1400.0 EUR',
      place: '10115 Berlin - Kreuzberg',
      date: 'gestern 22:35',
    }),
    quokaAd({
      id: 'cccc3333',
      title: 'Schlauch',
      price: '8,5 EUR',
      place: '76133 Karlsruhe - Grötzingen, Baden-Württemberg',
      date: '21 Juli',
    }),
    quokaAd({ id: 'dddd4444', title: 'Fahrradhelm', price: 'zu verschenken', date: '15 Dezember' }),
    quokaAd({ id: 'eeee5555', title: 'Luftpumpe', price: '29.0 EUR', oldPrice: '30.0 EUR' }),
    quokaAd({ id: 'ffff6666', title: 'Fahrrad' }),
  ].join(''),
});

/** `resultscount = 0` — and six suggestions inside the very same `.article-list`. */
const QUOKA_EMPTY = quokaPage({
  count: 0,
  noResults: true,
  next: null,
  rows: [
    quokaAd({
      id: 'zzzz0001',
      title: 'Bulthaup Küche',
      articleId: '',
      place: 'Karlsruhe, Baden-Württemberg',
    }),
    quokaAd({ id: 'zzzz0002', title: 'Sofa', articleId: '', place: 'Augsburg, Bayern' }),
  ].join(''),
});

/** The count says there are hits; every row lost its `data-articleid`. */
const QUOKA_MOVED = quokaPage({
  count: 3521,
  rows: [quokaAd({ id: 'aaaa1111', title: 'Herrenrad', articleId: '' })].join(''),
});

// ---------------------------------------------------------------------------
// Test rig
// ---------------------------------------------------------------------------

/** The real `*` group of markt.de, verbatim, so the gate is genuinely exercised. */
const MARKT_ROBOTS = `Sitemap: https://www.markt.de/sitemap_index.xml

User-Agent: *
Disallow: *.ajx
Disallow: */shop.htm
Disallow: *ajaxCall
Disallow: /admin/
Disallow: */kartensuche.htm
Disallow: /*?*contactFlow=

User-Agent: ClaudeBot
Disallow:
Crawl-delay: 1
`;

/** The real `*` group of Quoka: `Allow: /` plus the LEGACY paths it still blocks. */
const QUOKA_ROBOTS = `User-agent: ClaudeBot
Allow: /

User-agent: *
Allow: /
Disallow: /Suchergebnis/
Disallow: /Detailansicht/
Disallow: /Suchen/
Disallow: /ajax/
Disallow: /qs/
`;

interface Call {
  readonly url: string;
}

function fakeFetch(pages: Record<string, string>, calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url });
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') {
      return new Response(parsed.host === 'www.quoka.de' ? QUOKA_ROBOTS : MARKT_ROBOTS, { status: 200 });
    }
    const body = pages[parsed.pathname + parsed.search];
    if (body === undefined) return new Response('nope', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

function client(pages: Record<string, string>, calls: Call[]): HttpClient {
  return new HttpClient({
    version: '0.0.0-test',
    // No real seconds spent proving a gap was kept — that is the limiter's own test.
    limiter: new RateLimiter({ sleep: async () => {} }),
    fetchImpl: fakeFetch(pages, calls),
  });
}

export default async () => {
  await describe('markt.de: URL-Grammatik', async () => {
    await it('baut das Stichwort so, wie markt.de selbst umleitet', async () => {
      // Measured: /suche.htm?keywords=… 301s to exactly these paths. Building
      // the canonical form saves the redirect AND means the URL the robots gate
      // inspects is the URL that gets fetched.
      expect(marktKeywordPath('damen fahrrad')).toBe('damen+fahrrad');
      expect(marktKeywordPath('Nähmaschine Bernina')).toBe('n%C3%A4hmaschine+bernina');
      // Transliterating searches a different word — `naehmaschine` is not `nähmaschine`.
      expect(marktKeywordPath('Küchenmaschine')).toBe('k%C3%BCchenmaschine');
      // A slash in the term must not become a path segment.
      expect(marktKeywordPath('28"/zoll')).toBe('28%22%2Fzoll');
    });

    await it('verweigert die Suche ohne Suchbegriff', async () => {
      expect(() => marktKeywordPath('   ')).toThrow(/Suchbegriff/);
    });

    await it('rastet den Umkreis auf die Stufen der Seite ein und meldet das', async () => {
      expect(MARKT_RADIUS_STEPS[0]).toBe(0);
      expect(marktRadiusStep(25)).toBe(25);
      expect(marktRadiusStep(37)).toBe(50);
      expect(marktRadiusStep(9999)).toBe(250);

      const exact = buildMarktSearchUrl({ text: 'rad', postalCode: '30966', radiusKm: 25 }, NO_SCOPE, 1);
      expect(exact.url).toBe('https://www.markt.de/30966/suche/rad/?radius=25');
      expect(exact.applied).toEqualArray(['radius']);
      expect(exact.warnings).toHaveLength(0);

      const snapped = buildMarktSearchUrl({ text: 'rad', postalCode: '30966', radiusKm: 37 }, NO_SCOPE, 1);
      expect(snapped.url).toBe('https://www.markt.de/30966/suche/rad/?radius=50');
      // Widened, so the kernel still has to narrow — claiming `radius` here
      // would tell it not to bother and let 13 extra kilometres ride along.
      expect(snapped.applied).toHaveLength(0);
      expect(snapped.warnings[0]).toMatch(/50 km statt 37 km/);
    });

    await it('kennt genau die zwei Sortierungen, die als URL existieren', async () => {
      expect(buildMarktSearchUrl({ text: 'rad', sort: 'price-asc' }, NO_SCOPE, 1).url).toMatch(
        /\?sorting=price$/,
      );
      expect(buildMarktSearchUrl({ text: 'rad', sort: 'price-desc' }, NO_SCOPE, 1).url).toMatch(
        /sorting=-price/,
      );
      // "Neueste Anzeigen" IS the bare URL — the selected option carries no parameter.
      const newest = buildMarktSearchUrl({ text: 'rad', sort: 'newest' }, NO_SCOPE, 1);
      expect(newest.url).toBe('https://www.markt.de/suche/rad/');
      expect(newest.applied).toEqualArray(['sort']);
      // Relevance is not a thing this source can be asked for.
      expect(buildMarktSearchUrl({ text: 'rad', sort: 'relevance' }, NO_SCOPE, 1).applied).toHaveLength(0);
      expect(buildMarktSearchUrl({ text: 'rad', sort: 'ending-soonest' }, NO_SCOPE, 1).applied).toHaveLength(
        0,
      );
    });

    await it('paginiert über ?page= und nutzt Kategorie ODER Ort, nie beides', async () => {
      expect(buildMarktSearchUrl({ text: 'rad' }, NO_SCOPE, 3).url).toBe(
        'https://www.markt.de/suche/rad/?page=3',
      );
      expect(buildMarktSearchUrl({ text: 'rad' }, { region: null, category: 'haus-garten' }, 1).url).toBe(
        'https://www.markt.de/haus-garten/suche/rad/',
      );

      // Measured, and both orderings fail SILENTLY: /haus-garten/30966/… 301s to
      // the homepage, /30966/haus-garten/… answers "0 Treffer". So the geo wins
      // and the dropped category is reported instead of quietly producing one
      // of those two.
      const clash = buildMarktSearchUrl(
        { text: 'rad', postalCode: '30966', radiusKm: 25 },
        { region: null, category: 'haus-garten' },
        1,
      );
      expect(clash.url).toBe('https://www.markt.de/30966/suche/rad/?radius=25');
      expect(clash.warnings.some((w) => w.includes('haus-garten'))).toBe(true);
    });

    await it('prüft die Umgebungsvariablen und meldet Unsinn, statt bundesweit zu suchen', async () => {
      expect(marktScopeFromEnv({}).region).toBeNull();
      expect(marktScopeFromEnv({ TROEDLER_MARKT_REGION: 'Berlin' }).region).toBe('berlin');
      expect(marktScopeFromEnv({ TROEDLER_MARKT_CATEGORY: '/haus-garten/' }).category).toBe('haus-garten');
      expect(() => marktScopeFromEnv({ TROEDLER_MARKT_REGION: 'Berlin, Mitte' })).toThrow(
        /TROEDLER_MARKT_REGION/,
      );
      expect(() => marktScopeFromEnv({ TROEDLER_MARKT_CATEGORY: 'haus garten!' })).toThrow(
        /TROEDLER_MARKT_CATEGORY/,
      );
    });
  });

  await describe('markt.de: Trefferliste parsen', async () => {
    await it('liest jedes Feld einer Anzeige', async () => {
      const parsed = parseMarktSearchPage(MARKT_FULL, { now: NOW });
      const first = parsed.listings[0];

      expect(parsed.listings).toHaveLength(5);
      expect(first.key).toBe('markt-de:11111111');
      expect(first.id).toBe('11111111');
      expect(first.title).toBe('Herrenrad 28 Zoll');
      // The tracking query (`?geoUrlId=…`) is stripped: two searches must not
      // produce two different URLs for one ad.
      expect(first.url).toBe('https://www.markt.de/ein-slug/a/11111111/');
      expect(first.price?.minor).toBe(355000);
      expect(first.priceKind).toBe('negotiable');
      expect(first.sellerType).toBe('private');
      // Largest first: the 260 px variant out of the srcset, not the 130 px `src`.
      expect(first.images[0]).toBe('https://img.example/11111111/260x340/image');
      expect(first.location.postalCode).toBe('22083');
      expect(first.location.city).toBe('Hamburg');
      expect(first.location.country).toBe('DE');
      // No condition field exists on a result page, and reading one out of the
      // title is how the kernel's condition filter starts acting on fiction.
      expect(first.condition).toBe('unknown');
      expect(first.conditionRaw).toBeNull();
      // Postage is never printed here; `null` means unknown, not free.
      expect(first.shippingCost).toBeNull();
      expect(first.delivery).toBe('unknown');
      expect(parsed.totalEstimate).toBe(9933);
    });

    await it('wirft Telefonnummer und E-Mail beim Parsen weg, nicht später', async () => {
      const first = parseMarktSearchPage(MARKT_FULL, { now: NOW }).listings[0];
      expect(first.description).toMatch(/Guter Zustand/);
      expect(first.description?.includes('0176')).toBe(false);
      expect(first.description?.includes('@example.org')).toBe(false);
    });

    await it('nimmt den Verkäufer nirgends mit, liest aber privat/gewerblich aus dem Avatar', async () => {
      const listings = parseMarktSearchPage(MARKT_FULL, { now: NOW }).listings;
      expect(listings[0].sellerType).toBe('private');
      expect(listings[1].sellerType).toBe('commercial');
      // No avatar at all means unknown, never a guess.
      expect(listings[2].sellerType).toBe('unknown');
      // The avatar URL identifies a person as surely as a name — it must not
      // survive into the row.
      expect(JSON.stringify(listings).includes('userprofile')).toBe(false);
    });

    await it('rechnet alle vier Datumsschreibweisen dieser Seite aus', async () => {
      const listings = parseMarktSearchPage(MARKT_FULL, { now: NOW }).listings;

      // "Heute, vor 3 Min." — the trap. `parseGermanDate` alone would take its
      // today-branch, find no HH:MM and return today at 00:00, i.e. up to
      // eighteen hours early on the very freshest ads.
      expect(listings[1].listedAt).toBe(new Date(NOW.getTime() - 3 * 60_000).toISOString());
      expect(listings[1].listedAt).not.toBe(null);

      const heute = local(listings[0].listedAt);
      expect(heute.d).toBe(21);
      expect(heute.h).toBe(16);
      expect(heute.min).toBe(51);

      const gestern = local(listings[4].listedAt);
      expect(gestern.d).toBe(20);
      expect(gestern.h).toBe(8);
      expect(gestern.min).toBe(20);

      const absolut = local(listings[2].listedAt);
      expect(absolut.d).toBe(15);
      expect(absolut.m).toBe(7);
      expect(absolut.y).toBe(2026);
    });

    await it('liest VB, Festpreis, „Zu verschenken" und einen Mietpreis', async () => {
      const listings = parseMarktSearchPage(MARKT_FULL, { now: NOW }).listings;
      // A giveaway prints an EMPTY amount and puts the word in the label.
      expect(listings[1].price?.minor).toBe(0);
      expect(listings[1].priceKind).toBe('free');
      expect(listings[2].price?.minor).toBe(204000);
      expect(listings[2].priceKind).toBe('fixed');
      expect(listings[4].price?.minor).toBe(120000);
      expect(listings[4].priceKind).toBe('fixed');
      // A partner ad without a price block: unknown, not zero.
      expect(listings[3].price).toBeNull();
      expect(listings[3].priceKind).toBe('unknown');
    });

    await it('trennt die Entfernung vom Ortsnamen und rät kein Land', async () => {
      const listings = parseMarktSearchPage(MARKT_FULL, { now: NOW }).listings;
      // The distance is a <span> INSIDE the location node, so the collapsed
      // text reads "…(Niedersachsen)12 km" with no separator at all.
      expect(listings[4].location.city).toBe('Hemmingen (Niedersachsen)');
      expect(listings[4].location.distanceKm).toBe(12);
      expect(listings[0].location.distanceKm).toBeNull();
      // Four digits is Austria or Switzerland and we cannot tell which.
      expect(listings[2].location.postalCode).toBe('1010');
      expect(listings[2].location.country).toBeNull();
    });

    await it('behält Partner-Anzeigen, zählt sie und markiert sie gewerblich', async () => {
      const parsed = parseMarktSearchPage(MARKT_FULL, { now: NOW });
      const partner = parsed.listings[3];
      expect(parsed.partnerAds).toBe(1);
      expect(partner.id).toBe('44444444');
      // Its title is a POST button, so the URL has to come off `data-onclick-url`.
      expect(partner.url).toBe('https://www.markt.de/ein-slug/a/44444444/');
      expect(partner.title).toBe('Industriemechaniker (m/w/d)');
      expect(partner.sellerType).toBe('commercial');
    });

    await it('lässt den Empfehlungsblock nicht als Treffer durch', async () => {
      // THE discriminator for this source. Every fixture carries three
      // recommendation ads one level below the result block; a selector that
      // stopped anchoring on `.clsy-c-search__blocks-results > ul` would return
      // them and nobody would notice.
      const parsed = parseMarktSearchPage(MARKT_FULL, { now: NOW });
      expect(parsed.seen).toBe(5);
      expect(parsed.listings.map((l) => l.id)).toEqualArray([
        '11111111',
        '22222222',
        '33333333',
        '44444444',
        '55555555',
      ]);
      expect(parsed.listings.some((l) => l.title.startsWith('Empfehlung'))).toBe(false);
    });

    await it('warnt, wenn nur die gedeckelte Trefferzahl zu haben ist', async () => {
      const parsed = parseMarktSearchPage(MARKT_FULL, { now: NOW });
      expect(parsed.totalEstimate).toBe(9933);
      const capped = parseMarktSearchPage(MARKT_FULL.replace('Suchen (9.933 Treffer)', 'Suchen'), {
        now: NOW,
      });
      expect(capped.totalEstimate).toBe(1000);
      expect(capped.warnings[0]).toMatch(/Untergrenze/);
    });
  });

  await describe('markt.de: leer heißt leer, kaputt heißt kaputt', async () => {
    await it('nimmt „0 Treffer" als echte Null — samt Empfehlungen daneben', async () => {
      const parsed = parseMarktSearchPage(MARKT_EMPTY, { now: NOW });
      expect(parsed.listings).toHaveLength(0);
      expect(parsed.totalEstimate).toBe(0);
      expect(parsed.nextUrl).toBeNull();
    });

    await it('wirft parse-failed, wenn Treffer gemeldet sind und keine Zeile passt', async () => {
      let caught: ProviderError | null = null;
      try {
        parseMarktSearchPage(MARKT_MOVED, { now: NOW });
      } catch (err) {
        caught = err as ProviderError;
      }
      expect(caught).toBeInstanceOf(ProviderError);
      expect(caught?.kind).toBe('parse-failed');
      expect(caught?.message).toMatch(/9933 Treffer/);
    });

    await it('wirft parse-failed bei einer ganz fremden Seite', async () => {
      // The measured case: /haus-garten/30966/suche/… 301s to the HOMEPAGE,
      // which is a valid 200 with no result block at all.
      let kind: string | null = null;
      try {
        parseMarktSearchPage('<html><body><h1>markt.de</h1></body></html>', { now: NOW });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('parse-failed');
    });
  });

  await describe('Quoka: URL-Grammatik', async () => {
    await it('baut die Suche über ?q= und paginiert über &pag=', async () => {
      expect(buildQuokaSearchUrl({ text: 'testrad' }, null, 1).url).toBe(
        'https://www.quoka.de/anzeigen/?q=testrad',
      );
      expect(buildQuokaSearchUrl({ text: 'testrad' }, null, 3).url).toBe(
        'https://www.quoka.de/anzeigen/?q=testrad&pag=3',
      );
      expect(buildQuokaSearchUrl({ text: '' }, 'elektronik/computer', 1).url).toBe(
        'https://www.quoka.de/anzeigen/elektronik/computer/',
      );
    });

    await it('schiebt privat/gewerblich an den Server — als einzigen echten Filter', async () => {
      const privat = buildQuokaSearchUrl({ text: 'rad', sellerType: 'private' }, null, 1);
      expect(privat.url).toMatch(/commercial=false/);
      expect(privat.applied).toEqualArray(['sellerType']);
      // The parser stamps this onto every row: under `commercial=false` the
      // page is private by construction, which is a fact about the request.
      expect(privat.sellerType).toBe('private');
      expect(buildQuokaSearchUrl({ text: 'rad', sellerType: 'commercial' }, null, 1).url).toMatch(
        /commercial=true/,
      );
      expect(buildQuokaSearchUrl({ text: 'rad' }, null, 1).sellerType).toBe('unknown');
    });

    await it('baut die zwei Parameter NICHT, die live nichts tun', async () => {
      // Measured: `&order=priceasc` returns the identical 20 rows in the
      // identical order, and `&Zip=30966&Area=25` answers "keine Ergebnisse"
      // with six suggestions. A radius that silently returns nothing is the
      // worst outcome available here, so neither goes into a URL.
      const url = buildQuokaSearchUrl(
        { text: 'rad', postalCode: '30966', radiusKm: 25, sort: 'price-asc' },
        null,
        1,
      );
      expect(url.url).toBe('https://www.quoka.de/anzeigen/?q=rad');
      expect(url.applied).toHaveLength(0);
      expect(url.warnings[0]).toMatch(/sortiert nur nach Datum/);
      // The default order IS newest — measured across four pages of one query.
      expect(buildQuokaSearchUrl({ text: 'rad', sort: 'newest' }, null, 1).applied).toEqualArray(['sort']);
    });

    await it('verweigert eine Suche ohne Begriff und ohne Kategorie', async () => {
      expect(() => buildQuokaSearchUrl({ text: '  ' }, null, 1)).toThrow(/Suchbegriff/);
      expect(() => quokaCategoryFromEnv({ TROEDLER_QUOKA_CATEGORY: 'Haus & Garten' })).toThrow(
        /TROEDLER_QUOKA_CATEGORY/,
      );
      expect(quokaCategoryFromEnv({ TROEDLER_QUOKA_CATEGORY: '/Elektronik/Computer/' })).toBe(
        'elektronik/computer',
      );
    });
  });

  await describe('Quoka: Trefferliste parsen', async () => {
    await it('liest jedes Feld einer Anzeige', async () => {
      const parsed = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' });
      const first = parsed.listings[0];

      expect(parsed.listings).toHaveLength(6);
      expect(first.key).toBe('quoka:aaaa1111');
      expect(first.id).toBe('aaaa1111');
      expect(first.title).toBe('Herrenrad 28 Zoll');
      expect(first.url).toBe(
        'https://www.quoka.de/anzeigen/sport-wellness/fahrraeder/anzeige/ein-slug/aaaa1111.html',
      );
      expect(first.images[0]).toBe('https://s3.quoka.de/quoka/top/aaaa1111.webp');
      expect(first.location.postalCode).toBe('80801');
      expect(first.location.city).toBe('München');
      expect(first.condition).toBe('unknown');
      expect(first.delivery).toBe('unknown');
      expect(parsed.totalEstimate).toBe(3521);
      expect(parsed.nextUrl).toBe('https://www.quoka.de/anzeigen/?q=testrad&pag=2');
    });

    await it('liest Quokas Zahlenformat, statt es deutsch zu lesen', async () => {
      // The whole reason `germanizeAmount` exists. Read raw, `2 099 EUR` is
      // 2,00 € to core's German parser and `1400.0 EUR` is 140,00 € — both land
      // at the top of a price-ascending search looking like a bargain.
      const listings = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' }).listings;
      expect(listings[0].price?.minor).toBe(209900);
      expect(listings[1].price?.minor).toBe(140000);
      expect(listings[2].price?.minor).toBe(850);
      expect(listings[3].price?.minor).toBe(0);
      expect(listings[3].priceKind).toBe('free');
      // A reduced price: the current figure, never the struck-through one, and
      // never the two concatenated into "29.030.0".
      expect(listings[4].price?.minor).toBe(2900);
      // No price block at all is unknown, not zero.
      expect(listings[5].price).toBeNull();
      expect(listings[5].priceKind).toBe('unknown');

      expect(germanizeAmount('2 099 EUR')).toBe('2.099 EUR');
      expect(germanizeAmount('9999.9 EUR')).toBe('9.999,9 EUR');
      expect(germanizeAmount('60 EUR')).toBe('60 EUR');
      expect(germanizeAmount('zu verschenken')).toBe('zu verschenken');
    });

    await it('rechnet „heute", „gestern" und den Monatsnamen ohne Jahr aus', async () => {
      const listings = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' }).listings;

      const heute = local(listings[0].listedAt);
      expect(heute.d).toBe(21);
      expect(heute.h).toBe(17);
      expect(heute.min).toBe(52);

      const gestern = local(listings[1].listedAt);
      expect(gestern.d).toBe(20);
      expect(gestern.h).toBe(22);

      // "21 Juli" — every ad older than two days carries this form, and core
      // knows nothing about it. Leaving it null would blank the date on most of
      // the inventory past page three.
      const juli = local(listings[2].listedAt);
      expect(juli.d).toBe(21);
      expect(juli.m).toBe(6);
      expect(juli.y).toBe(2026);

      // "15 Dezember" on 21 August is LAST December. Assuming the current year
      // would post-date the ad into the future, where a --since filter keeps it
      // for ever.
      const dezember = local(listings[3].listedAt);
      expect(dezember.m).toBe(11);
      expect(dezember.y).toBe(2025);
    });

    await it('lässt das Bundesland weg und behält den Ortsteil', async () => {
      const listings = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' }).listings;
      expect(listings[1].location.city).toBe('Berlin - Kreuzberg');
      expect(listings[2].location.city).toBe('Karlsruhe - Grötzingen');
      expect(quokaPlace('73728 Esslingen, Baden-Württemberg')).toBe('73728 Esslingen');
      expect(quokaPlace('10115 Berlin - Kreuzberg')).toBe('10115 Berlin - Kreuzberg');
      expect(quokaIdFromUrl('https://www.quoka.de/anzeigen/x/anzeige/y/abc123.html')).toBe('abc123');
      expect(quokaIdFromUrl('https://www.quoka.de/anzeigen/?q=rad')).toBeNull();
    });

    await it('übernimmt den Anbietertyp aus der Anfrage, nicht aus der Zeile', async () => {
      const listings = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'private' }).listings;
      expect(listings.every((l) => l.sellerType === 'private')).toBe(true);
      const neutral = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' }).listings;
      expect(neutral.every((l) => l.sellerType === 'unknown')).toBe(true);
    });

    await it('wirft Kontaktdaten weg — auch die verschlüsselte Telefonnummer der Zeile', async () => {
      const first = parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' }).listings[0];
      expect(first.description).toMatch(/Sehr gepflegt/);
      expect(first.description?.includes('0176')).toBe(false);
      expect(first.description?.includes('@example.org')).toBe(false);
      // `data-phencrypted` sits on every real row. There is no selector for it
      // and there will not be one.
      const dump = JSON.stringify(parseQuokaSearchPage(QUOKA_FULL, { now: NOW, sellerType: 'unknown' }));
      expect(dump.includes('OBFUSCATED-PHONE')).toBe(false);
    });
  });

  await describe('Quoka: leer heißt leer, kaputt heißt kaputt', async () => {
    await it('gibt bei `resultscount = 0` nichts zurück, nicht die Empfehlungen', async () => {
      // THE discriminator for this source. The zero-hit page keeps six
      // suggestion ads inside the SAME `.article-list` the hits use — only the
      // empty `data-articleid` tells them apart.
      const parsed = parseQuokaSearchPage(QUOKA_EMPTY, { now: NOW, sellerType: 'unknown' });
      expect(parsed.listings).toHaveLength(0);
      expect(parsed.totalEstimate).toBe(0);
      expect(parsed.nextUrl).toBeNull();
    });

    await it('wirft parse-failed, wenn Treffer gemeldet sind und keine Zeile passt', async () => {
      let caught: ProviderError | null = null;
      try {
        parseQuokaSearchPage(QUOKA_MOVED, { now: NOW, sellerType: 'unknown' });
      } catch (err) {
        caught = err as ProviderError;
      }
      expect(caught?.kind).toBe('parse-failed');
      expect(caught?.message).toMatch(/3521 Treffer/);
    });

    await it('liest die Zeilen auch ohne resultscount — und sagt es', async () => {
      const withoutCount = quokaPage({ count: null, rows: quokaAd({ id: 'aaaa1111', title: 'Herrenrad' }) });
      const parsed = parseQuokaSearchPage(withoutCount, { now: NOW, sellerType: 'unknown' });
      expect(parsed.listings).toHaveLength(1);
      expect(parsed.totalEstimate).toBeNull();
      expect(parsed.warnings[0]).toMatch(/resultscount/);
    });

    await it('wirft parse-failed bei einer ganz fremden Seite', async () => {
      let kind: string | null = null;
      try {
        parseQuokaSearchPage('<html><body><h1>Quoka</h1></body></html>', { now: NOW, sellerType: 'unknown' });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('parse-failed');
    });
  });

  await describe('markt.de: Provider', async () => {
    await it('ist aus, zitiert die Klausel und öffnet keinen Socket', async () => {
      const calls: Call[] = [];
      const provider = createMarktDeProvider({
        http: client({}, calls),
        env: {},
        enabled: false,
        now: () => NOW,
      });
      const status = await provider.status();

      expect(provider.capabilities.enabledByDefault).toBe(false);
      expect(provider.capabilities.termsDoc).toBe('docs/quellen/markt.de.md');
      expect(status.configured).toBe(false);
      expect(status.problem?.kind).toBe('not-configured');
      expect(status.problem?.message).toMatch(/automatische Auslesen/);
      expect(provider.capabilities.note).toMatch(/docs\/quellen\/markt\.de\.md/);
      expect(calls).toHaveLength(0);

      // And the gate refuses the search itself, not just the status line.
      let kind: string | null = null;
      try {
        await provider.search({ text: 'testrad' });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('blocked-by-policy');
      // NOT ONE request goes out — not the search, and not robots.txt either.
      // The earlier version of this assertion allowed the robots.txt fetch,
      // because `HttpClient` loaded it before the gate had looked at `enabled`.
      // A request for robots.txt is still a request, and the hosts that are
      // switched off are precisely the ones whose operators asked not to be
      // contacted automatically. Fixed in @troedler/http; the list is empty now
      // and an empty list is the whole point of the test.
      expect(calls.map((c) => c.url)).toEqualArray([]);
      expect(calls.some((c) => c.url.includes('/suche/'))).toBe(false);
    });

    await it('meldet genau die Filter, die als URL existieren', async () => {
      const caps = createMarktDeProvider({ http: client({}, []), env: {}, enabled: true }).capabilities;
      // Price range and the private/commercial split are behind the POST-masked
      // form; condition, shipping and GTIN are not fields this source has.
      expect(caps.serverFilters).toEqualArray(['radius', 'sort']);
      expect(caps.serverSorts).toEqualArray(['newest', 'price-asc', 'price-desc']);
      expect(caps.access).toBe('html');
      expect(caps.maxResults).toBe(100);
      // The terms forbid copying ad content — so nothing reaches a disk.
      expect(caps.cache.memoryOnly).toBe(true);
      expect(caps.cache.ttlSeconds).toBe(0);
    });

    await it('holt zwei Seiten, entdoppelt, warnt vor Partner-Anzeigen', async () => {
      const calls: Call[] = [];
      const second = marktPage({
        count: '9.933 Treffer',
        rows: [
          // The promoted row repeats on every page and must vanish.
          marktAd({
            id: '11111111',
            title: 'Herrenrad 28 Zoll',
            amount: '3.550 €',
            label: 'VB',
            seller: 'private',
          }),
          marktAd({ id: '66666666', title: 'Sattel', amount: '12 €', label: 'Festpreis', seller: 'private' }),
        ].join(''),
        next: 'https://www.markt.de/suche/testrad/?page=3',
      });
      const provider = createMarktDeProvider({
        http: client({ '/suche/testrad/': MARKT_FULL, '/suche/testrad/?page=2': second }, calls),
        env: {},
        enabled: true,
        now: () => NOW,
      });

      const result = await provider.search({ text: 'testrad', limit: 40 });

      expect(result.requests).toBe(2);
      expect(result.listings.map((l) => l.id)).toEqualArray([
        '11111111',
        '22222222',
        '33333333',
        '44444444',
        '55555555',
        '66666666',
      ]);
      expect(result.totalEstimate).toBe(9933);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('Partner-Anzeigen'))).toBe(true);
      expect(calls.map((c) => c.url)).toEqualArray([
        'https://www.markt.de/robots.txt',
        'https://www.markt.de/suche/testrad/',
        'https://www.markt.de/suche/testrad/?page=2',
      ]);
    });

    await it('lässt eine von robots.txt gesperrte URL gar nicht erst raus', async () => {
      const calls: Call[] = [];
      const http = client({}, calls);
      let kind: string | null = null;
      try {
        await http.get('https://www.markt.de/haendler/shop.htm', { provider: 'markt-de', enabled: true });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('blocked-by-policy');
      // robots.txt was fetched; the disallowed URL never was.
      expect(calls).toHaveLength(1);
    });

    await it('meldet eine kaputte Region über status(), statt beim Suchen zu sterben', async () => {
      const provider = createMarktDeProvider({
        http: client({}, []),
        env: { TROEDLER_MARKT_REGION: 'Berlin Mitte!' },
        enabled: true,
      });
      const status = await provider.status();
      expect(status.configured).toBe(false);
      expect(status.problem?.message).toMatch(/TROEDLER_MARKT_REGION/);
    });
  });

  await describe('Quoka: Provider', async () => {
    await it('ist an, nennt die Nutzungsgrenze und braucht keine Zugangsdaten', async () => {
      const caps = createQuokaProvider({ http: client({}, []), env: {}, enabled: true }).capabilities;
      expect(caps.enabledByDefault).toBe(true);
      expect(caps.termsDoc).toBe('docs/quellen/quoka.de.md');
      // The AGB permit "Ansicht und das Herunterladen einer Kopie … für
      // persönliche und nicht-kommerzielle Zwecke" — so disk is allowed here,
      // unlike on markt.de, and the restriction is shown with every row.
      expect(caps.cache.memoryOnly).toBe(false);
      expect(caps.cache.ttlSeconds).toBe(900);
      expect(caps.disclaimer).toMatch(/nicht-kommerzielle/);
      expect(caps.serverFilters).toEqualArray(['sellerType', 'sort']);
      expect(caps.serverSorts).toEqualArray(['newest']);
    });

    await it('ist ohne Schalter nicht konfiguriert und fasst das Netz nicht an', async () => {
      const calls: Call[] = [];
      const provider = createQuokaProvider({ http: client({}, calls), env: {}, enabled: false });
      const status = await provider.status();
      expect(status.configured).toBe(false);
      expect(status.problem?.kind).toBe('not-configured');
      expect(calls).toHaveLength(0);
    });

    await it('sucht, meldet den angewandten Filter und stoppt an der Zeilenzahl', async () => {
      const calls: Call[] = [];
      const provider = createQuokaProvider({
        http: client({ '/anzeigen/?q=testrad&commercial=false': QUOKA_FULL }, calls),
        env: {},
        enabled: true,
        now: () => NOW,
      });

      const result = await provider.search({ text: 'testrad', sellerType: 'private', limit: 6 });

      expect(result.requests).toBe(1);
      expect(result.listings).toHaveLength(6);
      expect(result.applied).toEqualArray(['sellerType']);
      expect(result.listings.every((l) => l.sellerType === 'private')).toBe(true);
      expect(result.totalEstimate).toBe(3521);
      expect(result.truncated).toBe(true);
      expect(calls.map((c) => c.url)).toEqualArray([
        'https://www.quoka.de/robots.txt',
        'https://www.quoka.de/anzeigen/?q=testrad&commercial=false',
      ]);
    });

    await it('meldet eine leere Antwort als leer, nicht als Fehler und nicht als Empfehlungen', async () => {
      const calls: Call[] = [];
      const provider = createQuokaProvider({
        http: client({ '/anzeigen/?q=gibtesnicht': QUOKA_EMPTY }, calls),
        env: {},
        enabled: true,
        now: () => NOW,
      });
      const result = await provider.search({ text: 'gibtesnicht' });
      expect(result.listings).toHaveLength(0);
      expect(result.totalEstimate).toBe(0);
      expect(result.truncated).toBe(false);
      expect(result.requests).toBe(1);
    });

    await it('lässt die alten, gesperrten Quoka-Pfade nicht raus', async () => {
      // The 52 disallowed paths in Quoka's `*` group are all the PREVIOUS URL
      // scheme. Today's `/anzeigen/…` is allowed — but the old ones still are
      // not, and the gate has to keep saying so.
      const calls: Call[] = [];
      const http = client({}, calls);
      let kind: string | null = null;
      try {
        await http.get('https://www.quoka.de/Suchergebnis/rad', { provider: 'quoka', enabled: true });
      } catch (err) {
        kind = (err as ProviderError).kind;
      }
      expect(kind).toBe('blocked-by-policy');
      expect(calls).toHaveLength(1);
    });
  });
};
