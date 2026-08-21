# kleinanzeigen.de

| | |
|---|---|
| **Host** | `www.kleinanzeigen.de` |
| **Betreiber** | kleinanzeigen.de GmbH; Copyright Marktplaats B.V. (Adevinta-Konzern) |
| **Zugangsart** | HTML der öffentlichen Suchergebnis- und Anzeigenseiten. Keine API. |
| **Automatisierter Abruf laut AGB** | **untersagt** (§ 5 Nutzungsbedingungen) |
| **Standard im Programm** | **aus** — `enabledByDefault: false`, und es gibt keinen Codepfad, der das umdreht |
| **Zuletzt geprüft** | 2026-08-21 (robots.txt, Nutzungsbedingungen und Live-Abrufe an diesem Tag selbst gemessen) |
| **Registereintrag** | `packages/compliance/src/sources.ts`, `automatedAccess: 'forbidden'` |

Kurz und ohne Beschönigung: **es gibt für kleinanzeigen.de keinen legalen automatisierten
Suchzugang ohne schriftliche Zustimmung des Betreibers.** Weder robots-Konformität noch ein
ehrlicher User-Agent noch ein langsames Tempo ändern daran etwas — sie senken das Risiko und die
Belastung, aber der vertragliche Punkt bleibt. Wer diese Quelle einschaltet, trifft diese
Entscheidung selbst. Das Programm trifft sie für niemanden.

---

## 1. Es gibt keine öffentliche API

Keine Developer-Seite, kein Portal, keine Dokumentation.

Was es gibt, ist die alte Adevinta-„Belen"-Partnerschnittstelle. Der Host `api.kleinanzeigen.de`
lebt und antwortet auf jeden Pfad — auch auf erfundene — mit `HTTP 401` und
`www-authenticate: Digest realm="ebay-kleinanzeigen-api"` (selbst gemessen, 2026-08-21). Die
Zugangsdaten dafür stecken fest verdrahtet in den Mobil-Apps.

**Diese Schnittstelle wird nicht nachgebaut.** Zugangsdaten aus einer App zu extrahieren und damit
eine Authentifizierung zu passieren, ist die Umgehung einer Zugangssicherung; § 5 der
Nutzungsbedingungen untersagt das gesondert, und § 202a StGB steht im Raum. Der Punkt ist nicht
verhandelbar und auch nicht „später vielleicht".

Offiziell dokumentiert ist bei Kleinanzeigen ausschließlich der **Import** von Anzeigen
(OpenImmo-FTP für Immobilien, genehmigte Drittanbieter für gewerbliche Einsteller) — also Schreiben,
nicht Lesen. Ein lesender Zugang ist genau einmal belegt vergeben worden: seit dem 25.02.2026 ist
Kleinanzeigen direkt in ChatGPT verfügbar. Das ist eine Konzernpartnerschaft, kein Programm, für
das man sich bewirbt.

## 2. Die AGB-Klausel

**Fundstelle:** <https://themen.kleinanzeigen.de/nutzungsbedingungen/>, **§ 5 „Besondere Pflichten
des Nutzers", Nr. 1**. Abgerufen am 2026-08-21 (`HTTP 200`, 88 434 Bytes; die Seite trägt kein
„Stand"-Datum). `/agb/` gibt 404 — verbindlich ist `/nutzungsbedingungen/`.

Wörtlich, im Zusammenhang:

