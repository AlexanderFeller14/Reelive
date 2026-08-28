# Fotos-Import: Vollbild-Prüfung mit Fortschritt

Stand: 2026-08-28, im Gespräch freigegeben. Ersetzt im Fotos-Import
(`2026-08-27-fotos-import-design.md`) das Bestätigungs-Sheet und den Batch im
Kamera-Screen.

## Problem

Wer viele grosse Fotos und Videos wählt, wartet «ewig», bis die Bestätigung
erscheint. Die Zeit vergeht im Picker selbst: `expo-image-picker` dekodiert
jedes HEIC-Foto und kodiert es als JPEG, und exportiert jedes Video nach
H.264, BEVOR `launchImageLibraryAsync` zurückgibt, ohne Fortschritt und ohne
Bild. Dazu fehlt die Möglichkeit, einzelne Elemente vor dem Einsenden wieder
abzuwählen, und das Sheet deckt den Sucher nur halb.

## Entscheide

- **Der Picker gibt die Originale sofort zurück.**
  `preferredAssetRepresentationMode: Current` (kein Bild-Neukodieren, HEIC
  bleibt HEIC) und `videoExportPreset: Passthrough` (Byte-Kopie, HEVC bleibt
  HEVC). EXIF liest der Picker auf diesem Pfad weiterhin (MediaHandler.swift,
  schneller Bildpfad). Die Bibliotheks-Infos je Element laufen parallel.
- **Die Umwandlung wandert in den Batch, nach der Bestätigung, mit
  Fortschritt.** Videos, die nicht schon H.264 sind, exportiert ein eigenes
  Native-Modul (`VideoExport`, AVAssetExportSession, Preset 1920×1080, `.mp4`,
  netzwerkoptimiert) mit Fortschritts-Events. Fotos wandelt `preparePhoto`
  wie bisher nach JPEG. Fehlt das Modul (Web, Jest, Android), geht das Video
  unverändert weiter.
- **Vollbild-Route `/import-review` statt Sheet.** Wie `/preview`: Stack-Route
  über den Tabs, Kino-Palette, keine Tableiste. Die Kamera behält
  Hinweis-Sheet, Picker und Bewertung und übergibt die bewertete Liste über
  einen Halter (`importHandoff.ts`, Muster `camera/handoff.ts`). Die Route
  besitzt Vorschau, Abwahl, Batch, Fortschritt und die Erfolgsanimation.
- **Abwahl je Element** über ein kleines x auf der Kachel; die Kopie wird
  sofort gelöscht. Abgelehnte Elemente bleiben sichtbar (abgedunkelt, mit
  Grund), sind aber nicht abwählbar und werden nie eingesendet.
- **Fortschritt heisst Vorbereiten und Einsenden**, nicht der Server-Upload:
  je Kachel «Wird umgewandelt 42 %» (Video), Spinner (Vorbereiten), Häkchen
  (in der Warteschlange), Warnsymbol (gescheitert). Der Upload läuft danach
  im Hintergrund wie bei jeder Aufnahme.
- **Kein Abbrechen mitten im Batch**, keine Zurück-Geste während des Batches
  (`gestureEnabled: false`).
- Die Reise-Bindung bleibt: der Halter trägt `tripId`; der Batch sendet in
  genau diese Reise.

## Ablauf

1. Kamera: Knopf → Hinweis-Sheet (unverändert) → «Fotos auswählen» → Picker
   (schnell) → Bewertung (Datum, Zeitraum, Länge) → Halter füllen
   (Reise-ID und -Name, Autor, zulässige und abgelehnte Elemente, Zählerstand
   vor dem Batch) → `router.push('/import-review')`. Abgelehnte Kopien werden
   NICHT mehr sofort gelöscht: die Route zeigt sie und gibt sie frei.
   Abbruch im Picker, Picker-Fehler, fehlende Session und Blur während des
   Pickers bleiben wie bisher (Pille in der Kamera, Kopien freigegeben).
2. Route, Phase «Prüfen»: Kopf mit «Einsenden?» und Reisename, rechts
   «Abbrechen». Raster mit drei Spalten, Kacheln Radius 12: Fotos direkt aus
   der Picker-Kopie, Videos mit nachgeladenem Standbild (Film-Symbol solange),
   Film-Symbol und Länge. Zulässige Kacheln tragen oben rechts das x
   («Aus der Auswahl entfernen»). Abgelehnte Kacheln sind abgedunkelt mit
   Grund («Ausserhalb der Reise», «Zu lang», «Ohne Länge», «Ohne Datum»),
   ohne x. Unter dem Raster, falls etwas abgelehnt ist, die Zusammenfassung
   in der Gegenwartsform (`refusalSummary(..., 'preview')`, mit dem Hinweis
   zum Fotozugriff). Unten: «6 Momente passen in den Reisezeitraum» und
   `CinemaButton` «6 Momente einsenden»; die Zahl folgt der Auswahl. Ist
   nichts (mehr) übrig: «Nichts zum Einsenden», Knopf deaktiviert.
3. «Abbrechen» oder die Zurück-Geste: alle verbliebenen Kopien (zulässige
   und abgelehnte) werden gelöscht, zurück zur Kamera. Auch die
   nachgeladenen Video-Standbilder sind Kopien in tmp und werden mit
   freigegeben (bei Abwahl, Abbrechen und nach dem Batch).
