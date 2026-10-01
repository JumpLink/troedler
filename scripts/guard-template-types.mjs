#!/usr/bin/env node
/**
 * A `.blp` template name and the `GTypeName` that registers it are ONE string.
 *
 * This check exists because they were not. `search-view-popover.blp` declared
 * `template $TroedlerSearchPopover` while the class registering it said
 * `GTypeName: 'TroedlerFilterPopover'`, and the result was not a warning anyone
 * reads: GJS refused to build the template, `super()` threw, the search view
 * never finished constructing, and the window came up with NO search view in it
 * at all — an empty frame where the whole app lives.
 *
 * It passed everything first. Type check, lint, format, both bundles built, 1487
 * assertions green on gjs and on node, the MCP smoke clean, and `main`'s CI
 * green. Only a screenshot of the running app showed it, for the same reason
 * `guard-icon-names.mjs` exists: the question is not a question TypeScript can
 * ask, and the failure has no red line in any suite.
 *
 * So this asks it directly. It reads each `.blp`, takes the `$Name` out of its
 * `template` line, and requires that some `GTypeName: '<Name>'` exists in the
 * TypeScript beside it. Both halves need nothing but Node.
 *
 * Deliberately repo-shape and not a runtime probe: constructing the widget is
 * what proves it, and a widget needs a display to construct. This catches the
 * mistake that is actually made — a rename on one side only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUI = join(root, 'app/src/frontends/gui');

/** Every `.blp` under the GUI. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.blp')) out.push(full);
  }
  return out;
}

/** Every `.ts` under the GUI, with its source. */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The `$Name` out of a template's declaration line. */
function declaredType(blp) {
  const m = readFileSync(blp, 'utf8').match(/^\s*template\s+\$([A-Za-z0-9_]+)\s*:/m);
  return m?.[1] ?? null;
}

const templates = walk(GUI);
if (templates.length === 0) {
  console.error('guard-template-types: no .blp found under app/src/frontends/gui — wrong path?');
  process.exit(1);
}
const allTs = sources(GUI);

const failures = [];
for (const blp of templates) {
  const type = declaredType(blp);
  const where = blp.slice(root.length + 1);
  if (!type) {
    failures.push(`${where}: no \`template $Name :\` line found`);
    continue;
  }
  // A template's class is NOT necessarily in the file beside it: the popover is
  // declared in its own `.blp` and registered by a class inside `search-view.ts`,
  // because it is not a child of the view. So the question is asked of every
  // `.ts` in the GUI rather than of one presumed sibling — which is also the
  // honest scope, since a rename can move either end.
  const owners = allTs.filter((ts) => new RegExp(`GTypeName:\\s*'${type}'`).test(readFileSync(ts, 'utf8')));
  if (owners.length === 0) {
    const declared = allTs
      .flatMap((ts) => [...readFileSync(ts, 'utf8').matchAll(/GTypeName:\s*'([^']+)'/g)].map((m) => m[1]))
      .sort();
    failures.push(
      `${where}: declares $${type}, and no .ts in the GUI registers that GTypeName. ` +
        `Registered instead: ${declared.length ? declared.map((d) => `'${d}'`).join(', ') : 'none'}. ` +
        'GJS refuses to build a template whose type does not match the type registering it, ' +
        'and the widget then never finishes constructing — a window with no search view in it.',
    );
  }
}

if (failures.length > 0) {
  console.error(`guard-template-types: ${failures.length} of ${templates.length} template(s) mismatch:`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}

console.log(
  `guard-template-types: OK. ${templates.length} template(s), each $Name registered by the .ts beside it.`,
);