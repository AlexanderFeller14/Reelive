# MultiKamera: Instant-Kamerawechsel (iOS) - Implementationsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eigene AVCaptureMultiCamSession mit drei dauerhaft laufenden Kameras
(Front, Weitwinkel, Ultraweitwinkel) ersetzt expo-camera auf dem
Aufnehmen-Screen, damit jeder Kamerawechsel (Sucher und laufende Aufnahme)
in einem Frame statt in 300 bis 900 ms passiert.

**Architecture:** Neues Native-Modul `MultiKamera` im bestehenden Pod
`modules/kamera-zoom` besitzt Session, Inputs, Outputs und eine Sucher-View
mit einer Preview-Layer pro Kamera; ein Wechsel schaltet nur Sichtbarkeit
und Verteiler-Ziel um. Die bestehende Aufnahme-Klasse (`Aufnahme` in
KameraAufnahmeModule.swift) und die SofortVorschau werden wiederverwendet:
der neue Verteiler füttert `KameraAufnahmeModule.aktuelle` direkt. Auf der
JS-Seite kapselt `src/features/kamera/multiKamera.ts` das Modul, und der
Aufnehmen-Screen bekommt eine Weiche MultiCam-Pfad / expo-camera-Fallback.

**Tech Stack:** Expo 57 (expo-modules-core, TypeScript strict), Swift /
AVFoundation (AVCaptureMultiCamSession), Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-18-multikamera-instant-wechsel-design.md`

## Global Constraints

- UI-Sprache Deutsch (Du-Form), Bezeichner im Projektstil deutsch; KEINE
  Gedankenstriche (—) in Code, Kommentaren, Texten.
- TypeScript strict; nach jedem Task `npx tsc --noEmit` und
  `npx eslint src/` (GANZ src/, nicht nur die eigene Datei; 29 vorbestehende
  Fehler sind bekannt und bleiben, es dürfen keine NEUEN dazukommen).
- Jest: `npm test` im Ordner `mobile/`; einzelne Suiten über
  `npm test -- --testPathPattern "kamera.test"` (Klammern in Pfaden sind
  Regex, deshalb Muster ohne Klammern).
- Nach JEDER neuen Swift-Datei: `cd mobile/ios && pod install` (der
  CocoaPods-Glob ist ein Snapshot), sonst kompiliert die Datei nicht mit.
- Swift-Kompilier-Check pro nativem Task:
  `cd mobile/ios && xcodebuild -workspace Reelive.xcworkspace -scheme Reelive -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
  (endet mit `BUILD SUCCEEDED`).
- Die Jest-Suite sieht KEINE native Session. Alles, was nur am Gerät
  beweisbar ist, steht als expliziter Geräte-Meilenstein im Plan und wird
  vom Controller mit dem Product Owner am iPhone verifiziert, nie vom
  Implementer behauptet.
- Plan-Snippets sind Skizzen (Projekt-Konvention): bindend sind die
  Prosa-Anforderungen und die Interfaces; wer ein Snippet gegen den echten
  Dateistand anpasst, hält die Prosa ein, nicht das Snippet.
- Commits lokal pro Task; NIE pushen (Push nur auf ausdrückliches Kommando
  des Product Owners).
- Der expo-camera-Pfad des Screens bleibt vollständig funktionsfähig
  (Android, Simulator, Geräte ohne MultiCam, Laufzeit-Fallback). Kein Task
  darf ihn brechen; die bestehenden Kamera-Tests decken ihn ab.

## Bestehende Schnittstellen (Konsumenten-Sicht, Stand heute)

- `nativeAufnahme.ts`: `aufnahmeStarten(maxSekunden): Promise<boolean>`,
  `aufnahmeStoppen(): Promise<{uri, dauerS} | null>`, `dateiFertig()`,
  `verwerfen()`, `SofortVorschau` (View). Arbeitet über
  `KameraAufnahmeModule.aktuelle` (statisch), das auch `dateiAbwarten`
  und `verwerfen` bedient.
- `KameraAufnahmeModule.swift`: Klasse `Aufnahme` (Writer, StartFenster,
  `schreibeVideo`/`schreibeTon`/`stoppen`/`wennFertig`), statisches
  `aktuelle: Aufnahme?`, `sucherLayer`, Unterbrechungs-Beobachter
  (`AVCaptureSessionWasInterrupted`, object: nil, stoppt `aktuelle`).
- `nativeZoom.ts` / `KameraZoomModule.swift`: `linsen(position)`,
  `zoomGrenzen(name)`, `setzeZoom(name, faktor, sanft)`,
  `fokussiere(x, y)`.
- `zoom.ts`: `zoomGeraet(linsen)`, `nativerFaktor`, `begrenzen`,
  `beschriftung`, `aktiveStufe`, `zugFaktor`, Typen `Linse`, `Zoomgeraet`.
- Aufnehmen-Screen (`src/app/(tabs)/aufnehmen/index.tsx`): `richtung`
  ('back'|'front'), `kameraWechseln()`, `zoomSetzen(anzeige, sanft)`,
  `zoomGrenzenAktuell()`, `wechselErlaubt()`, `nativStart`/`nativLaeuft`,
  `handleFoto` (takePictureAsync), `handleVideoStart`/`handleVideoStop`,
  `wechselLaeuft`/`WechselBlende`, `mute`-Prop, `onAvailableLensesChanged`.

## Datei-Landkarte

