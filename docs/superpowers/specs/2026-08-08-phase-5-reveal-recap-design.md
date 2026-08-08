# Reelive Phase 5 — Reveal & Recap: Design-Spezifikation

**Datum:** 2026-08-08
**Status:** Abgenommen (im Alleingang entschieden — siehe §2)
**Basis:** [Produkt-Spec](2026-08-03-reelive-design.md) · [Roadmap](../plans/2026-08-03-reelive-v1-roadmap.md) ·
[Phase 4](2026-08-07-phase-4-kamera-upload-design.md) · `DESIGN-LANGUAGE.md` (verbindlich für alle UI)

## 1. Ziel & Deliverable

Der emotionale Höhepunkt der App. Die Owner-Person schliesst die Reise ab, das Siegel bricht,
und die Gruppe sieht zum ersten Mal alles: dieselben Tage aus allen Perspektiven, streng nach
Aufnahmezeit, nach Reisetagen gruppiert.

**Deliverable (Roadmap):** Der komplette Kern-Loop funktioniert — aufnehmen → reveal →
gemeinsamer Recap.

Phase 5 ist die erste Phase, in der überhaupt jemand ein Medium **liest**. Bis hierher war die
Versiegelung dadurch geschützt, dass es keinen Leseweg gab. Ab jetzt gibt es einen, und er muss
genauso hart sein wie das Nichtvorhandensein vorher.

## 2. Wie diese Spec entstanden ist

Der Auftraggeber hat die Umsetzung bis Phase 6 vollständig delegiert («entscheid einfach selbst
mit dem, was du empfiehlst»). Es gab also keine Brainstorming-Session; alle Entscheide in §3 sind
von mir getroffen und begründet. Wo ich einen Entscheid für riskant halte, steht das dabei.

Der Ist-Zustand wurde vor dem Schreiben vollständig kartiert (Migrationen, Policies, Grants,
Routenbaum, Komponenten, Pakete, Testaufbau) — diese Spec setzt nichts voraus, was nicht
nachgewiesen im Repo steht.

## 3. Rahmenentscheide

| Entscheid | Wahl | Begründung |
|---|---|---|
| Statuswechsel | **Edge Function `reveal-trip`, Service-Role** | `authenticated` hat auf `trips.status` und `revealed_at` gar kein Spalten-Grant — bewusst seit Phase 1. Der Client *kann* den Reveal nicht auslösen, und das bleibt so |
| Reveal-Entdeckung | **Die App entdeckt den Reveal selbst**, beim Fokussieren | Push ist eine Bequemlichkeit, nie eine Voraussetzung. Wer die Benachrichtigung verpasst, ausgeschaltet oder nie erlaubt hat, findet den Recap trotzdem |
| Push | **`expo-notifications` + Tabelle `push_tokens`, Versand aus `reveal-trip`** | Roadmap-Bestandteil. **Aber:** Expo Go kann keine Remote-Pushes empfangen (Expo-Doku: «You must use a development build»). Der Code entsteht hier, der Zustellnachweis gehört in Phase 6 zum ersten echten Build |
| Lese-URLs | **`media-urls` bekommt die Aktion `lesen`, gebündelt für eine ganze Reise** | Ein Recap hat leicht 200 Momente. Eine Signatur pro Moment und Request wäre 200 Roundtrips für einen einzigen Screen |
| Gültigkeit der Lese-URLs | **1 Stunde** | Lang genug für einen Recap-Durchlauf am Stück, kurz genug, dass eine weitergereichte URL nichts mehr wert ist. Uploads bleiben bei 10 Minuten |
| Player-Technik | **Reanimated + Gesture Handler**, eigener Screen | Beides ist installiert und wird schon genutzt. Kein neues Paket für Gesten |
| Videos | **`expo-video`, direkt von der signierten URL gestreamt** | Kein Download-Zwischenschritt, keine zweite Warteschlange. `expo-video` ist installiert und in der Aufnahme-Vorschau erprobt |
| Bilder | **`expo-image` mit Vorladen der nächsten drei** | Installiert, aber bisher ungenutzt. Der Player darf beim Weitertippen nicht schwarz blitzen |
| Übersicht | **Tages-Grid als eigener Screen, ja** | Ein 200-Momente-Recap ohne Sprungmöglichkeit ist unbenutzbar — man findet den einen Abend nie wieder. Die Tages-Gruppierung rechnet der Player ohnehin |
| Reaktionen & Kommentare | **Nur UI — Tabellen und Policies stehen seit Phase 1** | `reactions`, `comments`, `can_see_post` und die Grants sind vollständig da. Hier entsteht kein Schema |
| Archivierte Reisen | **`can_see_post` auf `('revealed','archived')` erweitern** | Bestehende Inkonsistenz: `posts` sind im Archiv sichtbar, aber `can_see_post` prüft nur `'revealed'` — Reaktionen und Kommentare wären in archivierten Reisen tot. Wurde bei der Archiv-Korrektur in Phase 3 übersehen |
| Share-Link, Web-Player, Galerie-Export, Melden | **Phase 6** | Alle vier hängen an Dingen, die Phase 6 sowieso bringt (öffentlicher Zugriff, Store-Pflichten). Phase 5 bleibt auf dem Kern-Loop |

