# MultiKamera: Instant-Kamerawechsel (iOS) - Design

Stand: 2026-08-18. Freigegeben vom Product Owner (Grundgerüst-Gate im Chat).

## 1. Ziel und Motivation

Der Wechsel zwischen Front- und Rückkamera dauert heute 300 bis 900 ms
(19 Messungen am Gerät: Median 338 ms, warm 40 bis 70 ms, kalt bis 900 ms),
im Sucher wie während einer laufenden Video-Aufnahme. Die Ursache ist
architektonisch: expo-camera betreibt EINE AVCaptureSession mit EINEM
Kamera-Input, jeder Wechsel tauscht den Input und wartet auf den
Sensor-Anlauf der anderen Kamera. Das ist Hardware-Zeit, in dieser
Architektur ist nichts mehr zu holen.

Der Umbau gibt der App eine eigene AVCaptureMultiCamSession, in der Front-,
Weitwinkel- und Ultraweitwinkel-Kamera DAUERHAFT parallel laufen, solange
der Sucher steht. Ein Wechsel zeigt dann nur noch den anderen, bereits
laufenden Strom: ein Frame statt hunderter Millisekunden, im Sucher wie
mitten in der Aufnahme.

### Machbarkeit (Phase-0-Sonde, iPhone 17 Pro Max, 2026-08-18)

Die Wegwerf-Sonde (MultiCamSondeModule.swift, fliegt mit dem Umbau raus)
hat am Zielgerät gemessen:

| Frage | Befund |
|---|---|
| MultiCam unterstützt | ja |
| Drei Kameras gleichzeitig (Front + Weit + Ultraweit) | ja |
| Hardware-Kosten zwei / drei Kameras | 0,50 / 0,75 (Budget: 1,0) |
| Systemdruck zwei / drei Kameras | 0,51 / 0,90 (Budget: 1,0) |
| Start der Dreifach-Session | 300 bis 407 ms (drei Läufe) |
| Erster Frame nach Start | Front 301 ms, Weit 302 ms, Ultraweit 466 ms |
| 1080p30 MultiCam-fähig | alle vier Kameras (auch Tele), beste Formate bis 4K30 |

Der Systemdruck von 0,90 mit drei Strömen ist erlaubt, aber warm; die
Schutzschaltung in §8 ist deshalb Pflichtteil, kein Nice-to-have.

Nebenfund: Die Sonde konnte die Geräte übernehmen, obwohl die
expo-camera-Session nicht freigegeben war (iOS entzieht sie der anderen
Session). Für den Umbau irrelevant, expo-camera verlässt den Screen ohnehin,
aber es erklärt, warum die Sonde ohne «Entwaffnen» lief.

## 2. Getroffene Entscheidungen (Product Owner, 2026-08-18)

1. **Geltung «Immer im Sucher»:** Beide Blickrichtungen laufen, sobald der
   Kamera-Tab offen ist, nicht erst beim Video-Start. Jeder Wechsel ist
   instant, dafür mehr Akku und Wärme im Sucher-Leerlauf.
2. **Drei Kameras statt zwei:** Auch der Ultraweitwinkel läuft dauerhaft,
   damit die 0,5×-Zoomgrenze nahtlos bleibt. Der höhere Systemdruck (0,90)
   wird über die Schutzschaltung abgefedert.
3. **Foto aus dem Videostrom:** Fotos entstehen als Frame-Grab aus dem
   laufenden Strom. Kein Qualitätsverlust gegenüber heute: Fotos sind seit
   dem 1920er-Entscheid ohnehin 1080×1920 aus dem Video-Preset.
4. **Zoom über ~4× digital (v1):** Kein Tele-Strom, hohe Zoomstufen werden
   digital aus dem Weitwinkel gerechnet (Snapchat-Muster). Die Tele-Linse
   als vierter, tauschbarer Slot ist späterer Ausbau (kostet beim Übertritt
   einmalig ~400 ms Sensor-Anlauf).
5. **expo-camera bleibt als Fallback:** Für Android, für iOS-Geräte ohne
   MultiCam und für den Simulator ändert sich nichts.

## 3. Architektur im Überblick

Neues Native-Modul **MultiKamera** im bestehenden Pod
(`modules/kamera-zoom/ios/`), bestehend aus:

- **MultiKameraModule** (expo-modules `Module`): besitzt die
  AVCaptureMultiCamSession, die drei Video-Inputs, den Audio-Input und
  alle Outputs. Lebenszyklus-, Wechsel-, Zoom-, Foto- und Aufnahme-API
  Richtung JavaScript.
- **MultiKameraSucherView** (expo-modules `View`): die Sucher-Fläche mit
  einer AVCaptureVideoPreviewLayer pro Kamera (drei Ebenen übereinander,
  `videoGravity = resizeAspectFill`). Sichtbar ist genau eine.
