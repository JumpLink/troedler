import { describe, expect, it } from '@gjsify/unit';

import { RateLimitExceeded, RateLimiter } from '@troedler/http';

/**
 * Time is injected, so these tests prove that a gap was kept without spending
 * the seconds proving it.
 */
function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

export default async () => {
  await describe('RateLimiter', async () => {
    await it('keeps the gap between CONSECUTIVE requests, not just after the first', async () => {
      // The chained queue exists for this. A naive implementation waits once
      // and then lets everything through, which is the fan-out that makes a
      // client look like a crawler.
      const clock = fakeClock();
      const limiter = new RateLimiter({ now: clock.now, sleep: clock.sleep });
      const budget = { delaySeconds: 2, maxRequests: null };
      const starts: number[] = [];
      const task = async () => {
        starts.push(clock.now());
      };

      await Promise.all([
        limiter.run('host.invalid', budget, task),
        limiter.run('host.invalid', budget, task),
        limiter.run('host.invalid', budget, task),
      ]);

      expect(starts.length).toBe(3);
      expect(starts[1] - starts[0]).toBe(2000);
      expect(starts[2] - starts[1]).toBe(2000);
    });

    await it('does not make different hosts wait for each other', async () => {
      // Separate budgets are where the speed comes from — serialising across
      // hosts would be politeness nobody asked for.
      const clock = fakeClock();
      const limiter = new RateLimiter({ now: clock.now, sleep: clock.sleep });
      const budget = { delaySeconds: 2, maxRequests: null };
      const starts: number[] = [];
      const task = async () => {
        starts.push(clock.now());
      };

      await Promise.all([limiter.run('a.invalid', budget, task), limiter.run('b.invalid', budget, task)]);
      expect(starts[0]).toBe(starts[1]);
    });

    await it('throws once the per-run budget is spent', async () => {
      const limiter = new RateLimiter({ now: () => 0, sleep: async () => {} });
      const budget = { delaySeconds: 0, maxRequests: 2 };
      await limiter.run('h.invalid', budget, async () => 1);
      await limiter.run('h.invalid', budget, async () => 2);

      let threw: unknown = null;
      try {
        await limiter.run('h.invalid', budget, async () => 3);
      } catch (err) {
        threw = err;
      }
      expect(threw instanceof RateLimitExceeded).toBe(true);
      // The refused attempt is NOT counted: `used` is what was actually spent
      // at the host, and a caller reading it to report remaining budget would
      // otherwise be told about a request that never left.
      expect(limiter.used('h.invalid')).toBe(2);
    });

    await it('ends the WAIT on abort, not only the request', async () => {
      // A CLI gets Ctrl-C; a window gets a Stop button that has to mean
      // something. Passing the signal to `fetch` alone is not enough: with a
      // two-second floor and several pages queued, everything after the current
      // request sits in this queue, and a cancellation that does not reach the
      // pause leaves a person watching a spinner for as long as the queue is
      // deep.
      const controller = new AbortController();
      const limiter = new RateLimiter({
        // Not zero: at `now() === 0` the FIRST request already owes a wait,
        // because `lastStart` starts at zero too. Ten seconds in, the first one
        // goes straight through and only the queued one sits in the gap — which
        // is the situation this test is about.
        now: () => 10_000,
        // A sleep that never resolves on its own, so the ONLY way out is the
        // abort. Without that this test would pass on an implementation that
        // simply waited the wait out.
        sleep: (_ms, signal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
          }),
      });
      const budget = { delaySeconds: 2, maxRequests: null };
      let ran = 0;
      const first = limiter.run('h.invalid', budget, async () => {
        ran += 1;
      });
      const queued = limiter.run(
        'h.invalid',
        budget,
        async () => {
          ran += 1;
        },
        controller.signal,
      );
      await first;
      controller.abort();

      let threw = false;
      try {
        await queued;
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      // And the abandoned request never went out — nor was it booked as spent.
      expect(ran).toBe(1);
      expect(limiter.used('h.invalid')).toBe(1);
    });

    await it('refuses a request that was cancelled before its turn came', async () => {
      const controller = new AbortController();
      controller.abort();
      const limiter = new RateLimiter({ now: () => 0, sleep: async () => {} });
      let ran = false;
      let threw = false;
      try {
        await limiter.run(
          'h.invalid',
          { delaySeconds: 0, maxRequests: null },
          async () => {
            ran = true;
          },
          controller.signal,
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(ran).toBe(false);
      expect(limiter.used('h.invalid')).toBe(0);
    });

    await it('books what went out, and holds what was reserved', async () => {
      // Two counters, because they answer different questions, and the split is
      // only observable when they DISAGREE. The ceiling has to hold across
      // everything already queued — four requests that each pass an up-front
      // check against a budget of two are four requests — while `--explain`
      // reports what the search cost, and an abandoned request cost nothing.
      const controller = new AbortController();
      const limiter = new RateLimiter({
        now: () => 10_000,
        sleep: (_ms, signal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
          }),
      });
      const budget = { delaySeconds: 2, maxRequests: 2 };

      await limiter.run('h.invalid', budget, async () => 1);
      const abandoned = limiter.run('h.invalid', budget, async () => 2, controller.signal);
      controller.abort();
      await abandoned.catch(() => undefined);

      // One request went out.
      expect(limiter.used('h.invalid')).toBe(1);
      // And the budget is still spent, because the second slot was taken the
      // moment it was queued. Counting `used` here would hand out a third.
      let threw: unknown = null;
      try {
        await limiter.run('h.invalid', budget, async () => 3);
      } catch (err) {
        threw = err;
      }
      expect(threw instanceof RateLimitExceeded).toBe(true);
    });

    await it('survives a failing task instead of poisoning the queue', async () => {
      // A 404 in the middle of paging must not take every later request to
      // that host down with it — and must not leave an unhandled rejection
      // behind either.
      const limiter = new RateLimiter({ now: () => 0, sleep: async () => {} });
      const budget = { delaySeconds: 0, maxRequests: null };

      let threw = false;
      try {
        await limiter.run('h.invalid', budget, async () => {
          throw new Error('404');
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(await limiter.run('h.invalid', budget, async () => 'weiter')).toBe('weiter');
    });
  });
};