| Datei | Rolle |
|---|---|
| Create `modules/kamera-zoom/ios/MultiKameraModule.swift` | Session, Inputs/Outputs, Wechsel, Zoom, Fokus, Foto, Aufnahme-Andockung, Druck-Beobachter |
| Create `modules/kamera-zoom/ios/MultiKameraSucherView.swift` | Sucher-View mit drei Preview-Layern |
| Modify `modules/kamera-zoom/expo-module.config.json` | Modul registrieren |
| Create `src/features/kamera/multiKamera.ts` | EINZIGER JS-Zugang zum Modul (Muster nativeAufnahme.ts) |
| Modify `src/features/kamera/zoom.ts` | reine MultiCam-Zoom-Abbildung `multiCamZiel` |
| Modify `src/app/(tabs)/aufnehmen/index.tsx` | Weiche MultiCam/Fallback, Wechsel, Zoom, Foto, Video, Lebenszyklus |
| Delete (Task 8) `modules/kamera-zoom/ios/MultiCamSondeModule.swift`, `src/features/kamera/multiCamSonde.ts`, Sonden-Knopf in `src/app/(tabs)/profil.tsx` | Phase-0-Sonde |
| Tests | `src/features/kamera/__tests__/zoom.test.ts`, `__tests__/multiKamera.test.ts`, `src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx` |

---

### Task 1: Reine Zoom-Abbildung `multiCamZiel`

**Files:**
- Modify: `src/features/kamera/zoom.ts` (ans Dateiende)
- Test: `src/features/kamera/__tests__/zoom.test.ts` (bestehende Suite erweitern)

**Interfaces:**
- Consumes: nichts Neues.
- Produces (bindend, spätere Tasks verlassen sich wörtlich darauf):
  ```ts
  export type MultiCamKamera = 'front' | 'weit' | 'ultraweit';
  export type MultiCamZiel = { kamera: MultiCamKamera; faktor: number };
  export function multiCamZiel(
    anzeige: number,
    richtung: 'back' | 'front',
    hatUltraweit: boolean
  ): MultiCamZiel;
  ```

Abbildung (Spec §5): Front immer `{kamera:'front', faktor: max(anzeige, 1)}`.
Back mit `anzeige < 1` und vorhandenem Ultraweitwinkel:
`{kamera:'ultraweit', faktor: anzeige * 2}` (0,5 → 1,0; 0,9 → 1,8). Sonst
`{kamera:'weit', faktor: max(anzeige, 1)}`. Ohne Ultraweitwinkel klemmt
`anzeige < 1` auf `{kamera:'weit', faktor: 1}`.

- [ ] **Step 1: Fehlschlagende Tests schreiben** (in der bestehenden
  `describe`-Struktur von zoom.test.ts eine neue Gruppe):

```ts
import { multiCamZiel } from '../zoom';

describe('multiCamZiel: die MultiCam-Zuordnung Anzeige → Kamera und Faktor', () => {
  it('Front bleibt Front, unter 1× klemmt der Faktor auf 1', () => {
    expect(multiCamZiel(0.5, 'front', true)).toEqual({ kamera: 'front', faktor: 1 });
    expect(multiCamZiel(2, 'front', true)).toEqual({ kamera: 'front', faktor: 2 });
  });
  it('0,5× auf der Rückseite ist der Ultraweitwinkel bei Faktor 1', () => {
    expect(multiCamZiel(0.5, 'back', true)).toEqual({ kamera: 'ultraweit', faktor: 1 });
  });
  it('0,9× liegt noch im Ultraweitwinkel, skaliert mit 2', () => {
    expect(multiCamZiel(0.9, 'back', true)).toEqual({ kamera: 'ultraweit', faktor: 1.8 });
  });
  it('ab 1× übernimmt der Weitwinkel mit dem Anzeige-Faktor', () => {
    expect(multiCamZiel(1, 'back', true)).toEqual({ kamera: 'weit', faktor: 1 });
    expect(multiCamZiel(3.5, 'back', true)).toEqual({ kamera: 'weit', faktor: 3.5 });
  });
  it('ohne Ultraweitwinkel klemmt unter 1× auf dem Weitwinkel bei 1', () => {
    expect(multiCamZiel(0.5, 'back', false)).toEqual({ kamera: 'weit', faktor: 1 });
  });
});
```

- [ ] **Step 2:** `npm test -- --testPathPattern "zoom.test"` → die fünf
  neuen Tests scheitern mit «multiCamZiel is not a function».
- [ ] **Step 3: Implementierung** (zoom.ts, mit Kommentar, warum die 2 fest
  ist: der Ultraweitwinkel deckt exakt den halben Bildwinkel-Faktor des
  Weitwinkels ab, iOS zählt ihn 1,0 bei Anzeige 0,5):

```ts
export type MultiCamKamera = 'front' | 'weit' | 'ultraweit';
export type MultiCamZiel = { kamera: MultiCamKamera; faktor: number };

export function multiCamZiel(
  anzeige: number,
  richtung: 'back' | 'front',
  hatUltraweit: boolean
): MultiCamZiel {
  if (richtung === 'front') return { kamera: 'front', faktor: Math.max(anzeige, 1) };
  if (anzeige < 1 && hatUltraweit) return { kamera: 'ultraweit', faktor: anzeige * 2 };
  return { kamera: 'weit', faktor: Math.max(anzeige, 1) };
}
```

