# Green, and it checked nothing

The failure mode this project is built against, with every mechanism and the incident that produced
it. Extracted verbatim from `AGENTS.md`.

## The failure mode this project is built against

**Green, and it checked nothing.** A marketplace that changed its markup, refused us, or was never
configured all look identical to "no matches" — and "no matches" is an answer people act on. So:

- `ProviderReport.outcome` is `ok | empty | skipped | failed`, never a row count.
- An adapter that got a page but matched **zero** elements with its selectors throws
  `parse-failed`; it does not return an empty list.
- `openDatabase` writes and reads back a canary row, because gjsify's `node:sqlite` **swallows
  exceptions in `all()`/`get()`** and would otherwise report an empty watchlist forever.
- `searchAll` reports `noSourceAnswered` separately, and the CLI says so in words.
- Every test needs a discriminator: would it still pass if the parser returned nothing?
- `scripts/guard-unused-kernel.mjs` fails CI when an exported `@troedler/core` function is
  unreachable from production. No test can cover this: a test proves a function WORKS, never that
  anything USES it — and the cross-source grouping this project exists for sat dead behind two
  green tests until a live check asked who called it.
- A pass that spends requests must report what it spent AND what it left out. The barcode
  cross-check under `--compare` first shipped adding 13 rows for 12 requests and changing nothing:
  eBay answers `item_summary/search?gtin=` with matching items whose summaries carry no product
  code, so every added row fell back to the title-and-price identity and grouped with nothing. The
  counters looked like work. `docs/quellen/ebay.de.md` § 7a has the measurement.

`--explain` belongs to the same idea. Where a source cannot push a filter down, the kernel applies
it to the rows that came back — a materially weaker guarantee, and the user has to be able to see
that they got it. It has to be complete about it, too: a filter the kernel applied but did not
name, or one it named that could not remove a row on this source, is the same failure wearing a
report.

## Check against the source, not against your own fixture

Every adapter here was once green against fixtures its own author had written, and a live check
found something wrong in **all four** running sources. Not one number was copied incorrectly — the
defects were all in a response shape that had been *inferred* and then pinned by a fixture built
from the same guess. Zoll-Auktion's `Versand:` row was documented as `Ja`/`Nein` in the DTO, in the
source record and in the fixture; the page prints `Nein` or `Deutschland (10,00 EUR)`, so the
adapter reported every shipping lot as collection-only and its own tests held that in place.

So: a claim about what a page or an API returns is worth what its measurement is worth. Write the
date and the sample into the source record (`docs/quellen/<host>.md`), and when a claim turns out
to be inference, **mark it as inference rather than deleting it** — the trail is what stops the
next person re-deriving the same guess.
