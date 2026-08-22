/**
 * `troedler search` — the command the whole project exists for.
 *
 * The flags mirror `SearchQuery` one to one on purpose: a flag that does not
 * correspond to a field would have to be interpreted somewhere, and that
 * somewhere would be a second definition of what a search means.
 *
 * `--explain` is not a debugging convenience. On some sources the price,
 * radius and sort filters cannot be pushed down at all, so they run here
 * against the rows that came back — a materially weaker guarantee than the
 * user asked for. `--explain` is how they find out, and printing it is a
 * correctness feature.
 */

import type { CommandModule } from 'yargs';

import {
  RESULTS_PER_PROVIDER,
  RESULTS_TOTAL,
  emptinessNotice,
  gapNotice,
  mergeExcludedNotice,
  type Condition,
  type ProviderId,
} from '@troedler/core';

import { allListings, getListing, search } from '../../core/actions/index.ts';
import { createContext } from '../../core/context.ts';
import {
  pickArgv,
  printJson,
  renderBand,
  renderGroup,
  renderGroupHeading,
  renderListing,
  renderReport,
  runAndExit,
} from './output.ts';

const CONDITIONS = [
  'new',
  'new-other',
  'refurb-a',
  'refurb-b',
  'refurb-c',
  'used-excellent',
  'used-good',
  'used-acceptable',
  'for-parts',
] as const;

export const searchCommand: CommandModule = {
  command: 'search <text..>',
  describe: 'Mehrere Gebrauchtwaren-Marktplätze mit einer Anfrage durchsuchen',
  builder: (yargs) =>
    yargs
      .positional('text', { type: 'string', array: true, describe: 'Suchbegriffe' })
      .option('provider', {
        type: 'string',
        array: true,
        alias: 'p',
        describe: 'Nur diese Quellen (mehrfach nutzbar); ohne Angabe alle aktivierten',
      })
      .option('min-price', { type: 'number', describe: 'Mindestpreis in Euro' })
      .option('max-price', { type: 'number', describe: 'Höchstpreis in Euro' })
      .option('condition', {
        type: 'string',
        array: true,
        choices: CONDITIONS,
        describe: 'Zulässige Zustände',
      })
      .option('seller', {
        type: 'string',
        choices: ['private', 'commercial'],
        describe: 'Privat oder gewerblich',
      })
      .option('delivery', {
        type: 'string',
        choices: ['shipping', 'pickup'],
        describe: 'Versand oder Abholung',
      })
      .option('zip', { type: 'string', describe: 'PLZ als Ausgangspunkt für die Umkreissuche' })
      .option('radius', { type: 'number', describe: 'Umkreis in km (nicht jede Quelle kann das)' })
      .option('since', { type: 'string', describe: 'Nur Angebote ab diesem Zeitpunkt (ISO)' })
      .option('gtin', { type: 'string', describe: 'EAN/ISBN/GTIN für einen exakten Produkttreffer' })
      .option('sort', {
        type: 'string',
        choices: ['relevance', 'price-asc', 'price-desc', 'newest', 'ending-soonest'],
        describe: 'Sortierung innerhalb jeder Quelle',
      })
      .option('limit', {
        type: 'number',
        describe: `Treffer je Quelle (Vorgabe ${RESULTS_PER_PROVIDER.default})`,
      })
      .option('total', {
        type: 'number',
        describe: `Treffer in der gemischten Liste (Vorgabe ${RESULTS_TOTAL.default})`,
      })
      .option('merge', {
        type: 'boolean',
        default: false,
        describe: 'Zusätzlich eine gemischte Liste über alle Quellen ausgeben',
      })
      .option('compare', {
        type: 'boolean',
        default: false,
        describe: 'Nach Produkt gruppieren: dasselbe Ding, alle Quellen nebeneinander',
      })
      .option('explain', {
        type: 'boolean',
        default: false,
        describe: 'Zeigen, welcher Filter wo gelaufen ist',
      })
      .option('json', { type: 'boolean', default: false, describe: 'Maschinenlesbare Ausgabe' }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const explain = pickArgv<boolean>(raw, 'explain') ?? false;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    const text = (pickArgv<string[]>(raw, 'text') ?? []).join(' ');
    const eur = (key: string): number | undefined => {
      const v = pickArgv<number>(
        raw,
        key,
        key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()),
      );
      return v === undefined ? undefined : Math.round(v * 100);
    };

    runAndExit(
      () =>
        search(createContext(), {
          text,
          providers: pickArgv<string[]>(raw, 'provider') as ProviderId[] | undefined,
          minPriceMinor: eur('min-price'),
          maxPriceMinor: eur('max-price'),
          condition: pickArgv<Condition[]>(raw, 'condition'),
          sellerType: pickArgv(raw, 'seller'),
          delivery: pickArgv(raw, 'delivery'),
          postalCode: pickArgv<string>(raw, 'zip'),
          radiusKm: pickArgv<number>(raw, 'radius'),
          since: pickArgv<string>(raw, 'since'),
          gtin: pickArgv<string>(raw, 'gtin'),
          sort: pickArgv(raw, 'sort'),
          limit: pickArgv<number>(raw, 'limit'),
          total: pickArgv<number>(raw, 'total'),
          merge: pickArgv<boolean>(raw, 'merge'),
          compare: pickArgv<boolean>(raw, 'compare'),
        }),
      {
        print: (result) => {
          if (asJson) {
            printJson({
              query: result.outcome.query,
              noSourceAnswered: result.noSourceAnswered,
              gaps: result.gaps,
              // One band per source, never one across them — see the note on
              // `SearchResult.bands`.
              bands: [...result.bands].map(([provider, band]) => ({ provider, band })),
              groups: [...result.outcome.grouped].map(([provider, listings]) => ({ provider, listings })),
              merged: result.outcome.merged,
              mergeExcluded: result.outcome.mergeExcluded,
              products: result.outcome.products,
              reports: result.outcome.reports,
            });
            return;
          }

          // Before the results, not after: it changes what the results MEAN.
          for (const gap of result.gaps) console.log(`${gapNotice(gap)}\n`);

          const listings = allListings(result.outcome);
          if (result.outcome.products) {
            let n = 1;
            for (const group of result.outcome.products) {
              console.log(renderGroup(group, n, result.verdicts));
              console.log('');
              n += 1;
            }
          } else if (result.outcome.merged) {
            let n = 1;
            for (const listing of result.outcome.merged) {
              console.log(renderListing(listing, result.verdicts.get(listing.key), n));
              n += 1;
            }
            // Rows are missing from this list by licence, not by chance. A
            // reader who is not told will read the merged list as "everything".
            const excluded = mergeExcludedNotice(result.outcome.mergeExcluded);
            if (excluded) console.log(`\n${excluded}`);
          } else {
            for (const [provider, group] of result.outcome.grouped) {
              if (group.length === 0) continue;
              console.log(renderGroupHeading(provider, group.length));
              let n = 1;
              for (const listing of group) {
                console.log(renderListing(listing, result.verdicts.get(listing.key), n));
                n += 1;
              }
              const band = result.bands.get(provider);
              if (band) console.log(renderBand(band));
              console.log('');
            }
          }

          for (const report of result.outcome.reports) console.log(renderReport(report, explain));

          // The distinction that matters more than any of the above: nobody
          // answered is not the same fact as nothing matched, and only the
          // second one means the thing is not out there.
          const emptiness = emptinessNotice(result.noSourceAnswered, listings.length);
          if (emptiness) console.log(`\n${emptiness}`);
        },
      },
    );
  },
};

