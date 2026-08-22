# Source record — Booklooker (`api.booklooker.de`, REST API v2.0)

| | |
|---|---|
| **Adapter** | `packages/booklooker` → `@troedler/booklooker`, provider id `booklooker` |
| **Access** | `official-api` — REST API v2.0. **No HTML path exists and none may be added.** |
| **Terms verdict** | `permitted` (registered in `@troedler/compliance` → `SOURCES`) |
| **Enabled by default** | yes, once `BOOKLOOKER_API_KEY` is present |
| **Cache TTL** | 15 min — chosen from the call budget, **not** from a licence term (see §4) |
| **Operator** | cBooks Germany GmbH |
| **Last checked** | 2026-08-21 |

Everything below was measured or quoted on **2026-08-21** from this machine, with the honest user
agent `troedler/0.1.0 (+https://github.com/JumpLink/troedler)`. Where a fact could not be measured
it says so in those words — this source has one significant gap and pretending otherwise would be
worse than the gap.

---

## 1. robots.txt

### `api.booklooker.de/robots.txt` — HTTP 200, 68 344 bytes, md5 `168ded4058d71d3e49834a65d1c1f932`

### `www.booklooker.de/robots.txt` — HTTP 200, 68 344 bytes, **same md5**

The API host serves the **website's** robots.txt, byte for byte. It is 2 922 lines, 2 905 of them
`Disallow`, with no `Crawl-delay` and no `Sitemap`. Twelve user-agent groups exist: eleven named
search engines (`Googlebot`, `Bingbot`, `Slurp`, `DuckDuckBot`, `archive.org_bot`, …) sharing one
allowance list, and then, at line 2 919:

```
User-agent: *

Disallow: /
```

**Everything is disallowed for anyone not on the list — including `/2.0/`, including
`/interface/`.** The adapter passes `apiHost: true` to `@troedler/http` and therefore skips this
file, and the justification has to be stated plainly because the flag's contract demands it:

> That file governs crawling the shop. It is not the licence for the REST API v2.0, which the
> operator documents publicly, issues free keys for, and prices a call budget on. We are there as
> a key holder, not as a crawler.

The flag is set in exactly one place — `BooklookerSession.#options()` in `packages/booklooker/src/request.ts` —
with that reason in a comment. **troedler never fetches `www.booklooker.de`.** Only `Listing.url`
points there, and a link is not a fetch.

### The verification command used to contradict this file — measured 2026-08-22

`troedler robots` exists so the compliance claim can be checked from outside. Run against this
source, with the freshly built bundle, it said:

```console
$ troedler robots "https://api.booklooker.de/2.0/search?token=x&titel=y"
VERBOTEN: https://api.booklooker.de/2.0/search?token=x&titel=y
  robots.txt von api.booklooker.de verbietet /2.0/search?token=x&titel=y (Disallow: /).
  Wartezeit zwischen Anfragen an api.booklooker.de: 2 s
```

That is the URL every Booklooker search fetches, lawfully, as a key holder. The command was
rebuilding the gate from two of its four inputs — always applying robots.txt, always assuming the
source is on — so it reported the program as a violator for doing the documented thing, and it
downloaded these 68 344 bytes on every invocation from a host the real run never asks. The next
reader would have "fixed" the adapter.

The `apiHost` decision moved into the gate itself (`GateBasis` in `@troedler/compliance`), so there
is one decision site and the command asks it the same question the socket layer does. It now
answers:

```console
erlaubt: https://api.booklooker.de/2.0/search?token=x&titel=y
  api.booklooker.de ist eine dokumentierte API. Es gilt die Lizenz des Anbieters, nicht die
  robots.txt der Website — siehe docs/quellen/booklooker.de.md.
  Quelle: Booklooker (offizielle API, an)
  Kein Höflichkeitsabstand für api.booklooker.de — es gilt das Limit der API, gegen das der
  Adapter drosselt.
  robots.txt wurde nicht gelesen. Dokumentierte API — es gilt die Lizenz des Anbieters. …
```

`Server: myracloud` on every response: Myra Security sits in front of both hosts. It did not
challenge, throttle or fingerprint any of the eleven probes below.

---

## 2. Which interface

