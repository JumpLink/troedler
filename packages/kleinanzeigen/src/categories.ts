/**
 * The category table — 159 rows, generated once, never crawled.
 *
 * Source: `https://www.kleinanzeigen.de/sitemap_categories.xml`, fetched
 * 2026-08-21. The sitemap is the only permitted way to this table: robots.txt
 * disallows `/s-kategorie-baum.html`, and the sitemaps are explicitly allowed.
 * It is checked in rather than fetched at startup because a table that changes
 * a few times a year has no business costing a request per run — and because a
 * runtime crawl of the operator's category tree is exactly the "collecting
 * content" § 5 of their terms names.
 *
 * Regenerate by re-reading that sitemap and taking, from every `<loc>`, the
 * part between `/s-` and the trailing `/c<id>`. 159 rows on 2026-08-21.
 *
 * Cities are deliberately NOT here. `sitemap_cities.xml` carries 11 231 rows
 * (780 KB), keys them by slug rather than by postal code, and `SearchQuery`
 * only ever hands us a postal code — so the table could not resolve the one
 * input we get. It would be a third of a megabyte in every bundle to answer a
 * question nobody asks. A user who knows their own location slug and id passes
 * them straight through (`KleinanzeigenDeps.location`).
 */

/** A slug is a PATH, not a name: eight of the 159 are nested, e.g. `haus-garten/sonstiges`. */
export interface KleinanzeigenCategory {
  readonly slug: string;
  readonly id: number;
}

/**
 * Ordered as the sitemap lists them, and an array rather than a record on
 * purpose: **13 slugs are ambiguous.** `haus-garten` is both the top-level
 * category 80 and the services subcategory 291; `sonstige` is three different
 * ids. A `Record<string, number>` would resolve those silently to whichever
 * one happened to be written last, which is the quiet-wrong-answer failure
 * this project keeps refusing to build. `resolveCategory` reports the
 * collision instead.
 */
