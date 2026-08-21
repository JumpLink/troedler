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
  used: number;
}

export class RateLimiter {
  readonly #hosts = new Map<string, HostState>();
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;

  constructor(options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
    // Injected so the tests do not spend real seconds proving that a gap was kept.
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = options.now ?? (() => Date.now());
  }

  /** Requests spent per host this run — what `--explain` and the quota command report. */
  used(host: string): number {
    return this.#hosts.get(host)?.used ?? 0;
  }

  async run<T>(host: string, budget: HostBudget, task: () => Promise<T>): Promise<T> {
    const state = this.#hosts.get(host) ?? { chain: Promise.resolve(), lastStart: 0, used: 0 };
    this.#hosts.set(host, state);

    if (budget.maxRequests !== null && state.used >= budget.maxRequests) {
      throw new RateLimitExceeded(host, budget.maxRequests);
    }
    state.used += 1;

    // Chain onto whatever is already queued for this host, so the gap is kept
    // between consecutive requests rather than merely after the first.
    const result = state.chain.then(async () => {
      const wait = state.lastStart + budget.delaySeconds * 1000 - this.#now();
      if (wait > 0) await this.#sleep(wait);
      state.lastStart = this.#now();
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
