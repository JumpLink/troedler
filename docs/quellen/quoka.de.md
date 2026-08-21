# quoka.de — source record

| | |
|---|---|
| **Host we call** | `www.quoka.de` |
| **Adapter** | `packages/markt` · provider id `quoka` |
| **Access** | `html` — no public API; the search is `/anzeigen/?q=…` |
| **Terms verdict** | `silent` on automated access; the AGB permit **personal, non-commercial** viewing and downloading |
| **Enabled by default** | yes |
| **Last read by a person** | 2026-08-21 |

Everything marked *measured* was fetched from this machine on 2026-08-21 with
the adapter's own user agent, `troedler/… (+https://github.com/JumpLink/troedler)`.
Nothing here is quoted from memory.

Quoka ships in the same package as markt.de and reaches the opposite verdict.
Both name `ClaudeBot` in robots.txt with an explicit `Allow`; the difference is
entirely in the terms.

## What this source is

A general German classifieds portal, operated by **Quoka SRL** (per the AGB
header). Categories: Immobilienmarkt, Tiermarkt, Bekanntschaften, Auto &
Motorrad, Haus & Familie, Jobs & Business, Elektronik, Hobby & Freizeit,
Sport & Wellness, Alles Mögliche. Private and commercial ads both, with a
server-side filter that separates them.

## robots.txt

*Measured*, `GET https://www.quoka.de/robots.txt` → HTTP 200, 2 213 bytes.
**28 groups, no sitemap.** The group that applies to us begins:

```
User-agent: *
Allow: /
Disallow: /Suchergebnis/
Disallow: /Suchergebnis_AlternativesErgebnis/
Disallow: /Suchergebnis_RegionalErweitert/
Disallow: /Detailansicht/
Disallow: /Detailansicht-Archiv/
Disallow: /Bildansicht/
Disallow: /Suchen/
Disallow: /Suchtipps/
Disallow: /Homepage/
Disallow: /MeinQuoka/
Disallow: /outgoing/
Disallow: /xml/
Disallow: /libs/
Disallow: /tools/
Disallow: /ajax/
Disallow: /qs/
Disallow: /qpi/
… (52 rules in total)
```

**Every disallowed path belongs to the site's PREVIOUS URL scheme.** Today's
search is `/anzeigen/?q=…` and today's ad is
`/anzeigen/<kategorie>/…/anzeige/<slug>/<token>.html`. Neither is touched by any
rule; both match `Allow: /`.

The file also carries a considered AI policy — `GPTBot`, `CCBot`,
`ChatGPT-User`, `OAI-SearchBot`, `ClaudeBot`, `claude-web`, `anthropic-ai`,
`Googlebot`, `Google-Extended`, `PerplexityBot`, `Applebot` each get
`Allow: /`, while `Bytespider`, `Baiduspider`, `DeepSeek`, `Sogou Spider`,
`YisouSpider`, `YoudaoBot`, `ToutiaoSpider`, `360Spider`, `WangluTechBot` and
`zoomRank` get `Disallow: /`.

Those permissions are **not ours**. *Measured* with `@troedler/compliance`'s own
matcher:

```
groupFor(robots, "troedler")  -> agents=["*"]         rules=52  crawlDelay=null
groupFor(robots, "ClaudeBot") -> agents=["claudebot"] rules=1   crawlDelay=null
```

troedler sends its own name and abides by `*`. That group happens to permit the
same paths; we do not borrow a bot's name to find out. No `Crawl-delay` for `*`
(only `msnbot` and `bingbot` get one), so the gate's 2 s floor applies.

*Measured* verdicts:

| Path | Verdict |
|---|---|
| `/anzeigen/?q=fahrrad` | ALLOW — `Allow: /` |
| `/anzeigen/?q=fahrrad&pag=2` | ALLOW |
| `/anzeigen/?q=fahrrad&commercial=false` | ALLOW |
| `/anzeigen/?pricetype=zu%20verschenken` | ALLOW |
| `/anzeigen/elektronik/computer/` | ALLOW |
| `/anzeigen/…/anzeige/<slug>/<token>.html` | ALLOW |
| `/Suchergebnis/rad` | DENY — legacy scheme |
| `/Detailansicht/x` · `/qs/x` · `/ajax/x` | DENY |

## Bot protection

Cloudflare is in front (`server: cloudflare`, `cf-ray`, `cf-cache-status:
DYNAMIC`), backed by ASP.NET (`x-aspnetmvc-version: 5.2`, `x-server: de-iis1`).
**No challenge *measured*** — HTTP 200 on the first try under the honest agent,
on every one of ~20 requests across search, category and detail pages. No cookie
required for reading. `vary: User-Agent` is set; no markup difference was
observed and the adapter never sends a browser string.