| Interface | Status | Verdict |
|---|---|---|
| **REST v2.0** `https://api.booklooker.de/2.0` | active, documented, OpenAPI 3.1 | **The one we use** — `POST /authenticate`, `GET /search` |
| Legacy XML `GET /interface/search.php` v1.2 | still answering | **Not used.** Needs a `pid` (partner id) granted case by case; its failure mode is worse (see §6) |
| `POST /2.0/purchase` | active | **Never.** v1 is read-only towards every marketplace; it also requires written clearance from `daten@booklooker.de` |
| The 14 seller-side interfaces (`article`, `order`, `file_import`, …) | active | Out of scope — they manage *your own* inventory |

The OpenAPI spec is at `https://www.booklooker.de/download/openapi.yaml` (`openapi: 3.1.0`,
`info.version: '2.0'`, 2 159 lines). It documents the envelope and every error code, and — this
matters — it does **not** document the search parameters or the search result. Those live only on
the HTML interface page, `rest_api.php?interface=search`.

---

## 3. Terms

booklooker's AGB (`www.booklooker.de/pages/agb_booklooker.php`, read 2026-08-21, 243 lines of
text) cover the marketplace itself: commission, seller obligations, PStTG tax data, buyer
protection. Searched for `automat*`, `Robot`, `Spider`, `Crawl`, `Scrap`, `maschinell`,
`Datenbank`, `extrahier*`, `vervielf*` — **zero hits.** There is no clause about automated access
in either direction.

So the `permitted` verdict does **not** rest on a permissive clause. It rests on the operator
offering a documented machine interface, handing out keys for it free of charge, publishing its
call budget, and selling extra quota — which is an invitation, not a tolerance.

The corresponding entry in `@troedler/compliance` → `SOURCES` should quote that, and its current
`clause` text needs one correction: it says *"100 requests/min"*, which is the **global** REST
ceiling. The **search** interface has its own, tighter budget — see §4.

---

## 4. Call budget

Two numbers, from two different pages, and they are not the same number:

| Scope | Limit | Source |
|---|---|---|
| The whole REST API | **100 requests/minute** | `pages/api.php`: "Die Abfragen der REST API sind auf maximal 100 Abfragen/Minute begrenzt." |
| `GET /2.0/search` alone | **50 calls per 10 minutes, free** | `rest_api.php?interface=search`: "Die Schnittstelle kann bis zu 50× pro 10 Minuten kostenlos aufgerufen werden. Wenn Sie mehr Aufrufe benötigen, können Sie ein kostenpflichtiges Kontingent buchen." |

50 per ten minutes is one call every twelve seconds, and it is the one that binds us. A search
costs **one** request when the token is warm and **two** when it is not, so the budget is roughly
25 cold searches per ten minutes. Two consequences are in the code:

- The token is **cached for the life of the provider instance**. Authenticating before every
  search would spend half the budget on saying hello.
- `capabilities.cache.ttlSeconds` is **900**. No licence term caps it — unlike eBay's contractual
  six hours — so the number comes from the budget: 50 calls per ten minutes is not a budget to
  spend on repeating the same question.

Exceeding it answers `QUOTA_EXCEEDED`, which the adapter maps to `rate-limited`. A hard block is
`TEMPORARILY_BLOCKED` → `refused`, and that one is a decision: the documentation says to contact
support, so the adapter stops rather than trying again.

---

## 5. The token

`POST /2.0/authenticate?apiKey=…` returns a token. **"Sofern Sie 10 Minuten keine Schnittstelle
aufrufen, verfällt der Token und Sie müssen sich erneut authentifizieren."**

Three things follow, all of them in `request.ts`:

1. **POST is mandatory.** Measured: the identical call as `GET` answers
   `{"status":"NOK","returnValue":"INVALID_REQUEST_METHOD"}`.
2. The cached token is treated as stale after **9 minutes**, not 10. The last minute would be
   spent racing the server: a token that was fresh at the check and expired at the request costs
   two extra round trips out of a budget of fifty.
3. On a `TOKEN_EXPIRED` / `TOKEN_UNKNOWN` / `TOKEN_MISSING` answer the adapter authenticates
   **once** more and repeats the search **once**. That is not a retry against a refusal — the
   project's "403 is a decision" rule stands untouched — it is this API's documented lifecycle
   ("eine erneute Authentifizierung ist notwendig"). It is bounded at one, so a server that keeps
   rejecting fresh tokens produces an error instead of a loop, and there is a test for that bound.

`AUTHENTICATION_FAILED` (the key itself is rejected) is **not** retried at all.

