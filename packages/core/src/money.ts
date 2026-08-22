/**
 * Money — integer minor units, never a float.
 *
 * The four sources disagree about how to spell a price and every one of them
 * would lose cents through a float: eBay sends the string `"289.00"`, Etsy an
 * `{amount, divisor}` pair, Discogs a number, and a classified ad says
 * `"3.550 € VB"` in German notation. Each adapter converts at its edge; past
 * the edge there is exactly one representation.
 */

export interface Money {
  /** Cents, not euros. 289.00 EUR is `28900`. */
  readonly minor: number;
  /** ISO 4217, uppercase. */
  readonly currency: string;
}

export function money(minor: number, currency = 'EUR'): Money {
  return { minor: Math.round(minor), currency };
}

/** From a decimal string as APIs send it (`"289.00"`, `"1289.9"`). */
export function moneyFromDecimal(value: string | number, currency = 'EUR'): Money | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(n) ? money(n * 100, currency.toUpperCase()) : null;
}

// No `moneyFromDivisor` here yet. It existed, for "the shape Etsy uses", and
// Etsy is not implemented — four lines of speculation with a green test and no
// caller. It comes back with the adapter that needs it, measured against a real
// response rather than a remembered one.

export function addMoney(a: Money, b: Money | null | undefined): Money {
  if (!b) return a;
  // Deliberately not converting: a cross-currency sum would be a made-up number.
  // The caller compares currencies first; this is the last line of defence.
  if (a.currency !== b.currency) return a;
  return { minor: a.minor + b.minor, currency: a.currency };
}

/** German formatting, the only locale this tool targets today. */
export function fmtMoney(m: Money | null | undefined): string {
  if (!m) return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: m.currency }).format(m.minor / 100);
}
