import { describe, expect, it } from '@gjsify/unit';

import { haversineKm, postalCentroid } from '@troedler/core';

export default async () => {
  await describe('geo', async () => {
    await it('places a known German postcode', async () => {
      const berlin = postalCentroid('10115');
      expect(berlin !== null).toBe(true);
      expect(Math.abs((berlin?.lat ?? 0) - 52.5) < 0.5).toBe(true);
    });

    await it('answers null instead of guessing', async () => {
      expect(postalCentroid('00000')).toBe(null);
      expect(postalCentroid('1010')).toBe(null);
      expect(postalCentroid('10115', 'AT')).toBe(null);
      expect(postalCentroid(null)).toBe(null);
    });

    await it('measures Berlin–Munich at roughly 500 km', async () => {
      const a = postalCentroid('10115');
      const b = postalCentroid('80331');
      expect(a !== null && b !== null).toBe(true);
      if (a && b) {
        const km = haversineKm(a, b);
        expect(km > 480 && km < 520).toBe(true);
        expect(haversineKm(a, a)).toBe(0);
      }
    });
  });
};
