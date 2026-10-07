# Leitplanken — the hard rules and why they exist

Extracted verbatim from `AGENTS.md`, which keeps only the one-line form of each rule. The rules
themselves are load-bearing: each one is the reason some part of the code looks the way it does, and
removing one silently changes what this project **is**. The reasoning behind them is what this file
carries, so that a future change to the code has to argue with the reason and not just with a line of
prose.

|**Local, per user, never central.** No hosted crawler, no shared index, no server endpoint, no
pooling of other people's searches. That is the line between local multi-marketplace software
(BGH I ZR 159/10, permitted) and a hosted meta-search engine (CJEU C-202/12 *Innoweb*,
prohibited). It is why the MCP server speaks stdio and there is no HTTP transport.
|**An official API beats HTML, always.** Where a marketplace offers one, the HTML path is not
implemented at all — not as a fallback, not "for later".
|**robots.txt is a gate, not a hint.** Parsed per host, cached, checked before every request in
`@troedler/http`. Crawl-delay honoured, otherwise ≥2 s and one connection per host. Never build a
URL the gate would refuse: a disallowed filter path is not a feature that unfortunately blocks, it
is the thing the operator forbade.
|**Never logged in.** No cookie jar, no session handling, no account. Without registration there
is no contract of use to breach; with a login, every clause applies.
|**Never circumvent.** No browser user-agent spoofing, no captcha/Cloudflare/Akamai/TLS-fingerprint
bypass, no proxy rotation, no retry with altered headers. **403 and 429 end the attempt with a
plain-language error.** A refusal is a decision, not a hiccup.
|**Never reverse-engineered credentials.** No tokens or keys extracted from apps or binaries, no
private endpoints behind auth. This is the one line here with criminal exposure (§ 202a StGB,
Modern-Solution line of cases through BVerfG 2025) and it is not close to the edge.
|**Cache is query-scoped TTL, never a mirror.** Only queries a user actually made. No paging
through a catalogue, no building a local picture of a market. eBay listing data: ≤6 h by licence.
|**Personal data is filtered while parsing, not cleaned up later.** No seller names or ids, no
profiles, no histories; phone numbers and e-mail addresses stripped from free text at the parser.
|**Images are fetched to be SHOWN, and never kept.** This rule was the opposite until 2026-09-06
— „images are URLs, never downloaded" — and it was changed deliberately, because a window that
lists second-hand goods without their photographs is not usable for the thing it is for. What
replaced it is narrower than a browser and not a loophole: the fetch runs through the SAME gate
(`HttpClient.image`), so an opt-out host, a switched-off source and a `Disallow:` on the image
path refuse there exactly as they do for a search; the operator's `Crawl-delay` is honoured and
only OUR politeness floor is dropped, because a thumbnail beside a row somebody is already reading
is not a crawl; the bytes go to a widget and are **never written to disk, never rehosted, never
redistributed**; a response that is not an image is a refusal rather than something to pass on.
`packages/http/src/client.ts` carries the reasoning, `app/tests/unit/compliance/image.test.ts`
the measurement — including the discriminator that a plain `get` on the same host still waits the
floor, so the exemption is about the KIND of request and not about the host.
|**Honest user agent**, `troedler/<version> (+repo-url)`, with a reachable contact. No spoofing.
It is also how an operator who objects can reach us at all.
|**`OPT_OUT_HOSTS` in `@troedler/compliance` is binding.** A host that objects is refused by the
gate and removed in the next release.
|**A new source means a source record first.** `docs/quellen/<host>.md` — robots.txt findings,
the terms clause quoted, whether an API exists, bot protection, date checked — then an entry in
`SOURCES`, then the adapter. No adapter without one.
|**Fixtures are synthetic.** Never commit a real listing, page capture, or database. Measure
against live pages locally; commit only HTML you wrote yourself.


Sources whose terms forbid automated access ship **off**. They are still OFFERED — this project
does not decide for anybody what they may fetch from their own machine — but `providers enable`
prints the operator's clause in full and refuses without `--acknowledge`, and the date lands in the
config.

That split is the point and must not be "simplified" away in either direction. **The request
violates the terms, not the program**: troedler is non-commercial, runs locally, and never fetches
such a source on its own initiative, so a user switching one on does it in their own name and
carries it. Removing the refusal would make the project ship the decision as a default; removing
the source would make it decide for the user instead. Neither is ours to do.

No permission is sought from any operator, and none is implied. What the project offers instead is
accuracy: the clause quoted, robots.txt still enforced even where the terms are not, the pace kept,
and an agent string that says what it is.
