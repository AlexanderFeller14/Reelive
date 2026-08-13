# Reelive Phase 6 — Teilen, Export & Store-Readiness: Design-Spezifikation

**Datum:** 2026-08-08
**Status:** Abgenommen (im Alleingang entschieden — siehe §2)
**Basis:** [Produkt-Spec](2026-08-03-reelive-design.md) · [Roadmap](../plans/2026-08-03-reelive-v1-roadmap.md) ·
[Phase 5](2026-08-08-phase-5-reveal-recap-design.md) · `DESIGN-LANGUAGE.md` (verbindlich für alle UI)

## 1. Ziel & Deliverable

Die letzte Phase vor dem Launch. Der Recap verlässt zum ersten Mal die Gruppe:
Aussenstehende können ihn über einen widerrufbaren Link anschauen, Mitglieder ihre Medien in
die eigene Galerie holen. Dazu kommt, was die Stores verlangen — Melden, Moderation,
Account-Löschung — und die Infrastruktur, um überhaupt einen Build abzugeben.

**Deliverable (Roadmap):** Einreichbare Builds für App Store und Play Store.

## 2. Wie diese Spec entstanden ist, und wo sie ehrlich aufhört

Der Auftraggeber hat die Umsetzung bis Phase 6 vollständig delegiert. Es gab keine
Brainstorming-Session; alle Entscheide in §3 sind von mir getroffen und begründet.

**Und hier liegt eine harte Grenze, die keine Entscheidung auflösen kann.** Ein grosser Teil
dieser Phase hängt an Konten und Zugangsdaten, die nur der Auftraggeber hat:

| Braucht ein fremdes Konto | Warum |
|---|---|
| EAS Build & Submit | Expo-Konto, Apple Developer Program (99 $/Jahr), Google Play Console (25 $) |
| TestFlight / Internal Testing | dieselben Konten, plus Bankdaten und Steuerangaben |
| Echtes Cloudflare R2 | R2-Zugangsdaten, Bucket, Domain |
| Sentry | Projekt und DSN |
| Store-Assets (Screenshots) | Screenshots eines laufenden Builds auf echten Geräten |
| Privacy Policy unter einer URL | eine Domain und die Entscheidung, wer der Verantwortliche ist |

**Was diese Phase deshalb liefert:** alles bis unmittelbar vor diese Grenze. Der Code ist
fertig, konfiguriert und getestet; es fehlen die Zugangsdaten und der Knopfdruck. Wo eine
Konfigurationsdatei ohne Konto nicht sinnvoll auszufüllen ist, entsteht eine Vorlage mit
Kommentaren, die genau sagt, was einzutragen ist — dasselbe Muster wie
`supabase/functions/.env.example`, das sich in Phase 4 bewährt hat.

**Was ausdrücklich nicht Teil dieser Phase ist:** die Verifikation am echten Gerät. Sie steht
seit Phase 4 aus und lässt sich hier nicht nachholen — im Simulator kommen keine Klicks an,
und Phase 4 braucht ausserdem eine Kamera. §10 hält fest, was dabei zu prüfen ist.

## 3. Rahmenentscheide

