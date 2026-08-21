#!/usr/bin/env node
/**
 * Refuse the one API that silently does nothing on the runtime we ship on.
 *
 * `url.searchParams.set(...)` updates the parameter object and leaves the URL
 * alone under GJS: `href`, `search` and `toString()` keep whatever query the
 * URL was parsed with, which for a URL built from a bare base is none. Every
 * URL assembled that way goes out with NO query string. Nothing throws, the
 * remote answers 200, and the answer is to a question nobody asked — measured
 * against `api.discogs.com/database/search`, which returned 34.7 million rows
 * of everything instead of the search.
 *
 * The same code is correct on Node, so the local test run, the type check and
 * the reviewer's reading all pass. That is why this is a grep and not a
 * comment: the defect survived six adapters, 1142 tests and one review, and it
 * was found by an assertion that happened to re-parse a built URL.
 *
 * Assemble query strings as `${base}?${new URLSearchParams(...)}` instead —
 * spec-correct on both runtimes and unaffected by the gap.
 *
 * // gjsify gap (unfixed): fixed on branch `fix/url-searchparams-writeback`,
 * // not yet released. DELETE THIS GUARD at the gjsify bump that contains it —
 * // and re-measure rather than trusting this note.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['packages', 'app/src'];
const MUTATORS = /\.searchParams\s*\.\s*(set|append|delete|sort)\s*\(/;
const ASSIGN = /\b(?:url|u|uri)\s*\.\s*(?:search|pathname|hash|host|protocol)\s*=[^=]/;

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) yield path;
  }
}

const findings = [];
for (const base of ROOTS) {
  for (const file of sources(join(root, base))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Comments are how the gap is documented, so they must not trip the guard.
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (MUTATORS.test(code) || ASSIGN.test(code)) {
        findings.push(`${file.slice(root.length + 1)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error('URL mutation is a silent no-op under GJS. Build the query string instead:\n');
  console.error('  const url = `${base}?${new URLSearchParams({ q, limit })}`;\n');
  for (const f of findings) console.error(`  ${f}`);
  console.error(`\n${findings.length} occurrence(s). See scripts/guard-url-mutation.mjs.`);
  process.exit(1);
}
console.log('OK: no URL mutation — every query string is built explicitly.');
