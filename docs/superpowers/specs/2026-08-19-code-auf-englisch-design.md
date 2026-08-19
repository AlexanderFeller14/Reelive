# Quellcode auf Englisch umstellen

Status: freigegeben am 2026-08-19

## Warum

Reelive wurde durchgehend mit deutschen Bezeichnern gebaut (`kinoBuehne.ts`,
`urlVorrat`, `Ausloeser.tsx`). Quellcode gehört auf Englisch: das ist die
Sprache der Plattform, der Bibliotheken und jedes Entwicklers, der später
dazukommt. Die Oberfläche bleibt davon unberührt, sie spricht weiter Deutsch
in der Du-Form gemäss `DESIGN-LANGUAGE.md` §6.

## Ausgangslage (gemessen am 2026-08-19)

| Grösse | Wert |
|---|---|
| TypeScript-Dateien in `mobile/src` | 225, davon 102 Testdateien |
| Codezeilen | 52 036 |
| Kommentarzeilen | 13 340, davon rund 10 700 deutsch |
| Sichtbare deutsche UI-Strings | 1161 |
| Navigationspfade als String-Literal | 46 |
| Swift-Zeilen im eigenen Native-Modul | 2428 |
| TypeScript in `supabase/functions` | 41 Dateien, 10 659 Zeilen, 20 Deno-Tests |
| Tests | 1838 in 104 Suites, alle grün |
| `tsc --noEmit` | fehlerfrei |

Bereits englisch und deshalb nicht Teil der Arbeit: das gesamte
Datenbankschema (`trips`, `posts`, `share_links`, `captured_at`), die meisten
RLS-Funktionen, die Feature-Ordner `auth`, `trips`, `recap`, `moments`, `push`
sowie die Basiskomponenten (`Button`, `Card`, `Badge`, `Input`, `Sheet`).

## Rahmenbedingungen

Die App läuft ausschliesslich lokal: keine gehostete Instanz mit Inhalten,
keine fremden Installationen, keine verschickten Share-Links. Daraus folgt für
die gesamte Umstellung: **es gibt keine Rückwärtskompatibilität zu wahren.**
Keine Datenmigration, kein Übergangszeitraum mit doppelten Namen, kein
Kompatibilitätscode. Persistente Daten auf dem Testgerät dürfen verloren gehen.

## Umfang

### Wird englisch

Alles innerhalb einer `.ts`, `.tsx`, `.swift`, `.sql`-Datei: Variablen,
Funktionen, Typen, Konstanten, Datei- und Ordnernamen, Kommentare,
Testbeschreibungen in `describe` und `test`. Dazu die Namen der Edge Functions,
der beiden deutschen SQL-Funktionen, der Vault-Secrets, der persistenten
Speicher-Keys und der lokalen SQLite-Tabelle.