- [ ] **Step 4:** `npm test -- --testPathPattern "zoom.test"` → grün.
- [ ] **Step 5:** `npx tsc --noEmit`, `npx eslint src/`, dann Commit:
  `git add src/features/kamera/zoom.ts src/features/kamera/__tests__/zoom.test.ts && git commit -m "feat(kamera): multiCamZiel bildet den Anzeige-Zoom auf Kamera und Faktor ab"`

---

### Task 2: Natives Modul MultiKamera (Session-Kern)

**Files:**
- Create: `modules/kamera-zoom/ios/MultiKameraModule.swift`
- Create: `modules/kamera-zoom/ios/MultiKameraSucherView.swift`
- Modify: `modules/kamera-zoom/expo-module.config.json` (Modulliste um
  `"MultiKameraModule"` ergänzen)

Kein Jest möglich (rein nativ); der Task endet mit Kompilier-Check.
Verhaltensbeweis kommt in Meilenstein A nach Task 4.

**Interfaces (Produces, bindend für Tasks 3 bis 7):**

Modulname `MultiKamera`. JS-sichtbare API:

```
Function  istVerfuegbar() -> Bool          // isMultiCamSupported && Front && Weitwinkel vorhanden
AsyncFunction starten(promise)             // Session bauen (einmal) und startRunning; idempotent
AsyncFunction stoppen(promise)             // stopRunning; Session bleibt gebaut
AsyncFunction wechsleKamera(promise) -> String   // 'front' | 'back'; tauscht Front <-> letzte Back-Kamera
Function  zoomSetzen(kamera: String, faktor: Double, sanft: Bool)
          // kamera in {'front','weit','ultraweit'}; wechselt bei Bedarf die aktive BACK-Ebene
AsyncFunction fokussiere(x: Double, y: Double)   // aktives Gerät, über dessen Preview-Layer
Events("druckGeaendert")                   // { stufe: 'nominal' | 'ernst' | 'kritisch' }
View MultiKameraSucherView, ViewName("MultiKameraSucher")
```

Interner Zustand (statisch, Muster KameraAufnahmeModule):
`session: AVCaptureMultiCamSession?`, `geraete: [String: AVCaptureDevice]`
(Schlüssel 'front'/'weit'/'ultraweit'), `inputs`, `videoOutputs:
[String: AVCaptureVideoDataOutput]`, `audioOutput`,
`aktiveKamera: String` ('front'|'weit'|'ultraweit'),
`letzteBack: String` ('weit'|'ultraweit'), `verteiler: MultiKameraVerteiler?`,
`static weak var sucher: MultiKameraSucherView?`,
`vorschauLayer: [String: AVCaptureVideoPreviewLayer]` (gehalten von der View).

**Bindende Anforderungen (Prosa):**

1. Session-Aufbau exakt nach dem in der Phase-0-Sonde erprobten Muster
   (MultiCamSondeModule.swift, Funktion `anschliessen`): pro Kamera
   MultiCam-fähiges 1920×1080\@30-Format setzen (Fallback: kleinstes
   MultiCam-Format ab 720p), `addInputWithNoConnections`,
   `addOutputWithNoConnections`, manuelle `AVCaptureConnection` zum
   Video-Output. ZUSÄTZLICH pro Kamera eine zweite manuelle Connection
   zur Preview-Layer der Sucher-View
   (`AVCaptureConnection(inputPort:videoPreviewLayer:)`).
2. Auf JEDER Video-Connection (Output UND Preview): `videoOrientation =
   .portrait`; für die Frontkamera `automaticallyAdjustsVideoMirroring =
   false` und `isVideoMirrored = true` (Output wie Preview; Spec §3:
   Spiegelung fest an der Verbindung, kein Pro-Frame-Angleichen mehr
   nötig, der Wächter in PufferAbgriff bleibt als zweite Linie).
3. Mikrofon: EIN `AVCaptureDeviceInput` (default .audio) plus EIN
   `AVCaptureAudioDataOutput` mit eigener Queue, Delegate ist der
   Verteiler. Fehlt die Berechtigung, läuft die Session ohne Ton weiter
   (kein throw, Muster outputsAnhaengen).
4. Fehlt der Ultraweitwinkel, wird die Session mit zwei Kameras gebaut
   (Spec §9); `zoomSetzen(kamera:'ultraweit', …)` fällt dann still auf
   'weit' zurück.
5. `starten` baut die Session beim ersten Aufruf und merkt sie sich;
   weitere Aufrufe starten nur `startRunning` (auf einer eigenen seriellen
   Queue, nie auf Main). Scheitert der Aufbau, reject mit Code
   `aufbau_gescheitert`; die JS-Seite entscheidet über den Fallback.
6. `wechsleKamera` und der Back-Ebenen-Wechsel in `zoomSetzen` ändern NUR
   `aktiveKamera`, die Sichtbarkeit der Preview-Layer (Main-Thread,
   `CATransaction` mit `setDisableActions(true)`, damit kein implizites
   Fade läuft) und das Verteiler-Ziel. KEIN beginConfiguration, KEIN
   Input-Umbau. `wechsleKamera` merkt sich beim Wechsel zu Front die
   zuletzt aktive Back-Kamera in `letzteBack` und stellt sie beim
   Rückwechsel wieder her.
7. `zoomSetzen` setzt `videoZoomFactor` (geklemmt auf
   min/maxAvailableVideoZoomFactor, `cancelVideoZoomRamp` vorweg, `sanft`
   = `ramp(toVideoZoomFactor:withRate: 8.0)`) auf dem Zielgerät; Muster
   wörtlich aus KameraZoomModule.setzeZoom.
