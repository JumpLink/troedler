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