> „Der Nutzer ist verpflichtet, alle Handlungen zu unterlassen, die den sicheren Betrieb der
> Kleinanzeigen-Dienste gefährden oder andere Nutzer belästigen könnten oder die sonst über eine
> bestimmungsgemäße Nutzung der Kleinanzeigen-Dienste hinausgehen. Er ist insbesondere verpflichtet,
> es zu unterlassen, […]
>
> – die Infrastruktur der Kleinanzeigen-Dienste einer übermäßigen Belastung auszusetzen oder auf
> andere Weise das Funktionieren der Kleinanzeigen-Dienste zu stören oder zu gefährden,
>
> – **Inhalte von Kleinanzeigen ohne vorherige Einwilligung von Kleinanzeigen zu vervielfältigen,
> öffentlich zugänglich zu machen, zu verbreiten, zu bearbeiten oder sonst in einer Art und Weise zu
> nutzen, die über die bestimmungsgemäße Nutzung der Kleinanzeigen-Dienste hinausgeht,**
>
> – die Anzeigen oder sonstigen Inhalte Dritter ohne deren vorherige Einwilligung zu
> vervielfältigen, öffentlich zugänglich zu machen, zu verbreiten, zu bearbeiten […],
>
> – **ohne die ausdrückliche schriftliche Zustimmung von Kleinanzeigen Crawler, Spider, Scraper
> oder andere automatisierte Mechanismen zu nutzen, um auf die Kleinanzeigen-Dienste zuzugreifen
> und Inhalte zu sammeln,**
>
> – Informationen, insbesondere E-Mail-Adressen oder Rufnummern, über andere Nutzer ohne die
> vorherige Einwilligung der Nutzer zu sammeln bzw. zu verwenden,
>
> – **Maßnahmen zu umgehen, die dazu dienen, den Zugriff auf die Kleinanzeigen-Dienste zu
> verhindern oder einzuschränken.**"

Vier Feststellungen daraus, die den ganzen Adapter bestimmen:

1. **Scraping ist untersagt** — unabhängig von robots.txt, unabhängig vom Volumen, unabhängig
   davon, wie höflich es geschieht. Deshalb `enabledByDefault: false`.
2. **Bot-Erkennung zu umgehen ist gesondert untersagt.** Stealth-Browser, Fingerprint-Patches und
   Proxy-Rotation sind damit nicht der Grenzfall, sondern der ausdrücklich benannte Verstoß. Nichts
   davon existiert in diesem Projekt, und ein 403 beendet den Lauf, statt einen zweiten Versuch mit
   anderen Kopfzeilen zu starten.
3. **Die Weitergabe fremder Anzeigeninhalte an Dritte ist zusätzlich untersagt.** Eine gehostete
   Suche mit Kleinanzeigen-Treffern verletzt also auch dann etwas, wenn der Abruf erlaubt wäre.
   Troedler läuft lokal, und die Treffer dieser Quelle tragen einen entsprechenden Hinweis
   (`capabilities.disclaimer`).
4. **Fremde Rufnummern und E-Mail-Adressen zu sammeln, ist untersagt.** Deshalb werden sie beim
   Parsen verworfen (`stripContactDetails()`), nicht später gelöscht.

Sanktion: § 6 — Verwarnung, vorläufige oder dauerhafte Sperrung, Verbot der Neuregistrierung.
Deutsches Recht, Gerichtsstand für Verbraucher Potsdam (§ 15).

Eine weitere Klausel ist technisch verwertbar, § 1:

> „Bei der Standard-Sortierung werden ohne Eingabe eines Ortes die neuesten Anzeigen oben angezeigt
> (alternativ änderbar auf ‚Niedrigster Preis' und ‚Höchster Preis'). Die Anzeigen auf der
> Suchergebnisseite werden mit Eingabe eines Ortes auf den Ort bzw. den Radius eingegrenzt."

→ Ohne Ort ist die Reihenfolge „neueste zuerst". Deshalb meldet der Adapter `serverSorts: ['newest']`
genau dann, wenn **kein** Ort konfiguriert ist — und sonst nichts. Nachgemessen an einer
Live-Trefferliste: 25 Zeilen, Zeitstempel streng absteigend von 18:20 auf 18:19.

## 3. robots.txt

`https://www.kleinanzeigen.de/robots.txt`, 11 141 Bytes, zehn User-Agent-Blöcke, **kein
`Crawl-delay`, kein `Request-rate`**, ein `Sitemap:`-Eintrag. Der für uns geltende Block ist
`User-agent: *` mit 252 Regeln. `GPTBot`, `OAI-SearchBot`, `ChatGPT-User` und `PerplexityBot` haben
eigene, großzügigere Blöcke — das ist die robots-Seite des ChatGPT-Vertrags, keine allgemeine
Erlaubnis.

**Gesperrt ist praktisch jede Verfeinerung der Suche:**

