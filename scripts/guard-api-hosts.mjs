#!/usr/bin/env node
/**
 * Refuse a provider whose `apiHost` flag disagrees with its declared `access`.
 *
 * `apiHost: true` switches the robots.txt gate off for a request. It is legal
 * for exactly one reason — the host is a documented API called under the
 * operator's own licence, so the website's crawl rules are not the rule that
 * applies — and that same fact is declared, separately, as
 * `capabilities.access: 'official-api'`. Two spellings of one fact, in two
 * files, with nothing tying them together.
 *
 * The consequence is not hypothetical. `troedler robots <url>` derives "is this
 * an API host" from `capabilities.access`, because that is the only form of the
 * fact a surface can reach. If an adapter ever sets `apiHost` without declaring
 * `access: 'official-api'` — or declares it and does not set the flag — the
 * command starts describing a different program than the one that runs, which
 * is precisely the defect it was just fixed for: measured 2026-08-22,
 * `troedler robots https://api.booklooker.de/2.0/search` printed "VERBOTEN" for
 * the URL every Booklooker search fetches.
 *
 * A unit test cannot cover this, for the same reason `guard-unused-kernel.mjs`
 * exists: the providers that would have to issue a probe request refuse first
 * with `not-configured`, so a test would pass by recording nothing. This is a
 * repo-shape check, and it asks one question per provider package — do the two
 * spellings of "this is an API" agree?
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(root, 'packages');

/** Packages that are not marketplace adapters and are not asked this question. */
const NOT_ADAPTERS = new Set(['compliance', 'core', 'html', 'http', 'store']);

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (entry.endsWith('.ts')) yield path;
  }
}

/** Strip comments so a mention inside a licence note is not read as code. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const problems = [];

for (const pkg of readdirSync(PACKAGES)) {
  if (NOT_ADAPTERS.has(pkg)) continue;
  const src = join(PACKAGES, pkg, 'src');
  let declaresApi = false;
  let setsFlag = [];

  for (const file of sources(src)) {
    const body = code(readFileSync(file, 'utf8'));
    if (/access:\s*'official-api'/.test(body)) declaresApi = true;
    if (/\bapiHost\s*:\s*true\b/.test(body)) setsFlag.push(file.slice(root.length + 1));
  }

  if (declaresApi && setsFlag.length === 0) {
    problems.push(
      `${pkg}: declares \`access: 'official-api'\` but never passes \`apiHost: true\`. ` +
        'Either the requests go through the robots gate — in which case the declaration is wrong — ' +
        'or the flag was dropped and every API call is now gated by the website\'s crawl rules.',
    );
  }
  if (!declaresApi && setsFlag.length > 0) {
    problems.push(
      `${pkg}: passes \`apiHost: true\` in ${setsFlag.join(', ')} but does not declare ` +
        "`access: 'official-api'`. The robots gate is off for requests no capability object " +
        'admits are API requests, so `troedler robots` will report the opposite of what runs.',
    );
  }
}

if (problems.length > 0) {
  console.error('Der apiHost-Wächter hat etwas gefunden:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log('apiHost und access stimmen in jedem Adapter überein.');
