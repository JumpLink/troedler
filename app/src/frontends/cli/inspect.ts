/**
 * The commands that let a person check what troedler is doing before trusting it:
 * `robots`, `terms`, `config`, `cache` and `check`.
 *
 * `robots <url>` in particular is not a developer toy. The whole project rests
 * on the claim that it only fetches what a site permits, and a claim nobody can
 * verify is worth nothing. This makes the gate answerable from the command
 * line, naming the exact rule that decided.
 *
 * Which is why it has to answer for the program that exists rather than the
 * simple one: the judgement lives in `explainUrl`, which asks the same gate the
 * socket layer asks, with the same facts. It used to build its own question here
 * and got a different answer — see the measurement in that file.
 */

import type { CommandModule } from 'yargs';

import { SOURCES, sourceFor } from '@troedler/compliance';
import { providerState } from '@troedler/core';
import { cacheDir, dataDir, dbPath, loadConfig } from '@troedler/store';

import { explainUrl, listProviders } from '../../core/actions/index.ts';
import { createContext } from '../../core/context.ts';
import { VERSION, runningOnGjs } from '../../core/runtime.ts';
import { pickArgv, printJson, runAndExit } from './output.ts';

export const robotsCommand: CommandModule = {
  command: 'robots <url>',
  describe: 'Prüfen, ob troedler eine URL abrufen würde — und was darüber entscheidet',
  builder: (yargs) =>
    yargs
      .positional('url', { type: 'string', describe: 'Vollständige URL' })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const url = pickArgv<string>(raw, 'url')!;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;

    runAndExit(async () => explainUrl(createContext(), url), {
      print: (v) => {
        if (asJson) return printJson(v);
        console.log(v.allowed ? `erlaubt: ${v.url}` : `VERBOTEN: ${v.url}`);
        if (v.detail) console.log(`  ${v.detail}`);

        // Which source this host belongs to decides everything above, so it is
        // named rather than left for the reader to infer from the hostname.
        if (v.provider) {
          const state = v.provider.enabled ? 'an' : 'aus';
          const kind = v.provider.access === 'official-api' ? 'offizielle API' : 'öffentliches HTML';
          console.log(`  Quelle: ${v.provider.label} (${kind}, ${state})`);
        } else {
          console.log('  Keine Quelle von troedler ruft diesen Host ab — die Antwort ist hypothetisch.');
        }

        // The pace, in the words that fit what governs it. A flat "2 s" on an
        // API host was wrong twice over: there is no floor there, and the real
        // limit is the one the operator publishes.
        console.log(
          v.basis === 'licence'
            ? `  Kein Höflichkeitsabstand für ${v.host} — es gilt das Limit der API, gegen das der Adapter drosselt.`
            : `  Wartezeit zwischen Anfragen an ${v.host}: ${v.delaySeconds} s`,
        );

        if (v.robotsSkipped) console.log(`  robots.txt wurde nicht gelesen. ${v.robotsSkipped}`);
        // "no robots.txt" and "could not read robots.txt" both permit the
        // request and are not the same statement. The second one used to be
        // printed as the first — a claim about a file nobody had seen.
        if (v.robots === 'absent')
          console.log('  (dieser Host liefert keine robots.txt — damit gilt keine Einschränkung)');
        if (v.robots === 'unreadable')
          console.log(
            `  ACHTUNG: robots.txt war nicht lesbar (${v.robotsDetail}) — es wurde KEINE Regel geprüft.`,
          );

        if (v.source) console.log(`  Quellenakte: ${v.source.doc} (geprüft ${v.source.checked})`);
      },
    });
  },
};

export const termsCommand: CommandModule = {
  command: 'terms [host]',
  describe: 'Was über die Nutzungsbedingungen einer Quelle festgehalten ist',
  builder: (yargs) =>
    yargs.positional('host', { type: 'string' }).option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const host = pickArgv<string>(raw, 'host');
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;

    runAndExit(async () => (host ? [sourceFor(host)].filter(Boolean) : SOURCES), {
      print: (records) => {
        if (asJson) return printJson(records);
        for (const r of records) {
          if (!r) continue;
          console.log(`${r.host}  [${r.automatedAccess}]  geprüft ${r.checked}`);
          if (r.clause) console.log(`    ${r.clause}`);
          console.log(`    ${r.doc}`);
        }
      },
    });
  },
};

