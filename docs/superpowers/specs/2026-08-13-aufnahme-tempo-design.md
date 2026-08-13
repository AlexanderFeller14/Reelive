# Aufnahme-Tempo und Zug-Zoom — Design-Spezifikation

**Datum:** 2026-08-13
**Status:** Abgenommen (Brainstorming-Session)

## 1. Ziel

Der Aufnahme-Fluss verliert jeden spürbaren Delay und der Auslöser lernt das
Snapchat-Muster vollständig: Halten und nach oben ziehen zoomt während der
Videoaufnahme. Konkret heisst das:

- Ein Foto erscheint quasi sofort in der Vorschau, nicht nach ~1 Sekunde.
- Eine Videoaufnahme beginnt unmittelbar nach der Halte-Schwelle, ohne den
  heutigen Session-Umbau (bis zu ~1 s Retry-Schleife).
- Nach Stopp, Verwerfen und Einsenden ist der Sucher sofort wieder da.
- Während der gehaltenen Aufnahme zoomt der Daumen durch Hochziehen, ohne den
  Auslöser loszulassen.

## 2. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Kamera-Modus | Dauerhaft `mode="video"`, kein Umschalten mehr |
| Foto-Format | 16:9 mit 1920×1080 aus dem Video-Preset (statt 4:3, 12 MP) |
| Mikrofon | Dauerhaft an, solange der Sucher fokussiert ist (oranger Punkt sichtbar); bei Tab-Blur stumm |
| Foto-Weg | `takePictureAsync({ pictureRef: true })`, Bild bleibt im Speicher |
| Speichern | `savePictureAsync()` im Hintergrund, Einsenden wartet auf das Promise |
| Übergabe an die Vorschau | Modul-Holder statt Router-Params (Params bleiben für Typ/Dauer/Reise) |
| Übergang Kamera ↔ Vorschau | Ohne Animation (`animation: 'none'`), dokumentierte §5-Ausnahme |
| Shutter-Sound | Aus (`shutterSound: false`), die Haptik bleibt das Feedback |
| Zug-Zoom | `Ausloeser` meldet den vertikalen Hub, der Screen rechnet den Faktor |
| Zoom-Mapping | Exponentiell, Referenz ist der Faktor beim Aufnahmestart |
| Sperr-Geste | Bleibt unverändert, läuft parallel auf der horizontalen Achse |
| Retry-Schleife Video-Start | Bleibt als Sicherheitsnetz, greift praktisch nicht mehr |

Zum Foto-Format: die Pipeline (`medien.fotoAufbereiten`) skaliert ohnehin auf
1080 px lange Kante herunter. 1920×1080 aus dem Video-Preset liegt über diesem
Ziel, die Endschärfe bleibt praktisch gleich; es ändert sich der Ausschnitt
(16:9 füllt die Vollbild-Ansichten der App besser, 4:3 zeigte mehr Höhe).
Dieser Tausch ist die bewusste Gegenleistung für den verzögerungsfreien
Video-Start.

## 3. Dauerhafter Video-Modus

`CameraView` läuft fest mit `mode="video"`. Der `modus`-State im Screen
entfällt; was an ihm hing, wandert an einen neuen `nimmtAuf`-Zustand, den
`handleVideoStart`/`handleVideoStop` führen:

| Heute | Neu |
|---|---|
| `mode={modus}` | `mode="video"` fest |
| Kopfzeile bei `modus !== 'video'` | bei `!nimmtAuf` |
| `darfWechseln = modus !== 'video'` | `!nimmtAuf` |
| `zoomBedienbar = modus !== 'video' \|\| aufnahmeGesperrt` | `!nimmtAuf \|\| aufnahmeGesperrt` |
| `enableTorch={blitz === 'on' && modus === 'video'}` | `blitz === 'on' && nimmtAuf` |
| Video-Start im Effekt an `modus` | direkt in `handleVideoStart` |
| `setModus('picture')` nach dem Stopp | entfällt ersatzlos |
| Zoom-Nachsetzen bei Moduswechsel | entfällt (kein Preset-Wechsel mehr) |

**Video-Start:** `recordAsync` startet direkt im Halte-Handler, es gibt keinen
`mode`-Commit mehr abzuwarten. Die Startschleife (`VIDEO_START_VERSUCHE`)
bleibt bestehen: sie kostet im Normalfall nichts (der erste Versuch trifft)
und fängt weiterhin die Fälle, in denen die Session anderweitig beschäftigt
ist. Ihr Begleitkommentar wird angepasst — der ursprüngliche Grund (Umbau
durch Moduswechsel) existiert nicht mehr.

