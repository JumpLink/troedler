import { describe, expect, it } from '@gjsify/unit';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigError, EMPTY_CONFIG, loadConfig, mutateConfig, saveConfig } from '@troedler/store';

export default async () => {
  const withTempDir = async (fn: (dir: string) => Promise<void> | void) => {
    const dir = mkdtempSync(join(tmpdir(), 'troedler-config-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  await describe('loadConfig', async () => {
    await it('treats a missing file as a first run, not an error', async () => {
      await withTempDir((dir) => {
        expect(loadConfig(join(dir, 'nope.json'))).toEqual(EMPTY_CONFIG);
      });
    });

    await it('refuses an unknown version instead of guessing the shape', async () => {
      await withTempDir((dir) => {
        const path = join(dir, 'c.json');
        writeFileSync(path, JSON.stringify({ version: 99, providers: {} }));
        let threw = false;
        try {
          loadConfig(path);
        } catch (err) {
          threw = err instanceof ConfigError;
        }
        expect(threw).toBe(true);
      });
    });

    await it('reports bad JSON with the path, not a bare parser message', async () => {
      await withTempDir((dir) => {
        const path = join(dir, 'c.json');
        writeFileSync(path, '{ broken');
        let message = '';
        try {
          loadConfig(path);
        } catch (err) {
          message = err instanceof Error ? err.message : '';
        }
        expect(message.includes(path)).toBe(true);
      });
    });
  });

  await describe('mutateConfig', async () => {
    await it('round-trips a change', async () => {
      await withTempDir((dir) => {
        const path = join(dir, 'c.json');
        saveConfig(path, EMPTY_CONFIG);
        mutateConfig(path, (c) => ({ ...c, providers: { ...c.providers, ebay: { enabled: false } } }));
        expect(loadConfig(path).providers.ebay?.enabled).toBe(false);
      });
    });

    await it('re-validates the result and leaves the old file intact on refusal', async () => {
      // Catching it here means the bad config never reaches disk — the
      // alternative is discovering it on the next start, with nothing to fall
      // back to.
      await withTempDir((dir) => {
        const path = join(dir, 'c.json');
        saveConfig(path, { ...EMPTY_CONFIG, defaults: { postalCode: '21762' } });
        let threw = false;
        try {
          mutateConfig(path, () => ({ version: 2 }) as never);
        } catch (err) {
          threw = err instanceof ConfigError;
        }
        expect(threw).toBe(true);
        expect(loadConfig(path).defaults.postalCode).toBe('21762');
      });
    });
  });
};
