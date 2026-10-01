#!/usr/bin/env node
/**
 * Refuse an icon name the app cannot actually draw.
 *
 * The filter button asked for `view-filter-symbolic` and the Adwaita theme has
 * no such name. It compiled, it type-checked, the type was right, and the app ran:
 * the button rendered as an EMPTY WHITE RECTANGLE, because a missing `-symbolic`
 * on a `Gtk.MenuButton` is not the `image-missing` placeholder a `Gtk.Image`
 * would show. No test, no warning, and a screenshot was the only way to see it.
 *
 * So this asks the question no type system can: does the name resolve, HERE, in
 * the icon theme this machine actually has? An answer of "no" fails the build for
 * a name the app ships, and the fix is one of two: bundle the icon
 * (`app/src/frontends/gui/resources/`, see `build-icon-resource.mjs`) or use a
 * name Adwaita has.
 *
 * It is a repo-shape check and a filesystem lookup, deliberately. A unit test
 * could only prove the list is well-formed; whether `pan-end-symbolic` exists is
 * a fact about the platform, and the platform is where it has to be checked.
 *
 * The second half is the same question for the app's OWN icons: the generated
 * resource must match the SVG next to it, so editing the drawing without
 * regenerating is a failed build rather than a stale blob. That check needs
 * nothing but Node — `glib-compile-resources` is a developer's machine, not a
 * requirement.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUI = join(root, 'app/src/frontends/gui');
const RESOURCES = join(GUI, 'resources');

/** Where the icon theme lives, in the order GTK would search it. */
const THEME_DIRS = [
  '/usr/share/icons/Adwaita',
  '/usr/share/icons/hicolor',
  '/usr/share/icons/gnome',
  '/usr/local/share/icons/Adwaita',
];

/** Themed sub-directories an icon theme may declare; any of them counts. */
const THEME_SUBDIRS = ['scalable', 'symbolic', 'actions', 'ui', '16x16', '22x22', '24x24', '48x48'];

/** Icon names are only interesting when they are `-symbolic` or plainly named. */
const ICON_NAME = /['"`]([a-z0-9][a-z0-9-]*-symbolic)['"`]/g;
/**
 * The `iconName:` / `icon-name:` property and the `Gtk.Button`/`Gtk.Image`
 * constructors, plus every bare string literal — because the names are also
 * constants (`COLLAPSED_ICON`) and a constant that stops resolving is the same
 * white rectangle with one more step between it and the grep.
 */
const PATTERNS = [
  /\biconName:\s*'([^']+)'/g,
  /\bicon-name:\s*"([^"]+)"/g,
  /\bicon_name:\s*'([^']+)'/g,
];

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sources(path);
      continue;
    }
    if (path.endsWith('.ts') && !path.endsWith('.d.ts')) yield path;
  }
}

/**
 * Prose is not code, and this guard has to be able to say the name of the icon it
 * is guarding against.
 *
 * `icons.ts` and `search-view.ts` both explain this failure in a comment, and a
 * guard that read its own documentation as a usage would fail forever. The same
 * problem, measured in `guard-unused-kernel.mjs`: a guard a common word defeats
 * is worse than none. String literals stay — a name inside one is a real
 * reference.
 */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

/** Every icon name the GUI mentions, with the file and line it came from. */
function used() {
  const found = new Map();
  const add = (name, where) => {
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(where);
  };
  for (const path of sources(GUI)) {
    const lines = withoutComments(readFileSync(path, 'utf8')).split('\n');
    for (const [i, line] of lines.entries()) {
      for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        let m = pattern.exec(line);
        while (m) {
          add(m[1], `${path.slice(root.length + 1)}:${i + 1}`);
          m = pattern.exec(line);
        }
      }
      // Bare literals, for the constants.
      ICON_NAME.lastIndex = 0;
      let m = ICON_NAME.exec(line);
      while (m) {
        add(m[1], `${path.slice(root.length + 1)}:${i + 1}`);
        m = ICON_NAME.exec(line);
      }
    }
  }
  return found;
}