**Video-Stopp:** Die Session bleibt unangetastet, der Sucher ist nach der
Rückkehr aus der Vorschau sofort wieder aufnahmebereit.

**Mikrofon:** Ohne `mute` hängt der Audio-Input dauerhaft an der Session,
iOS zeigt den orangen Punkt, solange der Sucher offen ist — wie bei Snapchat
und Instagram, bewusst so entschieden. Damit der Punkt nicht app-weit
leuchtet (Tab-Screens bleiben gemountet), wird `mute` an den Tab-Fokus
gekoppelt: fokussiert `false`, sonst `true`. Das Umhängen des Audio-Inputs
ist ein leichter `beginConfiguration`-Block ohne Preset-Wechsel; bis zur
frühestmöglichen Aufnahme (Halte-Schwelle 500 ms) ist der Input längst
wieder da.

**Blitz:** Torch fürs Video wie gehabt. Für Fotos gilt weiter das
`flash`-Prop; ob `AVCapturePhotoOutput` im Video-Preset auf dem Gerät
tatsächlich blitzt, ist ein Verifikationspunkt der Geräte-Checkliste.
Fallback, falls nicht: beim Foto mit Blitz kurz die Torch zünden
(Snapchat-Muster).

## 4. Instant-Foto

Ablauf beim Tippen (Phase `haelt`, unter der Schwelle losgelassen):

1. Haptik wie heute, dazu sofort `pausePreview()` — der eingefrorene Sucher
   ist der gefühlte Shutter.
2. `takePictureAsync({ pictureRef: true, shutterSound: false })` liefert das
   Bild nach wenigen Dutzend Millisekunden als natives Speicher-Objekt
   (`PictureRef`), ohne JPEG-Kodierung, ohne Platten-I/O.
3. `ref.savePictureAsync()` startet sofort im Hintergrund; das Promise wandert
   mit in die Übergabe.
4. Navigation zur Vorschau. Router-Params tragen wie bisher `typ`, `dauer`,
   `tripId` — das Bild selbst geht über das Übergabe-Modul.

### `src/features/kamera/uebergabe.ts` — der Holder

Router-Params sind Strings, ein `PictureRef` passt nicht hindurch. Das Modul
hält genau eine Übergabe:

```ts
type FotoUebergabe = {
  ref: PictureRef;            // fürs Anzeigen, direkt in expo-image
  datei: Promise<{ uri: string }>; // savePictureAsync, fürs Einsenden
};

uebergeben(u: FotoUebergabe): void  // räumt eine liegengebliebene Übergabe
abholen(): FotoUebergabe | null     // einmalig, danach leer
```

`uebergeben` ersetzt eine nicht abgeholte Übergabe (der alte Ref fällt dem
GC anheim), `abholen` nimmt sie heraus. Damit `datei` nie als unbehandelte
Ablehnung endet, solange niemand wartet, hängt beim Erzeugen ein neutraler
`catch` daran, der das Ergebnis nicht verbraucht (Ablehnung bleibt für den
`await` in `absenden` erhalten, etwa indem der Fehler gemerkt und beim
`await` wieder geworfen wird — Detail der Umsetzung).

### Vorschau

- Foto-Anzeige wechselt von React-Native-`Image` auf `expo-image` — das
  versteht einen `PictureRef` (SharedRef) direkt als `source`. Quelle ist
  `ref` aus der Übergabe oder `{ uri }` aus den Params (Video, Deep-Link).
- `absenden` wartet bei Fotos auf `datei` statt die `uri` aus den Params zu
  lesen; in der Praxis ist die Datei fertig, lange bevor jemand den Knopf
  erreicht. Ab der URI läuft alles Bestehende unverändert (aufbereiten,
  dauerhaft sichern, einreihen, aufräumen).
- **Deep-Link-Fall:** weder Übergabe noch `uri`-Param → zurück zur Kamera
  (`router.replace('/aufnehmen')`) statt eines leeren Screens.
- **Verwerfen:** lässt den Ref fallen; `dateiVerwerfen` bekommt die URI aus
  `datei`, sobald sie da ist (auch ein verworfenes Foto kann schon auf der
  Platte liegen und soll dort nicht liegen bleiben).

