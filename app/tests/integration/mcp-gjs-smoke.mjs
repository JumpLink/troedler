// Smoke test: the troedler MCP stdio server runs natively on GJS and answers a real
// `initialize` + `tools/list` + `tools/call` handshake driven by the MCP SDK client — then
// EXITS when its client goes away.
//
// Launched via `gjsify run` (the production entry): it resolves every dependency's native
// prebuild paths on its own and keeps stdout uncontaminated (its banner goes to stderr), so we
// spawn it with a CLEAN env — no manual LD_LIBRARY_PATH / GI_TYPELIB_PATH. A green run proves
// no launcher wrapper is needed.
//
// Prerequisite: `gjsify install` + `gjsify workspace troedler-cli build`, and gjs on PATH.
// Run with: `node app/tests/integration/mcp-gjs-smoke.mjs`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..'); // tests/integration -> app
const repoRoot = join(appRoot, '..'); // app -> repo root
const bundle = join(appRoot, 'dist', 'troedler.gjs.mjs');
assert(existsSync(bundle), 'build first — app/dist/troedler.gjs.mjs missing');

// The gjsify bin lives in the WORKSPACE ROOT's node_modules, not app/'s.
const gjsify = join(repoRoot, 'node_modules', '.bin', 'gjsify');
assert(existsSync(gjsify), 'run `gjsify install` first — @gjsify/cli bin missing');

// Clean env: strip native paths so success proves `gjsify run` resolves them itself.
const baseEnv = { ...process.env };
delete baseEnv.LD_LIBRARY_PATH;
delete baseEnv.GI_TYPELIB_PATH;
// Never let a developer's real database or config take part in a test run.
const env = {
  ...baseEnv,
  TROEDLER_DATA_DIR: join(repoRoot, 'node_modules', '.cache', 'troedler-smoke-data'),
  TROEDLER_CONFIG: join(repoRoot, 'node_modules', '.cache', 'troedler-smoke-config.json'),
};

const READ_ONLY_TOOLS = [
  'market_get_listing',
  'market_price_history',
  'market_providers',
  'market_quota',
  'market_search',
  'market_search_local',
  'market_watch_list',
];
const WRITE_TOOL = 'market_watch_save';

async function connect(extraEnv) {
  const transport = new StdioClientTransport({
    command: gjsify,
    args: ['run', bundle, 'mcp'],
    env: { ...env, ...extraEnv },
    cwd: appRoot,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'gjs-smoke', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

// ── 1. default catalogue: read-only, and provably so on the wire ────────────

const client = await connect({});
const info = client.getServerVersion();
assert.equal(info?.name, 'troedler', `unexpected server name: ${info?.name}`);

const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  READ_ONLY_TOOLS,
  'tool catalogue drifted — update READ_ONLY_TOOLS deliberately, it is the client contract',
);

// The read-only promise, asserted ON THE WIRE rather than in the source: this is what an MCP
// client actually sees. A tool that lost its annotation would have been dropped by the gate and
// failed the catalogue check above; one that gained `readOnlyHint: false` fails here.
for (const tool of tools) {
  assert.equal(tool.annotations?.readOnlyHint, true, `tool ${tool.name} is not marked read-only`);
}
console.log(`OK: MCP stdio server on GJS — ${tools.length} read-only tools (${info.name} ${info.version})`);

// A real tools/call. `market_providers` needs no credentials and no network, so it works in CI:
// it reports what each source CAN do and whether it is configured, which is exactly the answer
// that must survive a machine with no keys at all.
const res = await client.callTool({ name: 'market_providers', arguments: {} });
assert(Array.isArray(res.content) && res.content.length > 0, 'market_providers returned no content');
assert(!res.isError, `market_providers failed: ${String(res.content[0].text).slice(0, 200)}`);
const payload = JSON.parse(res.content[0].text);
assert(Array.isArray(payload.providers) && payload.providers.length > 0, 'expected a provider list');

// Sources whose terms forbid automated access must be OFF on a fresh machine. This is the one
// promise the README makes to people who are not us, so it is asserted rather than trusted.
for (const provider of payload.providers) {
  if (provider.id === 'kleinanzeigen') {
    assert.equal(provider.enabled, false, 'kleinanzeigen must be disabled by default');
  }
}
console.log(`OK: market_providers → ${payload.providers.length} sources, defaults respected`);

await client.close();

// ── 2. write catalogue is strictly larger, and only by the mutating tool ────

const writeClient = await connect({ TROEDLER_MCP_ALLOW_WRITE: '1' });
const withWrites = (await writeClient.listTools()).tools;
const names = withWrites.map((t) => t.name).sort();
assert.deepEqual(
  names,
  [...READ_ONLY_TOOLS, WRITE_TOOL].sort(),
  'write catalogue is not the read-only set plus the one writer',
);
assert.equal(
  withWrites.find((t) => t.name === WRITE_TOOL)?.annotations?.readOnlyHint,
  false,
  'the write tool must declare itself mutating — the gate believes the annotation',
);
console.log(`OK: TROEDLER_MCP_ALLOW_WRITE=1 adds exactly ${WRITE_TOOL}`);
await writeClient.close();

// ── 3. the server exits when its client goes away ───────────────────────────
//
// A regression test, not a nicety. The obvious park — `await new Promise(() => {})` — is
// unsettleable, so a server whose client died kept running forever; such processes were found
// REPARENTED TO `systemd --user`, which only happens once their spawner is gone. The SDK will
// not report EOF (its StdioServerTransport listens for `data`/`error` only), so this is the
// server author's job and nothing else would catch a regression.
//
// Driven with a raw spawn on purpose: StdioClientTransport.close() KILLS the child, which would
// pass whether or not EOF is handled.

const child = spawn(gjsify, ['run', bundle, 'mcp'], {
  env,
  cwd: appRoot,
  stdio: ['pipe', 'pipe', 'inherit'],
});
const exitedEarly = await Promise.race([
  new Promise((r) => child.once('exit', (code) => r(`exited early with ${code}`))),
  new Promise((r) => setTimeout(() => r(null), 4000)),
]);
assert.equal(exitedEarly, null, `server did not stay up while stdin was open: ${exitedEarly}`);

child.stdin.end(); // EOF — "your client is gone"
const outcome = await Promise.race([
  new Promise((r) => child.once('exit', (code) => r(code))),
  new Promise((r) => setTimeout(() => r('timeout'), 15000)),
]);
if (outcome === 'timeout') {
  child.kill('SIGKILL');
  assert.fail('server did not exit within 15s of stdin EOF — it would be orphaned');
}
assert.equal(outcome, 0, `server exited with ${outcome} on stdin EOF, expected 0`);
console.log('OK: server exits cleanly on stdin EOF (no orphan)');

process.exit(0);
