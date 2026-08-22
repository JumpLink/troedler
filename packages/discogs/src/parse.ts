/**
 * Discogs responses → `Listing[]`. Pure: no fetch, no clock, no config.
 *
 * The mapping is short but three of its decisions are load-bearing, and each
 * one exists because the obvious mapping produces a plausible wrong answer:
 *
 *   - **The price comes from `/marketplace/stats`, never from `/releases/{id}`.**
 *     Both carry `lowest_price`. `stats` honours `curr_abbr` and names its
 *     currency; the release endpoint ignores `curr_abbr` entirely and returns a
 *     bare number in USD. Measured on 2026-08-21, release 125204: stats said
 *     `{value: 64.0, currency: "EUR"}` and `{value: 54.33, currency: "GBP"}`
 *     for the matching `curr_abbr`, while the release endpoint answered `86.53`
 *     to `curr_abbr=EUR`, to `curr_abbr=GBP` and to no parameter at all. Reading
 *     the release field would label dollars as euros — a number that sorts,
 *     filters and compares, and is wrong by a third.
 *   - **`country` is not a location.** It is where the record was pressed. A
 *     German pressing sold from Osaka would be reported as "Germany" and a
 *     radius search would then act on it, so `location` stays null throughout.
 *   - **A barcode is only a GTIN once its check digit says so.** `merge.ts`
 *     treats `gtin:` as the trusted cross-provider identity, so a wrong one does
 *     not produce a missing match, it produces a false one.
 */

import {
  listingKey,
  money,
  ProviderError,
  stripContactDetails,
  type Listing,
  type Money,
} from '@troedler/core';
import type {
  DiscogsMarketplaceStats,
  DiscogsRelease,
  DiscogsSearchResponse,
  DiscogsSearchRow,
} from './types.ts';

/**
 * What the mapper reads.
 *
 * A search row plus the one field only the detail endpoint has. Keeping it
 * separate from `DiscogsSearchRow` matters: that type is a record of what the
 * wire actually sends, and quietly widening it would make the next reader
 * believe `/database/search` returns notes. It does not.
 */
export type MappableRow = DiscogsSearchRow & { readonly notes?: string };

/**
 * Characters of release notes kept in a description.
 *
 * Deliberately NOT `DESCRIPTION_CHARS` from `limits.ts`: that bounds the whole
 * description, which here also has to carry the offer count, the label and the
 * catalogue number. This is the share the notes may take of it, and it is small
 * because well-documented pressings run to several thousand characters of
 * pressing-plant trivia — the point is a teaser, not a copy of the page.
 */
const NOTES_CHARS = 300;

/** Lengths GS1 defines: EAN-8, UPC-A, EAN-13, GTIN-14. Nothing else is a GTIN. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
/** A candidate may contain digits, spaces and hyphens — nothing else. Rejects `LC00162`, `BIEM/GEMA`, matrix inscriptions. */
const GTIN_CANDIDATE = /^[\d\s-]+$/;

/**
 * GS1 mod-10, weights 3 and 1 alternating from the last data digit leftwards.
 *
 * One formula for all four lengths, which is the point: writing EAN-13 and
 * UPC-A separately is how one of them ends up with the weights the wrong way
 * round and quietly accepts half the garbage it was meant to reject.
 */
export function isValidGtin(digits: string): boolean {
  const n = digits.length;
  if (!GTIN_LENGTHS.has(n)) return false;
  let sum = 0;
  for (let i = n - 2; i >= 0; i--) sum += Number(digits[i]) * ((n - 2 - i) % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[n - 1]);
}

/**
 * Pick the one real barcode out of Discogs' `barcode[]` grab bag.
 *
 * Length alone is not enough. The matrix inscription `"10 6305058 1 320"`
 * reduces to thirteen digits and would pass a length check; its check digit
 * does not, which is the only thing standing between it and a false identity
 * match against a completely different record on eBay.
 */