### Rückweg

Beim erneuten Fokus des Kamera-Screens (`useFocusEffect`) läuft
`resumePreview()`. Die Kamera war nie unmountet, die Session nie umgebaut:
der Sucher läuft sofort.

## 5. Video-Stopp

Beim Loslassen (oder Stopp aus dem gesperrten Zustand): sofort
`pausePreview()` — das letzte Bild steht ruhig, statt dass der Sucher
weiterläuft, während die Datei finalisiert. Sobald `recordAsync` die URI
liefert (~100–300 ms Datei-Finalisierung, nicht wegzukürzen), Navigation zur
Vorschau; Videos gehen unverändert als Datei-URI durch die Params. Der bisher
grösste Posten nach dem Stopp — der Session-Rückbau auf `picture` — ist weg.

## 6. Übergänge (dokumentierte §5-Ausnahme)

Kamera ↔ Vorschau navigiert ohne Animation (`animation: 'none'` an der
Vorschau-Route). Das weicht bewusst von DESIGN-LANGUAGE §5 ab (Stack =
Parallax-Slide 400 ms), und zwar mit dieser Begründung: die Slide-Regel
inszeniert einen Ortswechsel. Hier gibt es keinen — eingefrorenes Sucherbild
und Foto sind deckungsgleich, es ist derselbe Kinosaal und dasselbe Bild.
Ein Slide würde dasselbe Vollbild wegschieben und wieder hereinholen und
damit genau die Verzögerung inszenieren, die diese Runde abschafft. Die
«Licht geht aus»-Inszenierung gilt dem Wechsel hell → Kino und bleibt davon
unberührt. Der Rückweg (Verwerfen, nach der Versiegelung) verhält sich
gleich.

## 7. Zug-Zoom am Auslöser

### `Ausloeser` meldet den Hub

- Beim Aufsetzen merkt sich der Auslöser neben `pageX` (Sperr-Geste) auch
  `pageY`.
- Ab Phase `video` meldet `onTouchMove` über einen neuen Prop
  `onZoomZug?: (hub: number) => void` die vertikale Verschiebung seit dem
  Aufsetzen: nach oben positiv, nach unten negativ, in pt.
- Sperr-Geste (horizontal) und Zug-Zoom (vertikal) laufen parallel und
  stören sich nicht; ein diagonaler Daumen bedient beide. Nach dem Sperren
  ist die Hand frei, dann übernehmen wie heute Pinch und Zoom-Reihe.

### Der Screen rechnet den Faktor

Beim Aufnahmestart merkt sich der Screen den aktuellen Faktor und die
Grenzen (`nativeZoom.zoomGrenzen`, wie beim Pinch). Das Mapping wird eine
reine Funktion in `zoom.ts`:

```
zugFaktor(hub, start, grenzen, basis): number
```

- **Exponentiell**, nicht linear: Zoom ist multiplikativ, ein linearer Weg
  fühlt sich am oberen Ende träge an. Snapchat mappt genauso.
- Nach oben deckt eine feste Strecke (~40 % der Bildschirmhöhe, Konstante
  fürs Feintuning am Gerät) den Weg vom Startfaktor bis zum Maximum ab.
- Nach unten führt die kurze Reststrecke bis zum unteren Bildschirmrand vom
  Startfaktor zurück Richtung Minimum (der Auslöser sitzt fast am Boden,
  viel Weg gibt es dort nicht).
- Gesetzt wird hart (`zoomSetzen(faktor, false)`): der Zoom folgt dem
  Finger, wie der Pinch.
- Begrenzt auf die Gerätegrenzen über das bestehende `begrenzen`.

### Verhalten drumherum

- Die Zoom-Reihe bleibt während der gehaltenen Aufnahme ausgeblendet (wie
  heute, wie Snapchat): der Faktor zeigt sich im Bild selbst.
- Nach dem Sperren bleibt der gezogene Faktor stehen und ist ab da per
  Pinch/Reihe veränderbar — `faktorRef` ist bereits die eine Quelle dafür.
- Nach der Aufnahme bleibt der Faktor stehen (Bestand, wie beim Pinch).
- Am Simulator und auf Android meldet `nativeZoom` nichts, `zoomSetzen` ist
  ein No-op — der Zug bewegt dort schlicht nichts, wie heute der Pinch.