export const configCommand: CommandModule = {
  command: 'config [action]',
  describe: 'Konfiguration anzeigen oder prüfen',
  builder: (yargs) =>
    yargs.positional('action', { type: 'string', choices: ['show', 'path', 'validate'], default: 'show' }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const action = pickArgv<string>(raw, 'action') ?? 'show';

    runAndExit(
      async () => {
        const context = createContext();
        if (action === 'path')
          return { config: context.configPath, data: dataDir(), cache: cacheDir(), db: dbPath() };
        // `validate` differs from `show` only in that it reads the file again
        // and throws on a bad one — `show` would happily print the defaults it
        // fell back to, which is exactly what you do not want to see when you
        // are checking whether your edit took.
        if (action === 'validate') {
          loadConfig(context.configPath);
          return { ok: true, path: context.configPath };
        }
        return context.config;
      },
      { print: printJson },
    );
  },
};

export const cacheCommand: CommandModule = {
  command: 'cache <action>',
  describe: 'Lokalen Bestand ansehen oder löschen',
  builder: (yargs) =>
    yargs
      .positional('action', { type: 'string', choices: ['stats', 'purge'] })
      .option('search', { type: 'string', describe: 'Nur diese gespeicherte Suche' })
      .option('older-than', { type: 'string', describe: 'Nur Einträge vor diesem ISO-Zeitpunkt' })
      .option('all', { type: 'boolean', default: false, describe: 'Alles löschen' }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const action = pickArgv<string>(raw, 'action')!;
    const context = createContext();

    if (action === 'stats') {
      runAndExit(async () => context.store().stats(), { print: printJson });
      return;
    }

    const search = pickArgv<string>(raw, 'search');
    const olderThan = pickArgv<string>(raw, 'older-than', 'olderThan');
    const all = pickArgv<boolean>(raw, 'all') ?? false;
    if (!search && !olderThan && !all) {
      throw new Error(
        'cache purge braucht --search, --older-than oder --all. Ohne Ziel wird nichts gelöscht.',
      );
    }
    runAndExit(async () => ({ removed: context.store().purge({ search, olderThan }) }), {
      print: (r) => console.log(`${r.removed} Einträge gelöscht.`),
    });
  },
};

export const checkCommand: CommandModule = {
  command: 'check',
  describe: 'Gesamtprobe: Laufzeit, Konfiguration, Datenbank, jede Quelle',
  builder: (yargs) => yargs.option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;

    runAndExit(
      async () => {
        const context = createContext();
        const providers = await listProviders(context);

        // The database is probed by opening it: `openDatabase` writes and reads
        // a canary row, so "opened fine" here really does mean reads work — see
        // the swallowed-exception note in @troedler/store.
        let store: string;
        try {
          context.store().stats();
          store = 'ok';
        } catch (err) {
          store = err instanceof Error ? err.message : String(err);
        }

        return {
          version: VERSION,
          runtime: runningOnGjs() ? 'gjs' : 'node',
          config: context.configPath,
          database: { path: dbPath(), status: store },
          providers: providers.map((p) => ({
            id: p.id,
            enabled: p.enabled,
            configured: p.configured,
            problem: p.problem,
          })),
        };
      },
      {
        print: (r) => {
          if (asJson) return printJson(r);
          console.log(`troedler ${r.version} auf ${r.runtime}`);
          console.log(`Konfiguration: ${r.config}`);
          console.log(`Datenbank:     ${r.database.path} — ${r.database.status}`);
          console.log('Quellen:');
          for (const p of r.providers) {
            console.log(`  ${p.id.padEnd(16)} ${providerState(p)}${p.problem ? ` — ${p.problem}` : ''}`);
          }
        },
      },
    );
  },
};
