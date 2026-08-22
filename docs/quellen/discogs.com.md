# discogs.com — source record

| | |
|---|---|
| **Host we call** | `api.discogs.com` |
| **Adapter** | `packages/discogs` · provider id `discogs` |
| **Access** | `official-api` — documented, public, no key required |
| **Terms verdict** | `permitted` |
| **Enabled by default** | yes |
| **Last read by a person** | 2026-08-21 |

Everything below marked *measured* was fetched from this machine on 2026-08-21
with the adapter's own user agent. Nothing here is quoted from memory.

## What this source can and cannot give us

**Discogs' public API contains no marketplace offers.** This is the single fact
the adapter is built around, and the reason its rows look different from every
other provider's.

- `GET /database/search?type=release` returns catalogue **releases** and carries
  **no price at all**.
- `GET /marketplace/stats/{release_id}` returns one **aggregate** per release —
  `num_for_sale` and `lowest_price`. That is "66 copies from 64,00 €", not an
  offer.
- `GET /marketplace/search` — the endpoint that once returned individual
  listings — was internal and undocumented and is gone. *Measured:* `HTTP 401
  {"message":"You must authenticate to access this resource."}`, and it stays
  401 with a token, so it is not a permission we are missing.
- `GET /users/{name}/inventory` would return a single dealer's stock. The
  adapter does **not** use it, for two independent reasons: `robots.txt`
  disallows `/users/` for `User-agent: *`, and a seller's inventory is
  personal data this project has no reason to hold.

So a Discogs row is **a release with a from-price** and a link to where the
offers actually are. `priceKind` is `from`, and `capabilities.note` says so in
words, because "ab 17,67 €" and "40 € VB on kleinanzeigen" are not the same kind
of number and the user has to be able to see that.

## Authentication

None required. A `DISCOGS_TOKEN` (personal access token from
`discogs.com/settings/developers`) is optional and changes exactly two things:

| | no token | with token |
|---|---|---|
| Requests per minute | 25 | 60 |
| Results per search (see below) | 22 | 57 |
| `cover_image` / `thumb` in **search rows** | empty strings *(measured)* | populated |

Images on `GET /releases/{id}` are populated **without** a token — *measured*:
release 125204 returns 11 `images` entries and a `thumb`. The token gap applies
to search rows only.

Header form: `Authorization: Discogs token=<token>`. No OAuth, no cookie, no
session — the adapter has no code that could hold one.

*Measured:* an **invalid** token returns `HTTP 401 {"message":"Invalid consumer
token. Please register an app before making requests."}` **and**
`x-discogs-ratelimit: 60`. The header states the tier the request claimed, not
the one it was granted, so it must never be used to conclude that a token works.

## Rate limits

Discogs documents a **moving average over a 60-second window**: 25 requests per
minute unauthenticated, 60 authenticated, with these headers on every response:

```
x-discogs-ratelimit: 25
x-discogs-ratelimit-remaining: 25
x-discogs-ratelimit-used: 0
```

Two things about them, both measured:

1. **They lag by one.** The first response of a fresh window reports
   `remaining: 25, used: 0` — the numbers describe the window *before* this
   request was counted. Taking `remaining` at face value overspends by exactly
   one.
2. **There is no reset header.** The documented rule — "If no requests are made
   in 60 seconds, your window will reset" — is what `quota()` derives `resetAt`
   from. It is computed from that rule, not invented.

Discogs asks callers to "take our global limit into account and throttle its
requests locally", which is what the adapter does: after the search response it
reads `remaining`, holds back a reserve of 3 (one for the lag, one for a
following `quota()`, one for margin) and prices at most that many releases,
re-reading the budget from every response. **It has never triggered a 429.**

### Why the result count is bounded by the rate limit

Each priced row costs its own request, so one search costs `1 + n`. With a
reserve of 3 that caps a search at `limit − 3` results: **22 without a token,
57 with one**. That is `capabilities.maxResults`, and it is also why the adapter
fetches exactly **one** search page and never pages: the page size Discogs
allows (100) is far larger than the number of rows we can afford to price.

If the window is already spent, the adapter throws `rate-limited` with
`retryAfterSeconds: 60` rather than returning an empty list — a result we could
not fetch must never reach the caller looking like a result that was empty.

## robots.txt