```
Disallow: /api                    ← der komplette API-Namensraum
Disallow: /belen-gateway/*
Disallow: /*.json                 ← jede JSON-Antwort
Disallow: /s-suchanfrage.html     ← der Such-Submit-Endpunkt
Disallow: /s-feed.rss             ← der RSS-Feed existiert, ist aber zu
Disallow: /s-kategorie-baum.html  ← die Kategorieliste
Disallow: /search /SEARCH /HOME /BROWSE /VIP /PVIP /MVIP /EVIP /DVIP
Disallow: /*/preis:*              ← Preisfilter
Disallow: /*/sortierung:*         ← Sortierung
Disallow: /*/anbieter:*           ← privat / gewerblich
Disallow: /*versand:*             ← Versandfilter
Disallow: /*/s-anzeige:angebote   /*/s-anzeige:gesuche
Disallow: /*/k0*r1 … r200         ← ALLE Umkreissuchen
Disallow: /*/l*r1 … r200   /*/c*r1 … r200
Disallow: /*/seite:6* … /*/seite:59*
Disallow: /*?*view=karte
```

**Erlaubt bleibt genau das:**

| Form | Beispiel |
|---|---|
| Stichwortsuche | `/s-fahrrad/k0` |
| Stichwort in einer Kategorie | `/s-fahrraeder/rennrad/k0c217` |
| Stichwort an einem Ort (**ohne Umkreis**) | `/s-hamburg/fahrrad/k0l9409` |
| beides zusammen | `/s-fahrraeder/hamburg/fahrrad/k0c217l9409` |
| Seiten 2 bis 5 | `/s-seite:2/fahrrad/k0`, `/s-fahrraeder/seite:2/rennrad/k0c217` |
| Anzeigenseite | `/s-anzeige/<slug>/<adId>-<catId>-<locId>` |
| Sitemaps | `/sitemap_categories.xml`, `/sitemap_cities.xml`, … |

Alle Formen oben sind am 2026-08-21 selbst abgerufen worden und liefern `HTTP 200` mit vollständig
serverseitig gerendertem HTML; der jeweils zurückgegebene `link rel="canonical"` bestätigt, dass die
Seite die Anfrage so verstanden hat, wie sie gemeint war.

### Zwei Stellen, an denen robots.txt allein nicht reicht

Der Enforcer in `packages/compliance` setzt die Regeln nach Googles Matching durch — der Adapter
verlässt sich aber an zwei Punkten bewusst **nicht** darauf:

* **Seite ≥ 6.** `Disallow: /…/seite:6…` braucht einen Schrägstrich vor `seite:6`. Die
  Stichwort-Schreibweise `/s-seite:6/fahrrad/k0` hat den nicht — nachgemessen: der eigene Matcher
  erlaubt sie und sperrt gleichzeitig `/s-fahrraeder/seite:6/c217`. Sich darauf zu berufen wäre
  Wortklauberei gegen die erkennbare Absicht; die Website selbst verlinkt nur bis Seite 5. Die
  Kappe steht deshalb im URL-Bau (`MAX_PAGE = 5`), wo sich nicht mit ihr diskutieren lässt.
* **Der Suchbegriff selbst.** Er landet ungefiltert im Pfad. Wer nach `preis:100` sucht, baut
  `/s-preis:100/k0` — und auch das lässt der Matcher durch, aus demselben Grund. Deshalb ersetzt
  `keywordSlug()` alles, was kein Buchstabe und keine Ziffer ist, durch `-`: die gesperrten Tokens
  `:`, `+` und `/` sind aus einer Nutzereingabe schlicht nicht schreibbar.

## 4. Was das für die Filter bedeutet

Das ist die zentrale Konsequenz, und sie ist im Programm sichtbar statt weggeschwiegen:

| Filter | Serverseitig möglich? | Wer erledigt ihn |
|---|---|---|
| Stichwort | ja | Quelle |
| Kategorie | ja (`c<id>`) | Quelle, wenn konfiguriert |
| Ort ohne Umkreis | ja (`l<id>`) | Quelle, wenn konfiguriert |
| Preis von/bis | **nein**, `/*/preis:*` gesperrt | Kern, nach dem Abruf |
| Umkreis | **nein**, alle `…r<km>` gesperrt | niemand — offen als „unenforced" gemeldet |
| Sortierung | **nein**, `/*/sortierung:*` gesperrt | Kern |
| privat / gewerblich | **nein**, `/*/anbieter:*` gesperrt | Kern |
| Versand | **nein**, `/*versand:*` gesperrt | Kern |
| Angebote / Gesuche | **nein**, gesperrt | — |

