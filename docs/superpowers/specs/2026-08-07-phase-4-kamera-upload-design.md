# Reelive Phase 4 — Kamera & Upload-Queue: Design-Spezifikation

**Datum:** 2026-08-07
**Status:** Abgenommen (Brainstorming-Session)
**Basis:** [Produkt-Spec](2026-08-03-reelive-design.md) · [Roadmap](../plans/2026-08-03-reelive-v1-roadmap.md) · `DESIGN-LANGUAGE.md` (verbindlich für alle UI)

## 1. Ziel & Deliverable

Die App bekommt ihr Herzstück: Momente einfangen. Aufnehmen funktioniert vollständig
offline; hochgeladen wird, sobald wieder Netz da ist. Gesehen wird nichts davon — die
Versiegelung aus Phase 1 bleibt unangetastet, sichtbar ist allein der eigene Zähler.

**Deliverable (Roadmap):** Aufnahme → versiegelt → landet komprimiert in R2 + Postgres,
auch nach Offline-Phasen.

## 2. Rahmenentscheide (in der Session getroffen)

| Entscheid | Wahl | Begründung |
|---|---|---|
| Medien-Storage | **S3-kompatibel programmieren, lokal gegen Supabase Storage** | R2 bleibt Eckpfeiler (CLAUDE.md), aber es liegen keine Credentials vor. Beide sprechen S3 — produktiv wechseln nur Endpoint und Zugangsdaten, der Code bleibt identisch |
| Kamera | **expo-camera**, Expo Go bleibt | Ursprünglich war `react-native-vision-camera` gesetzt (Produkt-Spec §3, schnellerer Kaltstart). Beim Bauen zeigte sich: Version 5.2.2 bringt kein Config-Plugin mit und lässt sich unter Node 24 nicht laden (offenes Upstream-Problem), und für einen Dev-Build fehlte auf dem Rechner der Platz. `expo-camera` löst beides, weil es in Expo Go steckt. Die Kamera bleibt hinter dem Screen gekapselt — ein späterer Wechsel trifft eine Datei |
| Video-Kompression | **Über die Aufnahmequalität, nicht nachträglich** | `expo-camera` nimmt in der gewählten Qualitätsstufe auf. Spart eine Transkodierung und damit eine grosse native Abhängigkeit (ffmpeg) |
| Queue-Speicher | **expo-sqlite** statt AsyncStorage | Jobs müssen einzeln und transaktional aktualisierbar sein; ein Absturz mitten im Schreiben darf die Warteschlange nicht zerstören |
| Signierte URLs | **Edge Function mit `aws4fetch`** | Die erste Edge Function der App — hier mit echtem Bedarf: der Client darf die S3-Zugangsdaten nie sehen |
| Mehrere aktive Reisen | **Auswahl-Schritt statt Umschalter im Sucher** | Das Konzept sieht einen Trip-Umschalter in der Kamera vor; der lohnt sich erst, wenn Nutzer wirklich mehrere Reisen parallel haben. Bis dahin: bei genau einer laufenden Reise direkt in die Kamera, sonst vorher auswählen |

## 3. Laufzeit: Expo Go bleibt

Alle Pakete dieser Phase — `expo-camera`, `expo-sqlite`, `expo-image-manipulator`,
`expo-video-thumbnails`, `expo-location`, `expo-network` — sind in Expo Go enthalten.
Es braucht keinen Dev-Build, was zwei Probleme auf einmal erledigt: das nicht
installierbare `vision-camera` und den fehlenden Platz auf dem Entwicklungsrechner.

Berechtigungen (Kamera, Mikrofon, Ortung) werden trotzdem sauber über `app.json`
deklariert — sie werden gebraucht, sobald in Phase 6 ein echter Build entsteht.

**Der Wechsel auf `vision-camera` bleibt möglich.** Die gesamte Kamera-Anbindung lebt
im Sucher-Screen; Aufnahme-Ergebnisse verlassen ihn ausschliesslich als Dateipfad plus
Typ. Wer später wechselt, tauscht eine Datei — Queue, Upload und Preview merken nichts
davon. Das ist eine bewusste Grenze, keine zufällige.

