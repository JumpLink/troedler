import { describe, expect, it } from '@gjsify/unit';

import { HttpClient, RateLimiter } from '@troedler/http';

/**
 * `HttpClient.image()` is the one path that fetches something a marketplace did
 * not hand us as data, so what it does and does not skip is a policy, and a
 * policy nobody measures is a comment.
 */

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function clock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
  };
}

/** A host that serves the given robots.txt and answers everything else as an image. */
function rig(robotsTxt: string, answer?: { body?: BodyInit; type?: string; status?: number }) {
  const timer = clock();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) {
      return new Response(robotsTxt, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(answer?.body ?? IMAGE_BYTES, {
      status: answer?.status ?? 200,
      headers: { 'content-type': answer?.type ?? 'image/png' },
    });
  }) as unknown as typeof fetch;

  const http = new HttpClient({
    version: '0.0.0-test',
    limiter: new RateLimiter({ now: timer.now, sleep: timer.sleep }),
    fetchImpl,
  });
  return { http, slept: timer.slept };
}

const OPTS = { provider: 'zoll-auktion', enabled: true };
const A = 'https://cdn.invalid/a.jpg';
const B = 'https://cdn.invalid/b.jpg';

export default async () => {
  await describe('HttpClient.image', async () => {
    await it('drops OUR politeness floor between two images on one host', async () => {
      const { http, slept } = rig('User-agent: *\nAllow: /\n');
      await http.image(A, OPTS);
      await http.image(B, OPTS);
      // Not "roughly fast" — no wait was requested at all.
      expect(slept.filter((ms) => ms > 0)).toEqualArray([]);
    });

    await it('still keeps a Crawl-delay the operator asked for', async () => {
      // The discriminator for the test above: same two calls, same host, and
      // the only difference is that this operator stated a number. If the image
      // path had simply been exempted from pacing, this would also be empty.
      const { http, slept } = rig('User-agent: *\nCrawl-delay: 5\nAllow: /\n');
      await http.image(A, OPTS);
      await http.image(B, OPTS);
      // Two waits, not one: `robots.txt` is itself a request to this host and
      // takes the first slot, so the first image waits behind it. That is the
      // honest count — the operator asked for five seconds between requests,
      // and asking them for their rules is one.
      expect(slept.filter((ms) => ms > 0)).toEqualArray([5000, 5000]);
    });

    await it('paces an ordinary GET on the same host at the floor', async () => {
      // And the discriminator in the other direction: the floor is still there
      // for crawling, so the exemption is about the KIND of request, not the host.
      const { http, slept } = rig('User-agent: *\nAllow: /\n');
      await http.get(A, OPTS);
      await http.get(B, OPTS);
      expect(slept.filter((ms) => ms > 0)).toEqualArray([2000, 2000]);
    });

    await it('refuses a path the operator disallowed, image or not', async () => {
      const { http } = rig('User-agent: *\nDisallow: /a.jpg\n');
      let message = '';
      try {
        await http.image(A, OPTS);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message.includes('robots.txt')).toBe(true);
    });

    await it('refuses a switched-off source before any socket opens', async () => {
      const { http } = rig('User-agent: *\nAllow: /\n');
      let failed = false;
      try {
        await http.image(A, { provider: 'markt-de', enabled: false });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    await it('refuses a body that is not an image instead of passing it on', async () => {
      // Every one of these hosts answers a bad URL with an HTML error page, and
      // a decoder handed HTML complains about pixel data.
      const { http } = rig('User-agent: *\nAllow: /\n', {
        body: '<!doctype html><title>404</title>',
        type: 'text/html; charset=utf-8',
      });
      let message = '';
      try {
        await http.image(A, OPTS);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message.includes('kein Bild')).toBe(true);
    });

    await it('returns the bytes it was given', async () => {
      const { http } = rig('User-agent: *\nAllow: /\n');
      const bytes = await http.image(A, OPTS);
      expect(Array.from(bytes)).toEqualArray(Array.from(IMAGE_BYTES));
    });
  });
};