Deshalb meldet der Adapter **`serverFilters: []`** — keinen einzigen. Das ist keine fehlende
Funktion, sondern die Wahrheit über diese Quelle, und `troedler search --explain` gibt sie weiter:
ein „höchstens 200 €" durchsucht hier die rund 125 gelieferten Zeilen, nicht die 900 000, die die
Seite zu haben behauptet.

**Obergrenze: 5 Seiten × 25 reguläre Anzeigen = 125 Treffer je Suche.** Mehr gibt die Quelle
robots-konform nicht her; `truncated` sagt das im Ergebnis.

## 5. Schutzmaßnahmen: Akamai Bot Manager

Kein Cloudflare — **Akamai**. Gemessen an `https://www.kleinanzeigen.de/`: die Antwort setzt
`_abck` und `bm_sz`, die beiden Cookies des Akamai Bot Managers; `api.kleinanzeigen.de` und
`gateway.kleinanzeigen.de` lösen beide auf `e74259.dsca.akamaiedge.net` auf. Der Login läuft über
Auth0 mit Captcha-Schritt, und aus fremden Projekten sind IP-Bereichssperren dokumentiert.

Akamai bewertet unter anderem den TLS-Fingerabdruck und eine per JavaScript erzeugte
Telemetrie-Nutzlast; stimmt sie nicht, wird das `_abck`-Cookie entwertet und jede Folgeanfrage
blockiert.

**Gemessen am 2026-08-21 mit dem ehrlichen User-Agent `troedler/0.1.0 (+…)`:**

| Abruf | Ergebnis |
|---|---|
| `/robots.txt` | `HTTP 200`, 11 141 Bytes, 357 ms |
| `/s-fahrrad/k0` | `HTTP 200`, 324 523 Bytes, 730 ms, 27 Anzeigen, kein Captcha |
| `/s-qxzvwlkjhgfdsayy/k0` (Unsinn) | `HTTP 200`, 111 889 Bytes, „Es wurden keine Ergebnisse …" |
| zwei Seiten hintereinander über den Adapter | `HTTP 200`, 50 Treffer, 2 Anfragen, 4,5 s |

Bei niedriger Rate greift der Bot Manager also derzeit nicht, auch nicht gegen einen
nicht-Browser-Agenten. **Das ist eine Momentaufnahme, keine Zusage** — und es ändert nichts an
Abschnitt 2. Wenn Akamai doch zuschlägt, ist die Antwort ein 403, und der HTTP-Client beendet den
Lauf mit einer Meldung, statt es erneut zu versuchen: ein 403 ist eine Entscheidung des Anbieters,
kein Schluckauf.