*Measured:* `https://api.discogs.com/robots.txt` returns HTTP 200 and is
**byte-identical** to `https://www.discogs.com/robots.txt` (3426 bytes) —
Cloudflare serves the website's file on the API host.

Under `User-agent: *`:

| Path | Verdict |
|---|---|
| `/database/search` | **not disallowed** |
| `/marketplace/stats/` | **not disallowed** (only `/marketplace/mywants$` is; `*/marketplace` sits under the `GoogleOther` group) |
| `/releases/` | **not disallowed** |
| `/users/` | **disallowed** — hence no dealer-inventory adapter |
| `/release/stats/`, `/master/stats/` | disallowed (website paths, unrelated to `/marketplace/stats/`) |

So all three endpoints the adapter uses would pass the gate on their own. The
adapter still sets `apiHost: true`, and the reason is narrower than "it is an
API": the extra two-second politeness floor would turn twenty price lookups into
forty seconds of waiting for nothing — Discogs publishes its own limit and its
own remaining budget, and the adapter throttles against those instead.

**What the flag drops is more than the floor, and this file understated it.**
`apiHost: true` also means robots.txt is never fetched and the robots rules are
never evaluated for this host. That is why the table above was checked by hand,
and it is why `troedler robots https://api.discogs.com/...` describes something
other than what runs: the command loads robots.txt and applies it, the adapter
does neither. Harmless here — verified 2026-08-22, `api` and `www` serve
byte-identical robots.txt (3 426 bytes) and none of the three paths is
disallowed under `User-agent: *` — but the command that exists to make the claim
checkable does not check this source's actual path.

## User-Agent

Discogs' developer documentation: *"Your application must provide a User-Agent
string that identifies itself – preferably something that follows RFC 1945"*,
with `AwesomeDiscogsBrowser/0.1 +http://adb.example.com` as a good example and
`curl/7.9.8 (…)` and `Mozilla/5.0 (…)` as bad ones — *"the alternative is that
we just silently block it"*.

`@troedler/http` sends `troedler/<version> (+https://github.com/JumpLink/troedler)`,
which is exactly that shape. Two measurements worth recording:

- A generic `curl/8.11.1` was **not** blocked today (HTTP 200). The policy is
  documented and its enforcement is discretionary; do not conclude from one
  probe that it is unenforced.
- **No User-Agent at all** gets `HTTP 403` from Cloudflare with an HTML body.
  A missing UA is the one form that is refused outright.

The adapter also pins `Accept: application/vnd.discogs.v2.discogs+json`
(*measured:* 200, `x-discogs-media-type: discogs.v2`), so a future v3 cannot
change the shape underneath us silently.

## Terms of Use findings

From the Discogs **API Terms of Use** (read 2026-08-21):

- **Six-hour staleness cap**, verbatim: *"You may not display in any format or
  to any audience the Content if it is more than six (6) hours older than the
  information on Our online properties or applications."* Plus: *"You may not
  cache or store the Content longer than is necessary to provide a service to
  Your application's users."* → `capabilities.cache.ttlSeconds = 21600`. This is
  a contractual number, not a tuning knob — the same six hours eBay imposes,
  from an unrelated contract.
- **Two required notices**, verbatim:
  1. *"This application uses Discogs' API but is not affiliated with, sponsored
     or endorsed by Discogs. 'Discogs' is a trademark of Zink Media, LLC."* —
     "may be included in Your terms and conditions or usage documentation".
  2. *"Data provided by Discogs."* — must be shown **"directly next to any data
     You use from the Discogs API"**, and *"must include a hyperlink to the
     discogs.com page that includes the data"*, with no mechanism that blocks
     search-engine ranking credit (i.e. no `rel="nofollow"`).

  Both live in `capabilities.disclaimer`, which every surface must render
  alongside this provider's rows. The required hyperlink is `Listing.url`,
  which is why it points at `www.discogs.com/sell/release/{id}` rather than at
  the API resource.
- **CC0 vs. Restricted Data.** Release titles, formats, dates, *"barcodes and
  other identifiers"*, credits, artist and label names are **CC0** — that is
  everything `/database/search` returns. **"Marketplace Data" … "including but
  not limited to: pricing"** is **Restricted Data**, and for it: *"You may not:
  Transfer Restricted Data to any third party. Use Restricted Data for any
  commercial purposes."*

  Reading it locally and showing it to the user who asked is exactly the use the
  API is for. **Re-publishing a Discogs price aggregate, or shipping it inside a
  hosted service, is not** — that needs its own decision before anyone builds it.
