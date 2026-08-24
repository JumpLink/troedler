/**
 * The German sentence set — in the kernel, not in a view.
 *
 * `labels.ts` next door holds the word for a value: what `used-good` is called,
 * what a `fixed` price is called. This file holds the sentences MADE of those
 * words — the ones that describe what happened during a search rather than what
 * a field contains.
 *
 * They are here for one reason, and it is the reason with the incident behind
 * it: **skipped ≠ empty ≠ failed** is the single most important distinction
 * this project draws, and it lived in `cli/output.ts`. A second surface written
 * against the same data would not have copied the sentences; it would have
 * written its own, slightly different, and the two would have disagreed about
 * whether a source answered. A marketplace that changed its markup, refused us,
 * or was never configured all look identical to "no matches" — and "no matches"
 * is an answer people act on.
 *
 * What stays in a view is what is genuinely of that medium: ANSI codes, column
 * widths, `console.log`, Pango markup. Anything a person reads and could quote
 * back is here.
 *
 * Nothing in this file touches the clock or the locale by itself: `now` is
 * always a parameter, because a function that reads `Date.now()` cannot be
 * tested for the boundary it exists to get right.
 */

import { fmtMoney, money } from './money.ts';
import {
  CONDITION_LABEL,
  DELIVERY_LABEL,
  PROVIDER_LABEL,
  SELLER_TYPE_LABEL,
  fmtPriceWithKind,
} from './labels.ts';
import { isTransient } from './errors.ts';
import type { Listing, Location, ProviderId } from './listing.ts';
import { BASIS_LABEL, type PriceBand } from './stats.ts';
import type { CrossCheckReport, ProviderReport } from './search.ts';

/** The label for a source, falling back to its id. Four copies before this existed. */
export function providerLabel(id: ProviderId | string): string {
  return PROVIDER_LABEL[id as ProviderId] ?? id;
}

/**
 * Said whenever a printed number already contains postage.
 *
 * Three copies inside one view file before this constant. Two rows in the same
 * list silently meaning different things is the failure it prevents.
 */
export const SHIPPING_INCLUDED = ' inkl. Versand';

/** `"30966 Hemmingen"` — postcode and town, whichever of the two exists. */
export function fmtLocation(location: Location): string {
  return [location.postalCode, location.city].filter(Boolean).join(' ');
}

/** A store row's `minor` + `currency` in one step. Six copies before this existed. */
export function fmtMinor(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor === null || minor === undefined) return fmtMoney(null);
  return fmtMoney(money(minor, currency ?? 'EUR'));
}

function bidCountLabel(bidCount: number): string {
  return `${bidCount} Gebot(e)`;
}

/**
 * How long ago an ad went up — and it has to know how precisely the source said so.
 *
 * `listedAtPrecision` exists because Quoka prints `heute 14:44` on some rows and
 * `20 August` on others: the second one resolves to midnight, which is the
 * EARLIEST instant that day could mean rather than when the ad appeared. As one
 * ISO string the two are indistinguishable, and rendering the day-precise ones
 * as "vor 2 d" states a distance the source never gave. The `since` filter
 * already learned this (`filter.ts`); the reader was still being told a number.
 */