## 4. Die Versprechen dieser Phase

Der Branch-Review von Phase 4 hat einen Prozessfehler aufgedeckt: der Plan zählte Bausteine und
Schnittstellen auf, aber niemand prüfte, ob für jedes **Versprechen** der Spec ein Task zuständig
war. Drei der vier schwersten Funde waren genau solche Lücken. Darum steht diese Liste hier, und
der Plan muss für jede Zeile einen Task benennen.

| # | Versprechen | Wo es brechen kann |
|---|---|---|
| V1 | Vor dem Reveal liest niemand ein Medium — auch nicht mit einer gültig aussehenden Anfrage | Die neue Lese-Aktion |
| V2 | Nach dem Reveal sieht jedes Mitglied **alle** Momente, sortiert nach `captured_at` | Abfrage und Sortierung |
| V3 | Der Reveal ist unumkehrbar, nur die Owner-Person löst ihn aus, und zweimal Drücken schadet nicht | `reveal-trip` |
| V4 | Nachzügler sortieren sich chronologisch ein; der Recap bleibt für sie offen | Player-Abfrage und Nachzügler-Anzeige |
| V5 | Nach dem Reveal entsteht kein neuer Moment mehr | Bereits durch Phase 1/4 gedeckt — muss belegt bleiben |
| V6 | Der Recap funktioniert, auch wenn nie ein Push ankommt | Reveal-Entdeckung |
| V7 | Reaktionen und Kommentare sehen nur Mitglieder einer aufgedeckten Reise | Bestehende Policies — muss belegt bleiben |
| V8 | Der Player läuft flüssig: kein schwarzes Blitzen, kein Ruckeln beim Weitertippen | Vorladen |
| V9 | Der Recap ist Kino: dunkle Palette, inszenierter Übergang, Siegel bricht mit Gold-Funken | Alle Recap-Screens |
| V10 | Eine abgelaufene Lese-URL beendet den Recap nicht — sie wird erneuert | Player-Fehlerbehandlung |

## 5. Reveal

**Auslöser.** Im Reise-Detail sieht die Owner-Person «Reise abschliessen» als einzigen
Primär-Button, sobald die Reise läuft. Ab dem Enddatum rückt er nach oben und bekommt eine
Zeile darüber: «Eure Reise ist zu Ende. Zeit für den Recap.» Vorher steht er unten, ohne Drängen.

**Bestätigung.** Ein Sheet (DESIGN-LANGUAGE §4), Haptik `warning`:

> **Reise abschliessen?**
> Danach kann niemand mehr Momente einsenden, und alle sehen den Recap. Das lässt sich nicht
> rückgängig machen.
> [Abschliessen] [Abbrechen]

Wartet noch etwas in der eigenen Warteschlange, kommt eine Zeile dazu: «Deine 3 wartenden
Momente kommen noch durch — sie sind vor dem Reveal entstanden.» Das ist keine Warnung, sondern
eine Beruhigung: Phase 1 lässt Nachzügler durch.

**Edge Function `reveal-trip`.** Body `{ trip_id }`. Sie prüft mit Service-Role:

1. Die aufrufende Person ist `trips.owner_id`. Sonst 403.
2. `status = 'active'`. Ist er schon `'revealed'`, antwortet sie **erfolgreich** (idempotent) —
   zweimal Drücken bei wackligem Netz darf nicht in einen Fehler laufen. Ist er `'archived'`,
   ist das ein Fehler.
3. Setzt `status = 'revealed'` und `revealed_at = now()` in **einer** Anweisung mit
   `where status = 'active'` — zwei gleichzeitige Aufrufe können so nicht beide gewinnen.
4. Verschickt danach die Pushes. **Ein Fehler beim Push darf den Reveal nicht scheitern lassen**:
   der Statuswechsel ist die Wahrheit, die Benachrichtigung nur die Botschaft.

Die Antwort enthält `revealed_at`, damit die App sofort weiss, was sie inszenieren soll.

