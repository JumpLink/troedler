/** Identity of the native app. The id doubles as the icon name and the D-Bus name. */
export const APP_ID = 'eu.jumplink.Troedler';
export const APP_NAME = 'Trödler';

export { VERSION as APP_VERSION } from '../../core/runtime.ts';

/**
 * Env-var prefix for the devtools hooks `@gjsify/adwaita-app` reads.
 *
 * `TR_APP_VIEW` opens straight to a view, `TR_APP_DEBUG` turns on load logging.
 * Same shape as buchhaltung's `BH_APP_*` and bauplaner's `BP_APP_*`, so one
 * screenshot recipe works across all three.
 */
export const DEV_HOOK_PREFIX = 'TR_APP';

/**
 * `TR_APP_QUERY` — run this search as soon as the window is up.
 *
 * Not a convenience. The devtools plane can click a widget and send an
 * accelerator, but it has no way to put text into an entry, so without this
 * hook the only screenshottable state of the search view is the empty one — and
 * every state that matters here (a source still pending, one that answered, one
 * that was skipped for its terms, one that failed) is on the other side of a
 * query. An app whose interesting states cannot be looked at is an app whose
 * interesting states nobody checks.
 */
export const QUERY_HOOK = `${DEV_HOOK_PREFIX}_QUERY`;

/**
 * `TR_APP_LAYOUT=grid|sections` — switch the results layout once the query has
 * run, exactly as the settings dialog does.
 *
 * Same argument as `TR_APP_QUERY`, one level in. The devtools plane cannot
 * operate an `Adw.ComboRow`: `ActivateWidget` on its list row reports `true` and
 * changes no selection, and `SendKey` answers `false` — measured 2026-09-06. So
 * without this hook the live switch is the one path in this window that can only
 * be checked by reading it, while both layouts and the config round-trip are
 * measured. It goes through `setLayout`, the same method the dialog's callback
 * calls, rather than around it — a hook that took a different route would prove
 * something nobody uses.
 */
export const LAYOUT_HOOK = `${DEV_HOOK_PREFIX}_LAYOUT`;
