# Momente aus Fotos einsenden (Mehrfachauswahl)

Stand: 2026-08-27, im Gespräch freigegeben.

## Problem

Snaps leben in Snapchats Sandbox. iOS gibt keiner anderen App Zugriff auf
diesen Container, und Snapchat bietet keine API, um Memories auszulesen. Was
es gibt: «In Kamerarolle speichern» in Snapchat, danach liegt der Snap in
Fotos. Reelive kennt heute genau einen Einsendeweg (Kamera → Preview →
Queue); wer einen gesicherten Snap einsenden will, hat keinen.

## Entscheide

- **Weg A, Galerie-Import**, keine Share Extension: nutzt `expo-image-picker`
  und `expo-media-library`, die beide schon im Build sind (Profilbild,
  Recap-Export). Kein neues natives Target, läuft im heutigen Dev-Client.
  Einzige Ausnahme: geänderte Berechtigungstexte in `app.json` wirken erst
  mit dem nächsten Native-Build.
- **Mehrfachauswahl, ohne Preview.** Die gewählten Elemente laufen direkt
  in die Upload-Queue, ohne Caption. Die Preview bleibt der Kamera
  vorbehalten. Obergrenze 20 Elemente pro Runde: der Picker kopiert jedes
  Element, bevor er die Liste übergibt, ohne eigene Fortschrittsanzeige.
- **HEVC → H.264 erzwungen.** `preferredAssetRepresentationMode: Compatible`
  wandelt HEIC in JPEG, transkodiert Videos aber NICHT von sich aus: das
  native Modul nimmt für `videoExportPreset` standardmässig `.passthrough`
  und kopiert dann, sobald Bibliothekszugriff besteht, die HEVC-Originaldatei
  unverändert (Final-Review, Important 1). Erst
  `videoExportPreset: H264_1920x1080` erzwingt den Export (Ergebnis `.mp4`),
  das der Web-Player braucht.
- **Import nur in den Reisezeitraum.** Der Kalendertag der Aufnahme muss in
  `[start_date, end_date]` der gewählten Reise liegen. Die Versiegelung lebt
  von «spontan, ungefiltert»; ohne diese Grenze würde die Reise zum Album für
  beliebiges Material. Der Server prüft das heute nicht (RLS lässt jedes
  `captured_at` zu, solange die Reise `active` ist); die Grenze gilt im
  Client, wie das Videolimit.
- **Kein Datum, kein Import.** Ohne ermittelbares Aufnahmedatum ist die
  Zeitraum-Regel nicht prüfbar; das Element wird abgelehnt und erklärt.
- **Videos über `MAX_VIDEO_SECONDS`** (heute 90 in `capture/index.tsx`)
  werden abgelehnt, nicht gekürzt.
- **Videos ohne bekannte Länge werden abgelehnt.** Der Server verlangt
  `duration_s` für Videos; ein Job ohne Länge bliebe ewig in der Queue
  (Final-Review, Important 2).
- **Ort nur aus dem Element**, nie vom aktuellen Standort: der Moment war
  woanders. Koordinaten aus der Fotobibliothek oder aus EXIF, der Ortsname per
  Reverse-Geocoding daraus; fehlt beides, bleibt der Moment ohne Ort.
- **Live Photos** kommen als Foto (Standbild). Der Picker wird ohne
  `livePhotos` geöffnet, dann liefert iOS den Typ `image`.

## Woher das Aufnahmedatum kommt

Reihenfolge, das erste Ergebnis gewinnt:

1. EXIF `DateTimeOriginal` (`YYYY:MM:DD HH:MM:SS`), zusammen mit
   `OffsetTimeOriginal` (`+02:00`), falls vorhanden. Ohne Offset wird die
   EXIF-Uhr als Gerätezeit gelesen, dieselbe Annahme wie bei der
   Live-Aufnahme. Der Picker liest EXIF direkt aus der Datei, ohne
   Bibliotheks-Berechtigung, nur bei Fotos.
