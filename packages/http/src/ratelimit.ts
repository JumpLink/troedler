/**
 * Per-host pacing: one request at a time, with a gap between them.
 *
 * Serialising per host is the point, not a side effect. Fanning three page
 * requests at one marketplace in parallel is precisely the "excessive load"
 * that every set of terms names, and it is also what makes a client look like
 * a crawler rather than a person. Different hosts have independent budgets and
 * run concurrently — that is where the speed comes from.
 *
 * The queue is a promise chain rather than a timer wheel: it needs no polling,
 * it preserves order, and it cannot leak a running timer on abort.
 */

export interface HostBudget {
  /** Minimum seconds between the START of two requests to this host. */
  readonly delaySeconds: number;
  /** Hard ceiling per run; `null` for none. Exhausting it is an error, not a wait. */
  readonly maxRequests: number | null;
}

export class RateLimitExceeded extends Error {
  readonly host: string;
  constructor(host: string, max: number) {
    super(`Anfragebudget für ${host} erschöpft (${max} Anfragen in diesem Lauf).`);
    this.name = 'RateLimitExceeded';
    this.host = host;
  }
}

interface HostState {
  chain: Promise<void>;
  lastStart: number;
  /**
   * Slots taken from the budget — booked at ENQUEUE, because the ceiling has to
   * hold across everything already queued. Four requests that all pass an
   * up-front check against a budget of two are four requests.
   */
  reserved: number;
  /**
   * Requests that actually went out — booked immediately before the task runs.
   *
   * Two counters and not one, because they answer different questions and used
   * to be the same number. `--explain` reports what a search COST, and a request
   * that was queued and then abandoned cost nothing; reporting it is the same
   * class of untruth as the "0 Anfragen, 1189 ms" a failed run once printed,
   * pointing the other way.
   */
  issued: number;
}

/**
 * A wait that a cancellation actually ends, and that leaves no timer behind.
 *
 * The listener is removed on both paths: a queue several pages deep would
 * otherwise accumulate one live listener per queued request on a signal that
 * outlives them all.
 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // An already-aborted signal never fires `abort` again, so a listener added
    // now would wait out the full timer. The caller checks first; this is the
    // line that makes the function safe on its own terms rather than on the
    // caller remembering.
    if (signal?.aborted) {
      reject(new Aborted());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Aborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The one shape an abort takes here, so every caller can recognise it. */
export class Aborted extends Error {
  constructor() {
    super('Abgebrochen.');
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Aborted();
}

export class RateLimiter {
  readonly #hosts = new Map<string, HostState>();
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;

  constructor(
    options: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number } = {},
  ) {
    // Injected so the tests do not spend real seconds proving that a gap was kept.
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Requests actually SENT per host this run — what `--explain` and the quota command report. */
  used(host: string): number {
    return this.#hosts.get(host)?.issued ?? 0;
  }

  async run<T>(
    host: string,
    budget: HostBudget,
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const state = this.#hosts.get(host) ?? {
      chain: Promise.resolve(),
      lastStart: 0,
      reserved: 0,
      issued: 0,
    };
    this.#hosts.set(host, state);

    if (budget.maxRequests !== null && state.reserved >= budget.maxRequests) {
      throw new RateLimitExceeded(host, budget.maxRequests);
    }
    state.reserved += 1;

    // Chain onto whatever is already queued for this host, so the gap is kept
    // between consecutive requests rather than merely after the first.
    const result = state.chain.then(async () => {
      // Abort is checked on both sides of the wait. A queued request that a
      // person cancelled must not go out afterwards, and — the reason this
      // exists at all — the WAIT itself has to end: with a two-second floor and
      // several pages queued, a Stop button that only reaches `fetch` leaves the
      // user watching a spinner for as long as the queue is deep. `fetch` gets
      // the same signal, so an in-flight request ends too.
      throwIfAborted(signal);
      const wait = state.lastStart + budget.delaySeconds * 1000 - this.#now();
      if (wait > 0) await this.#sleep(wait, signal);
      throwIfAborted(signal);
      state.lastStart = this.#now();
      state.issued += 1;
      return task();
    });

    // The queue must survive a failing task: `.then(noop, noop)` keeps the chain
    // alive and unrejected, so one 404 does not poison every later request to
    // that host with an unhandled rejection.
    state.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
