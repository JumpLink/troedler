# Partneranfrage an Kleinanzeigen — Entwurf

**Status: nicht abgeschickt.** Dieser Entwurf gehört Pascal Garber; abgeschickt wird er von seiner
Adresse, mit seinem Namen. Ergebnis danach hier eintragen (Datum, Antwort, Konsequenz), auch wenn
es eine Absage ist — eine dokumentierte Absage ist die Grundlage dafür, den Adapter dauerhaft
abgeschaltet zu lassen.

## Warum überhaupt

§ 5 Nr. 1 der Nutzungsbedingungen untersagt es, „ohne die ausdrückliche schriftliche Zustimmung von
Kleinanzeigen Crawler, Spider, Scraper oder andere automatisierte Mechanismen zu nutzen, um auf die
Kleinanzeigen-Dienste zuzugreifen und Inhalte zu sammeln". Die Klausel benennt damit selbst den
einzigen Weg, der aus einem Verstoß eine erlaubte Nutzung macht: **die schriftliche Zustimmung
einholen.** Alles andere — robots-konform bleiben, langsam abrufen, einen ehrlichen User-Agent
senden — senkt das Risiko, beseitigt den vertraglichen Punkt aber nicht.

## Einschätzung der Erfolgsaussicht: gering

Ehrlich vorweg, damit niemand die Antwort abwartet, bevor er weiterarbeitet:

- Alle **dokumentierten** Schnittstellen von Kleinanzeigen sind **Push** — Anzeigen *einstellen*
  (OpenImmo-Import für Immobilien, Drittanbieter wie AnzeigenChef als „offiziell genehmigte
  Schnittstelle"), gedacht für gewerbliche Einsteller mit Paketvertrag.
- Ein **lesender** Zugang ist genau einmal belegt vergeben worden: seit dem 25.02.2026 ist
  Kleinanzeigen mit „über 58 Millionen aktiven Anzeigen" direkt in ChatGPT verfügbar. Das ist eine
  Konzernpartnerschaft, kein Programm, für das man sich bewirbt.
- Ein öffentliches Partnerprogramm zum Lesen existiert nicht; es gibt keine Developer-Seite.

Die Anfrage kostet zehn Minuten. Sie ist trotzdem richtig: sie ist der einzige Schritt, der den
AGB-Punkt von „untersagt" auf „erlaubt" drehen kann, und eine schriftliche Absage ist selbst ein
verwertbares Ergebnis.

## Adressaten

- Historisch für API-Zugangsdaten: `api@ebay-kleinanzeigen.de` (Host tot, Adresse ungeprüft).
- Heute realistisch: Kontaktformular des PRO/Gewerblich-Bereichs bzw. die Presse-/Unternehmensseite
  unter `themen.kleinanzeigen.de`. **Vor dem Absenden die aktuell gültige Adresse dort nachsehen** —
  eine Anfrage an einen toten Verteiler ist keine Anfrage.

## Entwurf

> **Betreff:** Anfrage: schriftliche Zustimmung nach § 5 Nutzungsbedingungen für ein privates,
> lokal laufendes Suchwerkzeug
>
> Sehr geehrte Damen und Herren,
>
> ich entwickle ein quelloffenes Programm, mit dem eine Person mehrere Gebrauchtwaren-Marktplätze
> gleichzeitig durchsuchen kann, um ein bestimmtes Produkt zu finden. Das Programm läuft
> ausschließlich lokal auf dem Rechner der Nutzerin oder des Nutzers, mit deren eigener
> IP-Adresse, für deren eigene Suche. Es gibt keinen von mir betriebenen Dienst, keinen zentralen
> Crawler, keinen geteilten Index und keine Weitergabe der gefundenen Inhalte an Dritte.
>
> § 5 Ihrer Nutzungsbedingungen sieht für den automatisierten Zugriff eine ausdrückliche
> schriftliche Zustimmung vor. Genau darum bitte ich hiermit — und zwar bevor die Funktion
> ausgeliefert wird: in der aktuellen Fassung ist die Kleinanzeigen-Quelle in meinem Programm
> **abgeschaltet** und lässt sich auch nicht versehentlich aktivieren.
>
> Konkret bitte ich um eine der folgenden Möglichkeiten:
>
> 1. eine schriftliche Zustimmung zum lesenden Zugriff im unten beschriebenen Rahmen, oder
> 2. Zugangsdaten zu einer Partner-Schnittstelle, über die die Suche abgefragt werden kann, oder
> 3. die Auskunft, dass beides nicht vorgesehen ist — dann bleibt die Quelle dauerhaft
>    abgeschaltet, und ich halte das im Projekt nachvollziehbar fest.
>
> **Rahmen, den ich zusichern kann und der bereits im Programm durchgesetzt wird:**
>
> * Es werden nur öffentlich erreichbare Suchergebnis- und Anzeigenseiten gelesen. Die robots.txt
>   wird bei jedem Lauf ausgewertet und als Sperre behandelt, nicht als Empfehlung: gesperrte
>   Pfade — insbesondere Preis-, Umkreis-, Sortier- und Anbieterfilter sowie Ergebnisseiten ab
>   Seite sechs — werden gar nicht erst aufgerufen.
> * Höchstens eine Verbindung gleichzeitig und mindestens zwei Sekunden Abstand zwischen zwei
>   Anfragen; ein typischer Suchlauf sind wenige Seitenabrufe.
> * Ein wahrheitsgemäßer User-Agent mit Projektadresse, kein Browser-Spoofing.
> * Keine Anmeldung, keine Sitzungsverwaltung, kein Nutzerkonto.
> * Keine Umgehung technischer Schutzmaßnahmen. Antworten mit Status 403 oder 429 beenden den
>   Vorgang mit einer Fehlermeldung; es gibt keinen Wiederholungsversuch mit veränderter Anfrage.
> * Keine Speicherung personenbezogener Daten: weder Anbietername noch Profil; Telefonnummern und
>   E-Mail-Adressen werden bereits beim Auslesen verworfen. Bilder werden nur verlinkt, nie kopiert.
> * Kein Aufbau eines Bestandsabbildes: zwischengespeichert werden ausschließlich tatsächlich
>   gestellte Suchanfragen, kurz und zeitlich begrenzt.
>
> Über eine Rückmeldung würde ich mich freuen, auch über eine ablehnende. Für Rückfragen zur
> technischen Umsetzung stehe ich gern zur Verfügung; der Quellcode ist offen einsehbar.
>
> Mit freundlichen Grüßen
> Pascal Garber

## Nach der Antwort

| Antwort | Konsequenz im Code |
|---|---|
| Zustimmung erteilt | `SOURCES`-Eintrag auf `automatedAccess: 'permitted'`, Klausel durch das Aktenzeichen der Zustimmung ersetzen, `enabledByDefault` bleibt trotzdem `false` (die Zustimmung gilt für dieses Projekt, nicht für jeden Nutzer, der es installiert) |
| Partner-Zugangsdaten | Zweites Backend `partner-api` im selben Provider-Slot, HTML-Pfad entfällt |
| Absage | Bleibt wie jetzt: abgeschaltet, `note` um Datum und Ergebnis der Absage ergänzen |
| Keine Antwort binnen acht Wochen | Wie Absage behandeln und das Datum hier vermerken |