## 4. Aufnahme

**Kamera-Screen** (ersetzt den Platzhalter im Tab «Aufnehmen», Kino-Palette nach
DESIGN-LANGUAGE §1):

- Vollbild-Sucher. Auslöser unten: Tippen = Foto, Halten = Video, ein Ring zeigt den
  Fortschritt bis 30 s und stoppt dort selbsttätig (`expo-camera` kennt dafür
  `maxDuration`).
- Kamera wechseln und Blitz als translucente Pillen (§1: die einzige erlaubte UI auf
  Bildinhalt).
- Oben dezent: Name der laufenden Reise und der eigene Zähler.
- Ohne laufende Reise: Hinweis mit Weg zum Anlegen oder Beitreten, keine tote Kamera.
- Bei mehreren laufenden Reisen: vorgeschalteter Auswahl-Schritt.

**Preview** nach der Aufnahme:

- Das Aufgenommene formatfüllend, darüber eine optionale Caption (max. 120 Zeichen,
  verschiebbar), Ort und Zeit klein eingeblendet.
- Genau zwei Aktionen: «Einsenden» (primär) und verwerfen.
- Einsenden spielt die Versiegelungs-Inszenierung aus §5 der Design-Language: der Moment
  schrumpft in die Filmrolle, das Siegel schliesst mit Gold-Glow, der Zähler rollt hoch.
  Haptik `success`. Danach zurück in die Kamera — kein Zurück zum Moment.

**Metadaten:** `captured_at` und `captured_tz` kommen vom Gerät, nie vom Server.
Position über `expo-location`; der Ortsname über dessen Reverse-Geocoding. Schlägt das
fehl oder fehlt die Berechtigung, bleiben `lat`/`lng`/`place_name` leer — das ist kein
Grund, die Aufnahme zu verwerfen.

**Kompression:** Fotos auf max. 1080 px lange Kante, JPEG-Qualität 0.8, über
`expo-image-manipulator`. Video über die Aufnahmequalität auf max. 1080p. Thumbnails
entstehen lokal: beim Foto durch weiteres Skalieren, beim Video aus dem ersten Bild
(`expo-video-thumbnails`).

## 5. Upload-Queue

Die Queue ist die Lebensversicherung des Offline-Versprechens. Sie liegt in SQLite und
überlebt Neustarts.

**Ein Job je Moment**, mit: lokalem Dateipfad, Thumbnail-Pfad, allen `posts`-Feldern,
Anzahl Versuche, Zeitpunkt des nächsten Versuchs und Zustand.

**Ablauf je Job:**

1. `posts`-Zeile anlegen (RLS: Mitglied, eigener Name, laufende Reise — Phase 1). Sie
   entsteht erst beim Upload, weil offline kein Insert möglich ist. Die `id` erzeugt
   der Client bereits beim Aufnehmen (`expo-crypto`) und legt sie im Job ab: nur so
   lässt sich `storage_key` — der in `posts` NOT NULL ist — vor dem Insert bilden, und
   nur so legt ein Wiederanlauf nach Absturz keine zweite Zeile an.
2. Signierte PUT-URLs für Medium und Thumbnail von der Edge Function holen.
3. Beides hochladen.
4. Bei der Edge Function bestätigen; sie prüft, dass die Objekte liegen, und setzt
   `upload_status = 'uploaded'`. **Der Client kann das nicht selbst** — Phase 1 hat
   `update` auf `posts` für `authenticated` entzogen, und das bleibt so.

**Wiederholung:** exponentieller Backoff ab 2 s, gedeckelt bei 10 Minuten. Jobs bleiben
liegen, bis sie durchkommen; nichts wird nach n Versuchen still verworfen.

**«Nur über WLAN»:** Schalter im Profil-Tab, Zustand in AsyncStorage. Der Worker prüft
den Verbindungstyp über `expo-network` und pausiert auf Mobilfunk, statt Jobs scheitern
zu lassen.