export const CATEGORIES: readonly KleinanzeigenCategory[] = [
  { slug: 'auto-rad-boot', id: 210 },
  { slug: 'autos', id: 216 },
  { slug: 'autoteile-reifen', id: 223 },
  { slug: 'boote-bootszubehoer', id: 211 },
  { slug: 'fahrraeder', id: 217 },
  { slug: 'motorraeder-roller', id: 305 },
  { slug: 'motorraeder-roller-teile', id: 306 },
  { slug: 'anhaenger-nutzfahrzeuge', id: 276 },
  { slug: 'reparaturen-dienstleistungen', id: 280 },
  { slug: 'wohnwagen-mobile', id: 220 },
  { slug: 'auto-rad-boot/sonstiges', id: 241 },
  { slug: 'dienstleistungen', id: 297 },
  { slug: 'altenpflege', id: 288 },
  { slug: 'auto-rad-boot', id: 289 },
  { slug: 'babysitter-kinderbetreuung', id: 290 },
  { slug: 'multimedia-elektronik', id: 293 },
  { slug: 'haus-garten', id: 291 },
  { slug: 'kuenstler-musiker', id: 292 },
  { slug: 'reise-event', id: 294 },
  { slug: 'tierbetreuung-training', id: 295 },
  { slug: 'umzug-transport', id: 296 },
  { slug: 'sonstige', id: 298 },
  { slug: 'eintrittskarten-tickets', id: 231 },
  { slug: 'bahn-oepnv', id: 286 },
  { slug: 'comedy-kabarett', id: 254 },
  { slug: 'gutscheine', id: 287 },
  { slug: 'kinder', id: 252 },
  { slug: 'konzerte', id: 255 },
  { slug: 'sport', id: 257 },
  { slug: 'klassik-kultur', id: 251 },
  { slug: 'sonstige', id: 256 },
  { slug: 'multimedia-elektronik', id: 161 },
  { slug: 'audio-hifi', id: 172 },
  { slug: 'dienstleistungen-edv', id: 226 },
  { slug: 'foto', id: 245 },
  { slug: 'handy-telekom', id: 173 },
  { slug: 'haushaltsgeraete', id: 176 },
  { slug: 'konsolen', id: 279 },
  { slug: 'notebooks', id: 278 },
  { slug: 'pcs', id: 228 },
  { slug: 'pc-zubehoer-software', id: 225 },
  { slug: 'tablets-reader', id: 285 },
  { slug: 'tv-video', id: 175 },
  { slug: 'pc-videospiele', id: 227 },
  { slug: 'wearables', id: 405 },
  { slug: 'wearables-zubehor', id: 406 },
  { slug: 'multimedia-elektronik/sonstiges', id: 168 },
  { slug: 'familie-kind-baby', id: 17 },
  { slug: 'altenpflege', id: 236 },
  { slug: 'baby-kinderkleidung', id: 22 },
  { slug: 'baby-kinderschuhe', id: 19 },
  { slug: 'babyausstattung', id: 258 },
  { slug: 'babyschalen-kindersitze', id: 21 },
  { slug: 'babysitter-kinderbetreuung', id: 237 },
  { slug: 'kinderwagen-buggys', id: 25 },
  { slug: 'kinderzimmermoebel', id: 20 },
  { slug: 'spielzeug', id: 23 },
  { slug: 'familie-kind-baby/sonstiges', id: 18 },
  { slug: 'freizeit-nachbarschaft', id: 185 },
  { slug: 'esoterik-spirituelles', id: 232 },
  { slug: 'essen-trinken', id: 248 },
  { slug: 'freizeitaktivitaeten', id: 187 },
  { slug: 'handarbeit-basteln-kunsthandwerk', id: 282 },
  { slug: 'kunst', id: 240 },
  { slug: 'kuenstler-musiker', id: 191 },
  { slug: 'modellbau', id: 249 },
  { slug: 'reise-eventservices', id: 233 },
  { slug: 'sammeln', id: 234 },
  { slug: 'sport-camping', id: 230 },
  { slug: 'troedel-kistenweise', id: 250 },
  { slug: 'verloren-gefunden', id: 189 },
  { slug: 'freizeit-nachbarschaft/sonstiges', id: 242 },
  { slug: 'haus-garten', id: 80 },
  { slug: 'badezimmer', id: 91 },
  { slug: 'bueromoebel', id: 93 },
  { slug: 'dekoration', id: 246 },
  { slug: 'dienstleistungen-haus-garten', id: 239 },
  { slug: 'garten-pflanzen', id: 89 },
  { slug: 'heimtextilien', id: 90 },
  { slug: 'heimwerken', id: 84 },
  { slug: 'kueche-esszimmer', id: 86 },
  { slug: 'lampen-licht', id: 82 },
  { slug: 'schlafzimmer', id: 81 },
  { slug: 'wohnzimmer', id: 88 },
  { slug: 'haus-garten/sonstiges', id: 87 },
  { slug: 'haustiere', id: 130 },
  { slug: 'fische', id: 138 },
  { slug: 'hunde', id: 134 },
  { slug: 'katzen', id: 136 },
  { slug: 'kleintiere', id: 132 },
  { slug: 'nutztiere', id: 135 },
  { slug: 'pferde', id: 139 },
  { slug: 'tierbetreuung-training', id: 133 },
  { slug: 'vermisste-tiere', id: 283 },
  { slug: 'vogel', id: 243 },
  { slug: 'zubehoer', id: 313 },
  { slug: 'immobilien', id: 195 },
  { slug: 'auf-zeit-wg', id: 199 },
  { slug: 'container', id: 402 },
  { slug: 'wohnung-kaufen', id: 196 },
  { slug: 'ferienwohnung-ferienhaus', id: 275 },
  { slug: 'garage-lagerraum', id: 197 },
  { slug: 'gewerbeimmobilien', id: 277 },
  { slug: 'grundstuecke-garten', id: 207 },
  { slug: 'haus-kaufen', id: 208 },
  { slug: 'haus-mieten', id: 205 },
  { slug: 'wohnung-mieten', id: 203 },
  { slug: 'neubauprojekte', id: 403 },
  { slug: 'umzug-transport', id: 238 },
  { slug: 'immobilien/sonstiges', id: 198 },
  { slug: 'jobs', id: 102 },
  { slug: 'ausbildung', id: 118 },
  { slug: 'bau-handwerk-produktion', id: 111 },
  { slug: 'bueroarbeit-verwaltung', id: 114 },
  { slug: 'gastronomie-tourismus', id: 110 },
  { slug: 'kundenservice-callcenter', id: 105 },
  { slug: 'heimarbeit-mini-nebenjobs', id: 107 },
  { slug: 'praktika', id: 125 },
  { slug: 'sozialer-sektor-pflege', id: 123 },
  { slug: 'transport-logistik-verkehr', id: 247 },
  { slug: 'vertrieb-einkauf-verkauf', id: 117 },
  { slug: 'sonstige-berufe', id: 109 },
  { slug: 'mode-beauty', id: 153 },
  { slug: 'beauty-gesundheit', id: 224 },
  { slug: 'kleidung-damen', id: 154 },
  { slug: 'schuhe-damen', id: 159 },
  { slug: 'kleidung-herren', id: 160 },
  { slug: 'schuhe-herren', id: 158 },
  { slug: 'accessoires-schmuck', id: 156 },
  { slug: 'uhren-schmuck', id: 157 },
  { slug: 'mode-beauty/sonstiges', id: 155 },
  { slug: 'musik-film-buecher', id: 73 },
  { slug: 'buecher-zeitschriften', id: 76 },
  { slug: 'buero-schreibwaren', id: 281 },
  { slug: 'comics', id: 284 },
  { slug: 'fachbuecher-schule-studium', id: 77 },
  { slug: 'film-dvd', id: 79 },
  { slug: 'musik-cds', id: 78 },
  { slug: 'musikinstrumente', id: 74 },
  { slug: 'musik-film-buecher/sonstiges', id: 75 },
  { slug: 'nachbarschaftshilfe', id: 400 },
  { slug: 'nachbarschaftshilfe', id: 401 },
  { slug: 'unterricht-kurse', id: 235 },
  { slug: 'beauty-gesundheit', id: 269 },
  { slug: 'computerkurse', id: 260 },
  { slug: 'esoterik-spirituelles', id: 265 },
  { slug: 'kochen-backen', id: 263 },
  { slug: 'kunst-gestaltung', id: 264 },
  { slug: 'musik-gesang', id: 262 },
  { slug: 'nachhilfe', id: 268 },
  { slug: 'sportkurse', id: 261 },
  { slug: 'sprachkurse', id: 271 },
  { slug: 'tanzkurse', id: 267 },
  { slug: 'weiterbildung', id: 266 },
  { slug: 'sonstige', id: 270 },
  { slug: 'zu-verschenken-tauschen', id: 272 },
  { slug: 'tauschen', id: 273 },
  { slug: 'verleihen', id: 274 },
  { slug: 'zu-verschenken', id: 192 },
];