2. `creationTime` aus `MediaLibrary.getAssetInfoAsync(assetId)`. Dafür fragt
   Reelive vor dem Picker die Leseberechtigung an (Legacy-Einstieg
   `expo-media-library/legacy`, aus demselben Grund wie in `exportApi.ts`).
   Ohne sie liefert der Picker keine `assetId`; Videos ohne EXIF fallen dann
   unter «kein Datum».
3. Nichts: abgelehnt.

`captured_tz` ist immer die Gerätezeitzone; aus einem EXIF-Offset lässt sich
keine IANA-Zone ableiten. Der Kalendertag für die Zeitraum-Prüfung wird aus
`captured_at` in der Gerätezone gebildet (`todaysCalendarDay(new Date(iso))`).

Bekannte Grenze: Snapchat-Sicherungen tragen vermutlich kein EXIF; ihr Datum
ist dann der Speicherzeitpunkt (Punkt 2). Wer den Snap gleich sichert, liegt
richtig. Am Gerät zu prüfen.

## Ablauf in der Kamera

Seit dem 28. August ersetzt `2026-08-28-fotos-import-pruefung-design.md` die Punkte 4 bis 8: der Picker gibt Originale zurück, die Bestätigung ist eine Vollbild-Route mit Abwahl und Fortschritt je Element, die Umwandlung der Videos passiert im Batch.

1. Neuer Pill-Knopf in der rechten Steuerspalte (nach Kamera wechseln und
   Blitz, vor der Stabilisierung), Lucide-Icon `Images`, Label «Momente aus
   Fotos einsenden». Wie die anderen Knöpfe nur sichtbar, wenn keine
   Aufnahme läuft.
2. Tipp → **Hinweis-Sheet** «Momente aus Fotos» (Kino-Modus, jedes Mal,
   Entscheid 2026-08-27): ein Satz und drei Regeln mit den Werten der
   Reise (Reisezeitraum aus `formatRange`, Videolänge, «Ohne Caption, bis
   zum Recap versiegelt, höchstens 20 auf einmal»), Knopf «Fotos auswählen»,
   Textlink «Abbrechen». Wischen oder Tipp daneben gilt als Abbrechen. Beide
   Sheets bekommen die Höhe der Kino-Tableiste als unteren Abstand
   (`bottomInset`), damit Knopf und Textlink über der Leiste stehen.
3. «Fotos auswählen» → Leseberechtigung anfragen (eine Ablehnung stoppt
   nichts) → iOS-Picker mit `mediaTypes: ['images', 'videos']`,
   `allowsMultipleSelection`, `selectionLimit: 20`, `orderedSelection`,
   `exif: true`, `quality: 1`, `preferredAssetRepresentationMode: Compatible`
   (HEIC → JPEG), `videoExportPreset: H264_1920x1080` (erzwingt HEVC →
   H.264, siehe Entscheide), **kein `allowsEditing`** (der Avatar-Bug vom
   2026-08-13). Abbruch im Picker: nichts passiert.
4. Jedes Element wird bewertet (Datum, Zeitraum, Videolänge). Abgelehnte
   Picker-Kopien werden sofort gelöscht.
5. **Bestätigungs-Sheet** «Einsenden?»: Vorschau-Streifen der zulässigen
   Elemente (Fotos aus der Picker-Kopie, Videos als dunkle Film-Kachel),
   «N Momente passen in den Reisezeitraum.», darunter in Zweitfarbe die
   Zusammenfassung der Ablehnungen in der Gegenwartsform, Knopf «N Momente
   einsenden», Textlink «Abbrechen». Abbrechen löscht alle Kopien, nichts
   wird eingesendet. Sind alle abgelehnt: Titel «Nichts zum Einsenden», die
   Erklärung, ein Knopf «Verstanden». Das Sheet ist an die Reise gebunden,
   gegen die bewertet wurde: wechselt die Reise darunter (Tab-Wechsel, Reise
   endet oder wird aufgedeckt), schliesst es sich und gibt die Kopien frei.