8. `fokussiere` arbeitet wie KameraZoomModule.fokussiere (Punkt vor
   Modus, Belichtung kontinuierlich, Subject-Area-Monitoring an), aber
   auf dem AKTIVEN Gerät und mit `captureDevicePointConverted` der
   ZUGEHÖRIGEN Preview-Layer, ohne View-Hierarchie-Suche. Die
   Szenen-Rückstellung übernimmt der bestehende Beobachter in
   KameraZoomModule (er hört global auf AVCaptureDeviceSubjectAreaDidChange).
9. Druck-Beobachter: KVO auf `systemPressureState` des Weitwinkel-Geräts.
   Ab `.serious`: Ultraweitwinkel-Connections (Output und Preview)
   `isEnabled = false`; war 'ultraweit' aktiv, wird 'weit' mit Faktor 1
   aktiv. Event `druckGeaendert` mit `stufe:'ernst'`. Bei `.nominal`/
   `.fair`: wieder aktivieren, Event `stufe:'nominal'`. Ab `.critical`:
   zusätzlich die INAKTIVE Blickrichtung deaktivieren (Front-Connections
   aus, wenn eine Back-Kamera aktiv ist, und umgekehrt), Event
   `stufe:'kritisch'`; darunter wieder aktivieren (Spec §8).
10. Unterbrechungen: Beobachter auf `.AVCaptureSessionWasInterrupted`
    NUR für die eigene Session braucht es nicht (KameraAufnahmeModule
    stoppt `aktuelle` bereits global); wohl aber
    `.AVCaptureSessionInterruptionEnded` (object: eigene Session) →
    `startRunning` auf der Session-Queue (Spec §8).
11. `MultiKameraSucherView`: `ExpoView`-Unterklasse; erzeugt in `init`
    drei `AVCaptureVideoPreviewLayer` (ohne Session-Bindung, die
    Connections kommen vom Modul), `videoGravity = .resizeAspectFill`,
    `layoutSubviews` setzt alle Frames auf `bounds`. Registriert sich
    beim Modul (`MultiKameraModule.sucher = self`) in
    `didMoveToWindow`; das Modul verbindet die Layer beim Session-Aufbau
    (oder sofort, wenn die Session schon steht) und setzt die
    Sichtbarkeit nach `aktiveKamera`. Genau eine Layer sichtbar, die
    anderen `isHidden = true`.
12. Verteiler-Klasse `MultiKameraVerteiler` (in MultiKameraModule.swift):
    Delegate aller Video-Outputs und des Audio-Outputs. Video: Puffer
    von Outputs, deren Kamera nicht `aktiveKamera` ist, sofort
    verwerfen; aktive Puffer an `KameraAufnahmeModule.aktuelle?
    .schreibeVideo` (der Hochkant-Wächter aus PufferAbgriff wird
    übernommen: quere Frames bleiben draussen). Audio: an
    `KameraAufnahmeModule.aktuelle?.schreibeTon`. Läuft keine Aufnahme,
    sind beide Aufrufe durch das optionale `aktuelle` von selbst
    billige No-ops. Foto-Griff siehe Task 6 (der Verteiler bekommt dort
    einen `fotoWunsch`-Haken; hier noch nicht bauen).

- [ ] **Step 1:** Beide Swift-Dateien anlegen (Skizze unten), Modulliste
  in expo-module.config.json ergänzen.
- [ ] **Step 2:** `cd mobile/ios && pod install`
- [ ] **Step 3:** Kompilier-Check (Global Constraints) → `BUILD SUCCEEDED`.
- [ ] **Step 4:** Commit:
  `git add modules/kamera-zoom && git commit -m "feat(kamera): MultiKamera-Modul mit Dreifach-Session, Sucher-View und Verteiler"`

Skizze des Session-Aufbaus (Formatwahl und Anschluss wie in der Sonde;
die Sonde wird in Task 8 gelöscht, deshalb hier eigenständig):

```swift
private static func sessionBauen() throws -> AVCaptureMultiCamSession {
  let session = AVCaptureMultiCamSession()
  session.beginConfiguration()
  defer { session.commitConfiguration() }
  for (name, geraet) in geraete {
    try formatSetzen(geraet)                        // 1080p30, MultiCam-fähig
    let input = try AVCaptureDeviceInput(device: geraet)
    guard session.canAddInput(input) else { throw MultiKameraFehler(grund: "\(name): Input") }
    session.addInputWithNoConnections(input)
    inputs[name] = input
    let output = AVCaptureVideoDataOutput()
    output.setSampleBufferDelegate(verteiler, queue: videoQueue)
    session.addOutputWithNoConnections(output)
    videoOutputs[name] = output
    guard let port = input.ports(for: .video, sourceDeviceType: geraet.deviceType,
                                 sourceDevicePosition: geraet.position).first
    else { throw MultiKameraFehler(grund: "\(name): Port") }
    let ausgang = AVCaptureConnection(inputPorts: [port], output: output)
    ausrichten(ausgang, front: name == "front")     // portrait + Spiegelung
    session.addConnection(ausgang)
    if let layer = Self.sucher?.layer(fuer: name) {
      let vorschau = AVCaptureConnection(inputPort: port, videoPreviewLayer: layer)
      ausrichten(vorschau, front: name == "front")
      session.addConnection(vorschau)
    }
  }
  mikrofonAnhaengen(session)                        // Anforderung 3
  return session
}
```

