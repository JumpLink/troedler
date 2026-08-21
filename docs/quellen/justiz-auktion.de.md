# justiz-auktion.de — source record

| | |
|---|---|
| **Host we call** | `www.justiz-auktion.de` |
| **Adapter** | `packages/auktion` · provider id `justiz-auktion` |
| **Access** | `html` — single lots only; **the search is not implemented, and this document is why** |
| **Terms verdict** | `silent` on automated **reading**; automated **bidding** is forbidden by name, and troedler never bids |
| **Enabled by default** | yes — for `getListing`; `search()` refuses out loud |
| **Last read by a person** | 2026-08-21 |

Everything marked *measured* was fetched from this machine on 2026-08-21 with
the adapter's own user agent. Nothing here is quoted from memory.

## What this source is

The auction portal of the German and Austrian judiciary — bailiff seizures,
criminal-court confiscations (§ 111p StPO), lost property, and surplus office
equipment. Run by the **Ministerium der Justiz des Landes Nordrhein-Westfalen**
as platform operator, with a project office at the Generalstaatsanwalt in Hamm;
Austrian lots come from the Justiz-Auktions-Zentrum Wien.

Sellers are courts and enforcement offices, so `sellerType` is `commercial` and
the seller itself is never stored. Every row is a live auction. Austrian
postcodes are four digits — the location parser does not length-check.

*Measured:* `sitemap-auktionen.php` listed **352 live lots**; the site's own
unfiltered result header said **394 Treffer**.

## robots.txt

*Measured*, `GET https://www.justiz-auktion.de/robots.txt` → HTTP/2 200,
135 bytes, `Server: Apache`, `Last-Modified: Mon, 06 Jul 2026`:

```
User-agent: *
Disallow:
Sitemap: https://www.justiz-auktion.de/sitemap-auktionen.php
Sitemap: https://www.justiz-auktion.de/sitemap.php
```

An **empty** `Disallow:` means "nothing is disallowed". Read as a rule instead
of as a clearance it would ban every path on the host, and this provider would
go dark with no error to look at — `parseRobots` in `@troedler/compliance`
handles the case explicitly and a test in the adapter suite pins it.

## Bot protection

None *measured*. HTTP/2 200 on the first try under the honest user agent, no
challenge. A `PHPSESSID` cookie is set (`HttpOnly; secure; Max-Age=3600`) — see
below, it is the whole story of this source.

## The search: measured, and not implemented

This is the finding that shapes the adapter, so it is written out in full.

**1 — Both search forms POST.** The quick form is
`<form action="suche" method="post">` with `name="txt_search"`. The advanced
form at `/suche?detail` is
`<form action="auction_search.php" method="post" enctype="multipart/form-data">`
with fields `id`, `keywords`, `category`, `zip`, `standort`, `state`, `country`,
`shipping`, `username`, `results`, `sortby`, `perimeterSearch` — and a hidden
`<input name="_CSRF" value="…">`, 128 hex characters, minted per session.

**2 — GET is accepted and silently ignored.** *Measured*, each HTTP 200:

| Request | Result |
|---|---|
| `GET /suche?txt_search=fahrrad` | **394 Treffer** — the entire catalogue |
| `GET /auction_search.php?keywords=fahrrad` | **394 Treffer** |
| `GET /auction_search.php?keywords=fahrrad&bt_search=Suchen` | **394 Treffer** |
| `GET /auction_search.php?txt_search=fahrrad` | **394 Treffer** |
| `GET /auction_search.php?resultListLimit=50` | 394 Treffer, still **10 rows** |

The site nevertheless advertises the GET form as a schema.org `SearchAction`:

```json
{"@type":"SearchAction","target":"https://www.justiz-auktion.de/suche?txt_search={search_term_string}"}
```

An adapter written from that declaration would look like it worked and would
return the whole catalogue for every query — the single most expensive way to be
wrong in this project, because every answer is plausible.

