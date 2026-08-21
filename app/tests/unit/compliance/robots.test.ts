import { describe, expect, it } from '@gjsify/unit';

import { groupFor, isAllowed, parseRobots } from '@troedler/compliance';

/**
 * The matcher is the most load-bearing pure function in the project: it decides
 * what troedler is allowed to fetch. Every rule below is Google's robots.txt
 * specification, which is what operators actually write against.
 */
export default async () => {
  const FETCHED = '2026-08-21T12:00:00.000Z';

  await describe('parseRobots', async () => {
    await it('keeps consecutive user-agent lines in ONE group', async () => {
      // A file gives several bots identical treatment this way. Splitting them
      // loses the rules for all but the last, silently.
      const robots = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x\n', FETCHED);
      expect(robots.groups.length).toBe(1);
      expect(robots.groups[0].agents).toEqualArray(['a', 'b']);
    });

    await it('starts a new group when a user-agent follows rules', async () => {
      const robots = parseRobots('User-agent: a\nDisallow: /x\nUser-agent: b\nAllow: /\n', FETCHED);
      expect(robots.groups.length).toBe(2);
    });

    await it('treats an empty Disallow as no rule at all', async () => {
      // "Disallow:" with nothing after it means nothing is disallowed. Turning
      // it into a rule that matches every path would lock the crawler out of a
      // site that had just said "go ahead".
      const robots = parseRobots('User-agent: *\nDisallow:\n', FETCHED);
      expect(robots.groups[0].rules.length).toBe(0);
      expect(isAllowed(robots, 'troedler', '/anything').allowed).toBe(true);
    });

    await it('reads crawl-delay and sitemaps, and ignores comments', async () => {
      const robots = parseRobots(
        '# hello\nUser-agent: *\nCrawl-delay: 1.5\nDisallow: /x # trailing\nSitemap: https://e.invalid/s.xml\n',
        FETCHED,
      );
      expect(robots.groups[0].crawlDelaySeconds).toBe(1.5);
      expect(robots.sitemaps).toEqualArray(['https://e.invalid/s.xml']);
      expect(robots.groups[0].rules[0].pattern).toBe('/x');
    });
  });

  await describe('groupFor', async () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: troedler\nAllow: /\nDisallow: /private\n',
      FETCHED,
    );

    await it('prefers an exact agent match over the wildcard group', async () => {
      // Sites that name a bot mean it — whether to grant more or less. Falling
      // back to `*` would throw away a permission deliberately given.
      expect(groupFor(robots, 'troedler/0.1')?.agents).toEqualArray(['troedler']);
      expect(isAllowed(robots, 'troedler/0.1', '/s-fahrrad/k0').allowed).toBe(true);
      expect(isAllowed(robots, 'troedler/0.1', '/private/x').allowed).toBe(false);
    });

    await it('falls back to the wildcard for an unnamed agent', async () => {
      expect(isAllowed(robots, 'someoneelse', '/anything').allowed).toBe(false);
    });
  });

  await describe('isAllowed', async () => {
    await it('lets the LONGEST matching rule win, not the first', async () => {
      const robots = parseRobots('User-agent: *\nDisallow: /\nAllow: /public\n', FETCHED);
      expect(isAllowed(robots, 'troedler', '/public/page').allowed).toBe(true);
      expect(isAllowed(robots, 'troedler', '/other').allowed).toBe(false);
    });

    await it('gives Allow the tie at equal specificity', async () => {
      // The intuitive-looking opposite fails in the direction that blocks paths
      // the operator meant to permit.
      const robots = parseRobots('User-agent: *\nDisallow: /x\nAllow: /x\n', FETCHED);
      expect(isAllowed(robots, 'troedler', '/x').allowed).toBe(true);
    });

    await it('expands * and anchors $', async () => {
      const robots = parseRobots('User-agent: *\nDisallow: /*.json$\nDisallow: /a/*/b\n', FETCHED);
      expect(isAllowed(robots, 'troedler', '/data.json').allowed).toBe(false);
      expect(isAllowed(robots, 'troedler', '/data.json?x=1').allowed).toBe(true);
      expect(isAllowed(robots, 'troedler', '/a/anything/b').allowed).toBe(false);
    });

    await it('handles the real shape of a classified site: keyword search allowed, filters not', async () => {
      // Modelled on a live robots.txt: the plain keyword path stays open while
      // every filter refinement is closed. This is exactly the case the
      // adapters have to respect, so it is pinned here.
      const robots = parseRobots(
        [
          'User-agent: *',
          'Disallow: /api',
          'Disallow: /*.json',
          'Disallow: /*/preis:*',
          'Disallow: /*/sortierung:*',
          'Disallow: /*/seite:6*',
          'Disallow: /*/k0*r20',
        ].join('\n'),
        FETCHED,
      );
      expect(isAllowed(robots, 'troedler', '/s-fahrrad/k0').allowed).toBe(true);
      expect(isAllowed(robots, 'troedler', '/s-seite:2/fahrrad/k0').allowed).toBe(true);
      expect(isAllowed(robots, 'troedler', '/s-fahrrad/preis:100:200/k0').allowed).toBe(false);
      expect(isAllowed(robots, 'troedler', '/s-fahrraeder/seite:6/c217').allowed).toBe(false);
      expect(isAllowed(robots, 'troedler', '/s-fahrrad/k0r20').allowed).toBe(false);
      expect(isAllowed(robots, 'troedler', '/api/ads').allowed).toBe(false);
    });

    await it('reports the deciding rule, so a refusal can be explained', async () => {
      const robots = parseRobots('User-agent: *\nDisallow: /*/preis:*\n', FETCHED);
      const verdict = isAllowed(robots, 'troedler', '/s-x/preis:1:2/k0');
      expect(verdict.rule).toBe('Disallow: /*/preis:*');
    });
  });
};