Die gefährlichste dokumentierte Ausprägung ist eine andere: **stille leere Ergebnisse statt eines
Fehlers.** Eine fremde Referenzimplementierung führt dafür eigens einen Changelog-Eintrag
(„silent empty results on pages 2+", Mai 2026). Ein Lauf meldet Erfolg und liefert nichts, und
niemand sieht nach. Dagegen gibt es hier einen Diskriminator, siehe Abschnitt 6.

## 6. Was der Adapter tut — und was nicht

**Er tut:**

* Baut ausschließlich die in Abschnitt 3 aufgeführten Formen, mit dem Stichwort als **letztem**
  Segment vor dem `k`-Token. Nachgemessen: `/s-fahrrad/hamburg/k0l9409` wird zu
  `/s-hamburg/hamburg/k0l9409` kanonisiert und antwortet mit 27 plausiblen Treffern für
  „Hamburg in Hamburg". Die falsche Reihenfolge scheitert nicht, sie lügt.
* Hört bei Seite 5 auf und meldet `truncated`, wenn mehr da wäre.
* **Wirft Top-Anzeigen weg.** Sie sind bezahlte Platzierungen und stehen auf *jeder* Seite einer
  Suche erneut (gemessen: 2 pro Seite, identisch auf Seite 1 und 2). Blieben sie drin, sähe der
  Nutzer dasselbe Fahrrad dreimal.
* **Unterscheidet „nichts gefunden" von „Markup kaputt".** Die Seite schreibt bei einer echten
  Nulltreffer-Suche „Es wurden keine Ergebnisse … gefunden." und liefert den Ergebniscontainer
  `#srchrslt-adtable` gar nicht erst mit. Fehlen Anzeigen **und** dieser Satz, ist das ein
  `ProviderError('parse-failed')` — keine leere Liste.
* Vergleicht die selbst gebaute Seiten-URL mit dem `link rel="next"` der Seite und warnt bei
  Abweichung, statt still die falsche Seite zu holen.
* **Unterscheidet „Anzeige gelöscht" von „Anzeigenseite umgebaut".** Gemessen: `/s-anzeige/1`
  antwortet mit `HTTP 200` und 334 934 Bytes **Startseite** — kein 404, kein
  `#srchrslt-adexpired`, nichts im Rumpf, das den Fall benennt. Nur die URL, auf der man landet,
  sagt es. Deshalb liest `getListing()` `res.url` und gibt `null` zurück, wenn der Pfad nicht mehr
  unter `/s-anzeige/` liegt; fehlt der Titel auf einer Seite, die *noch* eine Anzeigenseite ist,
  ist das ein `parse-failed`.
* Verwirft Telefonnummern und E-Mail-Adressen beim Parsen.
* Hält Ergebnisse nur im Speicher (`cache.memoryOnly: true`, TTL 300 s). Ein Abbild des Bestands auf
  der Platte wäre genau das „Vervielfältigen", das § 5 benennt.

**Er tut nicht:** kein Login, keine Sitzung, kein Cookie-Jar, kein Browser-User-Agent, kein
Headless-Browser, keine Proxy-Rotation, keine Wiederholung mit veränderten Kopfzeilen, kein
Captcha-Umgehen, kein Nachbau der Digest-API. Kein Verkäufername, keine Verkäufer-ID, kein Profil,
keine Bilddateien — nur Bild-URLs.

### Gemessener Feldbestand

Trefferliste (`/s-fahrrad/k0`, 2026-08-21):

| Feld | Selektor | Anmerkung |
|---|---|---|
| Anzeigen-ID | `article[data-adid]` | numerisch |
| URL | `article[data-href]` | relativ |
| Titel | `.text-module-begin > a` | |
| Beschreibung | JSON-LD `description`, sonst `.aditem-main--middle--description` | beides gekürzt |
| Preis | `.aditem-main--middle--price-shipping--price` | Text: `„3.550 € VB"`, `„Zu verschenken"`, `„VB"`, `""`. **Nicht** `p[class*="price"]` — das trifft auch den durchgestrichenen `--old-price` |
| PLZ + Ort | `.aditem-main--top--left` | enthält ein Zero-Width-Space im Ortsnamen |
| Datum | `.aditem-main--top--right` | `„Heute, 18:20"`, `„Gestern, 14:29"`, `„26.04.2026"`; bei Top-Anzeigen **leer** |
| Bild | JSON-LD `contentUrl` (`$_59.AUTO`), sonst `img[src]` (`$_2.AUTO`) | 27 von 27 Zeilen hatten ein auswertbares JSON-LD |
| Versand | `span.simpletag` mit Text „Versand möglich" | dasselbe Element trägt auch Kleidergrößen und „Direkt kaufen" |
| gewerblich | `.badge-hint-pro-small-srp` | 5 von 27 Zeilen |
| Top-Anzeige | `li.ad-listitem.is-topad` | |
| Trefferzahl | `.breadcrump-summary` | `„1 - 25 von 921.982 Ergebnissen …"` |
| nächste Seite | `link[rel="next"]` | nur bis Seite 5 |

Anzeigenseite: `#viewad-title`, `#viewad-price`, `#viewad-locality`, `#viewad-description-text`,
`#viewad-extra-info` (Datum), `#viewad-ad-id-box`, `#viewad-details li.addetailslist--detail`
(u. a. `Zustand`), `.boxedarticle--details--shipping` (`„Nur Abholung"` / `„Versand möglich"`),
`.userprofile-vip-details` (`„Privater Nutzer"` / `„Gewerblicher Nutzer"` — nur der **Typ**, nie
der Name), `#viewad-image`.

**Wichtig:** Auf der Anzeigenseite gibt es **kein** schema.org `Product` oder `Offer`, nur
`ImageObject` und einen `WebSite`-Block. Preis und Zustand müssen aus dem DOM.

### Kategorie- und Ortstabellen

`packages/kleinanzeigen/src/categories.ts` enthält alle **159** Kategorien aus
`sitemap_categories.xml`, einmal gezogen und eingecheckt. Nötig, weil `/s-kategorie-baum.html`
robots-gesperrt ist, die Sitemap aber nicht. **13 Slugs sind mehrdeutig** (`haus-garten` ist die
Oberkategorie 80 *und* die Dienstleistungs-Unterkategorie 291; `sonstige` gibt es dreimal) — die
Tabelle ist deshalb eine Liste und kein Objekt, und `resolveCategory()` meldet die Mehrdeutigkeit,
statt eine der Nummern zu raten.

**Orte sind bewusst nicht dabei.** `sitemap_cities.xml` hat 11 231 Einträge (780 KB) und schlüsselt
sie nach Slug, nicht nach Postleitzahl — `SearchQuery` liefert aber nur eine Postleitzahl. Die
Tabelle könnte die einzige Eingabe, die es gibt, also gar nicht auflösen. Wer seine Region festlegen
will, gibt Slug und ID direkt an: `TROEDLER_KLEINANZEIGEN_LOCATION=hamburg/9409`, nachzuschlagen in
`https://www.kleinanzeigen.de/sitemap_cities.xml`.

## 7. Einschalten

Die Quelle bleibt aus, bis **zwei** Dinge zutreffen: sie ist in der Konfiguration aktiviert *und*
der Nutzer hat bestätigt, dieses Dokument gelesen zu haben (`acknowledged`, siehe
`packages/store/src/config.ts`). Das ist kein Ritual — es ist der Unterschied zwischen einem
Programm, das einen AGB-Verstoß als Voreinstellung ausliefert, und einem, bei dem ein Mensch diese
Entscheidung wissentlich getroffen hat.

```
troedler providers show kleinanzeigen     # zeigt Klausel, Sperren und Folgen
troedler providers enable kleinanzeigen   # verlangt die Bestätigung
```

Optional danach:

```
TROEDLER_KLEINANZEIGEN_CATEGORY=fahrraeder     # Slug, c217 oder 217
TROEDLER_KLEINANZEIGEN_LOCATION=hamburg/9409   # <slug>/<id>, ohne Umkreis
```

## Partneranfrage

<!-- Diesen Abschnitt füllt die Hauptsession. Der Entwurf und die Konsequenzen je nach Antwort
     stehen in docs/quellen/kleinanzeigen-partneranfrage.md. Hier gehört hinein: Absendedatum,
     Adressat, Antwort (auch eine Absage) und was daraus im Code folgt. -->

Status: **noch nicht abgeschickt.** Entwurf, Adressaten und die Konsequenzen je nach Antwort:
[kleinanzeigen-partneranfrage.md](kleinanzeigen-partneranfrage.md).

Die Klausel in § 5 benennt selbst den einzigen Weg, der aus einem Verstoß eine erlaubte Nutzung
macht — die ausdrückliche schriftliche Zustimmung. Solange die nicht vorliegt, bleibt dieser Adapter
das, was er heute ist: abgeschaltet, dokumentiert, und bereit für den Fall, dass die Antwort ja
lautet.

---

## Quellen

* Nutzungsbedingungen § 1, § 5, § 6, § 15 — <https://themen.kleinanzeigen.de/nutzungsbedingungen/> (2026-08-21)
* robots.txt — <https://www.kleinanzeigen.de/robots.txt> (2026-08-21, 11 141 Bytes)
* Sitemap-Index — <https://www.kleinanzeigen.de/sitemap_index.xml>
* Pressemitteilung „Kleinanzeigen jetzt direkt in ChatGPT nutzen", 25.02.2026 — <https://themen.kleinanzeigen.de/medien/pressemitteilungen/smarter-suchen-einfacher-finden-kleinanzeigen-jetzt-direkt-in-chatgpt-nutzen/>
* Schnittstellen für gewerbliche Einsteller (nur Import) — <https://hilfe-gewerblich.kleinanzeigen.de/artikel/schnittstellen>
* Eigene Live-Messungen am 2026-08-21: robots.txt, Suchergebnisseiten in allen erlaubten Formen, Nulltreffer-Seite, Anzeigenseite, Digest-Probe gegen `api.kleinanzeigen.de`
