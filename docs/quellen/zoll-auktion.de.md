# zoll-auktion.de — source record

| | |
|---|---|
| **Host we call** | `www.zoll-auktion.de` |
| **Adapter** | `packages/auktion` · provider id `zoll-auktion` |
| **Access** | `html` — no API exists; the whole search form is on the query string |
| **Terms verdict** | `silent` on automated **reading**; automated **bidding** is forbidden, and troedler never bids |
| **Enabled by default** | yes |
| **Last read by a person** | 2026-08-21 |

Everything marked *measured* was fetched from this machine on 2026-08-21 with
the adapter's own user agent, `troedler/… (+https://github.com/JumpLink/troedler)`.
Nothing here is quoted from memory.

## What this source is

The permanent public auction of the **Generalzolldirektion**, operated by
Hauptzollamt Gießen, Arbeitsbereich Zoll-Auktion, Bad Hersfeld. Sellers are
federal, state and municipal bodies — § 1 Abs. 5 of the Versteigerungsbedingungen
admits public-law bodies only and excludes private legal persons outright.

That single clause decides two fields in the DTO. `sellerType` is always
`commercial`, and it is a *category* rather than a person, so nothing about the
seller is ever stored. And every row is a live auction: `priceKind` is
`auction`, `endsAt` is real and matters, `bidCount` is published.

Goods are seized, pledged or confiscated items, surplus administrative
equipment, and property the state acquired by other means — lost property
(§§ 965, 978 BGB), unclaimed goods (§ 983 BGB), escheated estates (§ 1936 BGB).

*Measured:* the product sitemap listed **2 431 live lots**, in 16 top-level
categories.

## robots.txt

*Measured*, `GET https://www.zoll-auktion.de/robots.txt` → HTTP 200, 75 bytes,
`Server: Apache`, `Last-Modified: Thu, 19 Nov 2020`:

```
User-agent: *
Allow: /

Sitemap: https://www.zoll-auktion.de/sitemap.xml
```

Nothing is disallowed. Every URL this adapter builds — including the price,
radius, delivery and sort parameters — is therefore permitted, which is the
opposite of the kleinanzeigen.de situation and the reason this provider pushes
its filters down instead of leaving them to the kernel.

The sitemap index points at three files; `sitemaps/produkte.xml` (1.45 MB,
`lastmod` minutes old when fetched) is the complete live catalogue. The adapter
does **not** walk it: a per-query full-catalogue read is exactly the
"Vollübernahme wesentlicher Teile" that the database-maker's right
(§§ 87a ff. UrhG) is about, and the on-site search answers the question with one
request.

## Bot protection

None *measured*. Plain Apache, HTTP 200 on the first try under the honest user
agent, no challenge, no cookie required for reading. A session cookie
(`AL_SESS-S`) is *offered* on every response; the adapter neither stores nor
returns it, and reading works without it.

`Vary: User-Agent` is set. No difference in the returned markup was observed
between the honest agent and a browser string, and the adapter never sends one.

## Terms of Use findings

Document: **Versteigerungsbedingungen**, `/auktion/info.php?info=agb`,
Stand 01.12.2022. Fetched and read in full 2026-08-21.

**There is no clause forbidding automated retrieval.** No mention of crawlers,
spiders, scrapers, robots or bots anywhere in the document. What it does say,
and what belongs on the record:

> **§ 8 Systemintegrität (1)** — „Die Inhalte von Zoll-Auktion dürfen nicht bzw.
> nur mit vorheriger Zustimmung kopiert, verbreitet oder in sonstiger Weise
> genutzt oder vervielfältigt werden."

> **§ 8 Systemintegrität (2)** — „Es ist untersagt, Mechanismen, Software oder
> sonstige Routinen bei der Nutzung von Zoll-Auktion zu verwenden, welche die
> Funktionsfähigkeit in irgendeiner Weise beeinträchtigen oder zerstören
> können."

§ 8 Abs. 1 is a **reproduction and redistribution** reservation, not an access
restriction, and § 8 Abs. 2 is an integrity clause about load and interference.
Three things follow, and all three are implemented rather than merely noted:

1. **Nothing is written to disk.** `cache.memoryOnly` is `true` and
   `ttlSeconds` is 300. The short TTL is independently correct — a high bid can
   move any minute — but the reason it is `memoryOnly` rather than merely short
   is § 8 Abs. 1.
2. **Images are linked, never fetched.** The DTO holds URLs only. Rehosting a
   photo would be reproduction in the plain sense of the clause.
3. **No catalogue copy.** One query, one search, the source's own result page.

