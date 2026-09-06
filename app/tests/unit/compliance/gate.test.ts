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
        apiHost: false,
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
        apiHost: false,
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
        apiHost: false,
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
          apiHost: false,
        }).delaySeconds,
      ).toBe(5);
      const fast = parseRobots('User-agent: *\nCrawl-delay: 0.1\n', '2026-08-21T12:00:00.000Z');
      expect(
        evaluate({
          url: new URL('https://example.invalid/y'),
          userAgent: 'troedler',
          robots: fast,
          enabled: true,
          apiHost: false,
        }).delaySeconds,
      ).toBe(DEFAULT_DELAY_SECONDS);
    });

    await it("keeps the operator's wish apart from our own floor", async () => {
      // The two numbers must not be readable off one another, or a caller that
      // legitimately drops OUR floor would also drop THEIR Crawl-delay.
      const stated = evaluate({
        url: new URL('https://example.invalid/yes'),
        userAgent: 'troedler',
        robots,
        enabled: true,
        apiHost: false,
      });
      expect(stated.statedDelaySeconds).toBe(5);
      expect(stated.delaySeconds).toBe(5);

      // The discriminator: a host that asked for NOTHING still paces at the
      // floor, and must be distinguishable from one that asked for exactly it.
      const silent = evaluate({
        url: new URL('https://example.invalid/yes'),
        userAgent: 'troedler',
        robots: parseRobots('User-agent: *\nDisallow: /nope\n', '2026-08-21T12:00:00.000Z'),
        enabled: true,
        apiHost: false,
      });
      expect(silent.statedDelaySeconds).toBe(null);
      expect(silent.delaySeconds).toBe(DEFAULT_DELAY_SECONDS);

      const explicit = evaluate({
        url: new URL('https://example.invalid/yes'),
        userAgent: 'troedler',
        robots: parseRobots(
          `User-agent: *\nCrawl-delay: ${DEFAULT_DELAY_SECONDS}\n`,
          '2026-08-21T12:00:00.000Z',
        ),
        enabled: true,
        apiHost: false,
      });
      expect(explicit.statedDelaySeconds).toBe(DEFAULT_DELAY_SECONDS);
      expect(explicit.delaySeconds).toBe(DEFAULT_DELAY_SECONDS);
    });

    await it('lets a documented API through the robots.txt that forbids everything', async () => {
      // Not hypothetical. Measured 2026-08-22: `api.booklooker.de/robots.txt`
      // is 68 344 bytes of the WEBSITE's crawl rules and ends in
      // `User-agent: *` / `Disallow: /`. Booklooker's REST API v2.0 is
      // documented, free keys and all, and every search fetches
      // `/2.0/search`. Consulting that file here would refuse the licence.
      const shopRobots = parseRobots(
        'User-agent: Googlebot\nDisallow: /interface/\n\nUser-agent: *\n\nDisallow: /\n',
        '2026-08-22T12:00:00.000Z',
      );
      const url = new URL('https://api.booklooker.de/2.0/search?token=x');

      // The discriminator: the SAME file, the SAME URL, refused as a website.
      const asWebsite = evaluate({
        url,
        userAgent: 'troedler',
        robots: shopRobots,
        enabled: true,
        apiHost: false,
      });
      expect(asWebsite.allowed).toBe(false);
      expect(asWebsite.basis).toBe('robots');

      const asApi = evaluate({
        url,
        userAgent: 'troedler',
        robots: shopRobots,
        enabled: true,
        apiHost: true,
      });
      expect(asApi.allowed).toBe(true);
      expect(asApi.basis).toBe('licence');
      // No politeness floor on an API: these operators publish their own limits
      // and the adapters throttle against those. Two seconds here would turn
      // twenty Discogs price lookups into forty seconds of waiting for nothing.
      expect(asApi.delaySeconds).toBe(0);
      expect(asApi.detail?.includes('docs/quellen/booklooker.de.md')).toBe(true);
    });

    await it('refuses a disabled API host before the licence ever applies', async () => {
      // Order matters: the switch is checked first, so a source the user turned
      // off is not contacted because it happens to be an API.
      const v = evaluate({
        url: new URL('https://api.booklooker.de/2.0/search'),
        userAgent: 'troedler',
        robots: null,
        enabled: false,
        apiHost: true,
      });
      expect(v.allowed).toBe(false);
      expect(v.basis).toBe('disabled');
    });

    await it('treats a missing robots.txt as no restriction', async () => {
      const v = evaluate({
        url: new URL('https://example.invalid/x'),
        userAgent: 'troedler',
        robots: null,
        enabled: true,
        apiHost: false,
      });
      expect(v.allowed).toBe(true);
    });
  });
};