- Reduced Motion ist unberührt: der Zoom folgt dem Finger, nichts animiert
  von selbst.

## 8. Fehlerbehandlung

- **`takePictureAsync` scheitert** (am Simulator immer, am Gerät bei
  Speicher-/Berechtigungsproblemen): ohne Gegenmassnahme bliebe der Sucher
  durch `pausePreview` eingefroren. Deshalb: `resumePreview()` und eine
  Fehler-Pille nach bestehendem Muster, mit eigenem Text («Das Foto hat
  nicht geklappt. Versuch es nochmal.»). Der bestehende `aufnahmeFehler`-
  Mechanismus wird dafür um den Text parametrisiert.
- **`savePictureAsync` scheitert** (voller Speicher): `absenden` wartet auf
  `datei`, die Ablehnung landet im bestehenden `catch` und zeigt
  `SENDEN_FEHLGESCHLAGEN_MELDUNG`. Der Screen bleibt stehen, der Ref lebt
  noch, ein zweiter Versuch wartet erneut.
- **Ref-Lebenszyklus:** `uebergeben` ersetzt Liegengebliebenes, `abholen`
  leert den Holder, Verwerfen lässt den Ref fallen — kein Pfad hält einen
  `PictureRef` länger als nötig im Speicher.
- **Videoaufnahme scheitert:** unverändert (Fehler-Pille, Retry-Schleife,
  `undefined`-Pfad in `handleVideoStop`).

## 9. Tests

**Unit (Jest):**

- `zoom.test.ts`: `zugFaktor` — exponentieller Verlauf, Startfaktor als
  Referenz, Klemmen an beiden Grenzen, Hub 0 gibt den Startfaktor,
  negativer Hub Richtung Minimum.
- `uebergabe.test.ts`: einmaliges Abholen, Ersetzen von Liegengebliebenem,
  keine unbehandelte Ablehnung bei scheiterndem `datei`.
- `Ausloeser.test.tsx`: `onZoomZug` feuert erst ab Phase `video`, Hub-Werte
  aus `pageY`-Differenz, Sperr-Geste unverändert daneben.
- `kamera.test.tsx`: `mode="video"` fest, `mute` hängt am Fokus, Foto-Pfad
  legt Übergabe ab und navigiert ohne `uri`-Param, Fehlerpfad ruft
  `resumePreview` und zeigt die Foto-Meldung.
- `vorschau.test.tsx`: Ref-Quelle vor URI-Param, `absenden` wartet auf
  `datei`, Deep-Link ohne beides führt zurück.

**Gerät (die Jest-Suite sieht Navigation und Kamera-Timing nicht):**

- Foto: Tipp → Vorschau gefühlt sofort; Bild scharf und richtig orientiert;
  Einsenden funktioniert; 16:9-Ausschnitt in Vorschau und Recap prüfen.
- Foto mit Blitz im Video-Preset (Verifikationspunkt aus §3).
- Video: Halten → Aufnahme beginnt unmittelbar nach der Schwelle (Ring und
  tatsächlicher Videoanfang decken sich); Stopp → Vorschau zügig; Ton ab
  der ersten Sekunde.
- Zug-Zoom: Hochziehen zoomt, Zurückziehen zoomt raus, Sperren mit
  gezogenem Zoom, danach Pinch nahtlos ab demselben Faktor.
- Oranger Mikrofon-Punkt: an im Sucher, aus in allen anderen Tabs.
- Kein Regress: Doppeltipp-Kamerawechsel, Pinch, Zoom-Reihe, Sperr-Geste,
  Zähler-Pille, Trip-Umschalter.

## 10. Nicht in dieser Runde

- Kein Umbau der Vorschau zum Overlay im Kamera-Screen — die Route bleibt.
- Kein Beschleunigen des Kamera-Kaltstarts beim ersten Tab-Öffnen
  (Hardware-Anlaufzeit der Session).
- Kein Zug-Zoom vor der Halte-Schwelle (ein Tipp bleibt ein Foto, ein
  Wischen vor der Schwelle bedeutet nichts).
- Keine Android-Zoom-Arbeiten (die Linsen-API fehlt dort, siehe
  Zoom-Spec vom 2026-08-12).
- Kein Anfassen der Versiegelungs-Inszenierung — sie ist bewusst 700–900 ms
  und kein «Delay».