---

### Task 3: JS-Adapter `multiKamera.ts`

**Files:**
- Create: `src/features/kamera/multiKamera.ts`
- Test: `src/features/kamera/__tests__/multiKamera.test.ts`

**Interfaces:**
- Consumes: Modul-API aus Task 2 (wörtlich), `MultiCamZiel` aus Task 1.
- Produces (bindend für Task 4 bis 7):

```ts
export function verfuegbar(): boolean;
export async function starten(): Promise<boolean>;   // false = gescheitert ODER Modul fehlt
export function stoppen(): void;
export async function wechsleKamera(): Promise<'front' | 'back' | null>;
export function zoomSetzen(ziel: MultiCamZiel, sanft: boolean): void;
export function fokussiere(x: number, y: number): void;
export function aufDruck(hoerer: (stufe: 'nominal' | 'ernst' | 'kritisch') => void): () => void;
export const MultiKameraSucher: React.ComponentType<ViewProps>;
```

**Bindende Anforderungen:**

1. Dieselbe Bauart wie nativeAufnahme.ts: `requireOptionalNativeModule
   ('MultiKamera')`, einmal nachgesehen, `null` heisst «gibt es hier
   nicht» (Android, Simulator, alter Build). `verfuegbar()` ist
   `modul !== null && modul.istVerfuegbar()`.
2. `starten()` fängt jede Ablehnung und liefert `false`; MERKT sich zwei
   Fehlschläge in Folge in einem Modul-lokalen Flag `gescheitert` und
   liefert danach sofort `false`, ohne es erneut zu versuchen
   (Laufzeit-Fallback der Spec §8/§9; ein Erfolg setzt den Zähler
   zurück). `verfuegbar()` liefert nach gesetztem Flag ebenfalls false.
3. `aufDruck` abonniert das Modul-Event `druckGeaendert` über
   `modul.addListener` und liefert die Abmeldung; ohne Modul ein No-op,
   der eine leere Abmeldung liefert.
4. `MultiKameraSucher` über `requireNativeViewManager('MultiKamera')`
   (Muster SofortVorschau), aber hinter einem Guard, der auf Android/
   Simulator eine leere View liefert statt zu werfen.

- [ ] **Step 1: Fehlschlagende Tests** (Mock von expo-modules-core wie in
  `__tests__/nativeAufnahme.test.ts`, dort Muster übernehmen):

```ts
describe('multiKamera: der Zugang zum MultiCam-Modul', () => {
  it('verfuegbar ist false, wenn das Modul fehlt', …);
  it('verfuegbar fragt das Modul (istVerfuegbar)', …);
  it('starten liefert true bei Erfolg', …);
  it('starten liefert false bei Ablehnung und schaltet nach dem zweiten Fehlschlag dauerhaft ab', …);
  it('ein Erfolg setzt den Fehlschlag-Zähler zurück', …);
  it('zoomSetzen reicht Kamera, Faktor und sanft ans Modul durch', …);
  it('wechsleKamera liefert die neue Richtung, null ohne Modul', …);
  it('aufDruck meldet Ereignisse und die Abmeldung räumt auf', …);
});
```

  (Die Testkörper folgen dem nativeAufnahme-Testmuster: Modul-Mock mit
  jest.fn, `jest.resetModules()` pro Fall, weil das Modul und das
  `gescheitert`-Flag modul-lokal gecacht sind.)

- [ ] **Step 2:** `npm test -- --testPathPattern "multiKamera.test"` → rot.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** Suite grün; `npx tsc --noEmit`; `npx eslint src/`.
- [ ] **Step 5:** Commit `feat(kamera): multiKamera.ts kapselt das MultiCam-Modul samt Laufzeit-Fallback`.

---

### Task 4: Screen-Weiche: Sucher, Wechsel, Zoom, Fokus

