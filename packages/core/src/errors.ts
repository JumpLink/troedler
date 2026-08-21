/**
 * Provider failures, as a closed set — because the caller has to tell them apart.
 *
 * The dangerous failure in this project is not a crash, it is a source that
 * answers "0 results" when it actually refused, changed its markup, or was
 * never configured. Every one of those looks identical to "nothing matched"
 * unless the type system forces them apart, so it does.
 */

export type ProviderErrorKind =
  /** No credentials / not switched on. Not an error — a state. */
  | 'not-configured'
  /** The user's own robots/terms gate refused the URL before it was requested. */
  | 'blocked-by-policy'
  /** The remote refused us: 401, 403, captcha, bot wall. A stop sign, never a retry prompt. */
  | 'refused'
  /** 429 or a local budget exhausted. */
  | 'rate-limited'
  /** Network, TLS, timeout. */
  | 'unreachable'
  /** HTTP 200 but the shape was not what we parse — the markup moved. */
  | 'parse-failed'
  /** The remote answered with an error payload. */
  | 'remote-error';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  /** Seconds the remote asked us to wait, when it said so. */
  readonly retryAfterSeconds: number | null;

  constructor(
    provider: string,
    kind: ProviderErrorKind,
    message: string,
    options: { retryAfterSeconds?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/**
 * True when retrying later could plausibly help.
 *
 * `refused` is absent on purpose. A 403 from a bot wall is a decision, not a
 * hiccup, and retrying it — especially with anything changed about the request
 * — is exactly the "circumventing a technical measure" that turns a tolerated
 * read into an actionable one. We stop and say so.
 */
export function isTransient(kind: ProviderErrorKind): boolean {
  return kind === 'rate-limited' || kind === 'unreachable';
}