6. Sonst Batch: Kopfzeile (Reise-Wechsler, Steuerspalte) und Auslöser sind
   entfernt wie während einer Aufnahme, `captureLock` gesetzt (kein
   Tab-Wechsel mitten im Batch). Unten steht eine translucente Pille mit
   ActivityIndicator: «3 von 8 Momenten eingesendet». Die Elemente laufen
   strikt nacheinander durch `preparePhoto`/`prepareVideo` →
   `persistDurably` → `enqueueJob`, exakt der Queue-Pfad von `preview.tsx`.
   Ein scheiterndes Element kostet nur sich selbst.
7. Danach `MomentSubmissionAnimation` als Overlay über der Kamera mit dem
   Zählerstand von vor dem Batch und `added = N`: Zähler rollt um N, Titel im
   Plural «Momente eingesendet». Der `captureLock` bleibt bis zum Ende der
   Animation gesetzt (Final-Review, Important 4): die Kino-Tableiste liegt
   über dem Screen, ein Tab-Tipp während der 3,6 s würde sonst mitten in die
   Feier blenden. Nach der Animation wird der Zähler frisch geladen
   (Focus-Tick), und eine zurückgehaltene Zusammenfassung der Elemente, die
   beim Sichern gescheitert sind, bekommt die Pille (die Ablehnungen hat das
   Bestätigungs-Sheet schon erklärt).
8. Wurde nichts eingesendet (alle gescheitert), entfällt die Animation, die
   Zusammenfassung steht sofort.

## Copy (sichtbar, Deutsch, Du-Form, keine Gedankenstriche)

- Knopf: «Momente aus Fotos einsenden»
- Hinweis-Sheet: Titel «Momente aus Fotos», «Reelive holt Fotos und Videos
  aus deiner Fotomediathek in die Reise. Es gelten dieselben Regeln wie beim
  Aufnehmen:», «Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)», «Videos
  bis 90 Sekunden», «Ohne Caption, bis zum Recap versiegelt, höchstens 20 auf
  einmal», «Fotos auswählen», «Abbrechen»
- Bestätigungs-Sheet: Titel «Einsenden?» bzw. «Nichts zum Einsenden», «N
  Momente passen in den Reisezeitraum.» / «1 Moment passt in den
  Reisezeitraum.», «N Momente einsenden» / «1 Moment einsenden», «Abbrechen»,
  «Verstanden»
- Zusammenfassung in der Gegenwartsform (Bestätigungs-Sheet): «Der Moment
  kommt nicht mit: …», «1 von {total} Momenten kommt nicht mit: …»,
  «{refused} von {total} Momenten kommen nicht mit: …», «Keiner der {total}
  Momente kommt mit: …»; dieselben Gründe wie unten.
- Fortschritt: «{done} von {total} Momenten eingesendet»
- Picker-Fehler: «Deine Fotos liessen sich nicht öffnen. Probier es nochmal.»
- Ohne Session: «Du bist nicht angemeldet. Melde dich an und probier es nochmal.»
- Zusammenfassung, Einleitung:
  - ein Element: «Der Moment wurde nicht eingesendet: …»
  - alle abgelehnt: «Keiner der {total} Momente wurde eingesendet: …»
  - sonst: «{refused} von {total} Momenten wurden nicht eingesendet: …»
- Gründe (bei gemischten Gründen mit Anzahl davor, mit Komma gereiht):
  - «ausserhalb des Reisezeitraums (1.–14. Aug 2026)» (Bis-Strich aus
    `formatRange`, erlaubt)
  - «Video länger als 90 Sekunden» / «Videos länger als 90 Sekunden»
  - «Videolänge unbekannt» (derselbe Text für jede Anzahl)
  - «Aufnahmedatum unbekannt», dazu der Hinweis «Mit Zugriff auf deine Fotos
    kommt das Aufnahmedatum meist mit.»
  - «beim Sichern gescheitert»
- Die Fehler-Pille steht mindestens 4 s, bei langen Zusammenfassungen 50 ms
  je Zeichen, höchstens 12 s.
