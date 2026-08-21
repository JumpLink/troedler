import { describe, expect, it } from '@gjsify/unit';

import { cacheDir, configPath, dataDir, dbPath } from '@troedler/store';

// Every function takes its environment as a parameter, so the promise these
// tests check — nothing is EVER written inside the repository — is checkable
// without touching the real one.
export default async () => {
  await describe('XDG resolution', async () => {
    await it('follows an absolute XDG_DATA_HOME', async () => {
      expect(dataDir({ XDG_DATA_HOME: '/custom/data' })).toBe('/custom/data/troedler');
    });

    await it('ignores a RELATIVE XDG value, per the spec', async () => {
      // Honouring it would resolve against the current directory — which, run
      // from a checkout, is the repository. That is the exact leak this file
      // exists to prevent.
      expect(dataDir({ XDG_DATA_HOME: 'relative/path' }).startsWith('/')).toBe(true);
    });

    await it('is always absolute', async () => {
      expect(dataDir({}).startsWith('/')).toBe(true);
      expect(cacheDir({}).startsWith('/')).toBe(true);
      expect(configPath({}).startsWith('/')).toBe(true);
    });

    await it('can be overridden wholesale', async () => {
      expect(dataDir({ TROEDLER_DATA_DIR: '/srv/t' })).toBe('/srv/t');
      expect(cacheDir({ TROEDLER_CACHE_DIR: '/srv/c' })).toBe('/srv/c');
      expect(configPath({ TROEDLER_CONFIG: '/srv/c.json' })).toBe('/srv/c.json');
    });
  });

  await describe('dbPath', async () => {
    await it('always ends in .db', async () => {
      // libgda appends `.db` to whatever name it is given, so `index.sqlite`
      // lands on disk as `index.sqlite.db` and the next open makes
      // `index.sqlite.db.db`. Passing one is the spelling that is safe in both
      // directions.
      expect(dbPath({}).endsWith('/troedler/index.db')).toBe(true);
      expect(dbPath({ TROEDLER_DB_PATH: '/tmp/x.sqlite' })).toBe('/tmp/x.sqlite.db');
      expect(dbPath({ TROEDLER_DB_PATH: '/tmp/x.db' })).toBe('/tmp/x.db');
    });
  });
};
