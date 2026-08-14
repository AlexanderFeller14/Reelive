# Instant-Video-Vorschau: eigene AVFoundation-Aufnahme-Pipeline (iOS)

Datum: 2026-08-14 · Status: freigegeben (Brainstorming-Abschnitte 1–5 einzeln bestätigt)

## Ausgangslage

Nach dem Loslassen des Auslösers vergehen heute ~0,5 s, bis die Vorschau steht —
und das ist bereits das Optimum des heutigen Baukastens (Poster-Brücke +
vorgewärmter Player, siehe Commit 918e185). Die am Gerät gemessenen Böden:

- `recordAsync` (expo-camera) liefert die Videodatei erst **~350–420 ms** nach
  dem Loslassen; vorher existiert das Video nicht (iOS-Finalisierung).
- Die `VideoView` von expo-video braucht **~0,8 s**, bis sie einen bereits
  fertig geladenen, spielenden Player erstmals zeichnet — konstant, JS-Thread
  dabei frei; die Kosten stecken im nativen View-Aufbau.

Der User-Massstab ist Snapchat: Loslassen → das bewegte Video läuft sofort.
Das erreicht nur eine Pipeline, die nicht auf die Datei wartet.

## Erlebnis-Vertrag (das Ziel)

Loslassen → nach höchstens **~0,15 s** läuft in der Vorschau das bewegte,
stumme, loopende Video **ab Bild 0**. Die Videodatei entsteht im Hintergrund;
«Einsenden» wartet unsichtbar auf ihr Fertigschreiben (dasselbe Promise-Muster
wie beim Instant-Foto, `foto.datei`). Verwerfen räumt Datei und Puffer ab.
Scheitert die Pipeline, springt automatisch der heutige Weg ein (recordAsync +
Poster-Brücke) — kein Moment geht je verloren.

## Nicht-Ziele

- **Kein Android:** Das Vorhaben ist iOS-only, wie das bestehende
  KameraZoom-Modul. Android nimmt weiter den expo-camera-Weg.
- **Kein Ton in der Vorschau:** Sie ist bewusst stumm («eine Vorschau, kein
  Player»); Ton gehört nur in die Datei.
- **Kein Ersatz von expo-camera insgesamt:** Sucher, Fotos, Zoom, Fokus,
  Berechtigungen, Mikrofon-Logik bleiben unangetastet. Ersetzt wird allein die
  Video-AUFNAHME (`recordAsync` wird für Videos nicht mehr aufgerufen).

## Entscheid und verworfene Alternativen

Gewählt: **Voll-Ersatz mit eigenem Writer** (Ansatz A, User-Entscheid).

- *Verworfen — Nur-Abgriff neben recordAsync (Ansatz B):* kleinster Umfang,
  aber er hängt daran, ob ein `AVCaptureVideoDataOutput` während einer
  **laufenden** `AVCaptureMovieFileOutput`-Aufnahme Frames bekommt — historisch
  von iOS blockiert, auf neuen Versionen gelockert, ungewiss. Ansatz A braucht
  diese Koexistenz nur im Leerlauf (siehe Phase 0) und hat den Zweig selbst in
  der Hand.
- *Verworfen — react-native-vision-camera (Ansatz C):* reife Bibliothek mit
  Frame-Zugriff, ersetzte aber expo-camera komplett — Zoom-Modul, Fokus-Tipp,
  Mute-Logik, Berechtigungen müssten migrieren. Unverhältnismässig für ein
  einzelnes Erlebnis-Feature.

## Architektur — native Schicht (iOS)

Alles im bestehenden `modules/kamera-zoom`-Pod, aber als **eigene Modul-Klasse
`KameraAufnahme`** in eigener Datei plus native View `SofortVorschau`; das
Zoom/Fokus-Modul bleibt unberührt. Vier Bausteine mit je einer Aufgabe:

1. **SessionAbgriff** — findet die laufende expo-camera-Session über die
   Preview-Layer (derselbe Weg wie `fokussiere`) und hängt
   `AVCaptureVideoDataOutput` + `AVCaptureAudioDataOutput` an, jede mit eigener
   serieller Queue. Die Outputs werden **einmal** angehängt und bleiben dran —
   jedes An-/Abhängen wäre ein Session-Umbau und damit ein sichtbarer
   Sucher-Ruckler. Orientierung und Spiegelung übernimmt er von der
   Preview-Connection (Front-Kamera gespiegelt, wie im Sucher).

2. **AufnahmeSchreiber** — pro Aufnahme ein `AVAssetWriter`: .mov nach
   Library/Caches (derselbe Ort und dieselbe Endung wie heute, die
   Upload-Pipeline merkt keinen Unterschied), H.264 1920×1080 + AAC. Zeitbasis
   sind die Puffer-Timestamps der Session — Ton-Bild-Sync ist damit geschenkt.
   Der Dateipfad steht beim Start fest; `finishWriting` läuft nach dem
   Loslassen im Hintergrund und löst das `dateiFertig`-Promise (oder lehnt ab).

3. **StartFenster** — ein Ringpuffer hält die ersten **~0,7–1 s** Frames der
   Aufnahme (bei 1080p ~60–95 MB, nur für Sekunden; die Fenstergrösse ist eine
   Konstante und wird am Gerät kalibriert). Freigegeben, sobald die
   Datei-Vorschau übernommen hat oder verworfen wird.

4. **SofortVorschau-View** — eine `AVSampleBufferDisplayLayer`: spielt beim
   Loslassen sofort das StartFenster ab Bild 0 in Echtzeit, wechselt an der
   laufenden Position nahtlos auf einen `AVAssetReader` der inzwischen fertigen
   Datei und loopt danach endlos (Reader je Runde neu aufgesetzt). Stumm per
   Bauart — sie hat keine Audio-Session, der Mikrofon-Umbau des Kamera-Screens
   kann sie nicht pausieren. Sie ersetzt in diesem Fall auch die
   expo-video-VideoView samt deren ~0,8 s Zeichnzeit.