- "Discogs User Data" (usernames, user images, location, collection, wantlist)
  is Restricted Data too. The adapter touches none of it, and the `Listing` DTO
  has no field it could be put in.

## Measured, 2026-08-21

Endpoint behaviour:

| Probe | Result |
|---|---|
| `GET /database/search?q=kraftwerk&type=release&per_page=3` (no token) | `200`, `pagination.items: 6416` |
| `GET /marketplace/stats/125204?curr_abbr=EUR` | `{"num_for_sale":66,"lowest_price":{"value":64.0,"currency":"EUR"},"blocked_from_sale":false}` |
| `GET /marketplace/stats/125204?curr_abbr=GBP` | `{"value":54.33,"currency":"GBP"}` — `curr_abbr` **is** honoured here |
| `GET /releases/125204?curr_abbr=EUR` | `lowest_price: 86.53` — see the trap below |
| `GET /marketplace/stats/999999999` | `404 {"message":"Release not found."}` |
| `GET /database/search?…&per_page=250` | `200`, `per_page: 100` — silently clamped, not an error |
| `GET /database/search?barcode=888837168618&type=release` | `200`, 9 items — server-side filter, confirmed |
| `GET /database/search?q=<nonsense>` | `{"pagination":{…,"items":0,"urls":{}},"results":[]}` |
| `sort=year&sort_order=asc` | works, but Discogs sorts by year/title/label/have/want — **none** of which is a `SortKey` this project has |

End-to-end through the adapter, unauthenticated:

| Run | Requests | Time | Result |
|---|---|---|---|
| `search("kraftwerk autobahn", limit 6)` | 7 | 2.5 s | 6 listings, `totalEstimate 1095` |
| `search("kraftwerk", limit 22)` | 23 | 7.0 s | 12 listings; 10 of 22 releases had no offers; `quota()` afterwards `remaining 3 / limit 25` |
| `search("beatles", limit 5)` immediately after | 1 | 0.6 s | `ProviderError(rate-limited, retryAfter 60)` — refused itself with 2 requests still in the window |

## Traps

**The price is a global aggregate, and it is not on the page we link to.** This
is the most important sentence in this file. `/marketplace/stats/{id}` answers
with the cheapest of every copy worldwide, converted by Discogs — the long
fraction gives it away: `lowest_price.value` for release 36984 is
`7.679804607882764`, not a figure any seller typed. troedler prints "ab 7,68 €"
and links `/sell/release/36984`, and that page — anonymous, `?currency=EUR&sort=
price,asc` — starts at **€22,99** and shows 6 offers where the API said 66.
Release 15159: 9,00 € against **16,98 €**, 104 offers against 111.

*Measured 2026-08-22, and the counter-example matters as much:* release 1322803
answers `0.40 EUR` and its sell page begins at `data-pricevalue=0.40` — the same
figure to the cent. So the gap is **not a property of the number**; it varies by
release, and the visible sellers on 36984 were all NL/DE, which points at an
IP-dependent shipping filter on the website. Confirming that would need a login,
which is a hard rule against.

What follows for the code: the number is faithfully copied and must never be
treated as an asking price. `priceKind: 'from'` says so, and the kernel now acts
on it — the price band groups by basis and refuses to mix, and `verdictFor`
answers `unknown` rather than calling a minimum over 191 copies a bargain
against a field of asking prices, which it did every single time.

**The row says what it is, and the adapter used to take the URL's word for it.**
Every search row carries `"type": "release"` (measured: 22 of 22). It was not
modelled at all, because the adapter relied on `type=release` being in the URL it
built — the exact assumption that fell away when `searchParams.set()` turned out
to be a silent no-op under GJS and `/database/search` answered with 34.7 million
rows of everything. Artist ids priced as releases would have been invisible.

**One release, several valid barcodes — and the DTO has one slot.** *Measured on
`--gtin 5099996601419`:* two of five rows reported `0190295272432` instead, an
equally real barcode on the same release, because the rule was "longest wins"
and the zero-padded UPC-A is longer. The row a user searched by then looked like
it did not carry the code it had matched on. The rule is now: report the one the
caller asked for; failing that, the source's own order. `0190295272432` and
`190295272432` are one number, and `normalizeGtin` in the kernel makes them one.