Note also that these are *Versteigerungsbedingungen* — terms a **registered
bidder** accepts (§ 2, § 9 Abs. 3). troedler has no account and cannot get one,
so it never accepts them; they are recorded here because the operator's stated
wish is worth respecting whether or not it binds a non-registered reader.

Under § 44b UrhG a reservation against text-and-data-mining is effective only in
machine-readable form. robots.txt is the machine-readable channel this host
uses, and it says `Allow: /`.

## What IS forbidden — and is not what this adapter does

> **§ 3 Abs. 3** — the Bietagent is the operator's own automation.
> **§ 2 Abs. 7** — „Es ist verboten, durch Verwendung mehrerer Bieter-Konten
> oder im Zusammenwirken mit anderen Nutzern Angebote zu manipulieren."

Bidding requires a registered, confirmed account (§ 2 Abs. 1, Abs. 5). troedler
has no account, no cookie jar and no POST path out of the process — the only
outbound call in the codebase is `HttpClient.get`. There is no code here that
could place a bid.

## URL grammar — measured

Search: `GET /auktion/auktionsuebersicht.php`

| Parameter | Meaning | Values *(measured, read off the live form)* |
|---|---|---|
| `n0` | submit | `search` |
| `n2` | Suchbegriff | free text; `"phrase"`, `+wort`, `-wort` are supported by the site |
| `n1[]` | category | ids, repeatable; `0` = all |
| `n6` | Postleitzahl | 5 digits |
| `n4` | Umkreis | `-` ohne · `1` 20 km · `2` 50 km · `3` 100 km · `4` 250 km · `5` 500 km · `6` > 500 km |
| `n8` / `n7` | Mindest-/Maximalpreis | EUR |
| `n5[]` | Abholung/Versand | `a` Abholung · `1` Versand DE · `2` Versand EU · `3` Versand Europa |
| `s` | Sortierung | `12` Ende ↑ *(default)* · `22` Ende ↓ · `14` Start ↑ · `24` Start ↓ · `11` Preis ↑ · `21` Preis ↓ |
| `t` | Filterreiter | `t1` allgemein · `t2` Kfz |
| `c5[]` | Kfz-Hersteller | ids |
| `pagination` | Seite | 1-based |

Detail: `GET /auktion/produkt/<slug>/<id>` — *measured:* the slug is decorative,
`/auktion/produkt/x/971850` returns the same lot and the correct
`<link rel="canonical">`; an unknown id gives HTTP 404.

*Measured filter results:* `n2=fahrrad` → 83 Treffer / 9 pages;
`n5[]=1` → 720; `n2=uhr&n8=10&n7=100&s=11` → 331, first ten all 13,00 €;
`n6=30159&n4=2` → 62, all postcodes in the Hannover region.

**Ten rows per page, and no page-size parameter.** `capabilities.maxResults` is
therefore `10 × PAGE_DEPTH.max` = 50.

## What the pages carry

Result card, per lot: title (twice — see the trap below), product link, one
thumbnail, current bid, location as `PLZ Ort`, a pickup-only badge, the
countdown, the bid count. **No item text and no condition.** On a radius search
the location also carries the site's own distance: `60320 Frankfurt am Main
(ca. 4 km)` — read into `Location.distanceKm`, and kept out of the city name.

Detail page, additionally: full `Gegenstandsbeschreibung`, up to a dozen images
in three size variants, absolute end time, `Abholung: Ja/Nein`, the `Versand`
row, the offering authority, and a schema.org `Product` JSON-LD block whose
`offers.availabilityStarts` is the only timestamp on the whole site that carries
an explicit UTC offset.

**The `Versand` row does not mirror the `Abholung` row, and this file said it
did.** Measured 2026-08-22 on lots 973479 and 975100: the page prints `Nein`, or
it prints a destination with the flat rate — `Deutschland (10,00 EUR)`,
`Deutschland (5,50 EUR)`. The `Ja/Nein` claim here was inferred from the row
above it and never checked; the adapter's matching `/ja/i` test therefore never
matched a shipping lot, so **every lot that ships was reported as
collection-only**, and the search page and the detail page contradicted each
other about the same lot. The quoted rate is real money and is read into
`shippingCost`.

**The absolute end is now used, and the countdown is the fallback.** This file
previously justified the countdown by noting that `Auktionsende` carries no time
zone — true, but the offset is readable off the same document: the JSON-LD start
is the same wall clock the page prints, once with `+02:00`. Taking it from the
countdown instead cost up to 21 seconds of spread across four runs on a value
the source keeps constant, because the countdown is floored and our clock is
read after the response arrives.

`Startgebot`, `Auktions-ID`, `Charge` and a view counter are present too and are
not stored.

## Personal data on the page — and what happens to it

The detail page carries an **Ansprechpartner** block naming an official with a
direct line and an e-mail address:

```
Ansprechpartner: D. Wesselmann
Telefon: 05241 869 2238
E-Mail: …
```

The parser is scoped to `#auktionsinfobox` and `#gegenstandsbeschreibung` and
never walks that block, so those values are not read, let alone stored.
`stripContactDetails()` runs over the item text as the second line of defence,
for the case where a lot's own description repeats a number. Both are pinned by
tests in `app/tests/unit/providers/auktion.test.ts`.