- **KameraAufnahme** (bestehend): schreibt wie heute per AVAssetWriter,
  bekommt seine Puffer aber vom MultiKamera-Verteiler statt von Outputs,
  die nachträglich an die expo-camera-Session gehängt werden. StartFenster
  und SofortVorschau bleiben unverändert.
- **KameraZoom** (bestehend): setzt `videoZoomFactor` künftig auf die
  Geräte, die MultiKamera hält; die Sucher-Suche über die View-Hierarchie
  entfällt für den MultiCam-Pfad.

Auf der JS-Seite bekommt der Aufnehmen-Screen eine Weiche: ist MultiCam
verfügbar (neues, synchron lesbares Modul-Flag), rendert er
`MultiKameraSucher` statt `CameraView` und spricht die neue API; sonst
läuft der heutige expo-camera-Pfad unverändert. Die Weiche liegt in einem
eigenen Adapter (`src/features/kamera/multiKamera.ts`), damit der Screen
nur EINE Kamera-Schnittstelle kennt.

### Session-Aufbau (nativ)

- `AVCaptureMultiCamSession`, manuell verdrahtet
  (`addInputWithNoConnections` / `addOutputWithNoConnections` /
  `AVCaptureConnection`), wie in der Sonde erprobt.
- Pro Kamera: Format 1920×1080\@30 mit `isMultiCamSupported`, ein
  `AVCaptureVideoDataOutput`, eine Verbindung zur eigenen Preview-Layer.
- Ein `AVCaptureAudioDataOutput` am Mikrofon (Audio-Session-Verhalten wie
  heute: Mikrofon hängt dran, solange der Sucher steht, damit kein
  Session-Umbau beim Aufnahmestart ruckelt; das Muster hat sich beim
  Verwerfen-Rückweg bewährt).
- Orientierung und Spiegelung werden pro Verbindung fest gesetzt
  (Hochkant, Front gespiegelt), das heutige Pro-Frame-Angleichen samt
  Hochkant-Wächter in KameraAufnahme bleibt als zweite Verteidigungslinie
  bestehen.

## 4. Wechsel-Semantik (der Kern)

Zustand im Modul: `aktiveKamera` (front | weit | ultraweit). Ein Wechsel
Front/Back oder ein Zoomwechsel über die 1×-Grenze ändert nur diesen
Zustand und schaltet die Sichtbarkeit der Preview-Ebenen um, auf dem
Main-Thread, ohne Session-Rekonfiguration. Erwartete Dauer: ein Frame
(~33 ms), gemessen wird in der Geräterunde.

Während einer Video-Aufnahme entscheidet derselbe Zustand, welcher Strom
in den AVAssetWriter geht: der Verteiler reicht nur Frames der aktiven
Kamera an `schreibeVideo` weiter, Ton läuft ununterbrochen durch. Die
Zeitachse bleibt kontinuierlich (die Puffer aller Kameras tragen dieselbe
Session-Clock), es entsteht keine Lücke und kein Standbild. Der
JS-Doppeltipp ruft nur noch `wechsleKamera()` am Modul, die heutige
expo-camera-Sonderbehandlung (nativLaeuft-Gate, WechselBlende,
onAvailableLensesChanged-Wartezeit) entfällt im MultiCam-Pfad.

## 5. Zoom

Abbildung des UI-Zooms z auf Gerät und Faktor:

- z < 1: Ultraweitwinkel, `videoZoomFactor = 2·z` (0,5 → 1,0)
- z ≥ 1: Weitwinkel, `videoZoomFactor = z`, digital ohne Obergrenze bei
  der Tele-Schwelle (Entscheidung §2.4)

Die Rechenlogik (Stufen, Zug-Zoom, Grenzen) bleibt in `zoom.ts` auf der
JS-Seite; neu ist nur, dass `setzeZoom` im MultiCam-Pfad an MultiKamera
geht, das den Faktor auf das richtige Gerät legt und bei einem
Grenzübertritt zusätzlich die aktive Kamera wechselt. Sanfte Rampen
(`ramp(toVideoZoomFactor:withRate:)`) wie heute im KameraZoom-Modul.

## 6. Foto

`fotoAufnehmen()` greift den nächsten Frame der aktiven Kamera aus dem
Videostrom (CVPixelBuffer → HEIC/JPEG auf Disk; `captured_at` kommt
unverändert aus der JS-Seite wie heute), gespiegelt für die Frontkamera
(heutiges `mirror:true`-Verhalten). Der Blitz läuft über einen Torch-Puls am aktiven Gerät; das
sichtbare Verhalten (Blitz-Einstellung im Sucher) bleibt exakt wie heute.
Damit wird auch das Foto sofortig: kein `takePictureAsync`-Umweg über
expo-camera mehr, das Polaroid in der Vorschau bekommt den Frame, der im
Moment des Auslösens auf dem Schirm stand.

## 7. Fokus und Belichtung