**Warum `revealed_at` vom Server kommt und nicht vom Client:** Die Nachzügler-Regel in Phase 1
vergleicht `captured_at <= revealed_at`. Käme der Zeitpunkt vom Gerät, könnte eine falsch
gestellte Uhr das Fenster aufreissen.

**Inszenierung.** Beim ersten Öffnen einer frisch aufgedeckten Reise (pro Reise einmal, gemerkt
in AsyncStorage): das Siegel bricht auf, Gold-Funken ✦ steigen, 700–900 ms, Haptik `success`,
dann «Recap starten». Das ist die zweite der beiden inszenierten Ausnahmen aus
DESIGN-LANGUAGE §5 — kein Konfetti. Bei `prefers-reduced-motion` wird daraus ein 200-ms-Fade.

## 6. Push

**Tabelle `push_tokens`:** `user_id`, `token` (Expo-Push-Token als Primärschlüssel — dasselbe
Gerät kann den Account wechseln, dann gehört der Token der neuen Person), `platform`,
`updated_at`. RLS: jede Person sieht und schreibt nur eigene Zeilen. Grants ausdrücklich setzen —
`acl_baseline` hat die Default-Privilegien für neue Tabellen abgeräumt, eine Migration ohne
Grants liefert eine Tabelle, die niemand benutzen kann.

**Registrierung** beim Start, wenn angemeldet: Berechtigung erfragen, Token holen, Zeile
schreiben. Schlägt irgendetwas davon fehl — keine Berechtigung, kein Gerät, Expo Go —, ist das
**kein Fehler**, sondern der Normalfall: die App läuft weiter und sagt nichts.

**Versand** aus `reveal-trip`: an alle Mitglieder ausser die auslösende Person.
`POST https://exp.host/--/api/v2/push/send`, maximal 100 Nachrichten pro Anfrage (Expo-Limit),
also in Blöcken. Inhalt: «✈️ Euer Recap von ‹Interrail 2026› ist bereit!», `data` trägt die
`trip_id`, damit ein Tipp direkt in den Recap führt. Antwortet ein Ticket mit
`DeviceNotRegistered`, wird die Zeile gelöscht.

**Was hier bewusst fehlt:** die Erinnerung ab Enddatum (braucht einen Scheduler) und Pushes bei
Beitritten. Beides Phase 6.

## 7. Lesende URLs

`media-urls` bekommt eine dritte Aktion, `lesen`, mit Body `{ trip_id }`. Sie ist die einzige
Stelle im System, die je ein Medium lesbar macht, und prüft darum in dieser Reihenfolge:

1. JWT gültig (wie bisher, nur aus dem Header).
2. Die Reise existiert und hat `status in ('revealed','archived')`. **Sonst 403** — vor dem
   Reveal gibt es keine Lese-URL, für niemanden, auch nicht für die eigene Aufnahme.
3. Die aufrufende Person ist Mitglied (direkte Abfrage auf `trip_members` mit Service-Role, nicht
   über `is_trip_member` — der Oracle-Guard aus Phase 1 liefert für Service-Role `false`).

Erst dann liest sie **selbst** alle `posts` der Reise mit `upload_status = 'uploaded'`, leitet zu
jedem Schlüssel eine presignte GET-URL her und antwortet mit
`{ medien: [{ post_id, medium_url, thumb_url }], gueltig_bis }`.

**Die Schlüssel kommen aus der Datenbank, nie aus dem Body.** Dieselbe Regel wie beim Signieren
von Uploads: der Client bekommt Signaturen ausschliesslich für das, was die Function selbst
gelesen hat.

**Warum gebündelt und nicht pro Moment:** siehe §3. Der Nebeneffekt ist angenehm — es gibt genau
einen Ort, an dem die Berechtigung geprüft wird, statt einer Prüfung pro Abruf.

**Ablauf.** `gueltig_bis` geht an die App zurück. Der Player holt den Satz neu, wenn weniger als
fünf Minuten übrig sind oder ein Abruf mit 403 antwortet (V10). Das darf man nicht sehen.

## 8. Recap

### 8.1 Der Tab

Der Platzhalter im Recap-Tab wird eine Liste aller aufgedeckten und archivierten Reisen —
«entwickelte» Karten mit Cover-Collage und Abspiel-Knopf (Konzept §5.2). Leerer Zustand: «Noch
kein Recap. Der erste kommt, sobald ihr eine Reise abschliesst.»

### 8.2 Der Story-Player

Vollbild, Kino-Palette, der Übergang dorthin ist der inszenierte Fade durch Dunkel (§5 der
DESIGN-LANGUAGE, «das Licht geht aus»).

- **Tippen rechts** = weiter, **tippen links** = zurück, **halten** = Pause, **nach unten
  wischen** = schliessen.