## Terms of Use findings

Document: **AGB – Classified Portale**, `https://hilfebereich.quoka.de/agb/`.
Fetched and read in full 2026-08-21, 35 815 characters of text.

**There is no clause about automated access.** *Measured* by full-text search of
the document: `Crawler` 0 · `Spider` 0 · `Scraper` 0 · `Roboter` 0 ·
`automatisiert` 0 · `maschinell` 0 · `Suchmaschine` 0 · `Skript` 0.

What the document does say, under **„Nutzungsrecht"**:

> „Quoka gestattet Ihnen die **Ansicht und das Herunterladen einer Kopie** der
> Inhalte auf quoka.de **ausschließlich für persönliche und nicht-kommerzielle
> Zwecke**. […] Es ist **nicht gestattet**, die Inhalte zu verkaufen, zu
> verändern, zu **veröffentlichen**, zu **verbreiten** oder auf andere Weise für
> öffentliche oder kommerzielle Zwecke zu nutzen."

And, elsewhere in the same document, about what a user grants:

> „Sie gestatten auch allen Nutzern, die Ansicht, die Speicherung oder die
> Vervielfältigung dieser Inhalte für persönliche Zwecke."

### What follows

A local tool searching on its own user's behalf is the **permitted** case,
almost word for word — viewing and downloading a copy for personal,
non-commercial purposes. Redistribution is the **forbidden** one, and troedler
does none of it: the MCP server speaks stdio, there is no HTTP transport, no
hosted index and no shared cache (`AGENTS.md`, Leitplanke 1).

1. **`enabledByDefault: true`.** robots.txt permits the paths; the terms permit
   the use.
2. **`cache.memoryOnly = false`, `ttlSeconds = 900`.** Downloading a copy for
   personal use is the thing that was expressly allowed, so disk is fine here —
   unlike markt.de, where the same field is `0`/`memoryOnly` because that
   operator forbids copying ad content.
3. **`capabilities.disclaimer`** names the personal/non-commercial restriction
   and every surface must show it with the rows. That is the mechanism by which
   a user who *would* redistribute is told not to.
4. **`stripContactDetails()` runs while parsing.** See the trap below — this
   source ships the seller's phone number on every result row.

## URL grammar — measured

```
https://www.quoka.de/anzeigen/<kategorie>/?q=<begriff>&commercial=&pag=
```

| Parameter | Meaning | *Measured* behaviour |
|---|---|---|
| `q` | Suchbegriff | free text, not slugged; `?q=fahrrad` → 3 521 hits |
| `commercial` | Anbietertyp | **works.** `false` → 1 140, `true` → 2 381, matching the counts the site prints beside the filter |
| `pag` | Seite, 1-based | `&pag=2`; the pagination links up to page 100 |
| `pricetype` | Preistyp | `zu verschenken` → every row reads „zu verschenken" |
| `withpictures` | nur mit Bild | present in the markup; not used by the adapter |

Category is a path, not a parameter: `/anzeigen/elektronik/computer/`.

**Twenty rows per page.** `capabilities.maxResults` is `20 × PAGE_DEPTH.max` = 100.

### Two parameters that were tried and are NOT built

| Attempt | *Measured* result |
|---|---|
| `&order=priceasc` | **ignored.** Identical 20 rows in identical order to the bare URL. The sort control is a `<select class="search-results-order">` with no `name`, driven by script. |
| `&Zip=30966&Area=25` | **worse than ignored.** „Für die angegebenen Suchkriterien wurden keine Ergebnisse gefunden", `resultscount = 0`, and six recommendation ads. The location control geocodes through hidden `City`/`County` fields first. |

A radius parameter that silently returns nothing is the worst outcome available
on this source, so radius stays the kernel's job and never enters a URL.
`serverFilters` is therefore `['sellerType', 'sort']`, where `sort` means only
`newest` — see below.

### The default order IS newest

*Measured* across four pages of one query: page 1 all „heute", page 4 „gestern",
page 8 „19 August", page 50 „21 Juli". Strictly descending, so
`serverSorts: ['newest']` is a measurement rather than a claim. Any other sort
is reported as unapplied and finished by the kernel.

## What the pages carry

Result row (`div.article-item[data-articleid]`): the ad token in `location` and
in the URL, a GUID in `data-articleid`, title link, teaser text, one thumbnail
(`.webp`) plus an image count, `PLZ Ort[ - Ortsteil][, Bundesland]`, the date,
and the price. **No condition field, no shipping field, no seller badge, no GTIN.**