4. Phase «Einsenden»: Kopf zählt «3 von 6», «Abbrechen» verschwindet, die
   Geste ist gesperrt. Die Elemente laufen strikt nacheinander: Video →
   Codec prüfen → falls nicht H.264: Export mit Prozent auf der Kachel →
   Standbild → durable Kopie → Job → Warteschlange → Häkchen. Foto →
   JPEG → durable Kopie → Job → Warteschlange → Häkchen. Scheitert ein
   Element: Warnsymbol «Nicht gesichert», der Rest läuft weiter. Danach
   werden die abgelehnten Kopien gelöscht.
5. Phase «Fertig»: wurde mindestens eines eingesendet, spielt
   `MomentSubmissionAnimation` (Zählerstand von vor dem Batch, `added` =
   Anzahl) und führt zurück zur Kamera; der Kamera-Zähler lädt sich beim
   Fokus neu. Wurde nichts eingesendet, bleibt der Screen mit «Keiner der
   Momente liess sich sichern.» und einem Knopf «Zurück».
6. Ohne Halter (Deep Link, Neustart) ersetzt die Route sich durch `/capture`.

## Copy (sichtbar, Deutsch, Du-Form, keine Gedankenstriche)

- Titel «Einsenden?», Untertitel Reisename; im Batch «3 von 6 Momenten»
- Kachel-Gründe: «Ausserhalb der Reise», «Zu lang», «Ohne Länge», «Ohne Datum»
- Kachel-Status: «42 %» (Umwandlung), «Nicht gesichert»; Video-Länge «12 s»
- x: Vorlese-Text «Aus der Auswahl entfernen»
- «6 Momente passen in den Reisezeitraum» / «1 Moment passt in den
  Reisezeitraum» / «Nichts zum Einsenden»
- Knopf «6 Momente einsenden» / «1 Moment einsenden», Link «Abbrechen»
- Nach gescheitertem Batch: «Keiner der Momente liess sich sichern.», Knopf
  «Zurück»
- Bestehende Zusammenfassung in der Gegenwartsform bleibt für die Ablehnungen.

## Module

- `modules/camera-zoom/ios/VideoExportModule.swift`: `videoCodec(uri)`
  (FourCC der ersten Videospur, z. B. `avc1`, `hvc1`), `exportH264(uri,
  exportId)` mit Event `exportProgress` `{ exportId, progress }`. Registriert
  in `expo-module.config.json`.
- `features/moments/videoExport.ts`: Bridge mit `available()` und
  `ensureH264(uri, onProgress)` → `{ uri, converted }`; ohne Modul oder bei
  unbekanntem Codec unverändert.
- `features/moments/libraryPicker.ts`: schnelle Optionen, Infos parallel.
- `features/moments/importHandoff.ts`: `setImport`/`takeImport`, genau eine
  Übergabe.
- `features/moments/libraryImportSubmit.ts`: `submitImports(accepted,
  target, onProgress, onItem)`; je Element Events `converting {progress}`,
  `preparing`, `done`, `failed`; Videos über `ensureH264`, die konvertierte
  Datei ist ein Zwischenprodukt (`discardIntermediates`).
- `components/CinemaButton.tsx`: Prop `disabled`.
- `components/ImportTile.tsx`: Kachel mit Thumbnail, Video-Badge, x,
  Status-Overlay, Grund.
- `app/import-review.tsx`: die Route. `features/auth/guard.ts`:
  `isAreaForSignedIn` kennt `import-review`.
- `app/(tabs)/capture/index.tsx`: verliert Bestätigungs-Sheet, Batch,
  Fortschritts-Pille, Animation, Reise-Bindungs-Effekt; `pickAndAssess`
  endet im Halter und im `router.push`. `components/ImportConfirmSheet.tsx`
  samt Test wird gelöscht.

## Tests

Jest: Bridge-Fallback und Event-Weiterleitung (Modul gemockt); Picker-
Optionen; Halter; Batch-Events je Element inkl. Konvertierung und Aufräumen
der konvertierten Datei; `CinemaButton` deaktiviert; Kachel-Zustände; Route
(ohne Halter zurück, Raster, Abwahl mit Löschen, Abbrechen löscht alles,
Batch mit Fortschritt, Geste gesperrt, Animation, nichts eingesendet, nichts
zulässig); Kamera-Übergabe (Halter gefüllt, Route gepusht); Guard.

## Am Gerät zu prüfen (kann Jest nicht)

- Picker-Rückgabe mit 20 grossen HEIC-Fotos und HEVC-Videos: Sekunden statt
  Minuten?
- Export eines 30-s-HEVC-Clips: Dauer, Prozentanzeige, resultierendes
  `.mp4` spielt im Web-Player.
- Kacheln: HEIC-Fotos rendern in expo-image, Video-Standbilder laden nach.
- Speicher bei 20 Originalen in tmp; kein `[media] file could not be removed`
  nach Abwahl, Abbrechen und Batch.
- Zurück-Geste während des Batches gesperrt; nach der Animation steht die
  Kamera mit aktualisiertem Zähler.
- Neuer Native-Build nötig (neues Modul).

## Nicht drin

Abbrechen mitten im Batch, Sortierung, Caption, Anzeige des Server-Uploads,
«Nicht mehr zeigen» für den Hinweis.
