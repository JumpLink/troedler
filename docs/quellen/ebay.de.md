# Source record — eBay (`api.ebay.com`, marketplace `EBAY_DE`)

| | |
|---|---|
| **Adapter** | `packages/ebay` → `@troedler/ebay`, provider id `ebay` |
| **Access** | `official-api` — Browse API. **No HTML path exists and none may be added.** |
| **Terms verdict** | `permitted` (registered in `@troedler/compliance` → `SOURCES`) |
| **Enabled by default** | yes, once credentials are present |
| **Cache TTL** | **6 h — contractual, not a tuning knob** (see *Licence obligations*) |
| **Last checked** | 2026-08-21 |

Everything below was measured or quoted on **2026-08-21**. `developer.ebay.com` answers scripted
requests with a WAF 403; the mirror **`edp.ebay.com`** serves the same documentation and the
OpenAPI contracts without a login, and is what the documentation links point at.

---

## 1. robots.txt

### `api.ebay.com/robots.txt` — **HTTP 404, 0 bytes** (fetched 2026-08-21)

There is no robots.txt on the API host, so there is no crawl rule to respect or to skip. The
adapter still passes `apiHost: true` to `@troedler/http`, and the justification is the licence
rather than the 404: the API is a documented service eBay issues keysets for, governed by the
[API License Agreement](https://edp.ebay.com/join/api-license-agreement), not by a website's crawl
policy. The flag is set in exactly one place — `EbayClient.#fetchOptions()` — with that reason in
a comment.

### `www.ebay.de/robots.txt` — **HTTP 200, 15 980 bytes, md5 `c4554ef347e31caaf6d265f343feaecd`**

Version marker in the file: `v28.1_DE_August_2026`. No `Crawl-delay` anywhere (0 occurrences),
620 `Disallow` lines. Two findings decide this record:

1. **The preamble forbids robots outright and names the API as the approved route** (verbatim):

   > The use of robots or other automated means to access the eBay site without the express
   > permission of eBay is strictly prohibited. […] Approved enterprise integrations must use our
   > official API and comply with our API License Agreement.

2. **`User-agent: *` carries `Disallow: /sch/`** — the search-results path itself. Also
   `Disallow: /sch/ajax` and `Disallow: /sch/ebayadvsearch?_`.

So an HTML adapter for eBay would be forbidden by robots.txt *and* by the site's own preamble,
while the same data is available under a licence eBay hands out for free. That is why
`packages/ebay` has no `parse-html.ts` and no fallback: **an official API beats HTML, always.**

For the record, the file also blocks the AI crawlers by name — `GPTBot`, `ClaudeBot`,
`anthropic-ai`, `PerplexityBot`, `CCBot`, `Bytespider`, `AmazonBot`, `meta-externalagent`,
`Applebot-Extended`, `ChatGLM-Spider` — with `Disallow: /`. troedler is none of them and does not
touch the website at all, but it is the same signal the licence spells out in section 5: eBay
content must not feed a training pipeline.

---

## 2. Which API

| API | Status | Verdict |
|---|---|---|
| **Browse** `buy/browse/v1`, OAS **v1.20.4** | active | **The one we use.** `item_summary/search`, `item/{itemId}` |
| Finding API | **decommissioned 2025-02-04** | gone, server-side |
| Shopping API | **decommissioned 2025-02-04** | gone |
| Marketplace Insights `buy/marketplace_insights/v1_beta` | Limited Release — *"restricted and not open to new users at this time"* | sold-item history is **not available** |
| Feed API `buy/feed/v1` + Feed Beta | Limited Release, partner-gated | bulk dumps; not for a per-query tool anyway |
| Product API | decommissioned **2026-08-15** | do not reference |

Within Browse, only `GET /item/` (`getItems`, the bulk form) is marked *(Limited Release)*.
`item_summary/search`, `getItem` and `getItemByLegacyId` are not.

Contract: [Browse OAS3 v1.20.4](https://edp.ebay.com/api-docs/buy/browse/openapi/3/buy_browse_v1_oas3.json) ·
[search method](https://edp.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search) ·
[deprecation status](https://edp.ebay.com/develop/get-started/api-deprecation-status).

Rate-limit reporting uses Developer Analytics `v1_beta.0.1`,
`GET /developer/analytics/v1_beta/rate_limit/`, with the same application token.

---

## 3. Auth

**`client_credentials` — an application token. No user token, no redirect, no consent screen.**

> All methods in the Browse API require an Application access token, which is obtained using the
> client credentials grant flow.
> — [Browse API](https://edp.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)

- Endpoint `POST https://api.ebay.com/identity/v1/oauth2/token`,
  `Authorization: Basic base64(client_id:client_secret)`,
  body `grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope`.
- **Scope is `https://api.ebay.com/oauth/api_scope`** — the base scope. There is **no
  `buy.browse` scope**; only Feed (`buy.item.feed`) and Marketplace Insights
  (`buy.marketplace.insights`) have their own.
- Token lifetime **7 200 s**. eBay's own instruction: *"applications should store this token in a
  static variable and re-use the token while it is valid."*
- Keys are free, but **not instant on a fresh account** — and the portal's own marketing says
  otherwise, which is how this record got it wrong first. The registration page advertises
  *"Membership is free!"* next to *"New accounts include a free access tier"*, and the keyset
  page describes creating a keyset as a self-service click. Both are true, and neither is the
  first step. Measured 2026-08-22 on a new registration:

  > Thank you for registering with the eBay Developers Program. We are reviewing your account
  > information. Access to your new account is pending approval, which takes at least one
  > business day.

  So the order is: register → **account review, ≥ 1 business day** → then
  developer.ebay.com → *Application Keys* → Production keyset, which is the instant part.
  Plan the wait; it is not a failed registration.
- The **sandbox is useless for search** — documented as returning 0 results. Test the auth flow
  there if you like; search against production.

### ⚠️ The blocker before the first production call

From [Create the eBay API keysets](https://edp.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html)
and [Marketplace Account Deletion](https://edp.ebay.com/marketplace-account-deletion):

> Before you can use your Production keyset, you must subscribe to or opt out of eBay marketplace
> account deletion/closure notifications. […] New third-party developers […] must subscribe to or
> opt out […] before they make their first production API call.

Two ways to satisfy it:

- **Subscribe** — run a public HTTPS endpoint answering GET (challenge: SHA-256 over
  `challengeCode + verificationToken + endpoint`, reply `{"challengeResponse":"<hex>"}`) and POST.
  No localhost, no internal IP.
- **Opt out** — the *"Not persisting eBay data"* toggle plus an exemption reason.

**For troedler, opting out is the correct choice, and it is a consequence of the design rather
than a shortcut.** troedler stores nothing about any eBay user: `Listing` has no seller name, no
seller id and no profile, and `EbaySeller` in `packages/ebay/src/types.ts` deliberately transcribes
only `sellerAccountType`. There is no stored record an account deletion could oblige us to erase.

A keyset that has done neither is refused on its first production call — which surfaces exactly
like bad credentials, so the adapter's token error names all three causes in one sentence.

---

## 4. Rate limits — with the numbers

Source: [API Call Limits](https://edp.ebay.com/develop/get-started/api-call-limits), default tier.

| Resource | Limit |
|---|---|
| **Browse API, every method except `getItems`** | **5 000 calls/day** |
| Browse `getItems` | 5 000/day, separate pool |
| **OAuth `grant_type=client_credentials`** | **1 000 requests/day** |
| OAuth `authorization_code` / `refresh_token` | 10 000 / 50 000 per day |
| Taxonomy API | 5 000/day |

**The 1 000 is the one that shapes the code.** It is five times smaller than the search budget, so
an adapter that fetches a token per search exhausts the *wrong* pool first and starts failing at a
fifth of the searches it was licensed for. `EbayClient` therefore caches the token for its
lifetime minus a 60 s margin and collapses concurrent requests onto one in-flight fetch — twelve
tokens cover a full day. `app/tests/unit/providers/ebay.test.ts` asserts one token for two
searches, one for two *concurrent* searches, and a second one after the clock passes expiry.

Paging: `limit` 1–200 (default 50), `offset` 0–9 999 and a multiple of `limit`, hard cap **10 000
items per result set** (error 12029). troedler asks for at most 200 rows in one request and never
pages — `RESULTS_PER_PROVIDER.max` is 200, which is exactly eBay's ceiling.

Live budget: `GET /developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=browse`
returns `{count, limit, remaining, reset, timeWindow}` per resource. `provider.quota()` reads it
and skips the `getItems` resource, which is a different pool from the one a search spends.

---

## 5. Licence obligations that shape the code

All quotes verbatim from the
[eBay API License Agreement](https://edp.ebay.com/join/api-license-agreement) (retrieved
2026-08-21; full text archived locally during research).

### 5.1 Six-hour freshness — `capabilities.cache.ttlSeconds`

> Displayed item listing information may not be more than six (6) hours older than information
> displayed on the eBay Site, and other eBay Content must be no more than twenty-four (24) hours
> older […] If your displayed item listing is not as current as the listing on the eBay Site, you
> will disclose in your Application how much older your displayed item listing is.

Encoded as `LICENCE_MAX_AGE_SECONDS = 6 * 3600` on the capability object, so the cache layer
enforces it without knowing which provider it is holding. `Listing.fetchedAt` is what makes the
disclosure possible.

### 5.2 Deletion, not just expiry

> When the eBay Content is no longer publicly available, you must delete it from your Application.

A TTL alone does not satisfy this: the cache needs eviction of listings that have ended.

### 5.3 No co-mingling in a public display — why `grouped` is the primary shape

> eBay Content in a Public Display may not be co-mingled or combined with non-eBay Content. For
> example, all eBay Content in a Public Display must be visually isolated from third-party
> listings or other non-eBay information.

This is why `@troedler/core` returns results **grouped by provider** and makes the merged flat
list opt-in, and why `capabilities.disclaimer` carries the sentence every surface must show. For a
purely local CLI/MCP tool with no "Your Users" the clause is largely inert — but the GUI has to be
built the same way, so the constraint lives in the data rather than in someone's memory.

### 5.4 No user ids — why `Listing` has no seller

> You will not under any circumstances collect, store or share any eBay User' User IDs or
> passwords.

`seller.username` and `seller.userId` are not even present in `packages/ebay/src/types.ts`; only
`sellerAccountType` is, mapped to `SellerType` (`private` / `commercial`). A test serialises whole
mapped listings and asserts the pseudonyms from the sample response appear nowhere in them.

The contract additionally warns on `seller.username`: *"Effective September 26, 2025, select
developers will…"* be moved to immutable user ids — another reason not to build on that field.

### 5.5 No price modelling

> Use eBay Content, either alone or in combination with third-party information, to suggest or
> model prices for items listed on eBay Site.

(Listed among the prohibited uses.) A "what is this worth / suggested price" feature built on eBay
data is **out of bounds**, as is deriving category averages or GMV statistics. Showing the prices
of the offers a user searched for is not that; a valuation model is.

### 5.6 No AI training path

> Use eBay Content, including without limitation any Personal Information, to train algorithms,
> conduct machine learning, develop synthetic data sets, train large learning models, and/or train
> artificial intelligence systems.

Directly relevant to the **MCP server**: handing results to a model for inference is not training,
but the clause is broad, so eBay rows must never be written into any training, fine-tuning or
dataset-export path. Nothing in troedler does — the MCP server is read-only, stdio-only, and the
cache is query-scoped — and that has to stay true.

### 5.7 Images: link, never rehost

`image.imageUrl` points at `i.ebayimg.com`. There is no hotlinking prohibition in the licence — on
the contrary, the guest-checkout requirements demand *"The image of the item must be an eBay
image"*. Copying the bytes would be "store eBay Content", so `Listing.images` holds URLs only.
The `s-l64` / `s-l225` / `s-l500` / `s-l1600` size convention in the filename is **undocumented**;
do not build on it.

---

## 6. What the adapter sends

One request per search. `q`, `gtin`, `sort`, `limit`, `offset`, `fieldgroups=EXTENDED` (which is
what carries `shortDescription` and `itemLocation.city`), plus a comma-joined `filter=`.

| Query field | eBay filter | Claimed as applied? |
|---|---|---|
| `minPrice` / `maxPrice` | `price:[a..b]` **+ mandatory `priceCurrency`** (else error 12012) | yes |
| `condition` | `conditionIds:{…}` — expanded via `CONDITION_IDS`, the inverse of core's `conditionFromEbayId` | yes |
| `sellerType` | `sellerAccountTypes:{INDIVIDUAL\|BUSINESS}` — **only on AT, BE, CH, DE, ES, FR, GB, IE, IT, PL** | yes, on those marketplaces |
| `radius` + `postalCode` | `deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}` + `pickupCountry` + `pickupPostalCode` + `pickupRadius` + `pickupRadiusUnit` — **all five or error 12010** | yes |
| `since` | `itemStartDate:[<iso>]` | yes |
| `gtin` | the `gtin` query parameter, not a filter | yes |
| `sort` | `price` / `-price` / `newlyListed` / `endingSoonest`; omitted for relevance (= Best Match) | yes, except relevance |
| `delivery` | — | **never** |

Two deliberate refusals, both in `filter.ts`:

- **`delivery` is never claimed and is not in `serverFilters`.** eBay has no "ships to me" filter
  that means what the query means, and the pickup filter set narrows to local pickup only as a
  by-product of a radius search. Declaring it would promise something no request delivers.
- **A radius search is dropped when the query says `delivery: 'shipping'`.** eBay's radius search
  returns *local-pickup offers only*, so the combination would return nothing and call it a
  result.

`X-EBAY-C-MARKETPLACE-ID` is **mandatory**: *"If the marketplace ID value is invalid or missing,
the default value of EBAY_US is used"* — no error, no warning, just American results for a German
search. `X-EBAY-C-ENDUSERCTX: contextualLocation=…` is sent only when the user supplied a
postcode; it is what makes `sort=price` sort by price *including* shipping.

### Warnings are the quiet failure

Invalid filters come back as **HTTP 200 plus `warnings[]`** (12002 invalid value, 12014
`sellerAccountTypes` unsupported for the marketplace, 12015 postal code ignored), and the rows are
then **unfiltered**. If the kernel is told such a filter was applied it skips its own pass and
shows unfiltered rows with a confident face. So `attributeWarnings()` matches the eBay filter name
inside the warning text and `parameters`, removes what it names from `applied`, and — when it
cannot attribute a warning at all — **removes every claim**. One extra local filtering pass is
cheap; a silently ignored filter is not.

### Field mapping worth knowing

- `itemCreationDate` → `listedAt`. **Not** `itemOriginDate`, which survives a relist and would
  date a fresh listing years early. (`sort=newlyListed` sorts by `itemOriginDate`, which is eBay's
  choice, not ours.)
- `itemEndDate` → `endsAt` **only for auctions**. For a fixed-price listing eBay rolls it forward
  on renewal, so it is a countdown to nothing.
- `currentBidPrice` → `price` for auctions; the `price` field there is the opening bid, and
  mapping it puts a hot auction at the top of a price-ascending search as a one-euro bargain.
- `conditionId` → `Condition` via core's `conditionFromEbayId`.
- **`gtin` only ever comes from `getItem`.** `ItemSummary` has no such field, so search results
  carry `gtin: null` and the cross-provider identity falls back to title + price.

### Known gaps in the data itself

- **Browse does not return every live listing.** Community-reported and unchallenged: items are
  missed even after paging through a full result set, disproportionately auctions and
  multi-variation listings, plus a reported 10–15 min indexing delay for new listings. A
  "bargain alert" built on `sort=newlyListed` + polling has no real-time guarantee.
- `total` is eBay's own estimate — *"an indicator […] It could vary"*. Displayed, never
  calculated with.
- `watchCount` and "most watched" need a special grant. Not available.

---

## 7. Measured, 2026-08-21

Driven through the real adapter against `api.ebay.com` with deliberately invalid credentials
(no keyset was available), plus raw probes of the same endpoints:

| Probe | Result |
|---|---|
| `status()` with no credentials | `configured: false`, kind `not-configured`, **1 ms, zero network calls** |
| Token endpoint, bogus keyset | **HTTP 401**, `application/json`, body `{"error":"invalid_client","error_description":"client authentication failed"}` — round trip **756 ms** → adapter reports `ProviderError(refused)` naming all three likely causes |
| `search()` with the same keyset | fails at the token step; **no search request is made** |
| `item_summary/search` with a fake bearer | **HTTP 401** (JSON error body) → `refused` |
| `item_summary/search` with **no** `Authorization` | **HTTP 403** → `refused`, no retry |
| `developer/analytics/v1_beta/rate_limit/` with a fake bearer | **HTTP 401** → `refused` |
| `api.ebay.com/robots.txt` | **HTTP 404**, 0 bytes |
| `www.ebay.de/robots.txt` | **HTTP 200**, 15 980 bytes, md5 `c4554ef347e31caaf6d265f343feaecd` |

Note for whoever adds credentials: earlier documentation describes a **400** for a bad keyset;
what production actually answers is **401**, which `@troedler/http` maps to `refused`. The path is
still correct — a refused token is a stop sign, not something to retry — but the OAuth error body
never reaches the adapter, so the diagnosis has to come from the sentence the adapter adds.

Unverifiable without a keyset at the time, and therefore **not asserted anywhere in the code**:
the exact shape of a successful search response, whether `EXTENDED` reliably fills
`itemLocation.city` on `EBAY_DE`, and the resource names Developer Analytics uses for the Browse
pool. `quota()` reads those names defensively (any resource whose name is not `getItems`). A
keyset now exists — the response shape is measured below; the other two are still open.

---

## 7a. Measured with a real production keyset, 2026-08-24

### The keyset ships disabled, and says `invalid_client`

A fresh production keyset answers the token endpoint with **HTTP 401
`{"error":"invalid_client","error_description":"client authentication failed"}`** until the
marketplace-account-deletion decision from § 3 is made — the developer console shows *"Your keyset
is currently disabled"*, and the API's wording is **byte-identical to a mistyped secret**. Two
hours were spent on the wrong hypothesis because of it. The adapter's token error therefore names
all three causes in one sentence, and that sentence is load-bearing.

Exemption (*"I do not persist eBay data"*), then:

| Probe | Result |
|---|---|
| Token endpoint, real keyset | **HTTP 200**, `token_type: Application Access Token`, `expires_in: 7200` |
| `item_summary/search?q=…&limit=3`, `X-EBAY-C-MARKETPLACE-ID: EBAY_DE` | **HTTP 200**, 3 rows |
| `troedler search "Metabo Bandsäge" --limit 25` | 25 rows, **2 requests**, 1 229 ms |

### An `ItemSummary` carries no product code — which is why `--compare` could not work

Fields present on a row of `item_summary/search` (measured, all 3 rows identical in shape):

```
additionalImages · adultOnly · availableCoupons · buyingOptions · categories · condition
conditionId · itemCreationDate · itemHref · itemId · itemLocation · itemOriginDate
itemWebUrl · leafCategoryIds · legacyItemId · listingMarketplaceId · price · priorityListing
seller · shippingOptions · title · topRatedBuyingExperience
```

**No `gtin`, and no `epid`.** `getItem` has `gtin`; a search summary does not. So a group keyed on
the barcode can never contain an eBay row that came out of a keyword search — measured over three
live `--compare` runs: **34 groups, none spanning two markets**, with eBay configured and
answering.

### Asking by barcode works, and answers without repeating it

`item_summary/search?gtin=<code>` is supported and matches:

| Barcode | Origin | eBay `total` |
|---|---|---|
| `5099902987613` | Discogs, 2016 European vinyl reissue | 7 |
| `9780007232291` | Booklooker, ISBN of the Harris book | 4 |

This is what `crossCheckByGtin` in `@troedler/core` uses. **The rows it returns still carry no
`gtin`**, so the kernel writes the barcode it asked for onto them — and only when the report says
the source applied `gtin` server-side. Without that step the pass spent 12 requests, added 13 rows
and produced exactly zero cross-source groups: work that looked like work. With it, the same query
produced **5 groups spanning Discogs and eBay** out of 47.

---

## 8. Open items

- **`@troedler/http` needs `postForm()`.** The OAuth token endpoint is a POST and `HttpClient`
  exposes only `get`/`getJson`, so `packages/ebay` types its dependency as the structural
  interface `EbayHttp` (`getJson` + `postForm`). A real `HttpClient` satisfies it with no cast the
  moment the method lands. It must keep the same status mapping as `get()` — 429/503 →
  `rate-limited`, 401/403 → `refused` with no retry, everything else non-2xx → `remote-error` —
  and go through the same gate and rate limiter.
- **`ProviderError` should carry the HTTP status.** `getListing()` has to tell "this item is gone"
  (404 → `null`, an answer) from "the API broke", and today the only evidence is a German sentence
  it has to pattern-match. The shim is marked at the call site in `provider.ts` and comes out when
  `ProviderError` grows a `status` field.
- **`ProviderErrorKind` has no `invalid-query` member.** A search with neither text nor GTIN is a
  malformed request, not a remote error, but `remote-error` is the closest available kind.
- Marketplace Insights (sold-item history) is a Limited Release closed to new users — revisit if
  that ever changes; it is the only way to answer "what does this actually sell for".

## 9. Sources

All retrieved **2026-08-21** via `edp.ebay.com` (the `developer.ebay.com` front end answers
scripted requests with a WAF 403).

- [Browse API OAS3 v1.20.4](https://edp.ebay.com/api-docs/buy/browse/openapi/3/buy_browse_v1_oas3.json)
- [item_summary/search](https://edp.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
- [Buy API Field Filters](https://edp.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html)
- [Browse API Guide — headers, affiliate](https://edp.ebay.com/api-docs/buy/static/api-browse.html)
- [API Call Limits](https://edp.ebay.com/develop/get-started/api-call-limits)
- [API Deprecation Status](https://edp.ebay.com/develop/get-started/api-deprecation-status)
- [OAuth client credentials grant](https://edp.ebay.com/api-docs/static/oauth-client-credentials-grant.html)
- [Create the eBay API keysets](https://edp.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html)
- [Marketplace Account Deletion Notifications](https://edp.ebay.com/marketplace-account-deletion)
- [eBay API License Agreement](https://edp.ebay.com/join/api-license-agreement)
- [Buy API Requirements](https://edp.ebay.com/api-docs/buy/static/buy-requirements.html)
- [Item condition ID values](https://edp.ebay.com/api-docs/sell/static/metadata/condition-id-values.html)
- [Developer Analytics OAS v1_beta.0.1](https://edp.ebay.com/api-docs/developer/analytics/openapi/3/developer_analytics_v1_beta_oas3.json)
- `https://www.ebay.de/robots.txt` · `https://api.ebay.com/robots.txt` (fetched directly)
- Production status for DE: <https://entwickler.ebay.de/support/api-status/production>