/** The names the app's own GResource provides, from the resource XML. */
function bundled() {
  const xml = readFileSync(join(RESOURCES, 'troedler.gresource.xml'), 'utf8');
  const names = new Set();
  for (const m of xml.matchAll(/<file[^>]*>([^<]+)<\/file>/g)) {
    names.add(m[1].replace(/\.svg$/, ''));
  }
  return names;
}

/**
 * Is this name in the installed icon theme?
 *
 * A file on disk rather than `Gtk.IconTheme.has_icon`, because this script runs
 * under Node: asking GTK would need a display and a second runtime for one
 * question. The theme's own `index.theme` decides which sub-directories count,
 * and every declared one is searched.
 */
function inTheme(name) {
  for (const dir of THEME_DIRS) {
    for (const sub of THEME_SUBDIRS) {
      for (const ext of ['svg', 'png']) {
        try {
          statSync(join(dir, sub, `${name}.${ext}`));
          return true;
        } catch {
          /* keep looking */
        }
      }
    }
    // …and one level down, which is how Adwaita is actually laid out
    // (symbolic/actions, symbolic/ui, …).
    for (const sub of THEME_SUBDIRS) {
      let entries = [];
      try {
        entries = readdirSync(join(dir, sub));
      } catch {
        continue;
      }
      for (const nested of entries) {
        for (const ext of ['svg', 'png']) {
          try {
            statSync(join(dir, sub, nested, `${name}.${ext}`));
            return true;
          } catch {
            /* keep looking */
          }
        }
      }
    }
  }
  return false;
}

const own = bundled();
const names = used();

/**
 * Is there an icon theme to ask at all?
 *
 * Without this, a machine with no Adwaita installed would report every name as
 * missing and the guard would be a machine problem dressed as a code problem. It
 * says what it cannot answer and checks the half it can — which is the half that
 * does not depend on the host.
 */
const themesPresent = THEME_DIRS.filter((dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
});
const canAskTheme = themesPresent.length > 0;

const external = [...names.keys()].filter((n) => !own.has(n)).sort();
const missing = canAskTheme ? external.filter((n) => !inTheme(n)) : [];

if (missing.length > 0) {
  console.error('Icon names the app uses that this system cannot draw:\n');
  for (const name of missing) {
    console.error(`  ${name}  (${names.get(name).join(', ')})`);
  }
  console.error(
    '\nEin fehlender -symbolic-Name ist auf einem Gtk.MenuButton ein WEISSES RECHTECK, kein Platzhalter —' +
      '\nder Fehler faellt erst auf einem Screenshot auf. Entweder das Icon mitliefern' +
      '\n(app/src/frontends/gui/resources/, danach node scripts/build-icon-resource.mjs),' +
      '\noder einen Namen nehmen, den das Theme hat.',
  );
  process.exit(1);
}

// The generated resource against its source. SHA-256 of the SVG, which is what
// `build-icon-resource.mjs` records — so this needs no compiler, only Node.
const svg = readFileSync(join(RESOURCES, 'troedler-filter-symbolic.svg'));
const sha = createHash('sha256').update(svg).digest('hex');
const generated = readFileSync(join(GUI, 'icon-resource.ts'), 'utf8');
if (!generated.includes(sha)) {
  console.error(
    'app/src/frontends/gui/icon-resource.ts does not match resources/troedler-filter-symbolic.svg.\n' +
      'Run: node scripts/build-icon-resource.mjs',
  );
  process.exit(1);
}

console.log(
  `${names.size} icon names used, all resolvable ` +
    `(${own.size} bundled: ${[...own].join(', ')}; ${external.length} from the icon theme). ` +
    'Resource in sync with its SVG.' +
    (canAskTheme
      ? ` (theme: ${themesPresent.join(', ')})`
      : ' NOTE: no icon theme found on this machine — the theme half of this check could not run.'),
);