**Files:**
- Modify: `src/app/(tabs)/aufnehmen/index.tsx`
- Test: `src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Consumes: `multiKamera.ts` (Task 3), `multiCamZiel` (Task 1).
- Produces: Screen-Zustand `multiCam: boolean` (State, initial
  `multiKamera.verfuegbar()`), an dem ALLE folgenden Tasks ihre Weichen
  aufhängen.

**Bindende Anforderungen:**

1. Rendert `multiCam` den `MultiKameraSucher` (StyleSheet.absoluteFill)
   statt der `CameraView`; die CameraView-Props `mute`, `flash`,
   `enableTorch`, `selectedLens`, `onAvailableLensesChanged` haben im
   MultiCam-Zweig keine Entsprechung (Blitz kommt in Task 6). Die
   Zoomfläche, FokusRing, Kino-Bühne, Auslöser und alle Overlays bleiben
   für beide Zweige identisch.
2. Lebenszyklus: Ein Fokus-Effekt ruft `multiKamera.starten()` bei Fokus;
   liefert es `false`, setzt der Screen `multiCam` auf `false` (Fallback
   auf expo-camera für den Rest der Sitzung, Spec §9). Gestoppt wird beim
   Blur NUR, wenn KEINE Vorschau überdeckt (`inVorschau` false) und keine
   Aufnahme läuft: exakt die Bedingungen des heutigen mute-Props
   (`!fokussiert && !nimmtAuf && !inVorschau` heisst stoppen). Der
   bestehende resumePreview-Blur-Effekt und das mute-Prop bleiben
   unverändert im expo-camera-Zweig.
3. `kameraWechseln` im MultiCam-Zweig: KEIN `setWechselLaeuft(true)`,
   KEINE Blende, stattdessen `void multiKamera.wechsleKamera().then(...)`
   und `setRichtung` sofort; Faktor-Reset auf 1 und zugStart-Neuverankerung
   wie heute. `wechselErlaubt()` liefert im MultiCam-Zweig immer true
   (die Session übersteht den Wechsel per Konstruktion; der
   nativLaeuft-Gate gilt nur noch im expo-camera-Zweig).
4. `zoomSetzen` im MultiCam-Zweig: `multiKamera.zoomSetzen(multiCamZiel
   (anzeige, richtung, hatUltraweit), sanft)` statt nativeZoom.setzeZoom;
   `hatUltraweit` kommt aus den vorhandenen `linsen`-Daten (die
   Linsen-Enumeration über KameraZoom bleibt als Datenquelle für Stufen
   und Grenzen erhalten, virtuelle Geräte dürfen weiter ENUMERIERT
   werden, nur nicht in der Session laufen). Stufen und Grenzen
   (`zoomGeraet`, `zoomGrenzenAktuell`, Zug-Zoom, Pinch) bleiben
   unverändert; nur der Setz-Weg wechselt.
5. Tap-to-Focus im MultiCam-Zweig über `multiKamera.fokussiere` statt
   nativeZoom.fokussiere; FokusRing unverändert.
6. Druck-Abo: bei Fokus `multiKamera.aufDruck(...)` registrieren; bei
   `'ernst'`/`'kritisch'` mit aktivem Faktor < 1 den Zoom auf 1 setzen
   (`zoomSetzen(1, false)`), bei `'nominal'` nichts (der Nutzer zoomt
   selbst zurück). Abmeldung im Effekt-Cleanup.
7. Jest bleibt auf dem expo-camera-Zweig lauffähig: `multiKamera` wird in
   kamera.test.tsx gemockt, Standard-Mock `verfuegbar: () => false`, so
   laufen ALLE bestehenden Tests unverändert. Neue Tests setzen den Mock
   auf verfügbar.

- [ ] **Step 1: Fehlschlagende Tests** (kamera.test.tsx, neue Gruppe
  «MultiCam-Pfad», mit `verfuegbar: () => true`-Mock):
  - «der Sucher ist die MultiKamera-View, keine CameraView» (testID am
    Sucher; queryByTestId der CameraView-Attrappe ist null)
  - «Fokus startet die Session; ein Fehlschlag fällt auf expo-camera
    zurück» (starten-Mock false → CameraView erscheint)
  - «Doppeltipp ruft wechsleKamera und zeigt keine Wechsel-Blende»
  - «Doppeltipp wechselt auch während der gehaltenen Aufnahme» (kein
    nativLaeuft-Gate)
  - «zoomSetzen geht als MultiCamZiel ans Modul» (0,5 → {kamera:
    'ultraweit', faktor: 1})
  - «Druck ernst bei 0,5× stellt den Zoom auf 1»
  - «Blur ohne Vorschau stoppt die Session, mit Vorschau nicht»
    (fokusVerlieren-Harness mit negativem mockFokusStand, Muster der
    bestehenden Mikrofon-Tests; mockFokusStand im beforeEach auf 0!)
- [ ] **Step 2:** Muster `npm test -- --testPathPattern "kamera.test"` → neue rot, alte grün.
- [ ] **Step 3:** Implementieren (Weiche + Punkte 1 bis 6).
- [ ] **Step 4:** Ganze Kamera-Suite grün; `npx tsc --noEmit`; `npx eslint src/`.
- [ ] **Step 5:** Commit `feat(kamera): der Aufnehmen-Screen läuft auf der MultiKamera-Session, expo-camera bleibt Fallback`.

**MEILENSTEIN A (Controller + Product Owner am Gerät, nicht delegierbar):**
Build aufs iPhone, messen: Wechselzeit Sucher (Ziel unter zwei Frames,
Messsonde temporär), 0,5×-Grenze nahtlos, Zoom folgt dem Finger,
Tap-to-Focus, Session-Start ~300 bis 400 ms, Fallback erzwingen
(Simulator: CameraView erscheint). Erst nach bestandenem Meilenstein
weiter mit Task 5.

---

### Task 5: Video-Aufnahme im MultiCam-Pfad

**Files:**
- Modify: `modules/kamera-zoom/ios/MultiKameraModule.swift`
- Modify: `src/features/kamera/multiKamera.ts`
- Modify: `src/app/(tabs)/aufnehmen/index.tsx`
- Test: `src/features/kamera/__tests__/multiKamera.test.ts`, `src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Produces nativ: `AsyncFunction aufnahmeStarten(maxSekunden, promise)`
  und `AsyncFunction aufnahmeStoppen(promise) -> {uri, dauerS}` am
  MultiKamera-Modul. JS: `multiKamera.aufnahmeStarten(maxSekunden):
  Promise<boolean>`, `multiKamera.aufnahmeStoppen(): Promise<{uri, dauerS} | null>`.
- Consumes: Klasse `Aufnahme` und Statics aus KameraAufnahmeModule.

**Bindende Anforderungen:**