**`blocked_from_sale` is not "nothing for sale today".** Discogs bans the sale of
bootlegs and takedowns permanently. *Measured on five "unofficial" releases:*
`{"num_for_sale": null, "lowest_price": null, "blocked_from_sale": true}` — and
`null`, not the `0` this project's own type comment claimed. The flag was
modelled and read nowhere, so five permanently unsellable releases were reported
as "derzeit nicht angeboten", which invites coming back.

**The rate-limit header is a rolling average, not a ledger.** *Measured
2026-08-22:* 31 requests in 20 seconds were all answered while Discogs reported
**12** used. It is a moving window and appears to be edge-local. So `remaining`
is the best signal available and not a guarantee: the enrichment budget derived
from it counts ATTEMPTS (a 404 costs the same as a hit — "Release not found." is
a documented answer), and the CLI now prints the number as a rolling window
rather than as requests you have left. In the CLI, one command is one process,
so `troedler quota discogs` always spends a request of its own.

**The release endpoint's price is in dollars.** `GET /releases/{id}` also
carries `lowest_price` — as a bare number with no currency, and it **ignores
`curr_abbr` entirely**. Measured on release 125204: `86.53` for `curr_abbr=EUR`,
`86.53` for `curr_abbr=GBP`, `86.53` for no parameter, while
`/marketplace/stats/` answered `64.00 EUR` and `54.33 GBP` for the same release
seconds apart. Reading it would label dollars as euros — a number that sorts,
filters and compares, and is wrong by a third. `DiscogsRelease` in `types.ts`
does not model the field, so nothing can read it by accident.

**`barcode[]` is a grab bag.** It mixes real EAN/UPC codes with label codes
(`LC00162`), rights societies (`BIEM/GEMA`) and matrix/runout inscriptions.
Length is not enough to tell them apart: the measured inscription
`"10 6305058 1 320"` reduces to thirteen digits. Only the GS1 check digit
rejects it — and it has to, because `merge.ts` treats a GTIN as the *trusted*
cross-provider identity, so a wrong one does not produce a missing match, it
produces a false one.

**`country` is the pressing plant, not the seller.** A German pressing sold from
Osaka would be reported as "Germany" and a radius search would then act on it.
`Listing.location` stays null throughout.

**One barcode can span several releases.** Measured: Kling Klang reissues of
*Autobahn* from 2009, 2015 and 2020 all carry `5099996601419`. Within Discogs
this is harmless — `dedupeWithinProvider` keys on the release id — but
`groupByIdentity` will fold them into one group in the merged view. That is
arguably right (same product) and it is worth knowing before someone reports it
as a bug.

**The catalogue number must not go through `stripContactDetails()`.** The phone
pattern in `normalize.ts` matches a leading `0` followed by eight or more
digits, spaces, dots, slashes or hyphens — the exact shape of a Universal
catalogue number. Measured: `"Kat.-Nr.: 0602557531336"` and
`"Kat.-Nr.: 088 112 838-2"` both come back as `"Kat.-Nr.: […]"`. The strip
belongs on the free-text fields (title, label names, release notes), never on an
identifier.

**Release notes are written in Discogs' own wiki markup.** Measured on release
35822047: *"Identical to `[r=7000941]` with the addition of a signature"*.
Discogs' site renders those brackets as links; plain text has to do something
else with them. `[r=<id>]` becomes `discogs:<id>` — this project's own listing
handle, so the cross-reference stays actionable — while `[m=]`, `[a=<id>]` and
`[l=<id>]` are dropped (no handle exists for masters, artists or labels) and
`[a=Name]`/`[l=Name]` are unwrapped to the name they contain.

**Discogs lists a label once per role**, so a single-label release arrives as
`["Vertigo", "Vertigo"]`. Deduplicated before display, or it reads like a bug in
this tool.

## Sources

- Discogs API documentation — <https://www.discogs.com/developers>
  (Rate Limiting, Pagination, General Information / User-Agent policy)
- Discogs API Terms of Use — <https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use>
- `https://api.discogs.com/robots.txt` and `https://www.discogs.com/robots.txt`
- Own probes, 2026-08-21, from a German IP with the adapter's user agent.