export function extractGtin(barcodes: readonly string[] | undefined): string | null {
  const found: string[] = [];
  for (const raw of barcodes ?? []) {
    if (typeof raw !== 'string' || !GTIN_CANDIDATE.test(raw)) continue;
    const digits = raw.replace(/\D/g, '');
    if (isValidGtin(digits)) found.push(digits);
  }
  // Longest first: a release listing both a UPC-A and its EAN-13 form should be
  // identified by the more specific one.
  found.sort((a, b) => b.length - a.length);
  return found[0] ?? null;
}

/**
 * The title, qualified by edition.
 *
 * Discogs' `title` is `"Artist - Release"` and nothing more, so a search for
 * "kraftwerk" returns three rows all reading `"Kraftwerk - Kraftwerk"`
 * (measured: ids 125204, 4751427, 351443). On Discogs the EDITION is the
 * identity — a 1970 German gatefold LP and a 1994 unofficial CD are different
 * things at different prices — and a list the user cannot tell apart is not a
 * usable answer. So the qualifier is part of the title, the way any other
 * marketplace would have written it into theirs.
 */
export function buildTitle(row: MappableRow): string {
  const base = stripContactDetails((row.title ?? '').trim());
  const parts = [...(row.format ?? []).slice(0, 3), row.year, row.country].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? `${base} (${parts.join(', ')})` : base;
}

/**
 * A one-line summary: how many offers there are, then who released it.
 *
 * `catno` is appended AFTER `stripContactDetails` rather than passed through
 * it, and that is not tidiness. The phone pattern in `normalize.ts` matches a
 * leading `0` followed by eight or more digits, spaces, dots, slashes or
 * hyphens — which is the exact shape of a Universal catalogue number.
 * Measured: `"Kat.-Nr.: 0602557531336"` and `"Kat.-Nr.: 088 112 838-2"` both
 * come back as `"Kat.-Nr.: […]"`. The strip belongs on the user-written fields
 * (title, label), not on an identifier.
 */