**The key and the token travel in the query string** — that is what the interface takes. Any
transport error that quotes the URL therefore quotes the secret, so `request.ts` redacts both out
of error messages before they leave the adapter. There is a test for it.

---

## 6. Measured probes (2026-08-21)

Eleven unauthenticated probes. **Every single one is HTTP 200 with
`Content-Type: text/html; charset=UTF-8`,** including the failures.

| Call | HTTP | Body |
|---|---|---|
| `POST /2.0/authenticate` (no key) | 200 | `{"status":"NOK","returnValue":"API_KEY_MISSING"}` |
| `POST /2.0/authenticate?apiKey=` | 200 | `{"status":"NOK","returnValue":"API_KEY_MISSING"}` |
| `POST /2.0/authenticate?apiKey=<invalid>` | 200 | `{"status":"NOK","returnValue":"AUTHENTICATION_FAILED"}` |
| `GET /2.0/authenticate?apiKey=<invalid>` | 200 | `{"status":"NOK","returnValue":"INVALID_REQUEST_METHOD"}` |
| `GET /2.0/search` (no token) | 200 | `{"status":"NOK","returnValue":"TOKEN_MISSING"}` |
| `GET /2.0/search?token=<bogus>` | 200 | `{"status":"NOK","returnValue":"TOKEN_UNKNOWN"}` |
| `GET /2.0/nonexistent?token=x` | 200 | `{"status":"NOK","returnValue":"INVALID_INTERFACE"}` |
| `GET /interface/search.php` (no `pid`) | 200 | **0 bytes** |
| `GET /interface/search.php?pid=00000000&medium=book&title=Ende` | 200 | **0 bytes** |
| `GET /robots.txt` | 200 | 68 344 bytes (§1) |

### The two "green and empty" traps

**Trap 1 — the status line is useless here.** Success and every failure share HTTP 200 and a
`text/html` content type. Only `envelope.status` tells them apart. `parse.ts` therefore reads
`status` before it looks at anything else, and `@troedler/http`'s own 401/403/429 handling never
fires for this source. An adapter that trusted `res.ok` would report a missing key as a successful
search.

**Trap 2 — a successful call can return nothing at all.** The legacy interface answers with zero
bytes and status 200 when the `pid` is missing *and* when the `pid` is simply wrong. The two are
indistinguishable, which is precisely why that interface is not used. The same shape can reach us
through the REST envelope as `{"status":"OK","returnValue":""}`, and the adapter treats it as
`parse-failed` — **never as "0 Treffer"**. Through `@troedler/http`, a zero-byte body already
fails loudly on its own: measured, `getJson` raises
`remote-error: api.booklooker.de lieferte kein JSON (…)`.

---

## 7. Query grammar (`GET /2.0/search`)

Three documented rules shape `buildSearchParams()`:

1. **Every search parameter is AND-ed and none of them spans fields.** Verbatim: *"Alle
   Such-Parameter werden stets per UND-Verknüpfung miteinander verbunden. Soll nach einem
   Suchbegriff in allen Feldern gesucht werden, so muss die Schnittstelle mehrmals hintereinander
   aufgerufen werden."* One free-text box therefore maps to exactly **one** field. The adapter
   uses `title`, and says so in a warning on every text search — an author search would be a
   second call against the same budget, and joining author and title into one `title=` would AND
   the words inside the title and find nothing.
2. **An ISBN or EAN wins outright:** *"Wenn Sie als Such-Parameter isbn oder ean angeben, werden
   alle anderen Parameter ignoriert!"* So when `SearchQuery.gtin` is ISBN-shaped the adapter sends
   `isbn` plus `medium`/`limit`/`showShippingPrice` and nothing else, and reports `applied: ['gtin']`
   alone. A GTIN that is not an ISBN (a DVD or CD EAN) cannot be searched without knowing the
   medium; that query is reported as unanswerable with `requests: 0` and a warning rather than as
   an empty result.
3. **`limit` is capped at 150 and there is no paging.** 150 is the whole ceiling for one search,
   which is why `truncated` is `listings.length >= limit`.

