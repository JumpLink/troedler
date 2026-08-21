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
  PRICE_KIND_LABEL,
  PROVIDER_LABEL,
  SELLER_TYPE_LABEL,
  VERDICT_LABEL,
  fmtMoney,
  type Listing,
  type PriceStats,
  type PriceVerdict,
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

export function renderListing(listing: Listing, verdict: PriceVerdict | undefined, index: number): string {
  const price = fmtMoney(listing.totalPrice ?? listing.price);
  const kind = PRICE_KIND_LABEL[listing.priceKind];
  const where = [listing.location.postalCode, listing.location.city].filter(Boolean).join(' ');
  const facts = [
    CONDITION_LABEL[listing.condition],
    SELLER_TYPE_LABEL[listing.sellerType],
    DELIVERY_LABEL[listing.delivery],
    where,
    ago(listing.listedAt),
    verdict && verdict !== 'unknown' ? VERDICT_LABEL[verdict] : '',
  ].filter(Boolean);

  return [
    `${String(index).padStart(3)}. ${style(BOLD, listing.title)}`,
    `     ${price}${kind ? ` ${kind}` : ''}  ${style(DIM, facts.join(' · '))}`,
    `     ${style(DIM, listing.url)}`,
  ].join('\n');
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
  const head = {
    ok: `${name}: ${report.count} Treffer${report.truncated ? ' (mehr vorhanden, abgeschnitten)' : ''}`,
    empty: `${name}: keine Treffer`,
    skipped: `${name}: übersprungen — ${report.message ?? 'nicht konfiguriert'}`,
    failed: `${name}: FEHLER (${report.errorKind}) — ${report.message ?? ''}`,
  }[report.outcome];

  const lines = [report.outcome === 'failed' ? head : style(DIM, head)];

  for (const warning of report.warnings) lines.push(style(DIM, `    Hinweis: ${warning}`));
  if (report.disclaimer) lines.push(style(DIM, `    ${report.disclaimer}`));

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
    lines.push(style(DIM, `    ${report.requests} Anfragen, ${report.durationMs} ms`));
  }
  return lines.join('\n');
}

export function renderStats(stats: PriceStats | null): string {
  if (!stats) return '';
  return style(
    DIM,
    `Preisband über ${stats.count} Angebote: ${fmtMoney(stats.min)} … ${fmtMoney(stats.p25)} — ` +
      `${style(BOLD, fmtMoney(stats.median))} — ${fmtMoney(stats.p75)} … ${fmtMoney(stats.max)}`,
  );
}
