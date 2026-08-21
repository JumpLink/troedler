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

export interface GateVerdict {
  readonly allowed: boolean;
  readonly reason: DenyReason | null;
  /** Sentence fit to show the user. Names the rule, never just "blocked". */
  readonly detail: string | null;
  /** Seconds to wait between requests to this host. */
  readonly delaySeconds: number;
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
}

export function evaluate(input: GateInput): GateVerdict {
  const host = input.url.host.toLowerCase();

  if (isOptedOut(host)) {
    return {
      allowed: false,
      reason: 'opted-out',
      detail: `${host} hat dem automatisierten Abruf widersprochen und steht auf der Opt-out-Liste.`,
      delaySeconds: DEFAULT_DELAY_SECONDS,
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
    };
  }
  return { allowed: true, reason: null, detail: null, delaySeconds };
}