**Modul-API:** `aufnahmeStarten(maxSekunden)` → sofort;
`aufnahmeStoppen()` → `{ uri, dauerS }` sofort (der Pfad ist bekannt); dazu
eine eigene AsyncFunction, die erst nach `finishWriting` auflöst — daraus baut
der JS-Zugriffspunkt das `dateiFertig`-Promise; `verwerfen()` räumt Datei und
Puffer. Die Höchstdauer
stoppt ein modul-eigener Timer hart; der JS-Ring am Auslöser bleibt die
sichtbare Anzeige. Ein zweiter Start während einer laufenden Aufnahme wird
abgelehnt (Pendant zum `laeuftFoto`-Guard).

## Phase 0 — Machbarkeits-Nachweis (erster Implementationsschritt)

expo-camera lässt seinen **untätigen** `MovieFileOutput` an der Session hängen
(dauerhafter Video-Modus). Ob unser Frame-Abgriff daneben zuverlässig Bilder
bekommt, beweist der allererste Schritt am Gerät (Frame-Zähler-Probe). Falls
nicht: unser Modul entfernt den Output nativ aus der Session und wehrt sein
Wiederanhängen ab (expo-camera fügt ihn bei Session-Umbauten wieder ein, z.B.
beim Mute-Wechsel — der Abwehr-Mechanismus beobachtet die Session). Der
Implementationsplan enthält beide Zweige; die Weiche stellt Phase 0.

## Architektur — JS-Schicht

1. **`features/kamera/nativeAufnahme.ts`** — einziger Zugriffspunkt aufs neue
   Modul (Konvention wie `nativeZoom.ts`): `aufnahmeStarten`,
   `aufnahmeStoppen`, `verwerfen`, `verfuegbar()`. Fehlt das Modul oder
   scheitert der Start, greift automatisch der heutige Weg.

2. **Kamera-Screen:** `handleVideoStart` ruft `aufnahmeStarten` statt der
   recordAsync-Schleife; `handleVideoStop` bekommt von `aufnahmeStoppen()`
   sofort `{ uri, dauerS }` und navigiert augenblicklich. `duration_s` kommt
   vom Modul (genauer als die JS-Stoppuhr). Der heutige Vorwärm-Weg
   (createVideoPlayer + Poster) bleibt vollständig als Rückfallebene erhalten.

3. **Übergabe-Holder:** `VideoUebergabe` wird zur Zwei-Formen-Union — neu
   `{ art: 'nativ', uri, dateiFertig }` für die Pipeline, weiterhin
   `{ art: 'player', player, poster }` für den Fallback.

4. **Vorschau:** Bei `art: 'nativ'` rendert sie die `SofortVorschau`-View —
   kein expo-video, kein Poster, kein Weiterspiel-Netz nötig. **Einsenden**
   wartet auf `dateiFertig` (unsichtbar im bestehenden Sende-Spinner) und läuft
   dann unverändert durch `videoAufbereiten` → `dauerhaftSichern` →
   Warteschlange. **Verwerfen** ruft `nativeAufnahme.verwerfen()`. Deep-Link
   und Fallback laufen exakt wie heute.

## Fehler- und Grenzfälle

- **Voller Speicher / Writer-Fehler während der Aufnahme:** Aufnahme gilt als
  gescheitert — kein Navigieren, bestehende Fehler-Pille im Sucher;
  `dateiFertig` lehnt ab, der Einsenden-Fehlerpfad fängt Spätfälle.
- **Hintergrund oder Anruf** (`AVCaptureSessionWasInterrupted`): das Modul
  beendet die Aufnahme sauber (finishWriting), das bis dahin Gefilmte bleibt
  gültig; der JS-Stopp läuft über den bestehenden Auslöser-Pfad (Berührungen
  werden beim Sperren gecancelt). Geräteverifikation nötig.
- **Kein Mikrofon beim Start:** Aufnahme ohne Tonspur statt Scheitern.
- **Kamerawechsel während der Aufnahme:** heute schon gesperrt, bleibt so.
- **Speicherhaushalt:** StartFenster ist eine feste Obergrenze und wird nach
  Übernahme oder Verwerfen freigegeben.

## Testen

- **Jest (TDD):** Die gesamte JS-Seite — Holder-Union, Stopp-Weiche (nativ vs.
  Fallback), Vorschau-Weiche (SofortVorschau vs. VideoView),
  Einsenden-wartet-auf-`dateiFertig`, Verwerfen — gegen einen Mock von
  `nativeAufnahme.ts`, rot → grün.
- **Gerät (die eigentlichen Versprechen, Jest sieht davon nichts):**
  Messsonden (Metro-Zeitstempel) für «Loslassen → bewegtes Bild ≤ 0,15 s»;
  Checkliste: Ton-Bild-Sync im Recap, Orientierung/Spiegelung (Front/Back),
  nahtloser Wechsel RAM → Datei, sauberer Loop, 90-s-Stopp, Verwerfen räumt
  wirklich, Hintergrund/Anruf, voller Upload-Durchlauf mit echtem .mov.
- **Neuer Build nötig:** Natives Modul — Metro-Reload reicht nicht
  (`expo run:ios`, klassische UDID).

## Offene Kalibrierungen (bewusst im Plan, nicht in der Spec entschieden)

- Grösse des StartFensters (Frames vs. Speicher, am Gerät messen).
- Bitrate/Encoder-Feinwerte des Writers (Startpunkt: Standard-H.264 wie
  expo-camera, 1080p).
