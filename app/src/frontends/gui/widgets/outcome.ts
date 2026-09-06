/**
 * Which Adwaita colour an outcome gets — decided once, for every layout.
 *
 * Only a failure earns the error colour. `skipped` is a DECISION — an
 * operator's terms, a missing key — and painting it red tells a person
 * something broke when nothing did. Two layouts now render the same five
 * states, so this had to stop being an inline ternary in one of them.
 */
import type { ProviderReport } from '@troedler/core';

export function outcomeClasses(outcome: ProviderReport['outcome'], base: readonly string[]): string[] {
  return outcome === 'failed' ? [...base, 'error'] : [...base];
}
