/**
 * Shared CLI output.
 *
 * Two renderings of every result: `--json` for pipes and for anything that
 * parses, and a human one by default. The human one is the interesting case —
 * it must show the things that are easy to leave out and expensive to miss:
 * which sources answered, which filters actually ran where, and whether a
 * source was skipped rather than empty.
 */

import {
  CONDITION_LABEL,
  DELIVERY_LABEL,
  PROVIDER_LABEL,
  SELLER_TYPE_LABEL,
  BASIS_LABEL,
  VERDICT_LABEL,
  bestOf,
  fmtMoney,
  fmtPriceWithKind,
  isTransient,
  type Listing,
  type ListingGroup,
  type PriceBand,
  type PriceVerdict,
  type ProviderId,
  type ProviderReport,
} from '@troedler/core';

export function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

export function runAndExit<T>(fn: () => Promise<T>, options: { print?: (value: T) => void } = {}): void {
  const print = options.print ?? printJson;
  fn()
    .then(print)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

/**
 * Read an option from yargs argv, trying each spelling in turn — yargs exposes
 * kebab-case as camelCase and sometimes both.
 */
export function pickArgv<T>(argv: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const v = argv[key];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

const DIM = '\u001B[2m';
const BOLD = '\u001B[1m';
const RESET = '\u001B[0m';

/** Colour only when stdout is a terminal — a redirected file gets plain text. */
function style(code: string, text: string): string {
  return process.stdout.isTTY ? `${code}${text}${RESET}` : text;
}

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const hours = Math.round((now - then) / 3_600_000);
  if (hours < 1) return 'gerade eben';
  if (hours < 24) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} d`;
}

/** How long an auction still has. Coarse on purpose — the exact instant is in `--json`. */
function until(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((at - now) / 60_000);
  if (minutes < 0) return 'beendet';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 60 * 24) return `in ${Math.round(minutes / 60)} h`;
  return `in ${Math.round(minutes / (60 * 24))} d`;
}

export function renderListing(listing: Listing, verdict: PriceVerdict | undefined, index: number): string {
  const price = fmtPriceWithKind(listing.totalPrice ?? listing.price, listing.priceKind);
  // Say so when the printed number already contains postage — otherwise two
  // rows in the same list silently mean different things.
  const shipping = listing.totalPrice !== null ? ' inkl. Versand' : '';
  const where = [listing.location.postalCode, listing.location.city].filter(Boolean).join(' ');
  // For the one source with real auctions, the end and the number of bids are
  // the two fields the decision hangs on — and the reading view showed neither.
  const auction =
    listing.priceKind === 'auction'
      ? [
          listing.endsAt ? `endet ${until(listing.endsAt)}` : '',
          listing.bidCount !== null ? `${listing.bidCount} Gebot(e)` : '',
        ]
      : [];

  const facts = [
    CONDITION_LABEL[listing.condition],
    SELLER_TYPE_LABEL[listing.sellerType],
    DELIVERY_LABEL[listing.delivery],
    where,
    ...auction,
    ago(listing.listedAt),
    verdict && verdict !== 'unknown' ? VERDICT_LABEL[verdict] : '',
  ].filter(Boolean);

  return [
    `${String(index).padStart(3)}. ${style(BOLD, listing.title)}`,
    `     ${price}${shipping}  ${style(DIM, facts.join(' · '))}`,
    `     ${style(DIM, listing.url)}`,
  ].join('\n');
}

/**
 * The heading over a source's block.
 *
 * The default layout groups by source and used to print no heading at all:
 * every block restarted at `1.`, and the footer listed six sources against four
 * blocks, so the Nth heading was not the Nth block. Which market an offer is on
 * is half the answer this project exists to give.
 */
export function renderGroupHeading(provider: ProviderId, count: number): string {
  return style(BOLD, `${PROVIDER_LABEL[provider] ?? provider} (${count})`);
}

/**
 * The per-source footer.
 *
 * This is the part that must never be trimmed for tidiness. A source that was
 * skipped, refused or broke reads exactly like a source with no matches unless
 * it is spelled out here, and "no matches" is the answer a user acts on.
 */
export function renderReport(report: ProviderReport, explain: boolean): string {
  const name = PROVIDER_LABEL[report.provider] ?? report.provider;
  const cut =
    report.filters.dropped > 0
      ? ` (${report.filters.dropped} weitere passten und fielen dem Limit zum Opfer)`
      : report.truncated
        ? ' (mehr vorhanden, abgeschnitten)'
        : '';
  const head = {
    ok: `${name}: ${report.count} Treffer${cut}`,
    empty: `${name}: keine Treffer`,
    skipped: `${name}: übersprungen — ${report.message ?? 'nicht konfiguriert'}`,
    // Whether a retry could help is the one thing a user wants to know here,
    // and it is not guessable from the message. `refused` is deliberately not
    // transient: a 403 from a bot wall is a decision, and coming back with
    // anything changed is the circumvention this project refuses to do.
    failed:
      `${name}: FEHLER (${report.errorKind}) — ${report.message ?? ''}` +
      (report.errorKind && isTransient(report.errorKind) ? ' (später erneut möglich)' : ''),
  }[report.outcome];

  const lines = [report.outcome === 'failed' ? head : style(DIM, head)];

  for (const warning of report.warnings) lines.push(style(DIM, `    Hinweis: ${warning}`));
  // A provenance notice for data that is not there is noise at best and a claim
  // at worst — it stood under every skipped eBay run with `count: 0`.
  if (report.disclaimer && report.count > 0) lines.push(style(DIM, `    ${report.disclaimer}`));

  if (explain) {
    const server = report.filters.serverSide.join(', ') || '—';
    const client = report.filters.clientSide.join(', ') || '—';
    lines.push(style(DIM, `    Filter beim Anbieter: ${server}`));
    lines.push(
      style(
        DIM,
        `    Filter hier nachgezogen: ${client}` +
          (report.filters.clientSide.length > 0
            ? ` (auf ${report.filters.before} abgerufene Treffer, ${report.filters.after} blieben)`
            : ''),
      ),
    );
    if (report.filters.unenforced.length > 0) {
      lines.push(
        `    NICHT angewandt: ${report.filters.unenforced.join(', ')} — diese Quelle kann es nicht, und lokal ist es nicht entscheidbar.`,
      );
    }
    // `null` means the provider cannot account for its requests. Printing `0`
    // there claimed a fact — a failed Booklooker run that had spent a request
    // and burned quota was booked as "0 Anfragen, 1189 ms".
    const spent = report.requests === null ? 'Anfragen nicht gebucht' : `${report.requests} Anfragen`;
    lines.push(style(DIM, `    ${spent}, ${report.durationMs} ms`));
  }
  return lines.join('\n');
}

/**
 * One source's price band — or, in words, why there is none.
 *
 * Never one band across sources: measured, that put a Discogs aggregate
 * minimum, a Quoka asking price and the current bid on a car in the same
 * quartiles. The heading now names what the numbers ARE, because "Preisband
 * über 23 Angebote" was three kinds of number and 23 was not the row count.
 */
export function renderBand(band: PriceBand): string {
  if (band.kind === 'none') return style(DIM, `     kein Preisband — ${band.reason}`);
  const s = band.stats;
  const scope = s.count === s.considered ? `${s.count}` : `${s.count} von ${s.considered}`;
  const money =
    `${fmtMoney(s.min)} … ${fmtMoney(s.p25)} — ${style(BOLD, fmtMoney(s.median))} — ` +
    `${fmtMoney(s.p75)} … ${fmtMoney(s.max)}`;
  const lines = [
    style(
      DIM,
      `     Preisband über ${scope} ${BASIS_LABEL[s.basis]}` +
        `${s.shippingIncluded ? ' inkl. Versand' : ''}: ${money}`,
    ),
  ];
  for (const caveat of s.caveats) lines.push(style(DIM, `       (${caveat})`));
  return lines.join('\n');
}

/**
 * One product across the sources that carry it — the question this project
 * exists for: "what does this thing cost, and where".
 *
 * An ambiguous group is shown, not collapsed. Reporting the cheapest row of a
 * bucket that holds three different pressings of one barcode answers a
 * question nobody asked, in a number the user would act on.
 */
export function renderGroup(
  group: ListingGroup,
  index: number,
  verdicts: ReadonlyMap<string, PriceVerdict>,
): string {
  const sources = new Set(group.listings.map((l) => l.provider));
  // The identity is only worth naming when it actually joined rows. On a group
  // of one, "gleicher Titel, gleicher Preis" describes nothing that happened.
  const head =
    group.listings.length < 2 || group.identity === null
      ? null
      : group.identity.startsWith('gtin:')
        ? `GTIN ${group.identity.slice(5)}`
        : 'gleicher Titel, gleicher Preis';

  const lines = [
    `${String(index).padStart(3)}. ${style(BOLD, group.listings[0].title)}`,
    style(
      DIM,
      `     ${head ? `${head} · ` : ''}${group.listings.length} Angebot(e) auf ${sources.size} Quelle(n)`,
    ),
  ];
  // `null` for an ambiguous group, and that is the point: naming a cheapest
  // row of a bucket that holds three different pressings answers a question
  // nobody asked, in a number the reader would act on.
  const best = bestOf(group);
  if (group.ambiguous) {
    lines.push(
      `     Achtung: eine Quelle führt mehrere davon — dieselbe Nummer, verschiedene Ausgaben. Kein gemeinsamer Preis.`,
    );
  }
  for (const l of group.listings) {
    const price = fmtPriceWithKind(l.totalPrice ?? l.price, l.priceKind);
    const verdict = verdicts.get(l.key);
    const tail = verdict && verdict !== 'unknown' ? ` · ${VERDICT_LABEL[verdict]}` : '';
    const mark = best !== null && best.key === l.key ? '→' : ' ';
    lines.push(
      `     ${mark} ${(PROVIDER_LABEL[l.provider] ?? l.provider).padEnd(14)} ${price}` +
        `${l.totalPrice !== null ? ' inkl. Versand' : ''}${style(DIM, tail)}`,
    );
    lines.push(style(DIM, `       ${l.url}`));
  }
  return lines.join('\n');
}
