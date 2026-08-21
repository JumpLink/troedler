import { describe, expect, it } from '@gjsify/unit';

import { registerProviderTools } from '../../../src/frontends/mcp/tools/providers.ts';
import { registerSearchTools } from '../../../src/frontends/mcp/tools/search.ts';
import { registerWatchTools } from '../../../src/frontends/mcp/tools/watch.ts';
import { applyReadOnlyGate } from '../../../src/frontends/mcp/runtime.ts';
import type { Context } from '../../../src/core/context.ts';
import { createRecorder } from './recorder.ts';

/**
 * The catalogue itself, asserted without a transport or a marketplace.
 *
 * The point is not that the tools exist — it is that every one of them makes a
 * TRUE claim about whether it mutates. The gate believes the annotation, so an
 * annotation that lies is the one bug it cannot catch.
 */
const stubContext = {
  config: { version: 1, providers: {}, defaults: {} },
  configPath: '/dev/null',
  http: {} as never,
  providers: [],
  store: () => {
    throw new Error('kein Store in diesem Test');
  },
  closeStore: () => {},
} as unknown as Context;

function catalogue(allowWrite: boolean) {
  const rec = createRecorder();
  applyReadOnlyGate(rec.server, allowWrite);
  registerSearchTools(rec.server, stubContext);
  registerProviderTools(rec.server, stubContext);
  registerWatchTools(rec.server, stubContext);
  return rec;
}

export default async () => {
  await describe('tool catalogue', async () => {
    await it('registers only read-only tools by default', async () => {
      const rec = catalogue(false);
      expect(rec.names()).toEqualArray([
        'market_search',
        'market_get_listing',
        'market_providers',
        'market_quota',
        'market_watch_list',
        'market_search_local',
        'market_price_history',
      ]);
    });

    await it('every default tool actually declares readOnlyHint: true', async () => {
      // Belt and braces with the gate: the gate drops what does not declare it,
      // so this asserts the declaration is present rather than the tool merely
      // having survived.
      const rec = catalogue(false);
      for (const tool of rec.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    });

    await it('adds exactly the mutating tool when writes are allowed', async () => {
      const open = catalogue(true);
      const closed = catalogue(false);
      const extra = open.names().filter((n) => !closed.names().includes(n));
      expect(extra).toEqualArray(['market_watch_save']);
      expect(open.find('market_watch_save')?.annotations?.readOnlyHint).toBe(false);
    });

    await it('marks the network-touching tools as open-world', async () => {
      // An agent uses this to know which calls leave the machine.
      const rec = catalogue(false);
      expect(rec.find('market_search')?.annotations?.openWorldHint).toBe(true);
      expect(rec.find('market_search_local')?.annotations?.openWorldHint).toBe(false);
      expect(rec.find('market_price_history')?.annotations?.openWorldHint).toBe(false);
    });

    await it('describes market_search so an agent cannot mistake a failure for absence', async () => {
      // The description is load-bearing: without it an assistant reports "there
      // are none for sale" when a source was switched off.
      const description = catalogue(false).find('market_search')?.description ?? '';
      expect(description.includes('reports')).toBe(true);
    });
  });
};