| Entscheid | Wahl | Begründung |
|---|---|---|
| Token-Auflösung | **Eigene Edge Function `share-link`, Aktion `aufloesen` ohne JWT** | Der Kommentar in `20260803090500_social_rls.sql:35-37` hat es so vorgesehen: die Auflösung läuft nie über die Tabelle, sondern über Service-Role. Das ist der **zweite** Leseweg auf Medien und muss so hart sein wie der erste |
| Web-Player | **Derselbe Expo-Router-Baum, per Plattform-Shim web-fähig gemacht** | Das Root-Layout zieht heute `expo-sqlite`, `expo-secure-store` und `expo-notifications` beim Start — ein Web-Build startet gar nicht. Drei `.web.ts`-Dateien lösen das; eine zweite App wäre ein zweites Produkt |
| Umfang des Web-Players | **Nur Anschauen. Keine Reaktionen, keine Kommentare, kein Login** | Konzept §5.9: «schreibgeschützter Web-Player». Alles andere bräuchte Auth im Web und verdoppelt die Angriffsfläche |
| Export | **`expo-media-library`, einzelner Moment und «alle sichern»** | Das Paket ist der einzige unterstützte Weg in die Galerie |
| Melden | **Sheet aus dem Player, Owner sieht die Meldungen im Reise-Detail** | Tabelle und Policies stehen seit Phase 1; es fehlt nur die UI. Store-Pflicht |
| Moderation | **Owner löscht einen Moment aus dem Player** | `posts_delete_after_reveal` erlaubt es dem Owner bereits — im Client gibt es dafür bis heute keine Stelle |
| Account-Löschung | **Edge Function `konto-loeschen`, Service-Role** | Muss Auth-Nutzer, Profil, Speicherobjekte **und** die `on delete restrict`-Sperre auf eigenen Reisen auflösen. Der Client kann nichts davon |
| Eigene Reisen bei der Löschung | **Werden mitgelöscht, samt Medien aller Mitglieder** | Die Alternative wäre, die Reise an ein anderes Mitglied zu übertragen — das ist eine Produktentscheidung mit sozialer Sprengkraft und gehört nicht in eine Löschroutine. Der Dialog sagt es klar und nennt die Zahl |
| Sentry | **Code fertig, DSN aus der Umgebung, ohne DSN ein No-Op** | Genau wie Push in Phase 5: ohne Konto darf nichts kaputtgehen und nichts auffallen |
| R2 | **Bleibt lokal, aber der Wechsel wird auf eine Umgebungsdatei reduziert und dokumentiert** | Der Code spricht seit Phase 4 S3; es wechseln Endpoint und Zugangsdaten. Ohne Konto ist mehr nicht prüfbar |
| `expo-blur` | **Wird installiert, die Pillen bekommen ihren Blur** | Seit Phase 4 offen, DESIGN-LANGUAGE §1 verlangt ihn wörtlich. Niemand hat ihn je zugeteilt bekommen — das ist genau die Sorte Lücke, die diese Phase schliessen soll |

## 4. Die Versprechen dieser Phase

Wie in Phase 5, und mit der dort gelernten Verschärfung: **jede Zeile nennt die Datei, in der
die Zusicherung gehalten wird.** «Task X deckt das ab» hat sich als nicht prüfbar erwiesen.

| # | Versprechen | Wo es brechen kann |
|---|---|---|
| W1 | Ein Share-Link zeigt **nur** die Reise, zu der er gehört — nie eine andere | `share-link`/`aufloesen` |
| W2 | Ein widerrufener oder abgelaufener Link zeigt gar nichts mehr | dieselbe Aktion |
| W3 | Ein Share-Link auf eine **nicht** aufgedeckte Reise existiert nicht und funktioniert nicht | Erstellung **und** Auflösung |
| W4 | Der Web-Player kann nichts schreiben — keine Reaktion, kein Kommentar, kein Beitritt | Web-Bundle |
| W5 | Wer den Link hat, braucht kein Konto; wer kein Konto hat, kommt an nichts anderes | Guard und Bundle |
| W6 | Ein gelöschtes Konto hinterlässt keine Zeile und kein Objekt im Speicher | `konto-loeschen` |
| W7 | Eine Löschung, die mittendrin scheitert, hinterlässt keinen halben Zustand | dieselbe Function |
| W8 | Ein gemeldeter Moment erreicht die Owner-Person, und sie kann ihn entfernen | Melde-UI und Moderation |
| W9 | Der Export schreibt genau das, was man sieht — und sagt, wenn er es nicht darf | Export-Pfad |
| W10 | Ohne Sentry-DSN verhält sich die App exakt wie heute | Sentry-Anbindung |

## 5. Teilen

### 5.1 Die Edge Function `share-link`