- Animation im Plural: «Momente eingesendet», «Deine Momente sind unterwegs
  und bleiben bis zum Recap versiegelt.», Vorlese-Text «Momente erfolgreich
  eingesendet».
- Berechtigungstexte (`app.json`, beide Plugins): erwähnen neu auch das
  Einsenden aus Fotos.

## Module

- `features/moments/libraryImport.ts` (pur): `PickedMedia`,
  `resolveCaptureTime`, `resolveLocation`, `assess`, `refusalSummary`.
- `features/moments/libraryPicker.ts` (I/O): Berechtigung, Picker,
  Asset-Infos je `assetId`, liefert `PickedMedia[]`.
- `features/moments/libraryImportSubmit.ts` (I/O): `submitImports`
  (sequenziell, Fortschritts-Callback, Aufräumen), `discardRefused`.
- `features/moments/placeAndTime.ts`: `describePlace(lat, lng)` herausgelöst,
  `determinePlace` nutzt es.
- `components/MomentSubmissionAnimation.tsx`: Prop `added` (Default 1).
- `components/CinemaButton.tsx` (aus Player und Share herausgelöst).
- `components/ImportIntroSheet.tsx`.
- `components/ImportConfirmSheet.tsx`.
- `app/(tabs)/capture/index.tsx`: Knopf, `importStage`-Zustand, vier Handler
  (intro anzeigen, confirm anzeigen, abbrechen, eingesendet), Fortschritts-Pille,
  Overlay, Zusammenfassung, Zähler-Refresh.
- `app.json`: Berechtigungstexte.

## Tests

Jest deckt die Regeln (Datum, Zeitraum, Länge, Zusammenfassung), den Picker
(Optionen, Normalisierung, Fallbacks), das Batch-Einsenden (Jobs, Fortschritt,
Aufräumen, Teilfehler), die Animation (`added`), die zwei Sheets
(ImportIntroSheet, ImportConfirmSheet), CinemaButton und den Kamera-Screen
(Knopf, Hinweis-Sheet, Auswahl, Bestätigung, Abbrechen löscht Kopien, Batch
mit Fortschritt und Animation, Teilbatch, Picker-Fehler).

## Am Gerät zu prüfen (kann Jest nicht)

- Liefert der Picker im Modus «compatible» EXIF und `assetId` wie erwartet?
- Wird HEVC wirklich zu H.264, und spielt der Web-Player das Ergebnis?
- Bleibt die Kamera-Session unter dem System-Sheet ruhig
  (Betreten-Effekt-Falle aus dem MultiKamera-Umbau)?
- Welches Datum tragen Snapchat-Sicherungen tatsächlich (EXIF oder
  Speicherzeitpunkt)?
- Wie lange braucht der Picker bei 20 Videos, ist die Obergrenze richtig?
- HEVC-Import in beiden Berechtigungszuständen (Codec des hochgeladenen
  Objekts prüfen).
- Eingeschränkter Fotozugriff («Ausgewählte Fotos») mit einem Element
  ausserhalb der Auswahl.
- Tab-Tipp während der Animation.
- Ein 31 bis 90 s langes Video gegen die Server-Grenze.
- 20 grosse HEIC-Fotos (Rückkehrzeit, stilles `canceled`).
- App-Wechsel mitten im Batch.

## Bekannte Server-Grenze (ausserhalb dieses Branches)

`posts_duration_s_check` erlaubt 0 bis 30 s
(`supabase/migrations/20260803090600_role_hardening.sql`), der Client nimmt
seit 2026-08-14 bis 90 s auf. Videos von 31 bis 90 s (Kamera wie Import)
bleiben mit 23514 in der Queue hängen; braucht eine Migration plus pgTAP in
einem eigenen PR, und 23514 gehört in `momentsApi.ts` zu den dauerhaften
Ablehnungen.

## Nicht drin

Caption je Import, Zuschneiden langer Videos, Import in nicht-aktive Reisen,
serverseitige Zeitraum-Prüfung, Teilen-Ziel (Share Extension, Weg B).