| troedler | booklooker | Reported as `applied`? |
|---|---|---|
| `text` | `title` | — (not a `FilterKey`) |
| `gtin` (ISBN-shaped) | `isbn`, `medium=book` | **yes** |
| `sellerType: private/commercial` | `privOnly=1` / `profOnly=1` | **yes** |
| `sort: price-asc/desc` | `sortOrder=pricePlusShipping` + `sortDir` | **yes** |
| `condition` | `usedOnly=1` / `newOnly=1` | **no** — booklooker knows only new-vs-used |
| `since` | `dateFrom=YYYY-MM-DD` | **no** — booklooker knows only whole days |
| `minPrice`, `maxPrice`, `radius`, `delivery` | *nothing* | no |

The last two rows are the interesting ones. Both **are** pushed down, because a narrower request
wastes fewer of the 150 rows — but neither is *claimed*, so the kernel re-applies them at full
precision. Claiming them would drop the difference between "gut" and "akzeptabel", and between
08:00 and 23:00 on the same day, silently on the floor.

`sortOrder` is `pricePlusShipping` rather than `price` on purpose: the kernel ranks on
`totalPrice ?? price`, so ordering by the bare article price would hand back a different 150 rows
than the ones the user is about to see first.

Other parameters exist and are deliberately unused: `catID`/`subCatID`, `keyword`, `uID`, `lfdnr`,
`author`, `publisher`, `yearFrom`/`yearTo`, `signed`, `firstEdition`, `binding`, `discardUnavailable`.
`SearchQuery` has nowhere to put them today; `uID` is a **seller id** and will never be used.

---

## 8. The response — measured 2026-08-22

**The gap is closed.** With a real key, `GET /2.0/search` was called against the live API and the
answer transcribed. The inference recorded here before was **wrong in the one way that mattered**,
and the record keeps what it guessed alongside what is true, because the mistake is instructive:

> *Inferred on 2026-08-21:* "most likely an XML document as a string; possibly a JSON array of
> records with the same field names."

Neither. It is **JSON inside a JSON string** — two encodings, one nested in the other:

```jsonc
{ "status": "OK", "returnValue": "{\"Book\":[{\"Author\":\"Hesse, Hermann\", … }]}" }
```

The envelope is real, `/authenticate` does use `returnValue` as a plain token, and the spec's
`returnValue: ''` placeholder is why a string looked like it had to be markup. `parse.ts` now
decodes the string a second time when it starts with `{` or `[`, and recurses.

**How it was found, and why that is the point.** The adapter's first real call reported
`parse-failed` with the body quoted in the message — not "0 Treffer". A source that reports a
shape it does not understand costs minutes; one that returns an empty list for the same reason
costs however long it takes somebody to notice a marketplace has quietly stopped contributing.
That behaviour was designed in before anyone could test it, and this is the first time it earned
its keep.

### The fields, transcribed over 149 rows

Query: `title=Steppenwolf&author=Hesse`, 149 records, 159 022 bytes.

| Field | Present | Mapped to | Note |
|---|---|---|---|
| `Title` | 149/149 | `title` | |
| `Author` | 149/149 | `description` (head) | |
| `Price` | 149/149 | `price` | decimal string, `.` separator |
| `ShippingPrice` | 149/149 | `shippingCost` | `0.00` on 70 of 149 |
| `Country` | 149/149 | `location.country` | `DE` 138, `AT` 11 |
| `DetailLinkUrl` | 149/149 | `url` + id fallback | `detail.php` or `resultnew.php` |
| `New` | 149/149 | `condition` | `0` on 98, `1` on 51 — see below |
| `Offerer` | 149/149 | **dropped** | seller name |
| `Publisher` | 144/149 | `description` | |
| `ArticleId` | 143/149 | `id` | **absent = aggregate row** |
| `OffererId` | 143/149 | **dropped** | seller id |
| `RatePositive` | 143/149 | **dropped** | seller rating |
| `Infotext` | 131/149 | `description` | run through `stripContactDetails` |
| `Year` | 125/149 | `description` | sometimes `"1974."`, with the dot |
| `PicURL` | 120/149 | `images[0]` | |
| `Edition` | 89/149 | — | binding ("Taschenbuch"), NOT condition |
| `ISBN` | 88/149 | `gtin` | widened to GTIN-13, check digit verified |

**There is no date field at all**, so `listedAt` is always `null` here. And there is no free-text
condition: `Edition` is the binding. The only condition signal is `New`.

### Three findings that shaped the adapter