Drei Aktionen, und die dritte ist die heikelste des ganzen Projekts.

**`erstellen`** (JWT, Owner): legt eine Zeile in `share_links` an. Nur für eine Reise mit
`status = 'revealed'` — die Policy verlangt das ohnehin, die Function prüft es trotzdem selbst,
weil sie mit Service-Role arbeitet und die Policy dann nicht greift. Optionales Ablaufdatum.
Antwort: der Token und die fertige URL.

**`widerrufen`** (JWT, Owner): setzt `revoked = true`. Kein Löschen — ein widerrufener Link
soll unterscheidbar bleiben von einem, den es nie gab, damit ein Support-Fall beantwortbar ist.

**`aufloesen`** (**ohne JWT**): nimmt einen Token und gibt zurück, was ein Aussenstehender sehen
darf. Prüft in dieser Reihenfolge:

1. Token existiert. Sonst 404 — und zwar mit **demselben** Text und **derselben** Antwortzeit
   wie ein widerrufener oder abgelaufener Token. Sonst wird die Function zum Orakel, an dem man
   gültige Token erraten kann.
2. `revoked = false` und (`expires_at is null` oder in der Zukunft).
3. Die Reise ist `revealed` oder `archived`. Ein Link auf eine wieder versiegelte Reise — den
   Zustand gibt es heute nicht, aber die Prüfung kostet nichts — zeigt nichts.

Erst dann liest sie Reise, Momente (`upload_status = 'uploaded'`) und Profile, leitet die
Schlüssel **selbst** her (wie `media-urls`, nie aus `storage_key`) und gibt presignte GET-URLs
zurück. Gültigkeit **eine Stunde**, wie beim Mitglieder-Leseweg.

**Was `aufloesen` nicht zurückgibt:** Reaktionen, Kommentare, Mitgliederliste, Einladungscode.
Der Autorenname ja — er steht im Recap ohnehin auf jedem Moment.

> **Nachtrag 2026-08-12 (Profilbild):** `author_id` stand bis dahin auch auf dieser Liste.
> Seit dem Profilbild-Feature enthält die Antwort `autor_avatar_key`, und der Schlüssel
> lautet `profiles/<author_id>/<32 hex>.jpg` — die Auth-UUID der Autorin steht damit in der
> anonymen Antwort, wenn sie ein Profilbild hat. Bewusst akzeptiert statt umgangen: die UUID
> gewährt für sich genommen keinerlei Zugriff (`profiles`-RLS verlangt gemeinsame
> Mitgliedschaft, `select` auf `storage.objects` verlangt `authenticated`, und kein anonymer
> Endpunkt nimmt eine rohe uid entgegen). Wer den Link hat, kann daraus einzig ablesen, dass
> zwei geteilte Recaps dieselbe Autorin haben — und den Autorennamen zeigt die Antwort
> ohnehin. Die Alternative wäre ein zweiter, umgeschriebener Schlüsselnamensraum allein für
> den geteilten Weg gewesen: mehr bewegliche Teile und ein zweiter URL-Bauplan neben
> `avatarUrl()`, gegen einen Gewinn, den es nicht gibt.

**Ratenbegrenzung:** Der Endpunkt ist öffentlich und nimmt einen 32-stelligen Hex-Token. Der
Raum ist gross genug, dass Raten sinnlos ist; eine Begrenzung baue ich trotzdem nicht selbst,
sondern halte fest, dass sie beim ersten echten Deployment über Supabase/Cloudflare gehört.

### 5.2 Der Web-Player

Route `/teilen/[token]`, öffentlich (wie `join`), im Guard entsprechend eingetragen.

Er zeigt dieselbe Story wie der Recap-Player: Kino-Palette, Fortschrittsbalken, Tages-Trenner,
Autor, Zeit, Ort, Caption. **Ohne** Emoji-Leiste, **ohne** Kommentare, **ohne** Melden.
Stattdessen unten dezent: der Reelive-Wortzug und «Hol dir die App» (Konzept §5.9).

