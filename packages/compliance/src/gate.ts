/**
 * The gate every outbound request passes through.
 *
 * It answers one question — may we fetch this URL right now — from three
 * independent facts: the opt-out list, the host's robots.txt, and whether the
 * user switched this source on. Any one of them can say no, and a no is
 * returned as a value rather than thrown, so a caller cannot forget to handle
 * it and a `--explain` run can show exactly which of the three refused.
 *
 * robots.txt is fetched through an injected loader instead of being fetched
 * here. That keeps this package free of network code and testable, and it is
 * why the matcher — the part that must be right — has unit tests that never
 * touch a socket.
 */

import { isAllowed, type Robots, type RobotsVerdict } from './robots.ts';
import { isOptedOut, sourceFor } from './sources.ts';

export type DenyReason = 'opted-out' | 'robots' | 'disabled';

/**
 * WHAT decided — and the reason this field exists is a defect it makes
 * impossible.
 *
 * For a documented API host, robots.txt is not the rule that applies: the
 * operator's own licence is, and the file served at `/robots.txt` governs
 * crawling the website. Measured 2026-08-22, `api.booklooker.de/robots.txt`
 * ends in `User-agent: *` / `Disallow: /` — so a gate that consulted it would
 * refuse the very REST API this project holds a free key for.
 *
 * That branch used to live in `HttpClient` INSTEAD of here, which meant the gate
 * and the thing that actually opens sockets answered differently, and
 * `troedler robots https://api.booklooker.de/2.0/search` printed „VERBOTEN" for
 * a URL every Booklooker search fetches. One decision site, one answer.
 */
export type GateBasis = 'opt-out' | 'disabled' | 'robots' | 'licence';

export interface GateVerdict {
  readonly allowed: boolean;
  readonly reason: DenyReason | null;
  /** Sentence fit to show the user. Names the rule, never just "blocked". */
  readonly detail: string | null;
  /** Seconds to wait between requests to this host. */
  readonly delaySeconds: number;
  /** Which of the four things decided this verdict. */
  readonly basis: GateBasis;
}

/**
 * Politeness floor when a host publishes no Crawl-delay.
 *
 * Two seconds and a single connection per host. Not a guess: it is the pace
 * every well-behaved reference implementation in this space settles on, it
 * keeps us far below anything that could count as burdening the
 * infrastructure, and it makes the tool indistinguishable from a person
 * clicking through result pages — which is exactly what it is doing on the
 * user's behalf.
 */
export const DEFAULT_DELAY_SECONDS = 2;

export interface GateInput {
  readonly url: URL;
  readonly userAgent: string;
  /** `null` when the host serves no robots.txt — which means no restrictions. */
  readonly robots: Robots | null;
  /** Whether the user enabled this source. */
  readonly enabled: boolean;
  /**
   * A documented API host, called under the operator's own licence.
   *
   * Required rather than optional on purpose: it changes which rule applies, and
   * a caller that forgets it gets a different answer from the one the socket
   * layer will act on. That divergence is what this flag was moved here to end.
   */
  readonly apiHost: boolean;
}

export function evaluate(input: GateInput): GateVerdict {
  const host = input.url.host.toLowerCase();

  if (isOptedOut(host)) {
    return {
      allowed: false,
      reason: 'opted-out',
      detail: `${host} hat dem automatisierten Abruf widersprochen und steht auf der Opt-out-Liste.`,
      delaySeconds: DEFAULT_DELAY_SECONDS,
      basis: 'opt-out',
    };
  }

  if (!input.enabled) {
    const record = sourceFor(host);
    return {
      allowed: false,
      reason: 'disabled',
      detail:
        record?.automatedAccess === 'forbidden'
          ? `${host} ist abgeschaltet. Die Nutzungsbedingungen dieses Anbieters untersagen automatisierten Abruf — siehe ${record.doc}.`
          : `${host} ist nicht aktiviert.`,
      delaySeconds: DEFAULT_DELAY_SECONDS,
      basis: 'disabled',
    };
  }

  // An API host is governed by its licence, not by the website's crawl rules,
  // and it carries no politeness floor: these operators publish their own limits
  // and the adapters throttle against those. Both facts are decided here so that
  // every caller — the socket layer and `troedler robots` alike — gets them.
  if (input.apiHost) {
    const record = sourceFor(host);
    return {
      allowed: true,
      reason: null,
      detail: record
        ? `${host} ist eine dokumentierte API. Es gilt die Lizenz des Anbieters, nicht die robots.txt der Website — siehe ${record.doc}.`
        : `${host} wird als dokumentierte API abgerufen; robots.txt wird dafür nicht ausgewertet.`,
      delaySeconds: 0,
      basis: 'licence',
    };
  }

  const verdict: RobotsVerdict = input.robots
    ? isAllowed(input.robots, input.userAgent, input.url.pathname + input.url.search)
    : { allowed: true, rule: null, crawlDelaySeconds: null };

  const delaySeconds = Math.max(verdict.crawlDelaySeconds ?? 0, DEFAULT_DELAY_SECONDS);

  if (!verdict.allowed) {
    return {
      allowed: false,
      reason: 'robots',
      detail: `robots.txt von ${host} verbietet ${input.url.pathname}${input.url.search} (${verdict.rule}).`,
      delaySeconds,
      basis: 'robots',
    };
  }
  return { allowed: true, reason: null, detail: null, delaySeconds, basis: 'robots' };
}