export function categoryById(id: number): KleinanzeigenCategory | null {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}

export class CategoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryError';
  }
}

/**
 * Resolve what a user typed into one category.
 *
 * Accepts `c217`, `217`, or a slug (`fahrraeder`, `haus-garten/sonstiges`).
 * An ambiguous slug throws and names every candidate — the user picks, we do
 * not. An unknown one throws too: building `/s-fahrad/k0c0` and reporting
 * "nothing found" would be indistinguishable from a real miss.
 */
export function resolveCategory(input: string): KleinanzeigenCategory {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/^\/?s-/, '')
    .replace(/\/$/, '');
  const numeric = raw.match(/^c?(\d+)$/);
  if (numeric) {
    const found = categoryById(Number.parseInt(numeric[1], 10));
    if (found) return found;
    throw new CategoryError(
      `Kleinanzeigen kennt keine Kategorie ${raw}. Siehe docs/quellen/kleinanzeigen.de.md.`,
    );
  }

  const hits = CATEGORIES.filter((c) => c.slug === raw);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const ids = hits.map((c) => `c${c.id}`).join(', ');
    throw new CategoryError(
      `Der Kategorie-Slug "${raw}" ist bei Kleinanzeigen mehrdeutig (${ids}). Bitte die Nummer angeben.`,
    );
  }

  const near = CATEGORIES.filter((c) => c.slug.includes(raw)).slice(0, 5);
  const hint = near.length > 0 ? ` Gemeint war vielleicht: ${near.map((c) => c.slug).join(', ')}.` : '';
  throw new CategoryError(`Unbekannte Kleinanzeigen-Kategorie "${raw}".${hint}`);
}