Damit das Web-Bundle überhaupt startet, bekommen drei Module eine Web-Fassung:

| Modul | Web-Fassung |
|---|---|
| `queueDb` (`expo-sqlite`) | eine In-Memory-Fassung, die dieselbe Schnittstelle erfüllt und leer bleibt |
| `secureSessionStorage` (`expo-secure-store`) | im Web gibt es keine sichere Ablage — die Fassung speichert **nichts** und liest **nichts**. Das ist kein Mangel, sondern W5: im Web soll es gar keine Session geben |
| `pushApi` (`expo-notifications`) | gibt `'nicht-unterstuetzt'` zurück, wie auf dem Simulator |

**W4 wird nicht durch Weglassen erreicht, sondern durch das Bundle:** der Web-Player rendert
keine schreibende Komponente, und ohne Session hat er ohnehin kein JWT. Zusätzlich prüft ein
Test, dass die Web-Fassung des Sitzungsspeichers nichts behält.

### 5.3 Teilen in der App

Im Recap, für die Owner-Person: «Recap teilen» → Sheet mit dem Link, einem Kopieren-Knopf, dem
System-Teilen-Dialog und — falls schon einer existiert — «Link deaktivieren». Ablaufdatum als
optionale Auswahl (7 Tage, 30 Tage, unbegrenzt).

## 6. Export in die Galerie

Aus dem Player und aus der Übersicht: «In Galerie sichern» für den aktuellen Moment, und
«Alle sichern» für die ganze Reise.

Ohne Berechtigung: ein erklärender Hinweis mit Weg in die Einstellungen — nie ein stiller
Fehlschlag. Beim Sichern aller Momente ein Fortschritt («7 von 23»), abbrechbar, und am Ende
eine ehrliche Bilanz, wenn etwas fehlgeschlagen ist.

Gesichert wird **das Medium in voller Auflösung**, nicht das Thumbnail — über dieselben
signierten Lese-URLs, die der Player schon hat.

## 7. Melden und Moderation

**Melden:** langes Tippen auf einen Moment im Recap-Player → Sheet «Diesen Moment melden» mit
einer kurzen Begründung (Pflichtfeld, 1–500 Zeichen wie die Datenbank). Danach eine Bestätigung.
Der Moment bleibt sichtbar — Melden ist kein Verstecken.

**Moderation:** Die Owner-Person sieht im Reise-Detail eine Zeile «2 gemeldete Momente», die in
eine Liste führt: Vorschaubild, Grund, Zeitpunkt. Zwei Aktionen je Meldung — «Moment entfernen»
(löscht den Moment; `posts_delete_after_reveal` erlaubt es dem Owner bereits) und «Meldung
verwerfen».

**Eine Lücke, die dabei auffällt:** `reports` hat kein `update` und kein `delete` für
`authenticated`. «Meldung verwerfen» braucht eines von beidem. Ich entscheide mich für eine
Spalte `erledigt_am timestamptz` und ein Update-Grant nur darauf, nur für die Owner-Person —
eine gelöschte Meldung wäre für eine spätere Rechenschaft wertlos.

## 8. Account-Löschung

Im Profil, unter allem anderen, in `danger`: «Konto löschen».

**Der Dialog muss die Wahrheit sagen**, und die ist unbequem: Wer eigene Reisen hat, löscht sie
mit — samt der Momente **aller** Mitglieder. Der Dialog nennt die Zahlen («3 Reisen mit
insgesamt 128 Momenten von 5 Personen») und verlangt eine bewusste Bestätigung.

Die Alternative — die Reise an ein anderes Mitglied übertragen — ist eine Produktentscheidung
mit sozialer Sprengkraft (wer erbt? was, wenn niemand will?) und gehört nicht in eine
Löschroutine. §11 hält sie als offenen Punkt fest.

**Die Edge Function `konto-loeschen`** (JWT, nur das eigene Konto) arbeitet in dieser
Reihenfolge, und die Reihenfolge ist der Kern von W7:

