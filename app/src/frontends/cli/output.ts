/**
 * Shared CLI output — and by now, only the parts that are genuinely terminal.
 *
 * Two renderings of every result: `--json` for pipes and for anything that
 * parses, and a human one by default. The human one is the interesting case —
 * it must show the things that are easy to leave out and expensive to miss:
 * which sources answered, which filters actually ran where, and whether a
 * source was skipped rather than empty.
 *
 * Every sentence of that now comes from `@troedler/core`'s `present.ts`. This
 * file decides ANSI codes, column widths and where the newlines go; it decides
 * nothing a reader could quote. That split is the rule AGENTS.md states — "a
 * second copy of a presentation constant is how the CLI and the GUI end up
 * disagreeing about the same offer" — and it was already being broken here:
 * „ inkl. Versand" stood three times in this one file, the location format
 * again in the MCP tools, and the provider tri-state said „an" in one view and
 * „bereit" in another.
 */

import {
  AMBIGUOUS_GROUP_NOTICE,
  bandText,
  bestOf,
  explainLines,
  groupIdentityLabel,
  groupSpread,
  listingFacts,
  listingPrice,
  providerLabel,
  reportLine,
  sourceHeading,
  VERDICT_LABEL,
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

export function renderListing(listing: Listing, verdict: PriceVerdict | undefined, index: number): string {
  const price = listingPrice(listing);
  const facts = listingFacts(
    listing,
    Date.now(),
    verdict && verdict !== 'unknown' ? [VERDICT_LABEL[verdict]] : [],
  );

  return [
    `${String(index).padStart(3)}. ${style(BOLD, listing.title)}`,
    `     ${price.text}${price.shipping}  ${style(DIM, facts.join(' · '))}`,
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
  return style(BOLD, sourceHeading(provider, count));
}

/**
 * The per-source footer.
 *
 * This is the part that must never be trimmed for tidiness. A source that was
 * skipped, refused or broke reads exactly like a source with no matches unless
 * it is spelled out here, and "no matches" is the answer a user acts on.
 */
export function renderReport(report: ProviderReport, explain: boolean): string {
  const head = reportLine(report);
  const lines = [report.outcome === 'failed' ? head : style(DIM, head)];

  for (const warning of report.warnings) lines.push(style(DIM, `    Hinweis: ${warning}`));
  // A provenance notice for data that is not there is noise at best and a claim
  // at worst — it stood under every skipped eBay run with `count: 0`.
  if (report.disclaimer && report.count > 0) lines.push(style(DIM, `    ${report.disclaimer}`));

  if (explain) {
    // `strong` marks the one line a reader must not skim past: a filter that did
    // not take effect. The terminal spends its only emphasis on it.
    for (const line of explainLines(report)) {
      lines.push(line.strong ? `    ${line.text}` : style(DIM, `    ${line.text}`));
    }
  }
  return lines.join('\n');
}

/**
 * One source's price band — or, in words, why there is none.
 *
 * Never one band across sources: measured, that put a Discogs aggregate
 * minimum, a Quoka asking price and the current bid on a car in the same
 * quartiles.
 */
export function renderBand(band: PriceBand): string {
  const text = bandText(band);
  if (text.quantiles === null) return style(DIM, `     ${text.headline}`);
  // The median is the number a reader takes away, so it is the one thing in the
  // band that gets weight — which is a terminal decision, hence made here.
  const q = text.quantiles;
  const quantiles = `${q.min} … ${q.p25} — ${style(BOLD, q.median)} — ${q.p75} … ${q.max}`;
  const lines = [style(DIM, `     ${text.headline}: ${quantiles}`)];
  for (const caveat of text.caveats) lines.push(style(DIM, `       (${caveat})`));
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
  const head = groupIdentityLabel(group.identity, group.listings.length);

  const lines = [
    `${String(index).padStart(3)}. ${style(BOLD, group.listings[0].title)}`,
    style(DIM, `     ${head ? `${head} · ` : ''}${groupSpread(group.listings.length, sources.size)}`),
  ];
  // `null` for an ambiguous group, and that is the point: naming a cheapest
  // row of a bucket that holds three different pressings answers a question
  // nobody asked, in a number the reader would act on.
  const best = bestOf(group);
  if (group.ambiguous) lines.push(`     ${AMBIGUOUS_GROUP_NOTICE}`);
  for (const l of group.listings) {
    const price = listingPrice(l);
    const verdict = verdicts.get(l.key);
    const tail = verdict && verdict !== 'unknown' ? ` · ${VERDICT_LABEL[verdict]}` : '';
    const mark = best !== null && best.key === l.key ? '→' : ' ';
    lines.push(
      `     ${mark} ${providerLabel(l.provider).padEnd(14)} ${price.text}${price.shipping}${style(DIM, tail)}`,
    );
    lines.push(style(DIM, `       ${l.url}`));
  }
  return lines.join('\n');
}