1. Nativ erzeugt `aufnahmeStarten` dieselbe `Aufnahme` wie
   KameraAufnahmeModule.aufnahmeStarten (Ziel-URL-Muster
   `reelive-<UUID>.mov` im tmp, `mitTon` = Audio-Verbindung vorhanden)
   und setzt `KameraAufnahmeModule.aktuelle = aufnahme`. Der Guard
   («läuft schon, wenn aktuelle nicht gestoppt») wird übernommen.
   Dadurch funktionieren `dateiFertig`, `verwerfen` und die
   SofortVorschau-View UNVERÄNDERT über nativeAufnahme.ts, denn sie
   hängen alle an `KameraAufnahmeModule.aktuelle`.
2. Der Verteiler reicht ab da die Frames der AKTIVEN Kamera an
   `schreibeVideo`, Ton an `schreibeTon` (steht seit Task 2). Ein
   Kamerawechsel während der Aufnahme braucht KEINEN Aufnahme-Code:
   der Verteiler wechselt die Quelle, die Zeitachse ist die gemeinsame
   Session-Clock (Spec §4).
3. Screen: `handleVideoStart` setzt im MultiCam-Zweig
   `nativStart.current = multiKamera.aufnahmeStarten(MAX_VIDEO_SEKUNDEN)`
   statt nativeAufnahme.aufnahmeStarten; `handleVideoStop` ruft
   `multiKamera.aufnahmeStoppen()`. Alles Nachgelagerte (dateiFertig,
   verwerfen, SofortVorschau, Übergabe, Vorschau-Screen) bleibt wörtlich
   gleich, weil es über nativeAufnahme.ts an `aktuelle` hängt. Der
   recordAsync-Fallback-Ast im MultiCam-Zweig entfällt: liefert
   `aufnahmeStarten` false, zeigt der Screen die bestehende Fehlerpille
   («Die Aufnahme konnte nicht starten»), statt in recordAsync zu
   stürzen (recordAsync gehört der CameraView, die im MultiCam-Zweig
   nicht existiert).
4. Torch fürs Video: `enableTorch`-Äquivalent. Neues natives
   `Function blitz(an: Bool)`: setzt `torchMode` auf dem aktiven
   BACK-Gerät (Front: No-op). Screen ruft es im MultiCam-Zweig, wo heute
   `enableTorch={blitz === 'on' && nimmtAuf}` wirkt (Effekt auf
   [blitz, nimmtAuf, richtung]).

- [ ] **Step 1: Fehlschlagende JS-Tests:** Adapter (aufnahmeStarten/
  aufnahmeStoppen-Durchreichung, false/null ohne Modul) und Screen
  («Video-Start geht im MultiCam-Pfad ans MultiKamera-Modul», «Stopp holt
  Datei und Dauer vom MultiKamera-Modul», «scheitert der Start, erscheint
  die Fehlerpille und kein recordAsync-Aufruf», «Blitz an während der
  Aufnahme ruft blitz(true), Loslassen blitz(false)»).
- [ ] **Step 2:** rot laufen lassen.
- [ ] **Step 3:** Nativ + Adapter + Screen implementieren; `pod install`
  ist NICHT nötig (keine neue Datei), Kompilier-Check schon.
- [ ] **Step 4:** Suiten grün, tsc, eslint, Kompilier-Check.
- [ ] **Step 5:** Commit `feat(kamera): Video-Aufnahme läuft über die MultiKamera-Session, Wechsel ohne Lücke`.

**MEILENSTEIN B (am Gerät):** Video mit mehreren Wechseln (Sucher-Gefühl:
kein Standbild, keine Lücke), SofortVorschau beim Loslassen, Datei im
Recap mit Ton-Sync, Verwerfen-Rückweg instant, 90-s-Kappe, Zug-Zoom
während Aufnahme inkl. 0,5-Grenze.

---

### Task 6: Foto im MultiCam-Pfad

**Files:**
- Modify: `modules/kamera-zoom/ios/MultiKameraModule.swift`
- Modify: `src/features/kamera/multiKamera.ts`
- Modify: `src/app/(tabs)/aufnehmen/index.tsx`
- Test: beide bestehenden Suiten

**Interfaces:**
- Produces nativ: `AsyncFunction fotoAufnehmen(blitz: Bool, promise) ->
  {uri: String, breite: Int, hoehe: Int}`; JS:
  `multiKamera.fotoAufnehmen(blitz: boolean): Promise<{uri, breite, hoehe} | null>`.

**Bindende Anforderungen:**

1. Der Verteiler bekommt einen `fotoWunsch: ((CMSampleBuffer) -> Void)?`
   (nur unter Lock angefasst): steht er, bekommt er den NÄCHSTEN Frame
   der aktiven Kamera und wird geleert. `fotoAufnehmen` setzt ihn,
   wandelt den Frame in JPEG (CIImage → CGImage → UIImage,
   `jpegData(compressionQuality: 0.9)`), schreibt nach tmp
   `reelive-foto-<UUID>.jpg` und liefert Pfad und Masse. Die Spiegelung
   steckt bereits in der Connection (Task 2 Anforderung 2), KEINE
   zweite Spiegelung hier.
2. `blitz: true` auf einer Back-Kamera: Torch an, ~150 ms warten (die
   Belichtung zieht nach), Frame greifen, Torch aus. Front: kein Torch
   (wie heute; der heutige Foto-Blitz vorne ist der helle Screen NICHT,
   also schlicht kein Blitz).
