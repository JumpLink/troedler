/**
 * Fabricated listings for the kernel tests.
 *
 * Synthetic on purpose, and not only for the privacy rule: a hand-built row
 * lets a test state exactly one interesting fact — no price, mixed currency,
 * an auction that ends — which a captured real page never does.
 */

import { money, type Condition, type Listing, type ProviderId } from '@troedler/core';

export function listing(over: Partial<Listing> & { id: string; provider: ProviderId }): Listing {
  return {
    key: `${over.provider}:${over.id}`,
    title: 'Bandsaege BAS 318',
    description: null,
    url: `https://example.invalid/${over.id}`,
    price: money(28900),
    priceKind: 'fixed',
    shippingCost: null,
    totalPrice: money(28900),
    condition: 'used-good' as Condition,
    conditionRaw: null,
    sellerType: 'private',
    delivery: 'shipping',
    location: { postalCode: '21762', city: 'Otterndorf', country: 'DE', distanceKm: null },
    listedAt: '2026-08-20T09:00:00.000Z',
    listedAtPrecision: 'minute',
    endsAt: null,
    bidCount: null,
    images: [],
    gtin: null,
    fetchedAt: '2026-08-21T12:00:00.000Z',
    ...over,
  };
}
