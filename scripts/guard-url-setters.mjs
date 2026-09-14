#!/usr/bin/env node
/**
 * Refuse the URL setters that throw on the runtime we ship on.
 *
 * `new URL(...)` on GJS is very nearly read-only. Measured under gjsify 0.47.0
 * with gjs 1.88.1, assigning each of the ten WHATWG setters on a fresh URL:
 *
 *   search                        works
 *   protocol username password    TypeError: setting getter-only property
 *   host hostname port pathname   TypeError: setting getter-only property
 *   hash href                     TypeError: setting getter-only property
 *
 * On Node all ten work. So the failure is the expensive shape again: the code
 * type-checks, reads correctly, and passes every Node test, then throws on the
 * one runtime that matters. Compose the URL instead — build the string, or pass
 * the parts to the `URL(path, base)` constructor, which is spec-correct on both.
 *
 * This guard is narrower than the one it replaces on purpose. Its predecessor,
 * `guard-url-setters`' ancestor `guard-url-mutation.mjs`, also covered
 * `.searchParams.set/append/delete/sort` and `.search =` — both genuinely fixed
 * by gjsify PR #1245 — and was deleted whole at the 0.42.0 bump. `pathname` was
 * in its regex and is still broken today; deleting the guard on the strength of
 * a PARTIAL fix is how the remaining nine setters became unguarded for five
 * releases. Re-measure at every bump (see AGENTS.md) and remove exactly the
 * lines that measurement turns green — never the file because one of them did.
 *
 * // gjsify gap (unfixed, gjsify#1678): only `search` has a setter. The rest are
 * // getter-only on the GJS URL implementation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['packages', 'app/src'];

// `search` is deliberately absent: it is the one that works.
const THROWING = 'protocol|username|password|host|hostname|port|pathname|hash|href';
// Any identifier that reads as a URL, not just the four short names its
// predecessor listed: `searchUrl.pathname = …` is the same defect and would
// have walked straight past a narrower guard.
const HOLDER = String.raw`(?:u|url|uri|target|next|base|\w*[Uu][Rr][LlIi])`;
const ASSIGN = new RegExp(String.raw`\b${HOLDER}\s*\.\s*(?:${THROWING})\s*=[^=]`);

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
      if (ASSIGN.test(code)) findings.push(`${file.slice(root.length + 1)}:${i + 1}  ${line.trim()}`);
    });
  }
}

if (findings.length > 0) {
  console.error('These URL setters throw under GJS. Compose the URL instead:\n');
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(`\n  const u = new URL(\`\${base}\${path}?\${new URLSearchParams(params)}\`);\n`);
  process.exit(1);
}

console.log(`guard-url-setters: no assignment to a getter-only URL property (${THROWING.split('|').length} guarded).`);