Testbeschreibungen behalten dabei ihre Erzählkraft. Aus

    test('bei einem verschluckten Ortstag kann RecapTag.datum vom eigenen
          lokalen Datum eines Moments abweichen')

wird

    test('a swallowed local day lets RecapTag.datum differ from a moment own
          local date')

und nicht etwa ein blutleeres `test('day assignment')`.

### Bleibt deutsch

Die 1161 sichtbaren UI-Texte. Sämtliche Dokumente unter `docs/`, dazu
`CLAUDE.md`, `DESIGN-LANGUAGE.md`, `README.md` und `TODO.md`. Commit-Messages
folgen weiter der bisherigen Praxis auf Deutsch.

### Wird ausdrücklich nicht getan

Kein i18n-System, keine Extraktion der UI-Texte in eine Sprachdatei. Keine
Schema-Migration: die Tabelle heisst weiter `posts`. Keine Verhaltensänderung,
keine Umstrukturierung von Modulen, kein Refactoring über die Umbenennung
hinaus. Jede Etappe ist im Ergebnis eine reine Umbenennung.

## Glossar

Verbindlich für alle Etappen. Bei jedem Zweifel gilt dieses Wörterbuch, nicht
das Sprachgefühl im Moment der Umsetzung.

| Deutsch | Englisch | Deutsch | Englisch |
|---|---|---|---|
| Reise | `trip` | Auslöser | `shutter` |
| Moment | `moment` | Aufnehmen, Aufnahme | `capture` |
| Siegel, versiegeln | `seal` | Vorschau | `preview` |
| Kamera | `camera` | Übersicht | `overview` |
| Karte | `map` | Einladen, Einladung | `invite` |
| Konto | `account` | Zähler | `counter` |
| Teilen | `share`, Ordner `sharing` | Fehler | `error` |
| Nadel | `pin` | Vorrat | `pool` |
| Bühne | `stage` | Übergabe | `handoff` |
| Sperre | `lock` | Gesehen | `seen` |
| Melden | `report` | Tage | `days` |
| Fläche | `surface` | Ausschnitt | `viewport` |
| Gruppierung | `clustering` | Platzhalter | `placeholder` |
| Zuschnitt | `crop` | Wähler | `picker` |
| Oberkante | `topInset` | Adresse (URL) | `url` |

`Recap` und `Moment` bleiben unverändert, beide sind gültiges Englisch und
zugleich das Produktvokabular.

### Kernbegriff moment

Der Code spricht durchgehend von `moment` und `moments`, passend zur
Oberfläche. `postsApi.ts` wird zu `momentsApi.ts`, `postId` zu `momentId`,
`postsKette` zu `momentChain`. Ausschliesslich dort, wo eine Supabase-Query
eine Tabelle oder Spalte benennt, stehen weiter `posts` und `post_id`, weil
das die Namen im Schema sind. Diese Grenze verläuft sauber an den API-Modulen.

## Datei- und Ordnerumbenennungen

### `mobile/src/app`

| Vorher | Nachher |
|---|---|
| `(tabs)/aufnehmen/` | `(tabs)/capture/` |
| `(tabs)/profil.tsx` | `(tabs)/profile.tsx` |
| `(tabs)/reise/` | `(tabs)/trip/` |
| `(tabs)/reise/neu.tsx` | `(tabs)/trip/new.tsx` |
| `(tabs)/reise/[id]/bearbeiten.tsx` | `(tabs)/trip/[id]/edit.tsx` |
| `(tabs)/reise/[id]/einladen.tsx` | `(tabs)/trip/[id]/invite.tsx` |
| `(tabs)/recap/[id]/uebersicht.tsx` | `(tabs)/recap/[id]/overview.tsx` |
| `(tabs)/recap/[id]/karte.tsx` | `(tabs)/recap/[id]/map.tsx` |
| `teilen/[token].tsx` | `share/[token].tsx` |
| `vorschau.tsx` | `preview.tsx` |

### `mobile/src/components`

| Vorher | Nachher |
|---|---|
| `Ausloeser.tsx` | `ShutterButton.tsx` |
| `AvatarWaehler.tsx` | `AvatarPicker.tsx` |
| `AvatarZuschnitt.tsx` | `AvatarCropper.tsx` |
| `Fortschrittsbalken.tsx` | `ProgressBar.tsx` |
| `Kalender.tsx` | `Calendar.tsx` |
| `KartenNadel.tsx` | `MapPin.tsx` |
| `MemorySubmissionAnimation.tsx` | `MomentSubmissionAnimation.tsx` |
| `Pille.tsx` | `Pill.tsx` |
| `RevealInszenierung.tsx` | `RevealSequence.tsx` |
| `SiegelAbziehen.tsx` | `SealPeel.tsx` |
| `Versiegelung.tsx` | `SealAnimation.tsx` |
| `ZaehlerRoll.tsx` | `CounterRoll.tsx` |
| `Zeitraumfeld.tsx` | `DateRangeField.tsx` |
| `ZoomWahl.tsx` | `ZoomSelector.tsx` |

### `mobile/src/features`

| Vorher | Nachher |
|---|---|
| `kamera/` | `camera/` |
| `kamera/aufnahmeSperre.ts` | `camera/captureLock.ts` |
| `kamera/kinoBuehne.ts` | `camera/cinemaStage.ts` |
| `kamera/multiKamera.ts` | `camera/multiCamera.ts` |
| `kamera/nativeAufnahme.ts` | `camera/nativeCapture.ts` |
| `kamera/uebergabe.ts` | `camera/handoff.ts` |
| `karte/` | `map/` |
| `karte/KartenFlaeche.tsx` (+`.web`) | `map/MapSurface.tsx` |
| `karte/ausschnitt.ts` | `map/viewport.ts` |
| `karte/gruppenTipp.ts` | `map/clusterTap.ts` |
| `karte/gruppierung.ts` | `map/clustering.ts` |
| `karte/kartenPunkte.ts` | `map/mapPoints.ts` |
| `karte/nadel.ts` | `map/pin.ts` |
| `karte/typen.ts` | `map/types.ts` |
| `konto/kontoApi.ts` | `account/accountApi.ts` |
| `moments/einstellungen.ts` | `moments/settings.ts` |
| `moments/medien.ts` | `moments/media.ts` |
| `moments/ortUndZeit.ts` | `moments/placeAndTime.ts` |
| `moments/postsApi.ts` | `moments/momentsApi.ts` |
| `moments/queuePfade.ts` | `moments/queuePaths.ts` |
| `moments/zaehler.ts` | `moments/counter.ts` |
| `push/einstellungen.ts` | `push/settings.ts` |
| `recap/gesehen.ts` | `recap/seen.ts` |
| `recap/meldenApi.ts` | `recap/reportApi.ts` |
| `recap/siegelPeel.ts` | `recap/sealPeel.ts` |
| `recap/sozialApi.ts` | `recap/socialApi.ts` |
| `recap/tage.ts` | `recap/days.ts` |
| `recap/uhrzeit.ts` | `recap/timeOfDay.ts` |
| `recap/urlVorrat.ts` | `recap/urlPool.ts` |
| `teilen/` | `sharing/` |
| `teilen/TeilenSheetInhalt.tsx` | `sharing/ShareSheetContent.tsx` |
| `teilen/linkVerwaltenApi.ts` | `sharing/linkManagementApi.ts` |
| `teilen/texte.ts` | `sharing/texts.ts` |
| `trips/kalender.ts` | `trips/calendar.ts` |
| `trips/platzhalterCover.ts` | `trips/placeholderCover.ts` |
| `trips/useReiseGebunden.ts` | `trips/useTripBound.ts` |

### `mobile/src/lib` und `mobile/src/theme`

| Vorher | Nachher |
|---|---|
| `lib/fehlermelder.ts` | `lib/errorReporter.ts` |
| `lib/netzfehler.ts` | `lib/networkError.ts` |
| `lib/supabaseAdresse.ts` | `lib/supabaseUrl.ts` |
| `theme/useOberkante.ts` | `theme/useTopInset.ts` |

Jede Testdatei unter `__tests__` wandert mit ihrem Modul mit.

### Natives Modul

| Vorher | Nachher |
|---|---|
| `mobile/modules/kamera-zoom/` | `mobile/modules/camera-zoom/` |
| `KameraZoomModule.swift` | `CameraZoomModule.swift` |
| `KameraAufnahmeModule.swift` | `CameraCaptureModule.swift` |
| `MultiKameraModule.swift` | `MultiCameraModule.swift` |
| `MultiKameraSucherView.swift` | `MultiCameraViewfinderView.swift` |
| `SofortVorschauView.swift` | `InstantPreviewView.swift` |
| `ios/KameraZoom.podspec` | `ios/CameraZoom.podspec` |
| `requireNativeViewManager('KameraAufnahme')` | `requireNativeViewManager('CameraCapture')` |

Die Modulnamen stehen zusätzlich in `expo-module.config.json` unter
`apple.modules` und müssen dort mitwandern.

### Edge Functions

Betroffen sind nicht nur die drei deutschen Funktionsnamen, sondern der Code
in allen sieben Functions: 41 Dateien mit 10 659 Zeilen, darunter Bezeichner
wie `loescheEins`, `AnfrageBody`, `anfragendeId`, `alsHttpAntwort` und
`LesePruefTrip`.

| Vorher | Nachher |
|---|---|
| Function `konto-loeschen` | `delete-account` |
| Function `moment-entfernen` | `remove-moment` |
| Function `reveal-zeitplan` | `reveal-schedule` |
| `share-link/aufloesung.ts` | `share-link/resolution.ts` |
| `share-link/benachrichtigung.ts` | `share-link/notification.ts` |
| `share-link/verwaltung.ts` | `share-link/management.ts` |
| `moment-entfernen/zugriff.ts` | `remove-moment/access.ts` |
| `.../lesenZugriff.ts` | `.../readAccess.ts` |
| `reveal-zeitplan/zeitplan.ts` | `reveal-schedule/schedule.ts` |
| `reveal-zeitplan/zeitplanStore.ts` | `reveal-schedule/scheduleStore.ts` |
| `_shared/fehlermelder.ts` | `_shared/errorReporter.ts` |

Die zugehörigen `_test.ts`-Dateien wandern jeweils mit. Für die Bezeichner
gilt dasselbe Glossar wie im Client, ergänzt um `Anfrage` als `request`,
`Antwort` als `response`, `Zugriff` als `access`, `Auflösung` als
`resolution`, `Benachrichtigung` als `notification`, `Verwaltung` als
`management` und `Zeitplan` als `schedule`.

### Datenbank

| Vorher | Nachher |
|---|---|
| SQL `recap_ist_geteilt` | `recap_is_shared` |
| SQL `rufe_reveal_zeitplan` | `call_reveal_schedule` |
| Vault-Secret `projekt_url` | `project_url` |
| Vault-Secret `cron_geheimnis` | `cron_secret` |

### Hilfsskripte

| Vorher | Nachher |
|---|---|
| `scripts/testmedien-hochladen.mjs` | `scripts/upload-test-media.mjs` |
| `mobile/scripts/netz.js` | `mobile/scripts/network.js` |
| `mobile/scripts/netzAdresse.js` | `mobile/scripts/networkAddress.js` |
| npm-Skript `netz` in `package.json` | `network` |

Die beiden SQL-Funktionen werden nicht per `alter function ... rename`
geändert, sondern in einer neuen Migration mit `drop function` und
anschliessendem `create or replace function` unter dem neuen Namen. Der
`pg_cron`-Job aus `20260818100000_auto_reveal.sql` ruft
`rufe_reveal_zeitplan` auf und wird in derselben Migration neu angelegt.
Die pgTAP-Tests unter `supabase/tests/` prüfen die Funktionsnamen und wandern
mit.

### Persistente Keys

| Vorher | Nachher |
|---|---|
| `reelive.benachrichtigungen` | `reelive.notifications` |
| `reelive.reisen.` | `reelive.trips.` |
| `reelive.reveal_gesehen.` | `reelive.reveal_seen.` |
| `reelive.zaehler.` | `reelive.counters.` |
| SQLite-Tabelle `verworfene_momente` | `discarded_moments` |

Ohne Migration. Beim ersten Start nach der Umstellung sind die alten Werte
unerreichbar und die App verhält sich wie bei einer Neuinstallation. Das ist
gewollt und laut Rahmenbedingungen zulässig.

## Vorgehen

### Werkzeug

Bezeichner werden über die TypeScript-Sprachebene umbenannt, konkret mit
`ts-morph` und dessen `rename`, nicht mit `sed`. Der Unterschied ist der
Schutz der 1161 UI-Texte: ein semantisches Rename kennt Deklaration und
Verwendung, respektiert Scopes und fasst String-Literale grundsätzlich nicht
an. Ein textueller Ersatz von `Reise` würde `"Neue Reise"` mittreffen.

Dateien wandern mit `git mv`, damit die Historie erhalten bleibt.

Drei Klassen sind der Automatik nicht zugänglich und werden von Hand geführt:
die 46 Navigationspfade, die Speicher-Keys und die Kommentare.

Für `supabase/functions` steht `ts-morph` nicht zur Verfügung, weil Deno seine
Abhängigkeiten über URL-Importe auflöst und kein `tsconfig.json`-Projekt
bildet, an dem das Werkzeug ansetzen könnte. Dort wird Datei für Datei von
Hand umbenannt, abgesichert durch `deno check` und die 20 vorhandenen Tests.
Das ist vertretbar, weil der Code dort keine sichtbaren UI-Texte enthält und
das Hauptrisiko des textuellen Ersetzens damit entfällt.

### Etappen

Die Reihenfolge folgt den Abhängigkeiten, von blattnah nach aussen, damit
jede Etappe für sich grün ist und einzeln zurückgenommen werden kann.

0. Offene Arbeit im Arbeitsbaum committen (MultiKamera-Umbau, Siegel-Peel und
   die übrigen 27 Änderungen), damit Umbenennung und Inhalt sich im Diff nicht
   vermischen
1. `lib/` und `theme/`
2. `features/moments`
3. `features/recap`
4. `features/trips`
5. `features/kamera` nach `features/camera`
6. `features/karte` nach `features/map`
7. `features/teilen` nach `features/sharing` und `features/konto` nach
   `features/account`
8. `components/`
9. Routen unter `app/` samt der 46 Pfad-Strings, in einer Etappe, weil
   Dateiname und Pfad-String zusammengehören. In derselben Etappe wird
   ausschliesslich der erzeugte Pfad `/teilen/${token}` in
   `supabase/functions/share-link/index.ts:372`, die Konstante
   `TEILEN_BASIS_URL` und die Zusicherung im Integrationstest angepasst, sonst
   zeigt der erzeugte Link ins Leere. Der übrige Code dieser Function bleibt
   bis Etappe 11 unberührt
10. Natives Modul samt Podspec, `expo-module.config.json` und dem
    View-Manager-String. Danach ist ein neuer Native-Build nötig
11. Edge Functions: erst der Code innerhalb der sieben Functions, dann die
    Dateinamen, zuletzt die drei Verzeichnisnamen, weil deren Umbenennung
    den Aufrufnamen ändert und die Aufrufstellen im Client mitziehen muss
12. Datenbank: SQL-Funktionen, Vault-Secrets, pgTAP-Tests,
    `supabase/README.md`
13. Persistente Keys und die SQLite-Tabelle
14. Hilfsskripte unter `scripts/` und `mobile/scripts/` samt npm-Skript

### Kommentare

Für jeden deutschen Kommentar wird in dieser Reihenfolge geprüft:

1. **Ein Test deckt die Aussage bereits ab.** Dann wird der Kommentar
   gelöscht. Beispiele aus der Stichprobe: die Datumsgrenzenregel in
   `recap/tage.ts` ist durch `test('bei einem verschluckten Ortstag kann
   RecapTag.datum vom eigenen lokalen Datum eines Moments abweichen')`
   abgedeckt, der Lazy-Init in `moments/queueDb.ts` durch `test('öffnet die
   Datenbank nicht beim Import, sondern erst beim ersten Zugriff')`. Beide
   Testnamen sind hier im heutigen Zustand zitiert und werden in derselben
   Etappe selbst ins Englische übertragen.
2. **Die Aussage ist testbar, aber ungetestet.** Dann wird der fehlende Test
   geschrieben, mit englischem, erzählendem Namen, und der Kommentar gelöscht.
3. **Jest kann es strukturell nicht sehen.** Layout, Kamerabild, Navigation,
   Timing am Gerät. Dann bleibt ein kurzer englischer Kommentar stehen,
   einschliesslich Gerätefund und Datum. Beispiel: der Kommentarkopf von
   `kamera/kinoBuehne.ts` über die 10 Prozent Bildbreite, für den es keinen
   Test gibt und geben kann.

Reines Nacherzählen des Codes (`// setzt den Zähler zurück` über
`setZaehler(0)`) fällt unter Fall 1 und wird gelöscht.

Kommentare, die auf andere Dateien verweisen, müssen beim Umbenennen
mitgezogen werden. Besonderer Fall: `Versiegelung.tsx` wird nirgends
importiert, aber in sechs Kommentaren in `profil.tsx`, `player.tsx` und
`aufnehmen/index.tsx` als Referenzmuster für Animationen zitiert. Diese
Verweise werden auf `SealAnimation.tsx` aktualisiert, die Datei bleibt trotz
fehlendem Import erhalten.

## Verifikation

Nach jeder Etappe, vor dem Commit:

| Prüfung | Erwartung |
|---|---|
| `npx tsc --noEmit` | fehlerfrei |
| `npx jest` | 1838 Tests grün, oder mehr, wenn Fall 2 neue hinzugefügt hat |
| `npx expo lint` | keine neuen Fehler gegenüber dem Stand vor der Etappe |

Zusätzlich zwei projektweite Wächter:

1. **Zähler der sichtbaren Texte.** Die Zahl der deutschen UI-Strings muss bei
   1161 bleiben. Sinkt sie, hat das Werkzeug einen sichtbaren Text erwischt.
   Steigt sie, wurde versehentlich ein Bezeichner zu einem String.
2. **Suche nach deutschen Resten.** Ein `grep` auf Umlaute und die
   Glossar-Stämme (`reise`, `karte`, `fehler`, `zaehler`, ...) ausserhalb von
   String-Literalen und Kommentaren muss in den bereits umgestellten Ordnern
   leer sein.

Beide Wächter werden als Skript unter `scripts/` abgelegt, damit sie in jeder
Etappe identisch laufen und der Befund vergleichbar bleibt.

Für die Etappen 11 bis 14 greift die Jest-Suite nicht, weil sie den
Server-Code nicht sieht. Dort gilt stattdessen:

| Etappe | Prüfung |
|---|---|
| 11 Edge Functions | `cd supabase/functions && deno check` über alle Dateien, `deno test --allow-env` für alle 20 Tests, danach jede der sieben Functions einmal gegen die lokale Instanz aufrufen |
| 12 Datenbank | `supabase db reset` und `supabase test db`, dazu ein Blick in `cron.job`, ob der Auto-Reveal-Job auf den neuen Funktionsnamen zeigt |
| 14 Hilfsskripte | `npm run network` startet, das Upload-Skript lädt eine Testdatei hoch |

Die Etappen 10 und 13 sieht die Suite ebenfalls nicht, weil sie weder den
Native-Build noch den persistenten Speicher kennt. Beide brauchen einen Lauf
auf dem Gerät: Kamera öffnen, Foto und Video aufnehmen, einsenden, Recap
ansehen, App neu starten.

## Risiken

| Risiko | Gegenmassnahme |
|---|---|
| Ein UI-Text wird mitübersetzt | Semantisches Rename fasst Strings nicht an, plus Wächter 1 |
| Ein Navigationspfad passt nicht mehr zur Datei | Route und Pfad-String in derselben Etappe, expo-router wirft zur Laufzeit, deshalb Gerätelauf nach Etappe 9 |
| Ein Kommentar mit hart erkämpftem Wissen geht verloren | Dreistufige Prüfung, im Zweifel behalten. Fall 3 ist der Standard, nicht die Ausnahme |
| Der Native-Build bricht | Etappe 10 isoliert, danach `expo prebuild` mit anschliessender Kontrolle der Signing-Einstellungen |
| Der Cron-Job ruft eine gelöschte SQL-Funktion | Drop, Create und Job-Neuanlage in einer einzigen Migration |

## Erfolgskriterium

`grep` findet in `mobile/src`, `mobile/modules` und `supabase/functions`
ausserhalb von sichtbaren String-Literalen keine deutschen Bezeichner mehr.
Die Testsuite ist grün, die App startet auf dem Gerät, Aufnahme und Recap
funktionieren, und die Oberfläche zeigt unverändert dieselben deutschen Texte
wie vorher.