/**
 * `troedler show <key>` — one offer, read-only.
 *
 * It is the command the Justiz-Auktion adapter has been advertising under every
 * search ("Einzelne Auktionen sind abrufbar — `troedler show justiz-auktion:<id>`")
 * for a source that cannot be searched at all. It did not exist, and the only
 * route to a single offer was `item watch`, which writes to the store.
 */
export const showCommand: CommandModule = {
  command: 'show <key>',
  describe: 'Ein einzelnes Angebot abrufen — nur lesen, nichts speichern',
  builder: (yargs) =>
    yargs
      .positional('key', { type: 'string', describe: 'Schlüssel als <quelle>:<id>' })
      .option('json', { type: 'boolean', default: false, describe: 'Maschinenlesbare Ausgabe' }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const key = pickArgv<string>(raw, 'key')!;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;

    runAndExit(() => getListing(createContext(), key), {
      print: (found) => {
        if (asJson) return printJson(found);
        if (found.problem) {
          console.log(found.problem);
          return;
        }
        if (!found.listing) {
          // "Gone" and "could not look it up" are different facts, and only the
          // first one means the offer is not there any more.
          console.log(`${key}: gibt es nicht (mehr).`);
          return;
        }
        console.log(renderListing(found.listing, undefined, 1));
        if (found.listing.description) console.log(`\n${found.listing.description}`);
        for (const image of found.listing.images) console.log(image);
        if (found.disclaimer) console.log(`\n${found.disclaimer}`);
      },
    });
  },
};
