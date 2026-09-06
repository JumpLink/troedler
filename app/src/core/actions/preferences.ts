/**
 * Settings that belong to a person rather than to a search.
 *
 * Small, and still an action rather than a `mutateConfig` call inside a view:
 * the config file is written from ONE layer, so the reload that has to follow a
 * write cannot be forgotten in one surface and remembered in another. That is
 * the same reason `setProviderEnabled` lives next door.
 *
 * The CLI and the MCP server never call this — they have one layout and no
 * window — which is why the field is optional in the manifest and absent from
 * the file for anybody who only ever uses the terminal.
 */

import { mutateConfig, type ResultLayout } from '@troedler/store';

import type { Context } from '../context.ts';

export function setResultLayout(context: Context, layout: ResultLayout): void {
  mutateConfig(context.configPath, (config) => ({ ...config, ui: { ...config.ui, layout } }));
  context.reload();
}