3. Screen `handleFoto` im MultiCam-Zweig: statt pausePreview +
   takePictureAsync + uebergabe-expo-Sonderweg ruft er
   `multiKamera.fotoAufnehmen(blitz === 'on')` und übergibt das Ergebnis
   auf demselben Weg an die Vorschau wie heute das takePictureAsync-
   Ergebnis (uebergabe-Holder; die Felder heissen gleich: uri/breite/
   hoehe → bestehende Form der Übergabe einhalten, in uebergabe.ts
   nachsehen). KEIN pausePreview: der Sucher läuft unter der Vorschau
   weiter (Spec §6), das Polaroid zeigt den gegriffenen Frame.
4. Der expo-camera-Zweig von handleFoto bleibt Zeichen für Zeichen
   unverändert.

- [ ] **Step 1: Fehlschlagende Tests:** Adapter-Durchreichung; Screen:
  «der Auslöser holt das Foto vom MultiKamera-Modul und geht zur
  Vorschau», «der Sucher wird im MultiCam-Pfad nicht pausiert»,
  «Blitz-Einstellung wandert in fotoAufnehmen».
- [ ] **Step 2:** rot.
- [ ] **Step 3:** implementieren (nativ + Adapter + Screen), Kompilier-Check.
- [ ] **Step 4:** grün + tsc + eslint.
- [ ] **Step 5:** Commit `feat(kamera): Fotos kommen als Frame-Grab aus dem laufenden Strom`.

**MEILENSTEIN C (am Gerät):** Foto vorne/hinten (Spiegelung!), mit und
ohne Blitz, Qualität gegen heute vergleichen (1080×1920), Polaroid-
Animation, Einsenden-Durchlauf.

---

### Task 7: Härtung: Unterbrechungen, Hintergrund, Druck am Gerät

**Files:**
- Modify: `modules/kamera-zoom/ios/MultiKameraModule.swift` (nur falls
  Meilensteine Lücken zeigten)
- Test: bestehende Suiten bleiben grün

Kein neuer Code auf Vorrat: dieser Task ist der Sammelpunkt für Befunde
aus den Meilensteinen A bis C plus die gezielte Grenzfall-Runde am Gerät:

- [ ] Anruf während Aufnahme: Aufnahme stoppt sauber (bestehender
  Beobachter), Datei gültig, Session läuft nach Anrufende wieder
  (InterruptionEnded-Pfad aus Task 2).
- [ ] Home-Wischer während Aufnahme, App zurückholen: Sucher läuft, keine
  tote Session.
- [ ] 5-Minuten-Wärmetest im Sucher: `druckGeaendert`-Ereignisse
  beobachten (temporäre Log-Sonde), Schutzschaltung greift und kehrt
  zurück; App bleibt bedienbar.
- [ ] Simulator-Lauf: Fallback-Pfad rendert, Jest-Suite komplett grün.
- [ ] Befunde als Fixes committen: `fix(kamera): <Befund>`.

---

### Task 8: Rückbau: Sonde, Blende, Sonden-Logs

**Files:**
- Delete: `modules/kamera-zoom/ios/MultiCamSondeModule.swift`
- Modify: `modules/kamera-zoom/expo-module.config.json` (`MultiCamSondeModule` raus)
- Delete: `src/features/kamera/multiCamSonde.ts`
- Modify: `src/app/(tabs)/profil.tsx` (Sonden-Knopf, -Import, -State raus)
- Modify: `src/app/(tabs)/aufnehmen/index.tsx` ([dbg-flip]-Logs; die
  WechselBlende samt `wechselLaeuft`/Frist-Effekt NUR, wenn der
  expo-camera-Zweig sie nicht mehr erreicht: er erreicht sie weiterhin
  über den Fallback, also bleibt sie und verliert nur die Logs)
- Modify: `modules/kamera-zoom/ios/KameraAufnahmeModule.swift`
  (didDrop-NSLog-Sonde raus)
- Test: kamera.test.tsx (Blenden-Tests bleiben, sie testen den Fallback-Zweig)

- [ ] **Step 1:** Dateien löschen, Referenzen entfernen, `pod install`
  (Podfile-Snapshot kennt die gelöschte Datei sonst noch), Kompilier-Check.
- [ ] **Step 2:** Volle Jest-Suite, tsc, eslint src/ komplett.
- [ ] **Step 3:** Commit `chore(kamera): Phase-0-Sonde und Messsonden ausgebaut`.

---

### Task 9: Geräterunde als bindende Abnahme (Spec §10)

Controller + Product Owner, Messsonden temporär (JS-Zeitstempel im
Wechselpfad, danach entfernen):

- [ ] Wechselzeit Sucher und Aufnahme: unter zwei Frames gefühlt und
  gemessen; Protokoll der Werte in der Ledger.
- [ ] 0,5×-Grenze beim Ziehen nahtlos.
- [ ] Foto-Qualität/Spiegelung abgenommen.
- [ ] Video mit Wechseln + Ton-Sync im Recap abgenommen.
- [ ] Wärmetest-Ergebnis dokumentiert.
- [ ] Restliche Messsonden raus, volle Suiten, Abschluss-Commit.

## Verifikation des Gesamtplans

Meilensteine A bis C und Task 9 sind die Verifikation; Erfolgskriterium
ist das abgenommene Gefühl «Wechsel ist sofort» des Product Owners plus
die Messwerte im Protokoll. Der expo-camera-Fallback gilt als verifiziert,
wenn die bestehende Kamera-Suite grün ist und der Simulator-Lauf den
Fallback rendert.
