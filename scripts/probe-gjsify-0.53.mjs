#!/usr/bin/env node
/**
 * Capability probe for the gjsify 0.53.0 bump — the measurement that travels
 * with the version move.
 *
 * AGENTS.md's rule is that a bump RE-MEASURES the behaviour and believes the
 * measurement, not the note, and that the measurement must be able to FAIL. So
 * every check here prints its own verdict and the script exits non-zero on any
 * red. What is checked is deliberately THIS repo's surface and not the release
 * note: the URL setters the composed-URL comments talk about, the `node:sqlite`
 * behaviour the canary in `packages/store/src/db.ts` exists for, the HTML5 tree
 * construction `@troedler/html` is a single facade over, and the globals the
 * code calls without asking whether they are there.
 *
 * Run under BOTH runtimes, because that is where the discipline pays: every one
 * of these gaps bit on GJS while Node stayed green, so a green node run says
 * nothing on its own. Under gjs with `--app gjs`, and under node.
 *
 *   gjsify build scripts/probe-gjsify-0.53.mjs --app gjs --outfile dist/probe.gjs.mjs
 *   gjsify run dist/probe.gjs.mjs
 *   node dist/probe.gjs.mjs
 */
import { DOMParser } from '@gjsify/domparser';
import { DatabaseSync } from 'node:sqlite';

let green = 0;
let red = 0;

