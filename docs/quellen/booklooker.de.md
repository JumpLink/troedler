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

## 8. The response — what is measured and what is inferred

**This is the gap.** Nobody on this machine holds a Booklooker API key, so `GET /2.0/search` has
never been seen returning offers. What is known:

- The OpenAPI spec prints the SUCCESS example as `{status: 'OK', returnValue: ''}` and describes
  it only as *"eine selbsterklärende Liste mit den gefundenen Artikeln"*.
- The same spec uses the identical `returnValue: ''` placeholder for `article_list`, where the
  description **does** say what it is: a plain string, entries separated by `\n`, columns by TAB.
  So a bulk payload arriving as a *string* inside `returnValue` is this API's normal shape.
- The `extraFields` table for `search` is written entirely in **XML element notation** —
  `<AbsentFrom>`, `<AbsentTo>`, `<PaymentList>`, `<Payment>` — and it is the same table the legacy
  XML interface uses, whose result is *"ein selbsterklärendes XML-Dokument"* with the deep link in
  `<DetailLinkUrl>`.
- The official PHP example client prints the search result with `echo`, not `print_r` — the
  treatment it gives strings, not arrays.

So: **most likely an XML document as a string; possibly a JSON array of records with the same
field names.** `parse.ts` handles both and refuses to guess beyond that:

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
- **No `getListing`.** The interface has no by-id lookup, and its only per-offer handles are the
  seller's own running number and the seller id.

---

## 11. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BOOKLOOKER_API_KEY` | — | Free, from the account page **Persönliche Daten → API Key**. Without it the provider reports `not-configured` and is skipped. |
| `BOOKLOOKER_MEDIUM` | `book` | One of `book`, `abook`, `film`, `music`, `game`. An unknown value is an error, not a silent fallback to `book`. |
| `BOOKLOOKER_SHIPPING_COUNTRY` | `de` | Destination for the postage figure. Only `de`, `at`, `ch` exist. |

---

## 12. Open items

- [ ] **Measure a real `/2.0/search` response** and replace §8's inference with the field names.
- [ ] Correct the `clause` text in `@troedler/compliance` → `SOURCES`: the search interface is
      50 calls / 10 min, not 100/min (that is the global REST ceiling).
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
