/**
 * Answering "would troedler fetch this URL, and what decides that" — for real.
 *
 * This is the action behind `troedler robots`, and it is the one command whose
 * whole worth is that it does not describe an idealised version of the program.
 * The project rests on the claim that it fetches only what it is permitted to,
 * and a claim nobody can check is worth nothing.
 *
 * It was checking a different program. `robotsCommand` loaded robots.txt for
 * every host, evaluated the URL against it and printed the result — while the
 * socket layer skips robots.txt entirely on a documented API host and refuses a
 * disabled source before it opens anything at all. Measured 2026-08-22 with the
 * built bundle:
 *
 *     $ troedler robots https://api.booklooker.de/2.0/search?token=x&titel=y
 *     VERBOTEN: …
 *       robots.txt von api.booklooker.de verbietet /2.0/search… (Disallow: /).
 *
 * That URL is the one every Booklooker search fetches, lawfully, as the holder
 * of a free API key. `api.booklooker.de` serves the WEBSITE's robots.txt —
 * 68 344 bytes, ending in `User-agent: *` / `Disallow: /` — which governs
 * crawling the shop and is not the licence for the REST API. So the verification
 * command called the program a violator for doing the right thing, and would
 * have talked the next reader into "fixing" the adapter.
 *
 * The fix is not a special case in the printer. `apiHost` moved INTO the gate
 * (`GateBasis`), so there is one decision site; this action feeds it the same
 * facts the socket layer has — which provider owns the host, whether the user
 * switched it on, whether it is an API — and reports what comes back.
 */

import {
  evaluate,
  isOptedOut,
  sourceFor,
  type DenyReason,
  type GateBasis,
  type SourceRecord,
} from '@troedler/compliance';
import type { AccessKind, ProviderId } from '@troedler/core';

import { isEnabled, type Context } from '../context.ts';

export interface UrlGateProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly access: AccessKind;
  /** After config and `enabledByDefault` — the switch as it really stands. */
  readonly enabled: boolean;
}

export interface UrlGateReport {
  readonly url: string;
  readonly host: string;
  /**
   * The source troedler would reach this host through, or `null`.
   *
   * `null` is a real answer and used to be hidden: no adapter contacts that
   * host, so the verdict below is a hypothetical about a request this program
   * will never make. Printing it as though it described troedler's behaviour is
   * the same kind of untruth as the API case, one step further out.
   */
  readonly provider: UrlGateProvider | null;
  readonly allowed: boolean;
  readonly reason: DenyReason | null;
  readonly basis: GateBasis;
  readonly detail: string | null;
  /** Seconds the rate limiter would keep between requests to this host. */
  readonly delaySeconds: number;
  /** `null` when robots.txt was deliberately NOT read — see `robotsSkipped`. */
  readonly robots: 'parsed' | 'absent' | 'unreadable' | null;
  readonly robotsDetail: string | null;
  /** Why robots.txt was not consulted. `null` when it was. */
  readonly robotsSkipped: string | null;
  readonly source: SourceRecord | null;
}

/**
 * Run one URL through the same gate a search would, and report what decided.
 *
 * Fetches robots.txt in exactly the cases the socket layer would, and in no
 * others. That is not an optimisation: a request for robots.txt is still a
 * request, and the hosts that are switched off are precisely the ones whose
 * operators asked not to be contacted automatically. A verification command that
 * contacted them to prove they are not contacted would be its own defect.
 */
export async function explainUrl(
  context: Context,
  rawUrl: string,
  signal?: AbortSignal,
): Promise<UrlGateReport> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`"${rawUrl}" ist keine vollständige URL — erwartet wird etwas wie https://host/pfad.`);
  }
  const host = parsed.host.toLowerCase();

  const owner = context.providers.find((p) => p.capabilities.host.toLowerCase() === host) ?? null;
  const provider: UrlGateProvider | null = owner
    ? {
        id: owner.capabilities.id,
        label: owner.capabilities.label,
        access: owner.capabilities.access,
        enabled: isEnabled(context.config, owner),
      }
    : null;

  const apiHost = provider?.access === 'official-api';
  // A host no adapter owns is never fetched by troedler at all, so there is no
  // switch to consult; the question then is the plain robots.txt one.
  const enabled = provider ? provider.enabled : true;

  let robots: UrlGateReport['robots'] = null;
  let robotsDetail: string | null = null;
  let robotsSkipped: string | null = null;
  let parsedRobots = null;

  if (isOptedOut(host)) {
    robotsSkipped = 'Der Host steht auf der Opt-out-Liste — es geht nichts mehr an ihn raus.';
  } else if (!enabled) {
    robotsSkipped =
      'Die Quelle ist abgeschaltet. Das Tor lehnt vor jedem Socket ab, und eine Anfrage nach robots.txt wäre selbst eine Anfrage.';
  } else if (apiHost) {
    robotsSkipped =
      'Dokumentierte API — es gilt die Lizenz des Anbieters. Die robots.txt dieses Hosts richtet sich an Crawler der Website und wird nicht ausgewertet.';
  } else {
    // The parsed URL, not the bare host: the scheme is part of the question, and
    // `http://…` used to be answered out of `https://…/robots.txt`.
    const state = await context.http.robotsStateFor(parsed, signal);
    robots = state.kind;
    robotsDetail = state.kind === 'unreadable' ? state.detail : null;
    parsedRobots = state.robots;
  }

  const verdict = evaluate({
    url: parsed,
    userAgent: 'troedler',
    robots: parsedRobots,
    enabled,
    apiHost,
  });

  return {
    url: rawUrl,
    host,
    provider,
    allowed: verdict.allowed,
    reason: verdict.reason,
    basis: verdict.basis,
    detail: verdict.detail,
    delaySeconds: verdict.delaySeconds,
    robots,
    robotsDetail,
    robotsSkipped,
    source: sourceFor(host),
  };
}
