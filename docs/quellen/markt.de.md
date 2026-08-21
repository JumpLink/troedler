# markt.de — source record

| | |
|---|---|
| **Host we call** | `www.markt.de` |
| **Adapter** | `packages/markt` · provider id `markt-de` |
| **Access** | `html` — no public API; the search is a plain GET path |
| **Terms verdict** | **`forbidden`** — the Nutzungsbedingungen forbid automated retrieval outright |
| **Enabled by default** | **no**, and there is no code path that flips it |
| **Last read by a person** | 2026-08-21 |

Everything marked *measured* was fetched from this machine on 2026-08-21 with
the adapter's own user agent, `troedler/… (+https://github.com/JumpLink/troedler)`.
Nothing here is quoted from memory.

**This source is the reason the register separates robots.txt from terms.**
markt.de's robots.txt permits every URL this adapter would build — and names
`ClaudeBot` specifically to grant it more. Its Nutzungsbedingungen forbid
automated collection in one sentence. The clause wins.

## What this source is

A general German classifieds portal (markt.de GmbH & Co. KG, Hamburg) covering
Fahrzeuge, Immobilien, Jobs, Tiere, Haus & Garten, Elektronik, Dienstleistungen
and Kontaktanzeigen. Ads are private and commercial both, and a third stream —
"Partner-Anzeigen" — is affiliate inventory injected into the same result list.

## robots.txt

*Measured*, `GET https://www.markt.de/robots.txt` → HTTP 200, 1 464 bytes.
**31 groups, 1 sitemap.** The group that applies to us, verbatim:

```
User-Agent: *
Disallow: *.ajx
Disallow: *.drawWidgetEntriesCallback
Disallow: */img_placeholder_lazyload.svg
Disallow: */shop.htm
Disallow: *ajaxCall
Disallow: /11893755/
Disallow: /admin/
Disallow: /facebook/
Disallow: */importeurKarte.htm
Disallow: */kartensuche.htm
Disallow: /*?*contactFlow=
```

**No `Crawl-delay` for `*`.** The gate's floor of 2 s applies (`DEFAULT_DELAY_SECONDS`).

The file also carries an explicitly generous group — and it is not ours:

```
User-Agent: ClaudeBot
Disallow: 
Crawl-delay: 1
```

An **empty** `Disallow:` means "nothing is disallowed": full access, with a
one-second delay. (The workspace research map transcribed this as `Disallow: /`
and concluded the opposite. It is `Disallow:` with an empty value.)

*Measured* with `@troedler/compliance`'s own matcher, which is the only
authority that counts here:

```
groupFor(robots, "troedler")  -> agents=["*"]         rules=11  crawlDelay=null
groupFor(robots, "ClaudeBot") -> agents=["claudebot"] rules=0   crawlDelay=1
```

troedler sends its own name, matches `*`, and abides by `*`. Sending
`ClaudeBot` to collect a permission granted to a different program is exactly
the impersonation this project refuses — see `packages/http/src/agent.ts`.

Twenty-seven further agents (HTTrack, WebZIP, Teleport, Xenu, libwww, …) get
`Disallow: /`. We are not among them either.

*Measured* verdicts for every URL the adapter can build:

| Path | Verdict |
|---|---|
| `/suche/fahrrad/` | ALLOW |
| `/suche/fahrrad/?page=2` | ALLOW |
| `/suche/fahrrad/?sorting=price` | ALLOW |
| `/30966/suche/fahrrad/?radius=25` | ALLOW |
| `/berlin/suche/fahrrad/` | ALLOW |
| `/haus-garten/suche/fahrrad/` | ALLOW |
| `/e-bike-aktivelo/a/7ed33a6b/` | ALLOW |
| `/haendler/shop.htm` | DENY — `Disallow: */shop.htm` |
| `/staedte/kartensuche.htm` | DENY — `Disallow: */kartensuche.htm` |

## Bot protection

None *measured*. Apache, HTTP 200 on the first try under the honest agent, no
challenge, no cookie required for reading. Three cookies are *offered*
(`MARKT_COOKIE_CHECKER`, `MARKT_AGE_CONFIRM`, `MARKT_SESSION`); the adapter
stores none of them and reading works without them.

## Terms of Use findings — the decisive clause

Document: **Nutzungsbedingungen**, `https://www.markt.de/nutzungsbedingungen.htm`.
Fetched and read in full 2026-08-21, 23 511 characters of text.
(`/agb.htm` is HTTP 404, `/contentId,agb/inhalt.htm` is HTTP 410 — the
`contentId,nutzungsbedingungen` form redirects to the URL above.)

> „Das automatische Auslesen oder Sammeln von Inhalten auf markt.de (z. B. durch
> **Crawler, Spider oder Scraper**) ist ohne ausdrückliche schriftliche Erlaubnis
> **verboten**."

