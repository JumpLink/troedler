/**
 * `troedler providers` — what exists, what is on, and what each source can do.
 *
 * `providers enable` is where the project's one real refusal lives. A source
 * whose operator forbids automated access is never switched on by default and
 * cannot be switched on by accident: the command prints the terms record and
 * demands `--acknowledge`. That is a decision for a person, and the config
 * records the date they made it.
 */

import type { CommandModule } from 'yargs';

import type { ProviderId } from '@troedler/core';

import {
  AcknowledgementRequired,
  listProviders,
  quotas,
  setProviderEnabled,
} from '../../core/actions/index.ts';
import { createContext } from '../../core/context.ts';
import { pickArgv, printJson, runAndExit } from './output.ts';

export const providersCommand: CommandModule = {
  command: 'providers [action] [id]',
  describe: 'Quellen auflisten, ein- und ausschalten',
  builder: (yargs) =>
    yargs
      .positional('action', {
        type: 'string',
        choices: ['list', 'show', 'enable', 'disable'],
        default: 'list',
      })
      .positional('id', { type: 'string', describe: 'Quellen-Kennung, z. B. ebay' })
      .option('acknowledge', {
        type: 'boolean',
        default: false,
        describe:
          'Bestätigt, dass das Quellendokument gelesen wurde — nötig für Quellen, die automatisierten Abruf untersagen',
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const action = pickArgv<string>(raw, 'action') ?? 'list';
    const id = pickArgv<string>(raw, 'id') as ProviderId | undefined;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    const context = createContext();

    if (action === 'enable' || action === 'disable') {
      if (!id) throw new Error(`providers ${action} braucht eine Quellen-Kennung.`);
      runAndExit(
        async () => {
          try {
            setProviderEnabled(
              context,
              id,
              action === 'enable',
              pickArgv<boolean>(raw, 'acknowledge') ?? false,
            );
            return { id, enabled: action === 'enable' };
          } catch (err) {
            if (err instanceof AcknowledgementRequired) {
              // Not an error to swallow and not a prompt to auto-answer: the
              // user is being told what they would be agreeing to, and the
              // command exits so that saying yes is a separate, deliberate act.
              console.error(err.message);
              process.exit(2);
            }
            throw err;
          }
        },
        { print: (r) => console.log(`${r.id}: ${r.enabled ? 'aktiviert' : 'deaktiviert'}`) },
      );
      return;
    }

    runAndExit(() => listProviders(context, action === 'show' ? id : undefined), {
      print: (views) => {
        if (asJson) return printJson(views);
        for (const v of views) {
          const state = v.enabled ? (v.configured ? 'an' : 'an, aber nicht konfiguriert') : 'aus';
          console.log(`${v.id.padEnd(16)} ${state.padEnd(28)} ${v.access}  ${v.host}`);
          if (action === 'show' || !v.enabled || !v.configured) {
            if (v.problem) console.log(`    Problem: ${v.problem}`);
            if (v.note) console.log(`    ${v.note.split('\n').join('\n    ')}`);
          }
          if (action === 'show') {
            console.log(`    Filter beim Anbieter: ${v.serverFilters.join(', ') || '—'}`);
            console.log(`    Sortierung beim Anbieter: ${v.serverSorts.join(', ') || '—'}`);
            console.log(`    Höchstens ${v.maxResults} Treffer, Cache ${v.cacheTtlSeconds} s`);
            console.log(`    Quellendokument: ${v.termsDoc}`);
            if (v.disclaimer) console.log(`    Pflichthinweis: ${v.disclaimer}`);
          }
        }
      },
    });
  },
};

export const quotaCommand: CommandModule = {
  command: 'quota [id]',
  describe: 'Verbleibendes Anfragebudget je Quelle',
  builder: (yargs) =>
    yargs.positional('id', { type: 'string' }).option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    runAndExit(() => quotas(createContext(), pickArgv<string>(raw, 'id') as ProviderId | undefined), {
      print: (rows) => {
        if (asJson) return printJson(rows);
        if (rows.length === 0) return console.log('Keine Quelle meldet ein Budget.');
        for (const r of rows) {
          if (r.error) console.log(`${r.id}: nicht abrufbar — ${r.error}`);
          else
            console.log(
              `${r.id}: ${r.remaining ?? '?'} von ${r.limit ?? '?'} übrig${r.resetAt ? `, zurück am ${r.resetAt}` : ''}`,
            );
        }
      },
    });
  },
};
