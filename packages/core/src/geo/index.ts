/**
 * Distance between two German postcodes, offline.
 *
 * Exists because the radius is a filter no source can be trusted with:
 * kleinanzeigen.de disallows every `…r<km>` path in robots.txt and Quoka has no
 * radius at all. A row carries a postcode, the query carries one, and that is
 * enough for a straight-line answer — the table is bundled instead of asking a
 * geocoding service, because that would send every user's home postcode to a
 * third party on every search.
 *
 * The answer is the distance between postcode CENTROIDS. Good to a few
 * kilometres, which is the resolution of a "within 30 km" question; it is not a
 * route and not an address.
 */

import { POSTAL_DE } from './postal-de.ts';

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

const EARTH_RADIUS_KM = 6371;

let table: Map<string, GeoPoint> | null = null;

/** Parsed on first use: most runs never filter by radius and should not pay for 10 000 entries. */
function centroids(): Map<string, GeoPoint> {
  if (table) return table;
  const map = new Map<string, GeoPoint>();
  for (const entry of POSTAL_DE.split(';')) {
    const [code, lat, lon] = entry.split(':');
    map.set(code, { lat: Number(lat) / 100, lon: Number(lon) / 100 });
  }
  table = map;
  return map;
}

/**
 * The centroid of a German postcode, or `null` when it is not one we know.
 *
 * `null` is an answer ("cannot place this"), never a stand-in for zero — a row
 * we cannot place must not be dropped as "far away" or kept as "near".
 */
export function postalCentroid(postalCode: string | null | undefined, country?: string | null): GeoPoint | null {
  if (country && country.toUpperCase() !== 'DE') return null;
  const code = (postalCode ?? '').trim();
  // Five digits or nothing: Austria and Switzerland print four, and padding
  // them with a zero would silently place a Vienna ad in the Erzgebirge.
  if (!/^\d{5}$/.test(code)) return null;
  return centroids().get(code) ?? null;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