Two further sentences from the same document belong on the record:

> „Es ist verboten, persönliche Daten (wie E-Mail-Adressen) anderer Nutzer zu
> sammeln, an Dritte weiterzugeben oder sich diese ohne Erlaubnis zu
> beschaffen."

> „Ebenso ist es untersagt, fremde Anzeigeninhalte zu kopieren, zu verändern
> oder zu verbreiten."

### What follows, and is implemented rather than merely noted

1. **`enabledByDefault: false`.** No code path flips it. `providers enable`
   additionally requires `--acknowledge`, exactly as for kleinanzeigen.de.
2. **`cache.memoryOnly = true`, `ttlSeconds = 0`.** A file on disk is a copy,
   and copying ad content is the second forbidden thing above.
3. **`stripContactDetails()` runs while parsing**, never afterwards, and no
   seller name, id, profile link or avatar URL enters the DTO. The result row
   *does* carry the seller's profile picture; the adapter reads its URL only to
   classify private-vs-commercial and drops it — measured, 8 of 20 rows on one
   page carried a personal photograph.
4. **No account, no cookie jar, no POST.** The only outbound call in the
   codebase is `HttpClient.get`.

Under § 44b UrhG a text-and-data-mining reservation is effective only in
machine-readable form, and this host's machine-readable channel permits us.
That argument is available and it is **not** the one this project takes: the
operator's written wish is unambiguous, and the switch is left to the user with
the sentence in front of them (`capabilities.note`).

## URL grammar — measured

Search, canonical form:

```
https://www.markt.de/<geoUrlId|kategorie>?/suche/<keyword>/?radius=&sorting=&page=
```

*Measured* by following the redirect from `/suche.htm?keywords=…`:

| Input | Canonical URL |
|---|---|
| `keywords=fahrrad` | `/suche/fahrrad/` |
| `keywords=damen fahrrad` | `/suche/damen+fahrrad/` |
| `keywords=Nähmaschine Bernina` | `/suche/n%C3%A4hmaschine+bernina/` |
| `keywords=fahrrad&geoName=Berlin&radius=50` | `/berlin/suche/fahrrad/?radius=50` |
| `keywords=fahrrad&geoName=30966&radius=25` | `/30966/suche/fahrrad/?radius=25` |

Lowercased, words joined with `+`, UTF-8 percent-encoded. **Umlauts are kept,
not transliterated** — `naehmaschine` is a different word to this search engine.
The adapter builds the canonical form itself: it saves the redirect, and it
means the URL the robots gate inspects is the URL that is fetched.

| Parameter | Meaning | Values *(measured)* |
|---|---|---|
| `radius` | Umkreis in km, only with a geo segment | `0 5 10 15 20 25 50 100 150 200 250` — read off `data-slider-input-list` |
| `sorting` | Sortierung | `price` ↑ · `-price` ↓ · *absent* = „Neueste Anzeigen" (the selected default) |
| `page` | Seite, 1-based | `?page=2`; also published as `<link rel="next">` |

**Twenty rows per page**, *measured* from page 1 through page 201.
`capabilities.maxResults` is therefore `20 × PAGE_DEPTH.max` = 100.

### What cannot be pushed down, and why

Price range, price type (Festpreis/VB/Zu verschenken/Bestes Angebot) and
Anzeigenart (Privatangebot/Gewerbliches Angebot) are **not URLs at all**. Their
controls are `<button form="prg_form" data-targeturl="EpFPH8ZMLDiZRL4Y…">`
which POST an encrypted target through `/urlMaskingRedirect.htm`. There is
nothing here for robots.txt to forbid and nothing for the adapter to build, so
`serverFilters` is `['radius', 'sort']` and the kernel finishes the rest.

### Category and geo do not compose — and both failures are silent

*Measured:*

```
/haus-garten/30966/suche/fahrrad/?radius=25  → 301 to https://www.markt.de/?radius=25   (the HOMEPAGE)
/30966/haus-garten/suche/fahrrad/?radius=25  → 200, "Suchen (0 Treffer)", 17 recommendation ads
```

Both are the "green and empty" failure in its purest form. The adapter refuses
to build either: `buildMarktSearchUrl` uses the geo and reports the dropped
category in a warning. (The parser survives both anyway — the first raises
`parse-failed`, the second returns an honest zero — but a URL that cannot work
is not one to send.)

## What the pages carry

Result row (`li.clsy-c-result-list-item`): id in the `id` attribute
(`markt_result_<id>`), full title in the `title` attribute, ad path in
`data-onclick-url`, one thumbnail with a `srcset`, teaser text, price amount +
price label, `PLZ Ort` (plus `<span>NN km</span>` under a radius), the date, and
the seller's avatar. **No condition, no shipping field, no GTIN.**

