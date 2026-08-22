/**
 * `troedler watch` — saved searches and the "only what is new" report.
 *
 * `watch run` is the only command in the CLI that writes to the seen index.
 * Keeping that boundary is what makes the alerts believable: if a plain search
 * also marked offers as seen, the next run would go quiet about listings the
 * user never actually looked at.
 */

import type { CommandModule } from 'yargs';

import { fmtMinor, type ProviderId, type SearchQuery } from '@troedler/core';

import {
  addSearch,
  checkWatched,
  listSearches,
  removeSearch,
  runSearch,
  unwatchListing,
  watchListing,
} from '../../core/actions/index.ts';
import { createContext } from '../../core/context.ts';
import { pickArgv, printJson, renderListing, renderReport, runAndExit } from './output.ts';

export const watchCommand: CommandModule = {
  command: 'watch <action> [name]',
  describe: 'Gespeicherte Suchen anlegen, laufen lassen und nur neue Treffer melden',
  builder: (yargs) =>
    yargs
      .positional('action', {
        type: 'string',
        choices: ['add', 'list', 'remove', 'run', 'seen'],
        describe: 'Was getan werden soll',
      })
      .positional('name', { type: 'string', describe: 'Name der gespeicherten Suche' })
      .option('query', { type: 'string', alias: 'q', describe: 'Suchbegriffe (bei add)' })
      .option('provider', { type: 'string', array: true, alias: 'p', describe: 'Quellen (bei add)' })
      .option('min-price', { type: 'number', describe: 'Mindestpreis in Euro (bei add)' })
      .option('max-price', { type: 'number', describe: 'Höchstpreis in Euro (bei add)' })
      .option('zip', { type: 'string', describe: 'PLZ (bei add)' })
      .option('radius', { type: 'number', describe: 'Umkreis in km (bei add)' })
      .option('limit', { type: 'number', describe: 'Zeilen (bei seen)' })
      .option('json', { type: 'boolean', default: false, describe: 'Maschinenlesbare Ausgabe' }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const action = pickArgv<string>(raw, 'action')!;
    const name = pickArgv<string>(raw, 'name');
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    const eur = (key: string, camel: string): number | undefined => {
      const v = pickArgv<number>(raw, key, camel);
      return v === undefined ? undefined : Math.round(v * 100);
    };

    const context = createContext();

    switch (action) {
      case 'add': {
        if (!name) throw new Error('watch add braucht einen Namen.');
        const text = pickArgv<string>(raw, 'query');
        if (!text) throw new Error('watch add braucht --query.');
        const query: SearchQuery = {
          text,
          minPriceMinor: eur('min-price', 'minPrice'),
          maxPriceMinor: eur('max-price', 'maxPrice'),
          postalCode: pickArgv<string>(raw, 'zip'),
          radiusKm: pickArgv<number>(raw, 'radius'),
        };
        const providers = (pickArgv<string[]>(raw, 'provider') ?? []) as ProviderId[];
        runAndExit(async () => addSearch(context, name, query, providers), {
          print: (saved) =>
            asJson ? printJson(saved) : console.log(`Gespeichert: "${saved.name}" — ${saved.query.text}`),
        });
        return;
      }

      case 'list':
        runAndExit(async () => listSearches(context), {
          print: (searches) => {
            if (asJson) return printJson(searches);
            if (searches.length === 0) return console.log('Keine gespeicherten Suchen.');
            for (const s of searches) {
              const when = s.lastRunAt ? `zuletzt ${s.lastRunAt} (${s.lastRunNew} neu)` : 'noch nie gelaufen';
              console.log(`${s.name}: "${s.query.text}" — ${when}`);
            }
          },
        });
        return;

      case 'remove':
        if (!name) throw new Error('watch remove braucht einen Namen.');
        runAndExit(async () => removeSearch(context, name), {
          print: (removed) => console.log(removed ? `"${name}" entfernt.` : `"${name}" gab es nicht.`),
        });
        return;

      case 'seen': {
        if (!name) throw new Error('watch seen braucht einen Namen.');
        const limit = pickArgv<number>(raw, 'limit') ?? 50;
        runAndExit(async () => context.store().listSeen(name, limit), {
          print: (rows) => {
            if (asJson) return printJson(rows);
            for (const r of rows) {
              const price = fmtMinor(r.priceMinor, r.currency);
              console.log(`${r.firstSeenAt.slice(0, 10)}  ${price.padStart(12)}  ${r.title}`);
            }
            console.log(`\n${rows.length} Einträge.`);
          },
        });
        return;
      }

      case 'run': {
        if (!name) throw new Error('watch run braucht einen Namen.');
        runAndExit(() => runSearch(context, name), {
          print: (result) => {
            if (asJson) return printJson(result);
            if (result.noSourceAnswered) {
              console.log('Keine Quelle hat geantwortet — der Lauf wurde NICHT gespeichert.');
              // Not recording it is the point: an unrecorded failure keeps the
              // baseline intact, so the next successful run still reports the
              // offers this one never saw.
              for (const report of result.reports) console.log(renderReport(report, false));
              return;
            }
            if (result.fresh.length === 0) {
              console.log('Nichts Neues.');
            } else {
              console.log(`${result.fresh.length} neue Treffer:\n`);
              let n = 1;
              for (const listing of result.fresh) {
                console.log(renderListing(listing, undefined, n));
                n += 1;
              }
            }
            console.log('');
            for (const report of result.reports) console.log(renderReport(report, false));
          },
        });
        return;
      }

      default:
        throw new Error(`Unbekannte Aktion "${action}".`);
    }
  },
};