- **Fortschrittsbalken oben, segmentiert** — ein Segment pro Moment. Fotos laufen 5 Sekunden,
  Videos ihre echte Länge.
- **Tages-Trenner** zwischen den Tagen: eine kurze Zwischenkarte «Tag 3 · Lissabon · 12. August».
  Der Ortsname kommt vom häufigsten `place_name` des Tages; fehlt er überall, entfällt er.
- **Auf jedem Moment:** Avatar und Name der Autorin, Uhrzeit, Ort, und die Caption, falls es eine
  gibt — alles als translucente Pillen, das einzige erlaubte UI auf Bildinhalt.
- **Reaktionen:** eine Emoji-Leiste am unteren Rand. Tippen setzt sofort, ohne Wartespinner;
  scheitert es, verschwindet die Reaktion wieder. Reaktionen der anderen erscheinen dezent auf
  dem Moment.
- **Kommentare:** von unten aufwischbar, ein Sheet je Moment. Der Player pausiert dabei.
- **Nachzügler:** hat die Reise Momente mit `upload_status = 'pending'`, steht am Ende «3 Momente
  werden noch hochgeladen». Sie fehlen im Player, statt ihn mit Löchern zu füllen — ein Moment
  ohne Objekt im Speicher wäre eine schwarze Fläche.

**Sortierung:** immer `captured_at`, aufsteigend, mit `id` als zweitem Kriterium, damit die
Reihenfolge bei gleicher Sekunde stabil bleibt. Nie `created_at`.

### 8.3 Die Übersicht

Ein zweiter Screen, erreichbar aus dem Player und der Recap-Karte: nach Tagen gruppierte
Thumbnails im Raster. Tippen startet den Player an genau diesem Moment. Das ist der Weg zurück
zu einem bestimmten Abend, ohne 200-mal zu tippen.

## 9. Fehlerbehandlung

- **Lese-URL abgelaufen:** stillschweigend erneuern (§7). Erst wenn auch das scheitert, eine
  Meldung.
- **Video lädt nicht (Netz weg):** der Moment zeigt sein Thumbnail und einen Hinweis; Weitertippen
  bleibt möglich. Der Recap bricht nie ab.
- **Offline im Recap:** `expo-image` hat einen Cache — schon gesehene Momente bleiben sichtbar.
  Was fehlt, sagt es, statt schwarz zu bleiben.
- **Reveal scheitert:** der Button bleibt bedienbar, die Ursache steht darunter. Weil die Function
  idempotent ist, ist ein zweiter Versuch immer erlaubt.
- **Reise ohne einen einzigen Moment:** der Recap sagt es freundlich, statt einen leeren Player zu
  öffnen: «Diese Reise ist leer geblieben.»
- **Person hat nichts eingesendet:** kein Sonderfall — sie sieht den Recap wie alle anderen.
- **Mitgliedschaft während des Recaps entzogen:** der nächste Abruf antwortet 403, der Player
  schliesst mit einer Erklärung.

## 10. Testing

- **pgTAP:** `push_tokens` (nur eigene Zeilen les- und schreibbar, `anon` gar nicht); `can_see_post`
  jetzt auch für `'archived'`; der Nachweis, dass `authenticated` weiterhin kein Grant auf
  `trips.status`/`revealed_at` hat (V3); Reaktionen und Kommentare nur für Mitglieder aufgedeckter
  Reisen, für niemanden davor (V7).
- **Jest:** Tages-Gruppierung und Ortsname-Ermittlung; die Reihenfolge der Momente inklusive
  Gleichstand; die Zustandsmaschine des Players (weiter, zurück, Tagesgrenzen, Pause); das
  Erneuern abgelaufener URLs (V10); das Zusammenspiel von Reaktionen mit optimistischem Setzen.
- **Edge Function:** dass `lesen` vor dem Reveal 403 liefert und für Nicht-Mitglieder ebenfalls
  (V1) — das ist der wichtigste Test dieser Phase; dass `reveal-trip` nur die Owner-Person
  durchlässt und zweimal aufgerufen zweimal gelingt (V3).
- **Manuell:** Reveal auslösen und die Inszenierung sehen; den Recap durchtippen (Foto, Video,
  Tages-Trenner); reagieren und kommentieren; im Flugmodus öffnen; eine Reise mit wartendem
  Nachzügler aufdecken und beobachten, wie er später erscheint.

## 11. Bewusst nicht in Phase 5

Share-Links und der schreibgeschützte Web-Player, Export in die Galerie, Melden und Moderation,
die Reveal-Erinnerung ab Enddatum, Push bei Beitritten, das Archivieren einer Reise durch die
Owner-Person, gerendertes Highlight-Video, Kartenansicht.