**3 — The criteria live in the session, not the URL.** *Measured:* a cookie-jar
`POST` to `/auction_search.php` with the `_CSRF` token and
`multipart/form-data` field `keywords=fahrrad` returned **29 Treffer**, and the
pagination links on that page were bare `auction_search.php?start=10` — no query
string. `GET /auction_search.php?start=30` from a fresh session pages through
the **unfiltered** 394 again.

So the only working search is: fetch a form page, keep `PHPSESSID`, extract
`_CSRF`, POST it back. That is session handling and token replay, which the
project's Leitplanken rule out, and `HttpClient` has no method other than
`get()`.

### Why the two obvious workarounds are worse than refusing

**Walking `auction_search.php?start=N`** would work — 40 GET requests for the
whole catalogue, 10 rows at a time — and is rejected for two independent
reasons. It exhausts `maxRequestsPerHost` on a single query, and per query it
copies the operator's entire database, which is precisely what the
database-maker's right (§§ 87a ff. UrhG) is about. A person clicking through the
site does not do this.

**Matching the sitemap's slugs locally** costs one request, and under-reports
without saying so. The slugs are lossy: *measured*, `Rücklicht` appears as
`Rcklicht` (umlaut **dropped**, not transliterated, so `normalizeTitle`'s
`ü → u` fold does not reach it), `Größe` as `Groumlszlige`, `0,01` as
`0comma01`. They also carry no description, while the site's own search reads
one — of those 29 "fahrrad" hits only about six had *Fahrrad* in the title
("DDR-Klapprad", "E-Bike Ancheer" and so on did not). And the shortfall could
not even be declared: free text is not a `FilterKey`, so `serverFilters` has
nowhere to record "matched titles only". A provider that quietly returns a fifth
of the hits is the failure this project is built to make impossible.

### What the adapter does instead

`status()` returns `configured: true` with a permanent
`problem.kind = 'blocked-by-policy'` and the reason in plain German, so
`searchAll` reports the source as **skipped with a stated cause** rather than as
empty. `search()` throws the same error — never an empty list — for anyone who
calls it directly. `capabilities.serverFilters` is `[]`, `serverSorts` is `[]`
and `maxResults` is `0`, so `providers show` promises nothing that never arrives.

**Re-check when any of these becomes true:** `?txt_search=` actually filters, an
official API or feed appears, or the operator publishes a GET search endpoint.
Then `search()` is a small function, not a redesign.

## What does work: one lot by id

`GET /<anything>-<id>`. *Measured:* `/x-211751` and `/auktion-211751` both
return lot 211751; an unknown id answers HTTP 404. One request, no session, no
cookie, robots-permitted. That is `getListing()`, and it is the reason this
provider ships enabled rather than switched off.

Fields *measured* on a detail page: title (`h2.auktionstitel`), id
(`#auk_id span`), `Startgebot` and `Aktuelles Gebot` (`dl.geb_top`),
`Anzahl Gebote` (`dl#geb_uebersicht`), `Auktion endet in` and `Endet am:`,
`Artikelstandort`, `Bundesland`, `Versandart`, `Bezahlung`
(`dl#auk_uebersicht`), a `Zustand:` line and the item text (`#artbeschr`),
full-size images (`.swiper-slide img`), and a country flag (`span.land img[alt]`).
A schema.org `Product` block is present and duplicates name, image and
description; nothing is read from it that the page does not also state.

## Terms of Use findings

Documents: **Allgemeine Geschäftsbedingungen der Justiz-Auktion Deutschland**,
Stand August 2025, `/allgemeine-geschaeftsbedingungen-DE`, read in full; plus
`/allgemeine-versteigerungsbedingungen-AT` for Austrian lots.

**No clause forbids automated retrieval.** No crawler, spider, scraper or robot
appears anywhere in the German AGB. Two clauses are on the record:

> **§ 9 Urheberrecht und Verwendungsbeschränkung** — „Die Inhalte der
> Justiz-Auktion dürfen nicht bzw. nur mit vorheriger Zustimmung der
> Justiz-Auktion kopiert, verbreitet oder in sonstiger Weise genutzt oder
> vervielfältigt werden."

