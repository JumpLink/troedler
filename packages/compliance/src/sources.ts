/**
 * The source register — one machine-readable entry per host we ever contact.
 *
 * The rule this file exists to enforce: **no adapter without a source record.**
 * Adding a marketplace means first reading its robots.txt and its terms and
 * writing `docs/quellen/<host>.md`, then registering the verdict here, and only
 * then writing code. Doing it the other way round is how a project ends up
 * with six adapters and no idea which of them it is allowed to run.
 *
 * `automatedAccess` is a finding about the operator's TERMS, entirely separate
 * from robots.txt. The two disagree often enough that conflating them would be
 * useless: refurbed.de serves `Allow: /` to everyone and forbids crawlers in
 * clause 13.2 of its terms; kleinanzeigen.de forbids them in § 5 of its terms
 * *and* disallows the interesting paths.
 */

export type TermsVerdict =
  /** The operator offers an API or otherwise permits this use. */
  | 'permitted'
  /** Terms are silent on automated access; robots.txt governs. */
  | 'silent'
  /** Terms forbid automated access. Using the source anyway is the user's decision. */
  | 'forbidden';

export interface SourceRecord {
  readonly host: string;
  /** Path of the human record, relative to the repo root. */
  readonly doc: string;
  /** When a person last read the terms and robots.txt. Staleness is visible, not hidden. */
  readonly checked: string;
  readonly automatedAccess: TermsVerdict;
  /** The clause, quoted short. Present whenever `automatedAccess !== 'silent'`. */
  readonly clause: string | null;
}

export const SOURCES: readonly SourceRecord[] = [
  {
    host: 'api.ebay.com',
    doc: 'docs/quellen/ebay.de.md',
    checked: '2026-08-21',
    automatedAccess: 'permitted',
    clause:
      'Browse API under the eBay API License Agreement; listing data must not be shown more than 6 h stale.',
  },
  {
    host: 'api.discogs.com',
    doc: 'docs/quellen/discogs.com.md',
    checked: '2026-08-21',
    automatedAccess: 'permitted',
    clause:
      'Public API, 25 requests/min unauthenticated, 60 with a token. Release data is CC0; "Marketplace Data … including but not limited to: pricing" is Restricted Data — not to be passed to third parties or used commercially, and displayed no more than six hours stale.',
  },
  {
    host: 'api.booklooker.de',
    doc: 'docs/quellen/booklooker.de.md',
    checked: '2026-08-21',
    automatedAccess: 'permitted',
    clause:
      'Documented REST API v2.0, free key. The binding limit is the SEARCH interface at 50 calls per 10 minutes, not the global 100/min ceiling — one call every twelve seconds.',
  },
  {
    host: 'www.kleinanzeigen.de',
    doc: 'docs/quellen/kleinanzeigen.de.md',
    checked: '2026-08-21',
    automatedAccess: 'forbidden',
    clause:
      'Nutzungsbedingungen § 5: "ohne die ausdrückliche schriftliche Zustimmung von Kleinanzeigen Crawler, Spider, Scraper oder andere automatisierte Mechanismen zu nutzen, um auf die Kleinanzeigen-Dienste zuzugreifen und Inhalte zu sammeln" is prohibited.',
  },
  {
    host: 'www.zoll-auktion.de',
    doc: 'docs/quellen/zoll-auktion.de.md',
    checked: '2026-08-21',
    automatedAccess: 'silent',
    clause:
      '§ 8 Systemintegrität (1): content may not be copied, distributed or otherwise reproduced without prior consent — a restriction on redistributing what is read, not on reading it. robots.txt is `Allow: /` for everyone.',
  },
  {
    host: 'www.justiz-auktion.de',
    doc: 'docs/quellen/justiz-auktion.de.md',
    checked: '2026-08-21',
    automatedAccess: 'silent',
    clause:
      '§ 9 Urheberrecht und Verwendungsbeschränkung, word for word the clause zoll-auktion.de carries as § 8 (1): no copying or distribution without consent. robots.txt is open.',
  },
  {
    host: 'www.markt.de',
    doc: 'docs/quellen/markt.de.md',
    checked: '2026-08-21',
    // robots.txt says `Allow: /` — and the terms of use say the opposite. The
    // terms win, which is why this reads `forbidden` and the adapter ships off.
    // Exactly the combination the source register exists to keep apart.
    automatedAccess: 'forbidden',
    clause:
      'Nutzungsbedingungen: "Das automatische Auslesen oder Sammeln von Inhalten auf markt.de (z. B. durch Crawler, Spider oder Scraper) ist ohne ausdrückliche schriftliche Erlaubnis verboten." Also forbidden: collecting other users\' personal data, and copying or distributing third-party listing content.',
  },
  {
    host: 'www.quoka.de',
    doc: 'docs/quellen/quoka.de.md',
    checked: '2026-08-21',
    automatedAccess: 'silent',
    clause: null,
  },
];

export function sourceFor(host: string): SourceRecord | null {
  return SOURCES.find((s) => s.host === host) ?? null;
}

/**
 * Hosts that have asked us to stop.
 *
 * Binding, and shipped in the release rather than kept in someone's inbox: a
 * host listed here is refused by the gate no matter what the config says. The
 * contact address that makes an objection possible at all is in the user
 * agent and the README — an opt-out nobody can reach is decoration.
 */
export const OPT_OUT_HOSTS: readonly string[] = [];

export function isOptedOut(host: string): boolean {
  return OPT_OUT_HOSTS.includes(host.toLowerCase());
}
