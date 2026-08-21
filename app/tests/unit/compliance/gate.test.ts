import { describe, expect, it } from '@gjsify/unit';

import { DEFAULT_DELAY_SECONDS, evaluate, parseRobots } from '@troedler/compliance';

export default async () => {
  const robots = parseRobots('User-agent: *\nCrawl-delay: 5\nDisallow: /nope\n', '2026-08-21T12:00:00.000Z');

  await describe('evaluate', async () => {
    await it('refuses a disabled source and names the reason', async () => {
      const v = evaluate({
        url: new URL('https://example.invalid/x'),
        userAgent: 'troedler',
        robots: null,
        enabled: false,
      });
      expect(v.allowed).toBe(false);
      expect(v.reason).toBe('disabled');
    });

    await it('refuses what robots.txt refuses, quoting the rule', async () => {
      const v = evaluate({
        url: new URL('https://example.invalid/nope'),
        userAgent: 'troedler',
        robots,
        enabled: true,
      });
      expect(v.allowed).toBe(false);
      expect(v.reason).toBe('robots');
      expect(v.detail?.includes('Disallow: /nope')).toBe(true);
    });

    await it('allows what is permitted', async () => {
      const v = evaluate({
        url: new URL('https://example.invalid/yes'),
        userAgent: 'troedler',
        robots,
        enabled: true,
      });
      expect(v.allowed).toBe(true);
      expect(v.reason).toBe(null);
    });

    await it('honours a crawl-delay ABOVE the floor, and never falls below it', async () => {
      // The floor is politeness we impose on ourselves; the site's own number
      // only ever raises it.
      expect(
        evaluate({
          url: new URL('https://example.invalid/yes'),
          userAgent: 'troedler',
          robots,
          enabled: true,
        }).delaySeconds,
      ).toBe(5);
      const fast = parseRobots('User-agent: *\nCrawl-delay: 0.1\n', '2026-08-21T12:00:00.000Z');
      expect(
        evaluate({
          url: new URL('https://example.invalid/y'),
          userAgent: 'troedler',
          robots: fast,
          enabled: true,
        }).delaySeconds,
      ).toBe(DEFAULT_DELAY_SECONDS);
    });

    await it('treats a missing robots.txt as no restriction', async () => {
      const v = evaluate({
        url: new URL('https://example.invalid/x'),
        userAgent: 'troedler',
        robots: null,
        enabled: true,
      });
      expect(v.allowed).toBe(true);
    });
  });
};