**`New` is a statement in one direction only.** `1` becomes `new`. `0` says the book is not new
and stops — `Condition` has no "used, grade unstated" value distinct from `unknown`, and inventing
`used-good` would be a grade nobody wrote, which the ranking would then act on. So `0` maps to
`unknown` and the fact travels in `conditionRaw` as `"gebraucht"`, where a reader sees it and a
condition filter — which keeps unknown rows by design — does not silently drop two thirds of this
source.

**A row without `ArticleId` is not an offer.** Measured: those carry `Offerer: "verschiedene
Anbieter"` and a `resultnew.php` link instead of `detail.php`. They are a GROUP of offers, and the
price is the cheapest in it — so they get `priceKind: 'from'`. Calling that a fixed price would
promise something no single seller offers.

**The row limit is ignored.** `maxResults=3` came back with **149** rows. The cap is therefore
applied here, and a warning says so, so `--explain` distinguishes "we asked for 5" from "we got
149 and kept 5".

### What the parser still accepts

| `returnValue` | Result |
|---|---|
| `''` / whitespace | `parse-failed` — "leerer Rumpf", never zero hits |
| string containing `<` | XML branch |
| string without `<` | `parse-failed`, quoting the first 80 characters |
| array | JSON branch (an **empty** array is a legitimate zero) |
| object with exactly one array property | unwrapped into the JSON branch |
| anything else | `parse-failed`, naming the shape it saw |

**The discriminator is `<DetailLinkUrl>`** — the one result field the documentation names. An item
is *anything containing one*, which survives a rename of the container element (undocumented, so
it could be anything). Markup that contains none is `parse-failed` with the element count in the
message; a deep link that has moved into an **attribute** gets its own message, because that is a
five-minute fix once someone can see it.

The rest of the field names — title, price, shipping, ISBN, image, date — are resolved from a
candidate list of the documented name plus its German and English spellings. That inference is
only safe because of the guard around it: a record that yields no title **and** no link is
dropped, and a payload where **every** record drops is `parse-failed`. A wrong guess here cannot
become a quiet zero.

**When a key exists, re-measure this section first.** One real response replaces the whole
candidate list with the actual names, and the tests keep the guards.

### Field mapping

| `Listing` | From | Notes |
|---|---|---|
| `id`, `key` | `articleId` / `orderNo`, else a token from the deep link | The article number is what `/purchase` takes; the spec prints `A02HuK3Z01ZZc`, `A02ItXa601ZZx` |
| `url` | `DetailLinkUrl` | relative and protocol-relative forms absolutised |
| `price`, `shippingCost`, `totalPrice` | `Price`, `ShippingPrice` | notation decided per value — see below |
| `condition` | `Condition` (`extraFields`) via `conditionFromGerman()` | free German text; no second table in the adapter |
| `sellerType` | `SellerType` (`extraFields`): `0` = privat, `1` = gewerblich | |
| `delivery` | constant `shipping` | a mail-order marketplace; `showShippingPrice` prices the postage per row |
| `location.country` | `SellerCountry` (`extraFields`, ISO 639-1) | no postcode, no town — see §9 |
| `gtin` | `ISBN` / `EAN`, widened to **GTIN-13** | see below |
| `listedAt` | `DateOfEntry` / `dateFrom`-shaped field | ISO or German notation |
| `endsAt`, `bidCount` | always `null` | fixed-price marketplace, no auctions |
| `images` | first image URL, absolutised | linked, never fetched |

**Prices are read per value, not per assumption.** `article_list` returns bare decimals, the
website prints German notation, and the search payload is undocumented — so `12.50` is read as
twelve fifty and `1.234,56` as one thousand two hundred thirty-four fifty-six. Getting that
backwards turns a €1 234 first edition into €1.23 and sorts it to the top of a cheapest-first
search, which is a plausible, wrong answer rather than a crash.

**ISBN-10 is widened to ISBN-13, and the check digit is verified.** This is the field the whole
cross-provider grouping rests on: `identityKey()` in the kernel trusts a GTIN and nothing else,
and booklooker plus eBay are the only two sources here that supply one. eBay returns EAN-13, so a
book arriving as an ISBN-10 would never meet its eBay twin — grouping would fail in the one way
nobody notices. The check digit is verified rather than trusted because a mistyped ISBN that keeps
its shape would become a *confident* identity and merge two different books.

---

## 9. Personal data