export const itemCommand: CommandModule = {
  command: 'item <action> [key]',
  describe: 'Einzelne Angebote beobachten (Preisänderung, verkauft)',
  builder: (yargs) =>
    yargs
      .positional('action', { type: 'string', choices: ['watch', 'unwatch', 'list', 'check'] })
      .positional('key', { type: 'string', describe: 'Angebots-Schlüssel <provider>:<id>' })
      .option('note', { type: 'string', describe: 'Eigene Notiz' })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const action = pickArgv<string>(raw, 'action')!;
    const key = pickArgv<string>(raw, 'key');
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    const context = createContext();

    switch (action) {
      case 'list':
        runAndExit(async () => context.store().listWatched(), {
          print: (rows) => {
            if (asJson) return printJson(rows);
            for (const r of rows) {
              const price = fmtMinor(r.lastPriceMinor, r.currency);
              console.log(
                `${r.provider}:${r.listingId}  ${price.padStart(12)}  ${r.goneAt ? '[weg] ' : ''}${r.title}`,
              );
            }
            console.log(`\n${rows.length} beobachtete Angebote.`);
          },
        });
        return;

      case 'unwatch':
        if (!key) throw new Error('item unwatch braucht einen Schlüssel.');
        runAndExit(async () => unwatchListing(context, key), {
          print: (removed) =>
            console.log(removed ? `${key} wird nicht mehr beobachtet.` : `${key} war nicht in der Liste.`),
        });
        return;

      case 'watch': {
        if (!key) throw new Error('item watch braucht einen Schlüssel.');
        runAndExit(
          async () => {
            const at = key.indexOf(':');
            const provider = context.providers.find((p) => p.capabilities.id === key.slice(0, at));
            if (!provider?.getListing)
              throw new Error(`${key.slice(0, at)} kann einzelne Angebote nicht nachschlagen.`);
            const listing = await provider.getListing(key.slice(at + 1));
            if (!listing) throw new Error(`${key} gibt es nicht (mehr).`);
            watchListing(context, listing, pickArgv<string>(raw, 'note') ?? null);
            return listing;
          },
          { print: (listing) => console.log(`Beobachte: ${listing.title}`) },
        );
        return;
      }

      case 'check':
        runAndExit(() => checkWatched(context), {
          print: (rows) => {
            if (asJson) return printJson(rows);
            for (const r of rows) {
              if (r.error) {
                console.log(`${r.key}: nicht prüfbar — ${r.error}`);
              } else if (r.gone) {
                console.log(`${r.key}: WEG — ${r.title}`);
              } else if (r.changed) {
                const from = fmtMinor(r.previousMinor ?? 0, r.currency);
                const to = fmtMinor(r.currentMinor ?? 0, r.currency);
                console.log(`${r.key}: ${from} → ${to} — ${r.title}`);
              } else {
                console.log(`${r.key}: unverändert`);
              }
            }
          },
        });
        return;

      default:
        throw new Error(`Unbekannte Aktion "${action}".`);
    }
  },
};