export function buildDescription(row: MappableRow, stats: DiscogsMarketplaceStats): string | null {
  const parts: string[] = [];
  const offers = stats.num_for_sale ?? 0;
  parts.push(offers === 1 ? '1 Angebot im Discogs-Marktplatz' : `${offers} Angebote im Discogs-Marktplatz`);

  // Deduplicated: Discogs lists one company once per role, so a single-label
  // release routinely arrives as `["Vertigo", "Vertigo"]` — measured on release
  // 63961 — and printing it verbatim reads like a bug in this tool.
  const labels = [...new Set((row.label ?? []).filter((l) => typeof l === 'string' && l.length > 0))].slice(
    0,
    2,
  );
  if (labels.length > 0) parts.push(`Label: ${stripContactDetails(labels.join(', '))}`);
  if (row.catno) parts.push(`Kat.-Nr.: ${row.catno}`);

  const styles = (row.style ?? []).slice(0, 3).join(', ');
  const genres = (row.genre ?? []).slice(0, 2).join(', ');
  if (genres) parts.push(styles ? `${genres} (${styles})` : genres);

  // The release notes are the one genuinely free-text, user-written field
  // Discogs hands us, which makes them the one field the contact strip is
  // actually for. Truncated, because they run to several thousand characters on
  // well-documented pressings and this is a teaser, not a mirror of the page.
  const notes = plainNotes(row.notes);
  if (notes) {
    parts.push(stripContactDetails(notes.length > NOTES_CHARS ? `${notes.slice(0, NOTES_CHARS)}…` : notes));
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Discogs' wiki markup, rendered down to plain text.
 *
 * Release notes are written in Discogs' own bracket syntax and their site turns
 * it into links. Ours does not, so a note arrives reading "Identical to
 * [r=7000941] with the addition of a signature" — measured on release 35822047.
 * A release reference becomes this project's own listing handle, so it stays
 * actionable; the other id references have no handle and are dropped; a name
 * reference IS its own text and is unwrapped rather than deleted.
 */
export function plainNotes(raw: string | undefined): string {
  return (
    (raw ?? '')
      // [r=123] references another release, and this project already has a handle
      // for exactly that — so it becomes one the user can paste back into the
      // CLI rather than a number that means nothing outside discogs.com.
      .replace(/\[r=(\d+)\]/gi, 'discogs:$1')
      // [m=123] [a=123] [l=123] point at masters, artists and labels, for which
      // this tool has no handle. Dropped rather than left as a bare id.
      .replace(/\[[mal]=\d+\]/gi, '')
      // [a=Artist Name] [l=Label Name] — the name is the content.
      .replace(/\[[al]=([^\]]+)\]/gi, '$1')
      .replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/gi, '$1')
      .replace(/\[\/?[biu]\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function lowestPrice(stats: DiscogsMarketplaceStats): Money | null {
  const raw = stats.lowest_price;
  if (!raw || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return null;
  const currency =
    typeof raw.currency === 'string' && raw.currency.length === 3 ? raw.currency.toUpperCase() : 'EUR';
  return money(raw.value * 100, currency);
}

/**
 * The page a buyer actually wants: the offers for this release, not its
 * catalogue entry.
 *
 * It doubles as the hyperlink Discogs' API terms require next to any displayed
 * data ("The notice must include a hyperlink to the discogs.com page that
 * includes the data"), which is why it points at discogs.com rather than at
 * `resource_url` on the API host.
 */
export function sellUrl(id: number): string {
  return `https://www.discogs.com/sell/release/${id}`;
}

export interface MappedReleases {
  readonly listings: readonly Listing[];
  /**
   * Rows whose shape we could not read at all. The discriminator against
   * "grün und leer": all rows unmappable means the response moved, not that
   * nothing matched.
   */
  readonly unmappable: number;
  /** Releases nobody is currently selling. Dropped — but counted, so an empty result stays explainable. */
  readonly withoutOffers: number;
}

/**
 * Map enriched rows to listings.
 *
 * A release with no offer is dropped rather than returned price-less: this DTO
 * describes an offer, and "here is a record nobody is selling" is noise a
 * second-hand search has to answer for. The count survives in `withoutOffers`
 * so the provider can say why a search came back short.
 */
export function mapReleases(
  rows: readonly MappableRow[],
  statsFor: (id: number) => DiscogsMarketplaceStats | undefined,
  fetchedAt: string,
): MappedReleases {
  const listings: Listing[] = [];
  let unmappable = 0;
  let withoutOffers = 0;

  for (const row of rows) {
    const id = typeof row.id === 'number' && Number.isFinite(row.id) ? row.id : null;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (id === null || title.length === 0) {
      unmappable += 1;
      continue;
    }

    const stats = statsFor(id);
    // No stats means the budget ran out before this row, not that the row is
    // broken — it must never count as unmappable, or a short budget would look
    // like a markup change.
    if (!stats) continue;

    const price = lowestPrice(stats);
    if ((stats.num_for_sale ?? 0) <= 0 || price === null) {
      withoutOffers += 1;
      continue;
    }

    const images = [row.cover_image, row.thumb].filter(
      (u): u is string => typeof u === 'string' && u.startsWith('https://'),
    );

    listings.push({
      key: listingKey('discogs', String(id)),
      provider: 'discogs',
      id: String(id),
      title: buildTitle(row),
      description: buildDescription(row, stats),
      url: sellUrl(id),
      price,
      // The aggregate is the cheapest of N offers, which is precisely what
      // `from` means. Calling it `fixed` would invite the ranking to compare it
      // with a real asking price on another marketplace as if they were equals.
      priceKind: 'from',
      // Discogs postage is set per seller and per destination and appears only
      // in the offer, which the public API does not expose. `null` says so;
      // `0` would claim it is free.
      shippingCost: null,
      totalPrice: null,
      // The aggregate spans every condition on offer, from Mint to Poor. Naming
      // one would be inventing the grade of a record we cannot see.
      condition: 'unknown',
      conditionRaw: null,
      sellerType: 'unknown',
      // The Discogs Marketplace is mail order end to end; it has no collection
      // mechanism. This is a property of the marketplace, not of the row.
      delivery: 'shipping',
      // `row.country` is where the record was PRESSED. Putting it here would
      // send a radius search hunting for a seller who was never there.
      location: { postalCode: null, city: null, country: null, distanceKm: null },
      // Discogs' `date_added` is when the catalogue entry was created — often
      // decades after the record and unrelated to when anything went on sale.
      listedAt: null,
      listedAtPrecision: null,
      endsAt: null,
      bidCount: null,
      images,
      gtin: extractGtin(row.barcode),
      fetchedAt,
    });
  }

  return { listings, unmappable, withoutOffers };
}

export interface ParsedSearch {
  readonly rows: readonly DiscogsSearchRow[];
  /** Discogs' own count of matches, or `null` when it did not say. */
  readonly totalItems: number | null;
}

/**
 * Read the search envelope, or refuse.
 *
 * The two refusals are the ones that would otherwise be reported as "nothing
 * found": a body without a `results` array, and a body claiming matches while
 * handing over no rows. Measured baseline for a genuine miss (2026-08-21):
 * `{"pagination":{…,"items":0,"urls":{}},"results":[]}` — items zero AND the
 * array empty, which passes here and returns nothing, truthfully.
 */
export function parseSearchResponse(body: DiscogsSearchResponse): ParsedSearch {
  if (!Array.isArray(body?.results)) {
    throw new ProviderError(
      'discogs',
      'parse-failed',
      'Discogs antwortete ohne results-Array — die Struktur von /database/search hat sich geändert.',
    );
  }
  const items = body.pagination?.items;
  const totalItems = typeof items === 'number' && Number.isFinite(items) ? items : null;
  if (totalItems !== null && totalItems > 0 && body.results.length === 0) {
    throw new ProviderError(
      'discogs',
      'parse-failed',
      `Discogs meldet ${totalItems} Treffer, liefert aber keine Zeile — die Struktur von /database/search hat sich geändert.`,
    );
  }
  return { rows: body.results, totalItems };
}

/**
 * A detail response, reshaped into the row the mapper already understands.
 *
 * Deliberately a normaliser rather than a second mapper. A listing fetched by
 * id and the same listing found by search have to be the same object — same
 * title spelling, same description layout, same GTIN — or the CLI's detail view
 * quietly disagrees with the list it was opened from, and `dedupeWithinProvider`
 * stops recognising them as one row.
 */
export function releaseToRow(release: DiscogsRelease): MappableRow {
  const artist = (release.artists_sort ?? release.artists?.[0]?.name ?? '').trim();
  const title = (release.title ?? '').trim();
  const formats: string[] = [];
  for (const f of release.formats ?? []) {
    if (f.name) formats.push(f.name);
    for (const d of f.descriptions ?? []) formats.push(d);
  }

  // `identifiers` is typed, so the barcode can be picked by its label instead of
  // by shape — but it still goes through `extractGtin`, because a user-entered
  // "Barcode" is just as capable of being a matrix code with the wrong label on it.
  const barcodes = (release.identifiers ?? [])
    .filter((i) => typeof i.value === 'string' && /^barcode$/i.test(i.type ?? ''))
    .map((i) => i.value as string);

  const primary = (release.images ?? []).find((i) => i.type === 'primary')?.uri;
  const cover = primary ?? release.images?.[0]?.uri;

  return {
    id: release.id,
    title: artist && title ? `${artist} - ${title}` : title || artist,
    year: typeof release.year === 'number' && release.year > 0 ? String(release.year) : undefined,
    country: release.country,
    format: formats,
    label: (release.labels ?? []).map((l) => l.name).filter((n): n is string => typeof n === 'string'),
    catno: release.labels?.[0]?.catno,
    genre: release.genres,
    style: release.styles,
    barcode: barcodes,
    cover_image: cover,
    thumb: release.thumb,
    notes: release.notes,
  };
}
