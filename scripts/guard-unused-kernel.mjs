#!/usr/bin/env node
/**
 * Refuse an exported kernel function that nothing in production calls.
 *
 * `@troedler/core` is where the judgement lives — merge, dedup, ranking,
 * post-filtering, price statistics. A function there is not a utility: it is a
 * claim that the program does something. `groupByIdentity` and `bestOf` carried
 * that claim, had a green unit test each, were named in the file header as "the
 * part of this project that is actually new" — and had **no caller at all**.
 * Nothing across sources was ever grouped. The tests proved the functions
 * worked; nobody had asked whether anybody used them.
 *
 * Worse than dead: when it was finally connected it turned out to be wrong on
 * real data (one Discogs barcode covers three different pressings), so the test
 * had been guarding a behaviour that would have shipped a wrong price the day
 * someone wired it up.
 *
 * So this is a repo-shape check rather than a unit test, for the same reason
 * the URL guard is: no test can fail because of something that is missing
 * everywhere. It asks one question per export — does anything outside
 * `packages/core` and outside the tests mention this name?
 *
 * A deliberately unused export is fine; say so with the marker below, which
 * makes the decision visible in review instead of invisible in a grep.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(root, 'packages/core/src');

/** Where a production caller may live. Tests are excluded on purpose. */
const CONSUMERS = ['packages', 'app/src'];

/** Put this on the line above an export that is meant to have no caller yet. */
const ALLOW = '@public-api';

function* sources(dir, skip = () => false) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sources(path, skip);
      continue;
    }
    if (!/\.(ts|mts|js|mjs)$/.test(path) || skip(path)) continue;
    yield path;
  }
}

const isTest = (path) => /[.]test[.]|[/]tests[/]|fixtures\.ts$/.test(path);
const inKernel = (path) => path.startsWith(KERNEL);

// Only functions. Types, interfaces and constants are contracts and label
// tables — an unused one is dead weight, not a silently missing feature.
const EXPORTED_FN = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;

/**
 * Reachability, not mere mention.
 *
 * "Something names it somewhere" would pass a cluster of kernel functions that
 * only call each other — which is exactly the shape of the bug: `bestOf` was
 * called by nothing, `groupByIdentity` by nothing, and each had a green test.
 *
 * So a kernel file counts only once it is REACHED, and reachability starts
 * outside the kernel: app code and the adapters are reached by definition, a
 * kernel file becomes reached when a reached file other than itself names one
 * of its exports, and the whole thing runs to a fixpoint. A ring of dead
 * kernel functions never enters it.
 */
const kernelFiles = [...sources(KERNEL)].map((path) => {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const declared = [];
  lines.forEach((line, i) => {
    const m = EXPORTED_FN.exec(line);
    if (!m) return;
    const above = lines.slice(Math.max(0, i - 12), i).join('\n');
    declared.push({ name: m[1], where: `${relative(root, path)}:${i + 1}`, allowed: above.includes(ALLOW) });
  });
  return { path, text, declared, reached: false };
});

const outside = [];
for (const base of CONSUMERS) {
  for (const path of sources(join(root, base), (p) => isTest(p) || inKernel(p))) {
    outside.push({ path, text: readFileSync(path, 'utf8'), reached: true });
  }
}

/**
 * Comments are prose, and prose is not a caller.
 *
 * Measured 2026-08-22: `until()` in `present.ts` passed this guard while having
 * no caller at all, because ten files elsewhere use the English word "until" in
 * a sentence — "a bug until proven otherwise", "serve until the client goes
 * away". A guard that a common word defeats is worse than none: it reports
 * green on exactly the case it exists to catch. Strings are left in, because a
 * name inside a string is usually a real reference (a registry key, a message
 * naming the function) and stripping them would trade this false negative for a
 * false positive.
 */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

const mentions = (file, name) => {
  file.code ??= withoutComments(file.text);
  return new RegExp(`\\b${name}\\b`).test(file.code);
};

for (let changed = true; changed; ) {
  changed = false;
  for (const file of kernelFiles) {
    if (file.reached) continue;
    const reachedElsewhere = [...outside, ...kernelFiles.filter((f) => f.reached && f !== file)];
    if (file.declared.some(({ name }) => reachedElsewhere.some((f) => mentions(f, name)))) {
      file.reached = true;
      changed = true;
    }
  }
}

const orphans = [];
for (const file of kernelFiles) {
  for (const decl of file.declared) {
    if (decl.allowed) continue;
    const callers = [...outside, ...kernelFiles.filter((f) => f.reached && f !== file)];
    if (!callers.some((f) => mentions(f, decl.name))) orphans.push(decl);
  }
}

if (orphans.length > 0) {
  console.error('Kernel-Funktionen, die von der Produktion aus nicht erreichbar sind:\n');
  for (const { name, where } of orphans) console.error(`  ${name}  (${where})`);
  console.error(
    `\nEin gruener Test beweist, dass die Funktion FUNKTIONIERT — nicht, dass sie BENUTZT wird.` +
      `\nEntweder anschliessen, oder loeschen, oder mit "${ALLOW}" im Kommentar darueber` +
      `\nbegruenden, warum sie heute noch keinen Aufrufer hat.`,
  );
  process.exit(1);
}

const total = kernelFiles.reduce((n, f) => n + f.declared.length, 0);
console.log(`${total} exportierte Kernel-Funktionen, jede von der Produktion aus erreichbar.`);