The ad page additionally has `Anzeigentyp: Privatangebot | Gewerbliches Angebot`
and a `Zustand` attribute — which is why `condition` is `unknown` on every row
rather than guessed from the title.

`getListing` is deliberately **not implemented**. It would work (`/x/a/<id>/`
301s to the canonical ad URL, *measured*), but it is a second, differently
shaped parser per row fetched, for one field, on a source that is off by
default.

## Environment

| Variable | Meaning |
|---|---|
| `TROEDLER_MARKT_REGION` | a `geoUrlId`: `berlin`, `nordrhein-westfalen`, or a postcode like `30966` |
| `TROEDLER_MARKT_CATEGORY` | a top-level category slug: `haus-garten`, `elektronik-technik`, `hobby-freizeit-lernen`, `fahrzeuge`, `immobilien`, `jobs`, `tiere`, `dienstleistungen`, `kontaktanzeigen` |

Both are validated by shape, not against a table — troedler ships no place or
category list, and a well-formed but unknown value earns an honest 404 rather
than a silent nationwide search. A bad value is reported through `status()`.

## Traps

**The site-wide keyword search leaves the classifieds within two pages.**
*Measured* on `fahrrad`: page 1 had 0 Partner-Anzeigen, page 2 had 12, pages 4
and 50 had **20 of 20** — job postings and property listings, each with a
markt.de ad id, no price, and often no postcode. They are real ads on this
source, so they are returned; they are flagged `sellerType: 'commercial'` so a
private-seller filter removes them, and the provider emits a warning naming the
count. `TROEDLER_MARKT_CATEGORY` is the real fix:
`/haus-garten/suche/naehmaschine/` returned 36 hits and zero partner ads.

**A zero-hit search returns twenty ads.** *Measured* on
`/suche/qqzzxxwwvv123/`: HTTP 200, „Suchen (0 Treffer)", „Leider wurden keine
Anzeigen gefunden" — and twenty perfectly formed result rows underneath, in
`div.clsy-more-results > section.clsy-more-results__alternative-results`. A
plain `.clsy-c-result-list-item` selector returns all twenty. The adapter
anchors on `.clsy-c-search__blocks-results > ul.clsy-c-result-list > li…` and
additionally refuses to return rows when the hit count says zero.

**A Partner-Anzeige has no `<a href>`.** Its title is a POST button. Reading the
link would drop 40 % of an electronics page (*measured*: 8 of 20 rows on
`/elektronik-technik/suche/iphone/`). Title comes from the `li[title]`
attribute, URL from `data-onclick-url`.

**„Heute, vor 3 Min." is not a time.** Core's `parseGermanDate` sees the „Heute"
prefix, finds no `HH:MM`, and returns **today at 00:00** — up to eighteen hours
early, on the very freshest ads, which is exactly the rows a `--since` filter is
about. `parseMarktDate` matches the relative form first. Wordings *measured* on
this source: `Heute, HH:MM` · `Heute, vor N Min.` (up to 55) · `Gestern, HH:MM` ·
`DD.MM.YYYY`.

**The distance is inside the location node.** `<div class="…__location">30966
Hemmingen (Niedersachsen)<span>12 km</span></div>` collapses to
`…(Niedersachsen)12 km` with no separator. The span's text is removed from the
tail before the postcode is split off.

**A giveaway prints an empty price amount.** The word is in the *label*
(`Zu verschenken`), not the amount. Amount and label are joined before
`parseGermanPrice` sees them, which is also how `VB` becomes `negotiable`.

**Four-digit postcodes exist here.** markt.de carries a `dach-region` and links
a Swiss sister site. Five digits → `country: 'DE'`; four digits → `null`,
because Austria and Switzerland are indistinguishable at that point.

**Deeper pages carry a bucketed date.** *Measured*: every row on page 4 read
„Heute, 04:35" and every row on page 50 read „15.08.2026". That is what the site
prints; it is not a parser artefact.

## Rate limit

No published limit. The adapter runs one connection per host with the gate's
2 s floor (no `Crawl-delay` for `*`), and `HttpClient` caps a run at 40 requests
per host. A `limit: 25` search costs 2 page requests plus one robots.txt —
*measured* end to end at 4.7 s for Quoka and 2.5 s for markt.de.

## Live check — measured 2026-08-21

| Query | Result |
|---|---|
| `nähmaschine`, limit 20 | 20 rows of 82, 1 request, 1 Partner-Anzeige |
| `nähmaschine`, `TROEDLER_MARKT_CATEGORY=haus-garten` | 20 rows of 39, 1 request, **0 Partner-Anzeigen**, all `private` |
| `fahrrad`, PLZ 30966, 25 km | 10 rows of 115, `applied: ['radius']`, distances 0/6/12/16/24 km |
| `qqzzxxwwvv123` | 0 rows, `totalEstimate: 0`, no error |
| provider disabled | `blocked-by-policy` before the search URL leaves |