`sellerType` therefore comes from the *request*: under `commercial=false` every
row on the page is private by construction, and the parser stamps that on. With
no filter it stays `unknown` — never guessed.

`getListing` is **not implemented**. The ad page carries a schema.org `Product`
block with the full description and all image URLs, and a slug-less URL works
(*measured*: `/anzeigen/x/anzeige/x/<token>.html` → HTTP 200) — but the JSON-LD
contains raw newlines inside its string values and is **not valid JSON**
(`JSON.parse` → "Invalid control character at line 6"). A second parser per row
fetched, over a payload that needs repairing first, for fields the row already
has, is not worth the surface.

## Environment

| Variable | Meaning |
|---|---|
| `TROEDLER_QUOKA_CATEGORY` | a category path under `/anzeigen/`, e.g. `elektronik/computer` |

Shape-validated, not checked against a table: a well-formed but unknown category
earns an honest 404 rather than a silent search of everything. A bad value is
reported through `status()`.

## Traps

**Prices are not in German notation.** *Measured* shapes: `60 EUR` ·
`2 099 EUR` · `1400.0 EUR` · `9999.9 EUR` · `8,5 EUR` · `zu verschenken`. The
thousands separator is a **space** and the decimal separator is a **dot or a
comma**. Handing that to `parseGermanPrice` is not merely lossy, it is quietly
wrong in both directions:

```
parseGermanPrice("2 099 EUR")  →   2,00 €   (a thousandth of the price)
parseGermanPrice("1400.0 EUR") → 140,00 €   (a tenth of it)
```

Both then sort to the top of a price-ascending search looking like the bargain
of the year. `germanizeAmount()` rewrites the amount into the notation core
documents, and the money semantics stay core's job.

**A zero-hit search returns six ads *inside the result list*.** *Measured* on
`/anzeigen/?q=fahrrad&Zip=30966&Area=25`: HTTP 200, `var resultscount = 0`, the
no-result sentence, and six recommendation ads inside the very same
`.article-list` the hits use. They are distinguishable only by an **empty
`data-articleid`**. The adapter has two independent locks: the row selector is
`.article-list .article-item[data-articleid]:not([data-articleid=""])`, and
`resultscount` decides whether zero rows is an answer or a defect.

**The hit count is in an inline script, not in the markup.** `var resultscount =
3521;`. It is the discriminator, so it is read through the HTML façade
(`queryAll(doc, 'script')`), not by regexing the response body.

**Every result row carries the seller's phone number.** `data-phencrypted="…"`,
obfuscated. There is no selector for it in `types.ts` and there will not be one;
a test asserts the value never appears in the serialised output.

**Dates older than two days lose their year.** *Measured* wordings:
`heute HH:MM` · `gestern HH:MM` · `21 Juli` · `19 August`. Core knows the first
two; the third is a day plus a month **name** with no year and no time, and it
is what most of the inventory past page three carries. `parseQuokaDate` resolves
it to the most recent past occurrence — on 21 August, „15 Dezember" is *last*
December. Assuming the current year would post-date ads into the future, where
a `--since` filter keeps them for ever.

**A reduced price is two numbers in one node.** `.article-price` contains
`.new-price` and a struck-through `.old-price`; reading the container yields
`29.0 EUR30.0 EUR`. The adapter reads `.new-price` first.

**The Bundesland is part of the location string.** `73728 Esslingen,
Baden-Württemberg`. It is dropped: `Location` has no field for it, and folding
it into `city` would make „Esslingen" fail a comparison against every other
source's spelling of the same place. *Measured* over 102 location strings:
exactly zero or one comma, never two.

## Rate limit

No published limit. One connection per host, 2 s between requests (gate floor),
`HttpClient` caps a run at 40 requests per host.

## Live check — measured 2026-08-21

| Query | Result |
|---|---|
| `nähmaschine`, limit 25 | 25 rows of 146, 2 requests, 4.7 s |
| `fahrrad`, `sellerType: private`, limit 10 | 10 rows of 1 138, 1 request, `applied: ['sellerType','sort']` |
| `schallplatten`, `sellerType: private`, limit 10 | 10 rows of 353, 1 request |
| `?q=fahrrad&Zip=30966&Area=25` | 0 rows, `totalEstimate: 0`, no error — the six recommendations are not returned |

Prices, postcodes, towns and dates on all of the above were spot-checked against
the rendered page. No phone number and no e-mail address survived into any
`description`.
