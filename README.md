# troedler

Search several second-hand marketplaces with one query — from your own machine, at your own pace,
under your own name.

A trödler works the markets, sifting other people's goods for the one thing worth having. This does
that across eBay, classified-ad sites, public-authority auctions and collector marketplaces at
once, and tells you where a thing is cheap and where it is not.

It is a **command-line tool, a native GNOME/Adwaita app and an MCP server**, so you can use it from
a shell, from a window, or from an AI assistant. All three render the same results through the same
kernel. It runs on [GJS](https://gjs.guide/) via [gjsify](https://github.com/gjsify/gjsify) —
TypeScript, no Node runtime required.

```console
$ troedler search Bandsäge --max-price 400 --seller private --explain

eBay (18)
  1. Metabo BAS 318 Bandsäge — gebraucht, funktionsfähig
     289,00 € inkl. Versand  Gebraucht — sehr gut · privat · Versand · 21762 Otterndorf · vor 2 d · unter dem Feld
     https://www.ebay.de/itm/…
     Preisband über 18 Forderungspreise inkl. Versand: 95,00 € … 240,00 € — 315,00 € — 420,00 € … 890,00 €

Zoll-Auktion (5)
  1. 1 Bandsäge Metabo, gebraucht
     150,00 € Auktion  Zustand unbekannt · gewerblich · Abholung · 60326 Frankfurt am Main · endet in 1 h · 17 Gebot(e)
     https://www.zoll-auktion.de/auktion/produkt/…
     Preisband über 5 aktuelle Gebote: 13,00 € … 41,00 € — 65,00 € — 150,00 € … 310,00 €

eBay: 18 Treffer
    Filter beim Anbieter: maxPrice, sellerType
    Filter hier nachgezogen: —
Kleinanzeigen: übersprungen — Nutzungsbedingungen untersagen automatisierten Abruf, siehe docs/quellen/kleinanzeigen.de.md
Zoll-Auktion: 5 Treffer (7 weitere passten und fielen dem Limit zum Opfer)
```

One band **per source**, and it names what its numbers are. A current auction bid, a seller's
asking price and "cheapest of 191 copies worldwide" are three different kinds of number, and a
single band across them computes exact quartiles over nonsense.

## What it does

- **One query, every marketplace.** Results stay grouped by source, so you can see that a thing
  costs 40 € on one and 120 € on another — which is the answer you actually wanted.
- **The same thing, side by side.** `--compare` groups the results by product across sources, over
  the barcode where there is one. A group whose rows one source keeps apart — one barcode, three
  pressings — is shown as such and gets no single price, because it does not have one.
- **Is this a good price?** A median and a quartile band over what is currently on offer, and a
  coarse verdict per listing. One band per source, over one kind of number, and it says what it
  left out. It describes the field in front of you; it does not appraise.
- **One offer, read-only.** `troedler show <quelle>:<id>` fetches a single listing in full without
  touching the local store.
- **Saved searches with alerts.** `troedler watch run` reports only what is new since last time.
- **Watch single offers.** Price changes and "it's gone" for the things you are still thinking
  about.
- **An MCP server**, so an assistant can search on your behalf — and can see *why* a source
  returned nothing, instead of concluding the item does not exist.

## What it will not do

This matters more than the feature list, because it shapes everything else.

troedler runs **locally, for one person, and never as a service**. There is no hosted crawler, no
shared index, no server mode. It reads only what a site's `robots.txt` permits, at one request at a
time with a pause between them, under an honest user agent that says who it is and where to
complain. It never logs in, never spoofs a browser, never works around a captcha or a bot wall, and
never retries a refusal. When a marketplace says no, that is the answer.

Marketplaces whose terms forbid automated access ship **switched off**. troedler still offers them —
it just will not fetch one for you until you say so: `providers enable` prints the operator's clause
in full and refuses without `--acknowledge`.

**Who carries that is you.** troedler is a non-commercial tool that runs on your machine, under your
address, for your own search. The terms of a service bind the person using it, so switching a source
on means requesting it in your own name and answering for it yourself. The software neither makes
that call nor hides what it is: it ships the source off, quotes the sentence you would be going
against, records the date you agreed, and then stays out of the way. Even switched on, it keeps
every other limit — robots.txt, the pace, the honest user agent, no login, no circumvention.

Nothing about a seller is stored — no names, no ids, no profiles. Phone numbers and e-mail
addresses are stripped from listing text while parsing. Images are linked, never downloaded.

## Sources

Every source has a record under [`docs/quellen/`](docs/quellen/) with its `robots.txt` findings,
the relevant terms clause, and the date a human last checked. `troedler terms` prints the summary
and `troedler robots <url>` answers whether troedler would fetch a given URL and what decides it —
the opt-out list, the switch, robots.txt, or, on an official API, the operator's licence. It reports
the program that runs, so it makes exactly the requests a real search would make and no others.

| Source | Access | Default | Notes |
|---|---|---|---|
| eBay (DE) | official Browse API | on | Free developer keys. Listing data cached ≤6 h by licence. |
| Discogs | official API | on | Works without a token (25 requests/min; 60 with one). |
| Booklooker | official API | on | Free API key. |
| Zoll-Auktion, Justiz-Auktion | public HTML | on | German public-authority auctions; `robots.txt` fully open. |
| Quoka | public HTML | on | `robots.txt` open, terms silent on crawling. |
| markt.de | public HTML | **off** | Open `robots.txt`, but the terms forbid automated access. |
| kleinanzeigen.de | public HTML | **off** | Terms forbid automated access; `robots.txt` also blocks the price, radius, sort and seller filters. |

## Getting started

```bash
gjsify install                              # never npm install — see AGENTS.md
gjsify workspace troedler-cli build         # the CLI and the app
gjsify run app/dist/troedler.gjs.mjs check  # what is configured, what is not
```

Credentials go in `.env` (copy `.env.example`) or your shell. Every one is optional: a source
without its key reports itself unconfigured and is skipped — it never fails a search quietly.

The window:

```bash
gjsify workspace troedler-cli start:app
```

Two screens. **Suche** lays out one panel per source *before* asking any of them and settles each
in place, so a result never appears without the account of where it came from — and a source that
was skipped, refused or broke never looks like a source with nothing to offer. **Quellen** lists
every source with its switch; turning on one whose terms forbid automated access puts the
operator's clause on screen and asks, because that is a decision for a person and the date lands in
the config.

It is a separate bundle from the CLI on purpose: `troedler search` in a terminal has no business
loading GTK.

As an MCP server, point your client at:

```json
{
  "command": "…/node_modules/.bin/gjsify",
  "args": ["run", "…/app/dist/troedler.gjs.mjs", "mcp"],
  "cwd": "…/app"
}
```

Tools are read-only unless `TROEDLER_MCP_ALLOW_WRITE=1` is set, and the server enforces that by
dropping any tool that does not declare itself read-only.

## Where things are kept

Nothing is ever written inside this repository.

| | |
|---|---|
| `$XDG_CONFIG_HOME/troedler/config.json` | which sources are on, your defaults |
| `$XDG_DATA_HOME/troedler/index.db` | saved searches, seen offers, price history |
| `$XDG_CACHE_HOME/troedler/` | HTTP cache, TTL-bound per source |

`troedler cache purge` clears the local record; `troedler config path` prints where everything is.

## Contributing, and objecting

If you operate one of these sites and would rather troedler did not read it, open an issue or write
to the address in the user agent — the host goes on the opt-out list and out of the next release.
No argument, no delay.

Licence: MIT. Part of the [werkstatt](https://github.com/JumpLink) workspace, alongside
[postbote](https://github.com/JumpLink/postbote) and
[bauplaner](https://github.com/JumpLink/bauplaner).