Tap-to-Focus setzt Fokus- und Belichtungspunkt auf dem AKTIVEN Gerät
(Umrechnung Screen → Device-Koordinaten über die zugehörige Preview-
Layer), mit Subject-Area-Monitoring und automatischem Zurückstellen wie
heute im KameraZoom-Modul. Kontinuierlicher Autofokus als Grundzustand
auf allen drei Kameras.

## 8. Lebenszyklus und Schutzschaltung

- **Start/Stopp:** Der Aufnehmen-Screen startet die Session bei Fokus.
  Sie STOPPT beim Wechsel auf einen anderen Tab und im App-Hintergrund,
  läuft aber unter der Aufnahme-Vorschau WEITER, exakt wie der heutige
  expo-camera-Pfad (Mikrofon-bleibt-dran-Muster): nur so bleibt der
  Verwerfen-Rückweg instant und ohne Standbild. Startdauer ~300 bis
  400 ms, in dieser Zeit zeigt der Sucher die bestehende dunkle Fläche.
- **Unterbrechungen:** `AVCaptureSessionWasInterrupted` (Anruf,
  Hintergrund, Kamera-Entzug) beendet eine laufende Aufnahme sauber über
  den bestehenden Unterbrechungs-Pfad von KameraAufnahme und startet die
  Session bei `InterruptionEnded` neu.
- **Schutzschaltung Wärme:** Beobachter auf
  `systemPressureState`. Ab `.serious` wird die Ultraweitwinkel-
  Verbindung deaktiviert (Systemdruck fällt Richtung 0,5; der Zoom
  klemmt vorübergehend bei mindestens 1×, ein laufender 0,5×-Sucher
  springt auf 1×). Bei Rückkehr zu `.nominal`/`.fair` kommt der Strom
  wieder. Ab `.critical` zusätzlich Frontkamera-Strom deaktivieren,
  falls die Rückkamera aktiv ist (und umgekehrt); der Wechsel kostet
  dann übergangsweise wieder Sensor-Anlauf, das ist der gewollte Preis
  für Nicht-Drosseln.
- **Fallback:** Ist MultiCam nicht verfügbar oder scheitert der
  Session-Start zweimal in Folge, schaltet die JS-Weiche für die
  laufende App-Sitzung auf den expo-camera-Pfad zurück.

## 9. Fehlerfälle

| Fall | Verhalten |
|---|---|
| MultiCam nicht unterstützt (alte Geräte, Simulator) | Weiche rendert expo-camera-Pfad, keine Funktionseinbusse gegenüber heute |
| Session-Start scheitert | einmal neu versuchen, danach Fallback expo-camera + Fehlerpille wie heute |
| Einzelnes Gerät fehlt (kein Ultraweitwinkel) | Session mit zwei Kameras, Zoomgrenze bei 1× |
| Systemdruck `.shutdown`-nah | Schutzschaltung §8, Aufnahme läuft auf dem aktiven Strom weiter |
| Aufnahme läuft, App geht in den Hintergrund | bestehender Unterbrechungs-Pfad: Aufnahme sauber stoppen, Datei in die Vorschau |

## 10. Tests und Verifikation

- **Jest (JS):** Weiche (MultiCam ja/nein), Zoom-Abbildung z → (Gerät,
  Faktor) als reine Funktion, Screen-Verhalten im MultiCam-Pfad
  (Doppeltipp ruft `wechsleKamera`, kein Blenden-Gate mehr), Fallback-
  Umschaltung nach Startfehler. Natives Modul wie KameraAufnahme über
  `requireOptionalNativeModule`-Mocks.
- **Geräterunde (bindend, wie bei der Instant-Pipeline):** Wechselzeit im
  Sucher und mitten in der Aufnahme (Messsonde, Ziel: unter zwei Frames),
  0,5×-Grenze nahtlos, Foto-Qualität und -Spiegelung, Video mit mehreren
  Wechseln inkl. Ton-Sync im Recap, 5-Minuten-Wärmetest mit
  Schutzschaltungs-Beobachtung, Unterbrechung durch Anruf/Home-Wischer.
- Die Jest-Suite sieht keine native Session; was nur am Gerät beweisbar
  ist, steht im Plan als expliziter Geräteschritt (Lehre aus den
  bisherigen Runden).

## 11. Nicht-Ziele

- Android bleibt beim expo-camera-Pfad (kein Instant-Wechsel).
- Tele-Optik, 4K, HDR: nicht in v1.
- Kein Picture-in-Picture / gleichzeitiges Aufnehmen beider Kameras.

## 12. Aufräumen im Zuge des Umbaus

Die Phase-0-Sonde (MultiCamSondeModule.swift, multiCamSonde.ts, der
[dbg]-Knopf im Profil-Tab) fliegt raus, ebenso die dann überflüssige
WechselBlende samt Frist-Logik im MultiCam-Pfad und die [dbg-flip]-Sonden.