**Idempotenz:** Ein Job trägt die `post_id`, sobald Schritt 1 durch ist. Ein
Wiederanlauf nach Absturz legt keine zweite Zeile an und lädt nur, was fehlt.

## 6. Edge Function `media-urls`

Erste Edge Function des Projekts, Deno, Service-Role. Zwei Operationen:

- **sign:** prüft per JWT, dass die aufrufende Person Mitglied der Reise und Autor des
  Posts ist, und gibt presigned PUT-URLs für `storage_key` und `thumb_key` zurück
  (kurzlebig). Signiert mit `aws4fetch` gegen den Endpoint aus der Umgebung.
- **confirm:** prüft per HEAD, dass beide Objekte existieren, und setzt dann
  `upload_status = 'uploaded'`.

Die Schlüssel folgen dem Muster `trips/<trip_id>/<post_id>.<ext>` bzw. `…_t.jpg`. Der
Client bildet sie aus der selbst erzeugten `post_id` (§5), aber die Function **glaubt
ihm nicht**: sie liest die `posts`-Zeile, leitet den erwarteten Schlüssel daraus ab und
signiert ausschliesslich diesen. Damit kann niemand eine Signatur für einen fremden
Pfad erschleichen, obwohl der Client den Schlüssel kennt.

Lesende URLs sind **nicht** Teil dieser Phase — vor dem Reveal darf niemand Medien
lesen, das kommt mit Phase 5.

## 7. Zähler & Upload-Status

Der Zähler ist die einzige Information über versiegelte Momente (Phase 1:
`my_post_counts`). Sichtbar sind:

- **Kamera und Reise-Detail:** eigener Zähler, gross gesetzt (`type.display`), inklusive
  der noch nicht hochgeladenen Momente aus der Queue — sonst würde er nach einer
  Offline-Aufnahme rückwärts wirken.
- **Reise-Detail:** dezent «3 Momente warten auf Upload», wenn die Queue nicht leer ist.

## 8. Fehlerbehandlung

- Fehlende Kamera- oder Mikrofon-Berechtigung: erklärender Screen mit Weg in die
  Einstellungen, keine leere schwarze Fläche.
- Fehlende Ortungsberechtigung: Aufnahme läuft weiter, ohne Ort.
- Voller Gerätespeicher: Aufnahme wird abgelehnt mit klarer Ursache.
- Upload-Fehler bleiben unsichtbar, solange die Queue sie wiederholt — sie sind der
  Normalfall, keine Störung. Sichtbar wird nur die Zahl der wartenden Momente.
- Reise wird währenddessen aufgedeckt: Jobs mit `captured_at` vor dem Reveal laufen
  durch (Phase 1 erlaubt Nachzügler), spätere werden mit Erklärung verworfen.

## 9. Testing

- **pgTAP:** dass `upload_status` weiterhin nur mit Service-Role wechselt; dass ein
  Insert mit fremdem `author_id` scheitert; Nachzügler-Regel nach dem Reveal.
- **Jest:** Zustandsmaschine der Queue (Backoff, Wiederanlauf, Idempotenz, WLAN-Pause) —
  das ist die Kernlogik dieser Phase und gehört netzfrei getestet; Schlüssel-Ableitung;
  Zähler-Zusammenführung aus Server und Queue.
- **Edge Function:** Signatur- und Berechtigungspfade gegen die lokale Instanz.
- **Manuell auf dem Dev-Build:** Aufnahme im Flugmodus, App beenden, Netz einschalten,
  App öffnen — der Moment muss von selbst durchlaufen. Dazu Foto, Video mit 30-s-Grenze,
  Caption, verweigerte Berechtigungen.

## 10. Bewusst nicht in Phase 4

Reveal und Recap samt lesenden URLs (Phase 5), Cover-Upload für Reisen, Trip-Umschalter
im Sucher, Filter und Bearbeiten von Aufnahmen, Galerie-Import bestehender Fotos,
EAS-Builds und echtes R2 (Phase 6), Push.