The offering authority (`Anbieter`) is inside the parsed region and is
deliberately not carried into the DTO — `Listing` has no seller field, by design.

## Traps

**The visible link text carries soft hyphens, the accessible heading does not.**
*Measured:* `Modelleisenb&shy;ahn` in `.kachel_auktion_link a`, clean in
`h4.sr-only` and in the link's `title` attribute. A U+00AD inside a title
survives `.trim()`, breaks a substring match, and looks like a parser that
"sometimes" fails to find a word.

**The pickup badge is a fact when present and says nothing when absent.** A lot
that ships simply has no `Lieferinformationen` row. This file used to read the
absence as `both`, reasoning that § 5 Abs. 1 keeps collection open — but the
operator's own filter disagrees: measured 2026-08-22 on `n2=uhr`, 1 086 lots
total, `n5[]=a` (Abholung) returns 1 056 and `n5[]=1` (Versand DE) returns 210.
So for **30 lots the source itself says collection is impossible**, and none of
them carries a badge. `both` asserted collection for exactly those thirty. There
is no DTO value for "ships, collection unknown", so the absence now maps to
`unknown`, which claims nothing and still passes every delivery filter. The
reliable path for this question is the server-side filter, not the card.

**The end time is printed as a countdown AND as a deadline, and the deadline
wins.** `Restlaufzeit` appears in four spellings — `noch 55 Sekunden`,
`noch 23 Std. 40 Min.`, `1 Tag 12 Std. 55 Min.`, `2 Tage 17 Std. 3 Min.` — with
non-breaking spaces. The absolute `Auktionsende` carries no time zone, which is
why it was ignored; but the JSON-LD `availabilityStarts` on the same page is the
same wall clock the page prints for the start, once **with** `+02:00`. The
offset is therefore readable off the document and does not have to be assumed
from the reader's clock. The detail path now uses the printed deadline plus that
offset; the countdown remains for a page without JSON-LD, snapped to its own
granularity because it is floored, not rounded (measured: a page reading `noch
3 Std. 9 Min.` had 3 h 09 min 49 s left, and reading our clock after the
response shifts it again — 21 seconds of spread across four runs).

Search cards have no JSON-LD, so their `endsAt` still comes from the countdown.

**Prices use the German thousands dot.** `41.840,00 EUR` read the English way is
€41.84 — which then sorts to the top of a price-ascending search and looks like
the bargain of the year.

**The zero-hit page keeps its container.** `<div id="za-search-result-list"><p>Keine
Treffer.</p></div>`, and the breadcrumb drops the count entirely
(`Auktionssuche` instead of `Auktionssuche: 83 Treffer`). The adapter treats
"container present, no cards, no marker" as `parse-failed` rather than as zero.

**Three image sizes, all reachable.** *Measured* on `971850_Vorn.jpg`:
`t_…` 17 267 B, `galerie_…` 76 616 B, `galerie_large_…` 190 757 B, all HTTP 200.
The result card links the thumbnail; the adapter rewrites the path segment to
the large variant and keeps the thumbnail as the second entry. A `HEAD` request
on any of them answers 303 — use `GET`.

**The auction end can move.** § 3 Abs. 1: the hammer falls only once a bid has
stood for five minutes. `capabilities.disclaimer` says so, because a countdown
shown as exact is a promise the site does not make.

## Sources

- robots.txt — <https://www.zoll-auktion.de/robots.txt> *(2026-08-21)*
- Sitemap-Index — <https://www.zoll-auktion.de/sitemap.xml> *(2026-08-21)*
- Versteigerungsbedingungen, Stand 01.12.2022 — <https://www.zoll-auktion.de/auktion/info.php?info=agb> *(2026-08-21)*
- Datenschutzbestimmungen — <https://www.zoll-auktion.de/auktion/info.php?info=datenschutz>
- Betreiber-Beschreibung, ITZBund — <https://www.itzbund.de/DE/itloesungen/standardloesungen/zollauktion/zollauktion.html>
- § 44b UrhG (TDM, maschinenlesbarer Vorbehalt) — <https://dejure.org/gesetze/UrhG/44b.html>