1. Erst **ermitteln**, was alles wegmuss: eigene Reisen, deren Momente, die eigenen Momente in
   fremden Reisen, das Avatar-Objekt.
2. Dann die **Speicherobjekte** löschen. Ein Objekt ohne Datenbankzeile ist Müll; eine
   Datenbankzeile ohne Objekt ist ein kaputter Recap. Also die Objekte zuerst.
3. Dann die **eigenen Reisen** löschen — die Kaskaden räumen Momente, Mitgliedschaften,
   Reaktionen, Kommentare und Meldungen mit.
4. Dann den **Auth-Nutzer** löschen — die Kaskade auf `profiles` räumt den Rest.

Scheitert Schritt 2 teilweise, bricht die Function **ab**, bevor sie etwas in der Datenbank
anfasst, und meldet es. Ein Konto, das noch existiert, ist besser als eines, dessen Medien
verwaist im Speicher liegen.

## 9. Store-Vorbereitung

**`app.json`:** `ios.bundleIdentifier`, `android.package`, Berechtigungstexte für Fotobibliothek
und Benachrichtigungen, `ios.associatedDomains` und `android.intentFilters` als kommentierte
Vorlage für die spätere Domain.

**`eas.json`:** drei Profile — `development` (Dev-Build mit Dev-Client), `preview` (interne
Verteilung), `production` (Store). Ohne Konto nicht ausführbar; die Datei sagt in Kommentaren,
was fehlt.

**Sentry:** `@sentry/react-native` in der App, `Sentry.init` nur bei gesetztem
`EXPO_PUBLIC_SENTRY_DSN`. In den Edge Functions ein schlanker Fehler-Melder über `fetch`, ohne
Paket — ein npm-Import in Deno für zwei Zeilen wäre unverhältnismässig.

**Privacy Policy:** ein Entwurf in `docs/` mit den Feldern, die der Auftraggeber ausfüllen muss
(Verantwortlicher, Kontakt, Domain). Sie beschreibt wahrheitsgemäss, was die App erhebt:
Telefonnummer, Profil, Momente samt Ort und Zeit, Push-Token — und was sie **nicht** tut.

**Ein Punkt, der offen bleiben muss:** Die Datenschutzerklärung nennt heute Supabase (Frankfurt)
und Cloudflare R2 als Auftragsverarbeiter. Ohne echte Verträge ist das eine Absichtserklärung.
Der Entwurf markiert die Stelle.

## 10. Testing

- **pgTAP:** `share_links` — Erstellen nur durch Owner und nur bei `revealed`; Fremde sehen
  nichts; `reports.erledigt_am` nur durch die Owner-Person, keine andere Spalte schreibbar.
- **Deno:** die Prüfkette von `aufloesen` als reine Funktion, Docker-frei — **kein
  `ignore: !stackBereit`.** Das war der schwerste Befund von Phase 5 und darf sich nicht
  wiederholen. Dasselbe für die Reihenfolge in `konto-loeschen`.
- **Jest:** die Web-Fassungen der drei Module (insbesondere: der Sitzungsspeicher behält
  nichts); der Export-Pfad inklusive verweigerter Berechtigung; der Melde-Pfad; der
  Löschdialog mit seinen Zahlen; Sentry ohne DSN.
- **Manuell, und nur mit Gerät:** alles aus §11 der Phase-4-Spec und §10 der Phase-5-Spec, dazu
  ein Share-Link im echten Browser, ein Export in die echte Galerie und eine echte Löschung.

## 11. Bewusst nicht in Phase 6

Übertragen einer Reise an ein anderes Mitglied statt Löschen; ein Moderations-Backend jenseits
der Owner-Ansicht; Ratenbegrenzung des öffentlichen Endpunkts (gehört ans Deployment);
gerendertes Highlight-Video; Kartenansicht; täglicher Reveal; Bezahlmodell. Und alles aus §2,
das an fremden Konten hängt.