function ago(
  iso: string | null,
  now: number,
  precision: Listing['listedAtPrecision'] = 'minute',
): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  if (precision === 'day') {
    const days = Math.floor((now - then) / 86_400_000);
    if (days <= 0) return 'heute';
    if (days === 1) return 'gestern';
    return `am ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(then)}`;
  }
  const hours = Math.round((now - then) / 3_600_000);
  if (hours < 1) return 'gerade eben';
  if (hours < 24) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} d`;
}

/** How long an auction still has. Coarse on purpose — the exact instant is in the data. */
function until(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((at - now) / 60_000);
  if (minutes < 0) return 'beendet';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 60 * 24) return `in ${Math.round(minutes / 60)} h`;
  return `in ${Math.round(minutes / (60 * 24))} d`;
}

/**
 * The heading over a source's block.
 *
 * The default layout used to print none: every block restarted at `1.`, and the
 * footer listed six sources against four blocks, so the Nth heading was not the
 * Nth block. Which market an offer is on is half the answer this project gives.
 */
export function sourceHeading(provider: ProviderId, count: number): string {
  return `${providerLabel(provider)} (${count})`;
}

/**
 * What was left out of a source's block, in words.
 *
 * The discriminator between "this source has more for you" and "this is all
 * there was". Without it a capped result and an exhausted source read the same.
 */
function truncationNote(report: ProviderReport): string {
  if (report.filters.dropped > 0)
    return ` (${report.filters.dropped} weitere passten und fielen dem Limit zum Opfer)`;
  return report.truncated ? ' (mehr vorhanden, abgeschnitten)' : '';
}

/**
 * One line per source, and it must never be trimmed for tidiness.
 *
 * A source that was skipped, refused or broke reads exactly like a source with
 * no matches unless it is spelled out, and "no matches" is the answer a user
 * acts on. `outcome` is `ok | empty | skipped | failed` and never a row count,
 * for exactly this reason.
 */
export function reportLine(report: ProviderReport): string {
  const name = providerLabel(report.provider);
  switch (report.outcome) {
    case 'ok':
      return `${name}: ${report.count} Treffer${truncationNote(report)}`;
    case 'empty':
      return `${name}: keine Treffer`;
    case 'skipped':
      return `${name}: übersprungen — ${report.message ?? 'nicht konfiguriert'}`;
    case 'failed':
      // Whether a retry could help is the one thing a user wants to know here,
      // and it is not guessable from the message. `refused` is deliberately not
      // transient: a 403 from a bot wall is a decision, and coming back with
      // anything changed is the circumvention this project refuses to do.
      return (
        `${name}: FEHLER (${report.errorKind}) — ${report.message ?? ''}` +
        (report.errorKind && isTransient(report.errorKind) ? ' (später erneut möglich)' : '')
      );
  }
}

/**
 * The `--explain` block: which filter ran where, and what nobody could apply.
 *
 * Returned as lines with a `strong` flag rather than as one string, because the
 * "NICHT angewandt" line is the one a reader must not skim past — a terminal
 * makes it undimmed, a GUI gives it a colour, and neither should have to decide
 * which line that is.
 */
export interface ExplainLine {
  readonly text: string;
  /** True for the line that says a filter did not take effect. */
  readonly strong: boolean;
}

export function explainLines(report: ProviderReport): ExplainLine[] {
  const lines: ExplainLine[] = [
    { text: `Filter beim Anbieter: ${report.filters.serverSide.join(', ') || '—'}`, strong: false },
    {
      text:
        `Filter hier nachgezogen: ${report.filters.clientSide.join(', ') || '—'}` +
        (report.filters.clientSide.length > 0
          ? ` (auf ${report.filters.before} abgerufene Treffer, ${report.filters.after} blieben)`
          : ''),
      strong: false,
    },
  ];
  if (report.filters.unenforced.length > 0) {
    lines.push({
      text: `NICHT angewandt: ${report.filters.unenforced.join(', ')} — diese Quelle kann es nicht, und lokal ist es nicht entscheidbar.`,
      strong: true,
    });
  }
  // `null` means the provider cannot account for its requests. Printing `0`
  // there claimed a fact — a failed Booklooker run that had spent a request and
  // burned quota was booked as "0 Anfragen, 1189 ms".
  const spent = report.requests === null ? 'Anfragen nicht gebucht' : `${report.requests} Anfragen`;
  lines.push({ text: `${spent}, ${report.durationMs} ms`, strong: false });
  return lines;
}

/**
 * One source's price band — or, in words, why there is none.
 *
 * Never one band across sources: measured, that put a Discogs aggregate minimum,
 * a Quoka asking price and the current bid on a car in the same quartiles. The
 * heading names what the numbers ARE, because "Preisband über 23 Angebote" was
 * three kinds of number and 23 was not the row count.
 */
export interface BandText {
  readonly headline: string;
  /**
   * The five figures, already formatted, in order — or `null` when there is no
   * band.
   *
   * Handed over as parts rather than as one line so a surface can give the
   * median the weight it deserves without picking it back out of a string. A
   * `String.replace` for that is wrong on the band it matters most for: when
   * min, median and max are the same amount, it emphasises the first one.
   */
  readonly quantiles: {
    readonly min: string;
    readonly p25: string;
    readonly median: string;
    readonly p75: string;
    readonly max: string;
  } | null;
  readonly caveats: readonly string[];
}

export function bandText(band: PriceBand): BandText {
  if (band.kind === 'none') {
    return { headline: `kein Preisband — ${band.reason}`, quantiles: null, caveats: [] };
  }
  const s = band.stats;
  const scope = s.count === s.considered ? `${s.count}` : `${s.count} von ${s.considered}`;
  return {
    headline:
      `Preisband über ${scope} ${BASIS_LABEL[s.basis]}` + (s.shippingIncluded ? SHIPPING_INCLUDED : ''),
    quantiles: {
      min: fmtMoney(s.min),
      p25: fmtMoney(s.p25),
      median: fmtMoney(s.median),
      p75: fmtMoney(s.p75),
      max: fmtMoney(s.max),
    },
    caveats: s.caveats,
  };
}

/**
 * A source's switch and readiness, in one phrase.
 *
 * Two views said this three ways and two of them disagreed — one printed „an",
 * the other „bereit" for the same state. A GUI toggle row would have been the
 * third spelling.
 *
 * FOUR states, not three, because `MarketProvider.status()` promises four:
 * off, on-but-unconfigured, on-and-working, and on-with-credentials-that-do-not
 * work. Reading only the two booleans collapsed the last pair, and the result
 * was `check` printing „ebay bereit" one line above eBay's own 401 — a keyset
 * that existed, was spelled correctly, and was disabled at the operator's end.
 * Justiz-Auktion lands in the same state permanently and by design.
 *
 * `problem` is REQUIRED for that reason. Optional, a caller that forgets it
 * gets „bereit" for a broken source, which is exactly the sentence this
 * function was written to stop two views from disagreeing about.
 */
export function providerState(source: {
  enabled: boolean;
  configured: boolean;
  problem: string | null;
}): string {
  if (!source.enabled) return 'aus';
  if (!source.configured) return 'an, aber nicht konfiguriert';
  return source.problem === null ? 'bereit' : 'an, aber nicht nutzbar';
}

/**
 * What the barcode cross-check cost and what it bought — or `null` when there
 * is nothing to say.
 *
 * Never silently: the pass spends requests the reader's query did not ask for,
 * and a cap that quietly dropped barcodes would make a partial comparison look
 * like a complete one. Both numbers are therefore in the sentence.
 */
export function crossCheckNotice(check: CrossCheckReport | null): string | null {
  if (check === null || check.asked === 0) return null;
  const parts = [
    `${check.gtins} Barcode(s) bei den übrigen Quellen gegengeprüft (${check.asked} Abfrage(n))`,
  ];
  parts.push(
    check.added > 0 ? `${check.added} zusätzliche(s) Angebot(e)` : 'keine zusätzlichen Angebote',
  );
  if (check.skipped > 0) {
    parts.push(`${check.skipped} weitere(r) Barcode(s) NICHT geprüft — Obergrenze erreicht`);
  }
  if (check.failed.length > 0) {
    parts.push(`ohne Antwort: ${check.failed.map(providerLabel).join(', ')}`);
  }
  return `${parts.join(' · ')}.`;
}

/** What a search asked for that cannot take effect, said before the results. */
export function gapNotice(gap: string): string {
  return `Hinweis: ${gap}`;
}

/**
 * Rows missing from a merged list by LICENCE, not by chance.
 *
 * A reader who is not told reads the merged list as "everything". Returns `null`
 * when nothing was excluded, so a surface cannot render an empty notice.
 */
export function mergeExcludedNotice(excluded: readonly ProviderId[]): string | null {
  if (excluded.length === 0) return null;
  const names = excluded.map(providerLabel).join(', ');
  return (
    `${names} steht NICHT in dieser gemischten Liste — die Lizenz verlangt, ` +
    'diese Zeilen von fremden getrennt zu zeigen. Die Treffer stehen ohne --merge da.'
  );
}

/**
 * The distinction that matters more than any other in this project.
 *
 * "Nobody answered" is not the same fact as "nothing matched", and only the
 * second one means the thing is not out there. `null` when there is nothing to
 * say, so no surface prints a reassurance it did not earn.
 */
export function emptinessNotice(noSourceAnswered: boolean, rowCount: number): string | null {
  if (noSourceAnswered)
    return 'Keine einzige Quelle hat geantwortet — das ist NICHT dasselbe wie "nichts gefunden".';
  return rowCount === 0 ? 'Keine Treffer.' : null;
}

/**
 * The identity a compare group was built on, in words — or `null`.
 *
 * `null` on a group of one, where "gleicher Titel, gleicher Preis" describes
 * nothing that happened. The `gtin:` prefix is a kernel-internal key format and
 * was being decoded inside a view with a `slice(5)`.
 */
export function groupIdentityLabel(identity: string | null, size: number): string | null {
  if (size < 2 || identity === null) return null;
  return identity.startsWith('gtin:') ? `GTIN ${identity.slice(5)}` : 'gleicher Titel, gleicher Preis';
}

export const AMBIGUOUS_GROUP_NOTICE =
  'Achtung: eine Quelle führt mehrere davon — dieselbe Nummer, verschiedene Ausgaben. Kein gemeinsamer Preis.';

export function groupSpread(size: number, sources: number): string {
  return `${size} Angebot(e) auf ${sources} Quelle(n)`;
}

/**
 * The facts under a listing's title, in the order they are read.
 *
 * Returned as an array so a surface joins them the way its medium wants —
 * a terminal with " · ", a GUI as separate labels — without any of them having
 * to know which facts a listing has.
 */
export function listingFacts(
  listing: Listing,
  now: number,
  extras: readonly string[] = [],
): string[] {
  const auction =
    listing.priceKind === 'auction'
      ? [
          listing.endsAt ? `endet ${until(listing.endsAt, now)}` : '',
          listing.bidCount !== null ? bidCountLabel(listing.bidCount) : '',
        ]
      : [];
  return [
    CONDITION_LABEL[listing.condition],
    SELLER_TYPE_LABEL[listing.sellerType],
    DELIVERY_LABEL[listing.delivery],
    fmtLocation(listing.location),
    ...auction,
    ago(listing.listedAt, now, listing.listedAtPrecision),
    ...extras,
  ].filter(Boolean);
}

/**
 * The price as printed, and whether it already contains postage.
 *
 * Two fields rather than one string: a terminal appends „inkl. Versand" to the
 * amount, a GUI puts it in a separate dimmed label, and neither should have to
 * split the other's sentence apart to do it.
 */
export function listingPrice(listing: Listing): { readonly text: string; readonly shipping: string } {
  return {
    text: fmtPriceWithKind(listing.totalPrice ?? listing.price, listing.priceKind),
    shipping: listing.totalPrice !== null ? SHIPPING_INCLUDED : '',
  };
}
