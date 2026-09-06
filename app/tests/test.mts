// Test entry: aggregates every *.test.ts suite (each a default-exported async fn) and runs them
// under @gjsify/unit, on GJS and Node both (`gjsify test`). Keep this list in sync when adding a
// test file — an unlisted suite is a suite that never runs, and it looks exactly like a passing one.
import { run } from '@gjsify/unit';

import normalize from './unit/core/normalize.test.ts';
import filter from './unit/core/filter.test.ts';
import merge from './unit/core/merge.test.ts';
import search from './unit/core/search.test.ts';
import stats from './unit/core/stats.test.ts';
import present from './unit/core/present.test.ts';

import robots from './unit/compliance/robots.test.ts';
import gate from './unit/compliance/gate.test.ts';
import ratelimit from './unit/compliance/ratelimit.test.ts';
import image from './unit/compliance/image.test.ts';

import storePaths from './unit/store/paths.test.ts';
import store from './unit/store/store.test.ts';
import config from './unit/store/config.test.ts';

import ebay from './unit/providers/ebay.test.ts';
import kleinanzeigen from './unit/providers/kleinanzeigen.test.ts';
import discogs from './unit/providers/discogs.test.ts';
import booklooker from './unit/providers/booklooker.test.ts';
import auktion from './unit/providers/auktion.test.ts';
import markt from './unit/providers/markt.test.ts';

import actionRobots from './unit/actions/robots.test.ts';

import mcpGate from './unit/mcp/gate.test.ts';
import mcpTools from './unit/mcp/tools.test.ts';

run({
  normalize,
  filter,
  merge,
  search,
  stats,
  present,
  robots,
  gate,
  ratelimit,
  image,
  storePaths,
  store,
  config,
  ebay,
  kleinanzeigen,
  discogs,
  booklooker,
  auktion,
  markt,
  actionRobots,
  mcpGate,
  mcpTools,
});