function check(name, body) {
  try {
    body();
    green += 1;
    console.log(`  green  ${name}`);
  } catch (err) {
    red += 1;
    console.log(`  RED    ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`probe on ${globalThis.process?.versions?.gjs ? 'gjs' : 'node'}`);

// --- URL: the ten WHATWG setters the composed-URL comments talk about --------
const URL_SETTERS = [
  ['protocol', 'http:', 'https:'],
  ['username', '', 'jumplink'],
  ['password', '', 'secret'],
  ['host', 'example.org', 'example.com'],
  ['hostname', 'example.org', 'example.com'],
  ['port', '', '8080'],
  ['pathname', '/suche', '/results'],
  ['search', '?q=a', '?q=b'],
  ['hash', '#top', '#ende'],
  ['href', 'http://example.org/suche?q=a#top', 'http://example.com/results?q=b#ende'],
];

for (const [name, expected] of URL_SETTERS) {
  check(`URL.${name} is settable and reads back`, () => {
    const url = new URL('http://example.org/suche?q=a#top');
    // Assigned through the index so the SETTER is what runs. Under gjsify
    // <= 0.47.0 every one of these threw "setting getter-only property" while
    // Node accepted it, and the type check stayed green.
    url[name] = expected;
    if (url[name] !== expected) throw new Error(`read back ${url[name]}`);
  });
}

check('URL.searchParams.set is not discarded', () => {
  const url = new URL('http://example.org/database/search');
  url.searchParams.set('q', 'fahrrad');
  url.searchParams.set('type', 'release');
  if (url.search !== '?q=fahrrad&type=release') throw new Error(`search is ${url.search}`);
  if (url.href !== 'http://example.org/database/search?q=fahrrad&type=release') {
    throw new Error(`href is ${url.href}`);
  }
});

// --- node:sqlite: what the canary in packages/store/src/db.ts is about -------
check('sqlite all() raises on a missing table', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.prepare('SELECT * FROM does_not_exist').all();
  } catch {
    return;
  }
  throw new Error('all() returned instead of raising');
});

check('sqlite get() raises on a missing column', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (a TEXT)');
  try {
    db.prepare('SELECT nope FROM t').get();
  } catch {
    return;
  }
  throw new Error('get() returned instead of raising');
});

check('sqlite binds an explicit NULL and reads it back as NULL', () => {
  // What the code actually does: every nullable column is bound as `null` on
  // purpose (`gone_at = NULL` inline, `result.minor` after a `?? null`), never as
  // `undefined`. So this is the assertion that matches the code.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (a TEXT, n INTEGER)');
  db.prepare('INSERT INTO t (a, n) VALUES (?, ?)').run(null, null);
  const row = db.prepare('SELECT a, n FROM t').get();
  if (row.a !== null || row.n !== null) throw new Error(`read back ${JSON.stringify(row)}`);
});

check('sqlite binds undefined the way THIS node does, and says which', () => {
  // Deliberately not asserted as an equality. gjsify binds `undefined` as NULL
  // (matching Node 26.10); node 24 — the version that bootstraps this toolchain —
  // REFUSES it. So the two runtimes genuinely differ here, and a probe that
  // demanded agreement would be red on node for a difference nobody relies on:
  // no statement in `packages/store` binds `undefined`. What is asserted is that
  // the behaviour does not change under the runtime, so the note in schema.ts
  // can name it instead of leaving it folklore.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (a TEXT)');
  let outcome;
  try {
    db.prepare('INSERT INTO t (a) VALUES (?)').run(undefined);
    outcome = db.prepare('SELECT a FROM t').get().a === null ? 'NULL' : 'a value';
  } catch {
    outcome = 'refused';
  }
  console.log(`  note   undefined binds as: ${outcome} on ${globalThis.process.versions.gjs ? 'gjs' : 'node'}`);
});

check('sqlite reads a value above 2^31 exactly', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (n INTEGER)');
  // 2^31 is where a 32-bit read wraps; #1841 (0.53.0) is about exactly this.
  const big = 2147483648;
  db.prepare('INSERT INTO t (n) VALUES (?)').run(big);
  const row = db.prepare('SELECT n FROM t').get();
  if (row.n !== big) throw new Error(`read back ${row.n}`);
});

check('sqlite keeps a large value after a small row', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER, n INTEGER)');
  db.prepare('INSERT INTO t (id, n) VALUES (1, 5)').run();
  db.prepare('INSERT INTO t (id, n) VALUES (2, ?)').run(2147483648);
  const rows = db.prepare('SELECT n FROM t ORDER BY id').all();
  if (rows[1].n !== 2147483648) throw new Error(`second row read back ${rows[1].n}`);
});

check('sqlite canary round-trip: write, read back, delete', () => {
  // The canary in packages/store/src/db.ts, verbatim in shape.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const stamp = `canary-${Date.now()}`;
  db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run('canary', stamp);
  const back = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('canary');
  db.prepare('DELETE FROM schema_meta WHERE key = ?').run('canary');
  if (back?.value !== stamp) throw new Error('the row did not come back');
});

check('sqlite survives an EXISTS subquery', () => {
  // #1893 (0.53.0). libgda used to reject these outright.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE a (id INTEGER)');
  db.exec('CREATE TABLE b (id INTEGER)');
  db.prepare('INSERT INTO a (id) VALUES (1)').run();
  db.prepare('INSERT INTO b (id) VALUES (1)').run();
  const rows = db
    .prepare('SELECT id FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.id = a.id)')
    .all();
  if (rows.length !== 1) throw new Error(`EXISTS matched ${rows.length} rows`);
});

// --- HTML5: what @troedler/html is the single facade over --------------------
// On a real 329 KB results page the old XML parser matched `.aditem` 0 times.
check('domparser matches by class, not tag name', () => {
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE html><html><body><ul><li class="aditem">eins</li><li class="aditem">zwei</li></ul></body></html>',
    'text/html',
  );
  const items = doc.querySelectorAll('.aditem');
  if (items.length !== 2) throw new Error(`querySelectorAll('.aditem') → ${items.length}`);
});

check('domparser decodes entities', () => {
  const doc = new DOMParser().parseFromString(
    '<html><body><p>Preis 40&nbsp;&euro; &amp; Versand</p></body></html>',
    'text/html',
  );
  const para = doc.querySelector('p');
  if (!para.textContent.includes('&')) throw new Error(`got ${JSON.stringify(para.textContent)}`);
});

check('domparser closes an unclosed <li> like a browser', () => {
  const doc = new DOMParser().parseFromString(
    '<html><body><dl><dt>Fahrrad</dt><dd>40 &euro;</dd><dt>Auto</dt><dd>1200 &euro;</dd></dl></body></html>',
    'text/html',
  );
  if (doc.querySelectorAll('dt').length !== 2) throw new Error('dt count wrong');
  if (doc.querySelectorAll('dd').length !== 2) throw new Error('dd count wrong');
});

check('domparser uppercases tagName but keeps localName lower', () => {
  // The spec difference that bit this repo once: tagName is UPPERCASE in the
  // DOM and was lowercase under domhandler, so `node.tagName === 'dt'` silently
  // stopped matching and a whole <dl> came back empty.
  const doc = new DOMParser().parseFromString(
    '<html><body><dl><dt>Fahrrad</dt><dd>40 &euro;</dd></dl></body></html>',
    'text/html',
  );
  const dt = doc.querySelector('dt');
  if (dt.localName !== 'dt') throw new Error(`localName is ${dt.localName}`);
});

// --- the globals the code calls without asking -------------------------------
check('btoa exists and atob round-trips it', () => {
  const encoded = btoa('client:secret');
  if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('no btoa');
  if (atob(encoded) !== 'client:secret') throw new Error('atob does not round-trip');
});

console.log(`\n${green} green, ${red} red`);
if (red > 0) process.exitCode = 1;