Nothing about the seller is kept. `uID` (booklooker's seller id) is never read, no seller name or
shop name is mapped, and there is no field on `Listing` for either. `SellerType` — private or
commercial — is a category, not a person, and it is the only thing a buyer needs.

Free text (`Comment`/`Annotation`) runs through `stripContactDetails()` **while parsing**, so a
phone number or e-mail address in a seller's note never reaches the cache. Images are URLs.

---

## 10. What the adapter deliberately does not do

- **No purchase.** v1 is read-only; `/purchase` also needs written clearance. If it is ever
  built, the trap is documented and quotable: *"`status = OK` bedeutet nicht, dass jede Bestellung
  erfolgreich war"* — the per-order detail in `orders` / `invalidArticles` has to be evaluated.
- **No legacy `pid` path.** Its failure mode (§6) cannot be distinguished from an empty result.
- **No Webgains affiliate wrapping.** booklooker's programme (`wgprogramid=275385`) would rewrite
  every `DetailLinkUrl` through `track.webgains.com`. That silently monetises the user's search
  and changes what a link points at; if it is ever wanted it must be opt-in and visible.
- **No multi-media fan-out.** One search hits one `medium` (`BOOKLOOKER_MEDIUM`, default `book`).
  Searching all five would be five calls out of fifty.
- **No `getListing`** — and this was re-measured on 2026-08-22, because §8 undermined the original
  reason. `ArticleId` turned out to be present on 143 of 149 rows and `detail.php?id=<ArticleId>`
  is the deep link, so "no stable per-offer handle" was no longer true. The interfaces answer:

  | Endpoint | GET | POST |
  |---|---|---|
  | `/detail`, `/articles` | `INVALID_INTERFACE` | — |
  | `/article` | `INVALID_REQUEST_METHOD` | `INVALID_REQUEST_METHOD` |

  So `/article` **exists** and accepts neither verb we may use. What is left is PUT and DELETE,
  which on a seller-facing API means create/update and remove — against an article id belonging to
  somebody else.

  **That measurement was not taken, deliberately.** Probing a write verb to find out whether it is
  a read is how you delete a stranger's listing to learn that you could. The conclusion stands on
  what was measured: the two interfaces that answer a read are `/authenticate` and `/search`, and
  neither takes an article id. If booklooker ever documents a read endpoint, this is the place to
  correct — not by trying verbs.

---

## 11. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BOOKLOOKER_API_KEY` | — | Free, from the account page **Persönliche Daten → API Key**. Without it the provider reports `not-configured` and is skipped. |
| `BOOKLOOKER_MEDIUM` | `book` | One of `book`, `abook`, `film`, `music`, `game`. An unknown value is an error, not a silent fallback to `book`. |
| `BOOKLOOKER_SHIPPING_COUNTRY` | `de` | Destination for the postage figure. Only `de`, `at`, `ch` exist. |

---

## 12. Open items

- [x] **Measure a real `/2.0/search` response** — done 2026-08-22 with a key; §8 now carries the
      transcription instead of the guess, and seven tests pin it.
- [x] Correct the `clause` text in `@troedler/compliance` → `SOURCES`: the search interface is
      50 calls / 10 min, not 100/min (that is the global REST ceiling).
- [x] `getListing` re-measured 2026-08-22 — see §10. `/article` exists but answers
      `INVALID_REQUEST_METHOD` to both GET and POST; the remaining verbs are writes on somebody
      else's listing and were not tried. Stays absent, now for a measured reason.
- [ ] Re-read the AGB when the BGH decides the scraping revision on **2026-09-03** (5 U 104/24).
      This source does not depend on the outcome — it has an API licence — but the record should
      say when it was last read.

---

## Sources

- [API overview](https://www.booklooker.de/pages/api.php) · [REST API v2.0 index](https://www.booklooker.de/pages/rest_api.php)
- [`search` interface](https://www.booklooker.de/pages/rest_api.php?interface=search) · [`authenticate` interface](https://www.booklooker.de/pages/rest_api.php?interface=authenticate)
- [OpenAPI 3.1 spec](https://www.booklooker.de/download/openapi.yaml) — `info.version: '2.0'`, 2 159 lines
- [Official PHP example client](https://www.booklooker.de/pages/rest_api.php?do=download&filename=booklooker_rest_api.php&path=booklooker_rest_api.php)
- [Legacy search API v1.2 / Webgains](https://www.booklooker.de/pages/api_search.php)
- [AGB](https://www.booklooker.de/pages/agb_booklooker.php) — cBooks Germany GmbH
