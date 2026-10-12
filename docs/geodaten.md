# Geodata for the radius filter

Neither kleinanzeigen.de (robots.txt disallows every `…r<km>` path) nor Quoka (no radius) can filter by
distance. The kernel does it after the fetch: it looks up the query's postcode and each row's postcode in a
bundled table and measures the straight line between the two points.

## Behaviour

- Applies when the query has a postcode **and** a radius, the source did not apply the radius itself, and the
  origin postcode is in the table. Otherwise the radius stays in `unenforced`, as before.
- Rows farther away than the radius are dropped.
- Rows whose location cannot be placed (no postcode, non-German, four-digit) are **kept** and counted in the
  report (`unlocated`) — "unknown" is not "far".
- Every row of a query with a postcode gets `distanceKm` (whole km) when it can be placed; a figure from the
  source wins over ours. The MCP tools expose it as `distance_km`.
- The search warns which sources were filtered locally, and how many rows that removed.
- Accuracy is that of postcode centroids: a few kilometres, nothing finer.

## Source and licence

[GeoNames](https://www.geonames.org/) postal codes for Germany (`https://download.geonames.org/export/zip/DE.zip`),
**CC BY 4.0**. Attribution: "Contains data from GeoNames (geonames.org), CC BY 4.0."

Per postcode the median latitude and longitude of the listed places is used (a few postcodes list outliers),
rounded to 0.01°. 10 815 postcodes, ~165 KB in `packages/core/src/geo/postal-de.ts`. The table is parsed on
first use.

## Regenerate

```sh
curl -O https://download.geonames.org/export/zip/DE.zip && unzip DE.zip DE.txt
node scripts/generate-postal-de.mjs DE.txt
```

`postal-de.ts` is generated; do not edit it by hand.
