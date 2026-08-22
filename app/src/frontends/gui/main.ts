/**
 * The native GNOME front-end — entry point.
 *
 * A third surface on the same seam as the CLI and the MCP server: it builds a
 * `Context` and calls the actions in `app/src/core/actions`, and it renders
 * every sentence from `@troedler/core`'s `present.ts`. Nothing about a
 * marketplace, a filter or a refusal is decided in here.
 *
 * Its own bundle, not a subcommand of the CLI. `import Adw from '@girs/adw-1'`
 * becomes a top-level `gi://Adw` in the bundle, so folding this into
 * `troedler.gjs.mjs` would make every `troedler search` in a terminal load GTK
 * and libadwaita, and fail without a display. Two entry points, one kernel.
 *
 *   build: gjsify workspace troedler-cli build:app   (→ dist/troedler-app.gjs.mjs)
 *   run:   gjsify workspace troedler-cli start:app
 *
 * The shell is `@gjsify/adwaita-app`'s `runAdwaitaApp`, which owns the
 * `runAsync` lifecycle — never the sync `run()`, which starves the promise-job
 * queue so an awaited search never resolves and the spinner turns for ever —
 * plus the quit/about actions and the env-gated devtools control plane.
 */

// FIRST, before anything reads `process.env`. The CLI entry point does the same
// on its first line, and leaving it out here made the two surfaces disagree
// about the world: `troedler check` reported Booklooker „bereit" while the app
// next to it said „Kein BOOKLOOKER_API_KEY gesetzt" — same machine, same
// `.env`, same key. A source that is configured and reports itself as skipped
// is the exact failure this project spends its comments on, and the app was
// producing it about itself.
import 'dotenv/config';

import Gtk from '@girs/gtk-4.0';
import { readAppDevHooks, runAdwaitaApp } from '@gjsify/adwaita-app';

import { createContext } from '../../core/context.ts';
import { APP_ID, APP_NAME, APP_VERSION, DEV_HOOK_PREFIX, QUERY_HOOK } from './constants.ts';
import { APP_CSS } from './css.ts';
import { MainWindow } from './window.ts';

// Pin GTK 4 before libadwaita pulls it in; keep the import referenced.
void Gtk;

const hooks = readAppDevHooks({ prefix: DEV_HOOK_PREFIX });
const query = process.env[QUERY_HOOK]?.trim() || undefined;
const context = createContext();

const status = await runAdwaitaApp({
  applicationId: APP_ID,
  css: APP_CSS,
  about: {
    applicationName: APP_NAME,
    applicationIcon: APP_ID,
    developerName: 'JumpLink / Art+Code Studio',
    version: APP_VERSION,
    website: 'https://github.com/JumpLink/troedler',
    license: 'MIT',
    comments:
      'Mehrere Gebrauchtwaren-Marktplätze mit einer Anfrage durchsuchen — vom eigenen Rechner, ' +
      'im eigenen Tempo, unter dem eigenen Namen. Die Treffer bleiben nach Quelle getrennt, und ' +
      'jede Quelle sagt, ob sie geantwortet hat. Derselbe Kern wie die Kommandozeile.',
  },
  createWindow: (app) => new MainWindow(app, context, { view: hooks.view, query }),
});

context.closeStore();
process.exit(status);