Word for word the clause zoll-auktion.de carries as § 8 Abs. 1, and handled the
same way: `cache.memoryOnly` is `true`, images are linked and never fetched, and
there is no catalogue copy.

> **§ 6 / § 7** — „Die Abgabe von Geboten mittels nicht von der Justiz-Auktion
> autorisierter automatisierter Datenverarbeitungsprozesse (z. B. so genannten
> „Sniper"-Programmen) ist unzulässig."

This is the only automation the operator forbids, and it is about **bidding**.
troedler has no account, no session and no POST path; there is no code here that
could place a bid. Bidding also presupposes registration (§ 4), which troedler
never performs, so the AGB are never accepted in the first place.

## Personal data on the page — and what happens to it

Two blocks name someone and neither is carried into the DTO:

- `<dt>Verkäufer:</dt>` — the selling court, e.g. *Landgericht Hagen*. A body,
  not a person, but `Listing` has no seller field by design.
- `<dt>Höchstbietender</dt><dd>g**o**1</dd>` — a masked but still user-scoped
  pseudonym. Never read.

Item text runs through `stripContactDetails()` while parsing. All three are
pinned by tests.

## Traps

**The `<link rel="canonical">` can point at a different auction.** *Measured:*
on lot **211751** the canonical was
`https://www.justiz-auktion.de/2-Notebooks-Lifebook-Fujitsu-E546-211622`. The
adapter builds the returned URL from the id it was asked for and never from the
canonical — a link taken from it sends the reader to somebody else's lot.

**Everything is entity-encoded, including punctuation.** `u&period;a&period;`,
`0&comma;01`, `20&colon;00&colon;00`, `mb7295&lowbar;pic1w`, `&NewLine;`,
`H&amp;amp&semi;M`. *Measured:* `htmlparser2` decodes all of them, which is one
concrete reason `@troedler/html` exists — `@gjsify/domparser` does not decode
entities at all today.

**"Aktuelles Gebot: 0,00 €" is a placeholder, not a price.** Before the first
bid the current-bid field is zero and the `Startgebot` is the number that
matters. Passed through, a 0 € lot sorts to the top of a price-ascending search
and reads as a giveaway.

**The end time is printed twice, and only one form is safe.**
`Auktion endet in: 24 Tage, 1 Stunde, 31 Minuten` next to
`Endet am: 14.09.2026 20:00:00` — the absolute one carries no time zone. The
adapter computes `endsAt` from the countdown; *measured* against that lot it
landed on `2026-09-14T18:01:00Z`, i.e. 20:01 Vienna/Berlin time, within a minute
of the printed value and correct from any time zone.

**`Versandart` is single-valued.** `Selbstabholung` or `Versand`, and the page
says nothing about the other. Unlike zoll-auktion.de's omitted badge this is not
widened to `both`.

**The 404 page is not always a 404.** Some dead ids answer HTTP 200 with an
error page carrying `<h3 id="zuordnung">Error 404</h3>` and no lot. The parser
returns `null` for it, so a gone auction is an answer either way.

## Sources

- robots.txt — <https://www.justiz-auktion.de/robots.txt> *(2026-08-21)*
- Auktions-Sitemap — <https://www.justiz-auktion.de/sitemap-auktionen.php> *(2026-08-21)*
- AGB Deutschland, Stand August 2025 — <https://www.justiz-auktion.de/allgemeine-geschaeftsbedingungen-DE> *(2026-08-21)*
- Allgemeine Versteigerungsbedingungen Österreich — <https://www.justiz-auktion.de/allgemeine-versteigerungsbedingungen-AT>
- Datenschutzerklärung — <https://www.justiz-auktion.de/datenschutz>
- Portalbeschreibung, Justizportal des Bundes und der Länder — <https://justiz.de/onlinedienste/justiz_auktion/index.php>
- § 44b UrhG (TDM, maschinenlesbarer Vorbehalt) — <https://dejure.org/gesetze/UrhG/44b.html>
