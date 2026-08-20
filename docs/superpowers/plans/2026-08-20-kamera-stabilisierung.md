# Videostabilisierung mit Sucher-Schalter: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die MultiCam-Pipeline stabilisiert Videos mit `.standard`, ein dritter Pill-Knopf unter dem Blitz schaltet sie aus und ein (Default: an).

**Architektur:** Der native Zustand `stabilizationWanted` folgt exakt dem `flashWanted`-Muster (Wunsch unter `stateLock`, Anwendung auf der Session-Queue). Die Bridge bekommt `setStabilization` analog `setFlash`, der Screen einen dritten `PillButton` nur im MultiCam-Zweig. Preview-Connections bleiben unstabilisiert.

**Tech Stack:** Swift (AVFoundation, expo-modules-core), TypeScript strict, Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-20-kamera-stabilisierung-design.md`

**Branch:** `feat/camera-stabilization` ab `main`.

## Global Constraints

- Stabilisierungsmodus fest `.standard`, niemals `.auto` oder cinematic (Instant-Pipeline: Foto = Frame-Grab, Blitz-Vorlauf 150 ms).
- Default an, Schalter nicht persistiert (App-Start beginnt mit «an»), wie der Blitz.
- Preview-Connections bleiben unberührt.
- Quellcode englisch (Bezeichner, Kommentare, Testtitel), sichtbare UI-Texte deutsch in Du-Form; keine Em-Dashes in Texten und Kommentaren.
- Nach Code-Änderungen immer ganz `src/` linten (`npx eslint src`), nicht nur die eigene Datei; 29 vorbestehende Fehler sind bekannt und bleiben.
- Alle Befehle laufen in `mobile/`.

---

### Task 1: Natives Modul: `stabilizationWanted` und `applyStabilization`

Swift hat hier kein Test-Target; die Verifikation ist der Build in Task 4 plus die Geräte-Prüfliste. Deshalb kein TDD-Zyklus in diesem Task, dafür exakt kopierte Muster aus derselben Datei.

**Files:**
- Modify: `mobile/modules/camera-zoom/ios/MultiCameraModule.swift`

**Interfaces:**
- Produces: native `Function("stabilization")` mit Signatur `(on: Bool) -> Void`, Dispatch-Name `stabilization` (Task 2 ruft ihn über die Bridge auf).

- [ ] **Step 1: Zustand ergänzen**

Direkt nach `private static var _flashWanted = false` (bei Zeile 121, im `stateLock`-Block-Kommentarbereich):

```swift
  // Whether the streams SHOULD be stabilized. Kept as a wish for the same
  // reason as _flashWanted: the call arrives on the JS thread, the
  // connections change on the session queue (attach), so the module holds
  // the wish and re-applies it on every session build.
  private static var _stabilizationWanted = true
```

Direkt nach der `flashWanted`-Property (endet bei Zeile 195):

```swift
  private static var stabilizationWanted: Bool {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return _stabilizationWanted
    }
    set {
      stateLock.lock()
      _stabilizationWanted = newValue
      stateLock.unlock()
    }
  }
```

- [ ] **Step 2: Bridge-Funktion deklarieren**

Im `definition()`-Block direkt nach dem `Function("flash")`-Block (endet bei Zeile 423):

```swift
    // Video stabilization for all output connections; the photo path
    // inherits it, its image is a grab from the same stream. Synchronous
    // like `flash`: the call only notes the WISH, the switching happens on
    // the session queue (see applyStabilization).
    Function("stabilization") { (on: Bool) in
      Self.stabilizationWanted = on
      Self.applyStabilization()
    }
```

- [ ] **Step 3: `applyStabilization` implementieren**

Neuer Abschnitt direkt nach `setTorch` (nach Zeile ~945, vor dem nächsten `// MARK:`):

```swift
  // MARK: - Stabilization

  // `.standard` only, never `.auto`: auto may pick a cinematic mode, and
  // those buffer frames up to about a second. Poison for this path, whose
  // photo is the NEXT frame of the stream and whose flash lead is
  // calibrated to 150 ms (takePhoto). `.standard` stabilizes in hardware
  // with minimal latency.
  //
  // All output connections are treated alike (the flash pattern, no case
  // per active camera). The preview connections stay untouched on
  // purpose: stabilizing them would cost extra budget, and Apple's own
  // camera app shows the same viewfinder-versus-recording discrepancy.
  // Work happens on the session queue, where the connections are written;
  // fixed name list with subscript access, the same rule as applyFlash.
  private static func applyStabilization() {
    sessionQueue.async {
      let wanted = stabilizationWanted
      for name in cameraNames {
        guard let connection = outputConnections[name],
          connection.isVideoStabilizationSupported,
          let device = devices[name],
          device.activeFormat.isVideoStabilizationModeSupported(.standard)
        else { continue }
        connection.preferredVideoStabilizationMode = wanted ? .standard : .off
      }
    }
  }
```

- [ ] **Step 4: Wunsch in `attach()` anwenden**

In `attach(_:to:as:)`, direkt nach `orient(connection, front: name == "front")` und vor `outputConnections[name] = connection` (bei Zeile 591):

```swift
    // The current wish lands on the fresh connection right away: a session
    // rebuild (Metro reload, tab switch) must not lose it. AVFoundation's
    // default is .off, so only the ON case needs writing.
    if stabilizationWanted, connection.isVideoStabilizationSupported,
      device.activeFormat.isVideoStabilizationModeSupported(.standard)
    {
      connection.preferredVideoStabilizationMode = .standard
    }
```

- [ ] **Step 5: Commit**

```bash
git add modules/camera-zoom/ios/MultiCameraModule.swift
git commit -m "feat(camera): Videostabilisierung .standard im MultiCam-Modul, Default an"
```

---

### Task 2: Bridge: `setStabilization` in `multiCamera.ts`

**Files:**
- Modify: `mobile/src/features/camera/multiCamera.ts`
- Test: `mobile/src/features/camera/__tests__/multiCamera.test.ts`

**Interfaces:**
- Consumes: native `Function("stabilization")` aus Task 1 (Dispatch-Name `stabilization`, Parameter `on: boolean`).
- Produces: `export function setStabilization(on: boolean): void` (Task 3 ruft sie aus dem Screen auf).

- [ ] **Step 1: Failing Tests schreiben**

In `multiCamera.test.ts` das `mockNativeModule`-Objekt um einen Key erweitern (nach `flash: jest.fn(...)`):

```ts
  stabilization: jest.fn((_on: boolean) => {}),
```

Im `beforeEach` nach `mockNativeModule.flash.mockImplementation(() => {});`:

```ts
  mockNativeModule.stabilization.mockImplementation(() => {});
```

Im Kommentar über `mockNativeModule` («its keys mirror MultiCameraModule.swift's ...») in der Aufzählung `takePhoto/flash/addListener` zu `takePhoto/flash/stabilization/addListener` ergänzen.

Neue Tests am Dateiende:

```ts
test('setStabilization passes the wish through to the native module', () => {
  multiCamera().setStabilization(false);
  expect(mockNativeModule.stabilization).toHaveBeenLastCalledWith(false);
  multiCamera().setStabilization(true);
  expect(mockNativeModule.stabilization).toHaveBeenLastCalledWith(true);
});

test('setStabilization without the native module stays silent', () => {
  mockAvailable = false;
  expect(() => multiCamera().setStabilization(true)).not.toThrow();
  expect(mockNativeModule.stabilization).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `npx jest src/features/camera/__tests__/multiCamera.test.ts`
Expected: FAIL, `setStabilization is not a function` (Property fehlt am Modul).

- [ ] **Step 3: Bridge implementieren**

In `multiCamera.ts` im Typ `NativeMultiCameraModule` nach `flash(on: boolean): void;`:

```ts
  stabilization(on: boolean): void;
```

Nach der `setFlash`-Funktion:

```ts
// Video stabilization for the whole stream; the photo frame grab inherits
// it. Synchronous like setFlash: a wish call with no response to wait for.
// The native default is on, so this only has to carry the toggle.
export function setStabilization(on: boolean): void {
  getNativeModule()?.stabilization(on);
}
```

Im «Native contract»-Kommentar über dem Typ nichts weiter nötig (er beschreibt die Regel, nicht jede Methode).

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `npx jest src/features/camera/__tests__/multiCamera.test.ts`
Expected: PASS, alle Fälle.

- [ ] **Step 5: Commit**

```bash
git add src/features/camera/multiCamera.ts src/features/camera/__tests__/multiCamera.test.ts
git commit -m "feat(camera): setStabilization-Bruecke zum MultiCam-Modul"
```

---

### Task 3: Screen: Stabilisierungs-Pill unter dem Blitz

**Files:**
- Modify: `mobile/src/app/(tabs)/capture/index.tsx`
- Test: `mobile/src/app/(tabs)/capture/__tests__/camera.test.tsx`

**Interfaces:**
- Consumes: `multiCamera.setStabilization(on: boolean)` aus Task 2.

- [ ] **Step 1: Failing Tests schreiben**

In `camera.test.tsx` das `mockMultiCamera`-Objekt (bei Zeile 232) nach `setFlash` erweitern:

```ts
  setStabilization: jest.fn((_on: boolean) => {}),
```

In der `jest.mock('@/features/camera/multiCamera', ...)`-Factory nach der `setFlash`-Zeile:

```ts
    setStabilization: (on: boolean) => mockMultiCamera.setStabilization(on),
```

Im `beforeEach` nach `mockMultiCamera.setFlash.mockImplementation(() => {});` (bei Zeile 337):

```ts
  mockMultiCamera.setStabilization.mockImplementation(() => {});
```

Neue Tests (neben den bestehenden MultiCam-Blitz-Fällen ab Zeile ~2640 einsortieren). `mockMultiCamera.available` steht per Default auf `false`, der MultiCam-Zweig braucht `mockReturnValue(true)`:

```tsx
// === The stabilization pill (MultiCam branch only) ===
test('the stabilization toggle carries the wish to the module', async () => {
  mockMultiCamera.available.mockReturnValue(true);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  // The mount effect reports the default (on) once.
  expect(mockMultiCamera.setStabilization).toHaveBeenLastCalledWith(true);

  await fireEvent.press(screen.getByLabelText('Stabilisierung ausschalten'));
  expect(mockMultiCamera.setStabilization).toHaveBeenLastCalledWith(false);

  await fireEvent.press(screen.getByLabelText('Stabilisierung einschalten'));
  expect(mockMultiCamera.setStabilization).toHaveBeenLastCalledWith(true);
});

test('the expo-camera fallback shows no stabilization pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.queryByLabelText('Stabilisierung ausschalten')).toBeNull();
  expect(screen.queryByLabelText('Stabilisierung einschalten')).toBeNull();
  expect(mockMultiCamera.setStabilization).not.toHaveBeenCalled();
});

test('during a running capture the stabilization pill disappears too', async () => {
  mockMultiCamera.available.mockReturnValue(true);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockMultiCamera.startCapture.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.getByLabelText('Stabilisierung ausschalten')).toBeTruthy();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(screen.queryByLabelText('Stabilisierung ausschalten')).toBeNull();
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `npx jest "src/app/(tabs)/capture/__tests__/camera.test.tsx" -t "stabilization"`
Expected: FAIL, `Unable to find an element with accessibilityLabel: Stabilisierung ausschalten` (bzw. der Mount-Erwartungswert schlägt fehl).

- [ ] **Step 3: Screen implementieren**

In `index.tsx`:

1. Lucide-Import erweitern (bestehende Importzeile mit `Zap, ZapOff`):

```ts
import { ..., Vibrate, VibrateOff, Zap, ZapOff } from 'lucide-react-native';
```

2. State neben `flash` (bei Zeile 515):

```ts
  const [stabilization, setStabilization] = useState<'on' | 'off'>('on');
```

3. Effekt direkt nach dem Torch-Effekt (endet bei Zeile 836):

```ts
  // Unlike the torch, the stabilization wish holds for the whole stream
  // (the photo grab inherits the stabilized frame), not only while
  // recording. The native default is on; this effect carries the toggle
  // and repeats the current wish on mount, which is idempotent.
  useEffect(() => {
    if (!multiCam) return;
    multiCamera.setStabilization(stabilization === 'on');
  }, [multiCam, stabilization]);
```

4. Dritter `PillButton` in der Controls-Spalte direkt nach dem Blitz-`PillButton` (endet bei Zeile 1734), nur im MultiCam-Zweig; der expo-camera-Fallback hat keine Stabilisierungs-API. Icon-Logik wie beim Blitz: aktives Feature hell (`text-1`), abgeschaltet gedimmt und durchgestrichen (`text-2`):

```tsx
            {multiCam && (
              <PillButton
                label={
                  stabilization === 'on'
                    ? 'Stabilisierung ausschalten'
                    : 'Stabilisierung einschalten'
                }
                onPress={() =>
                  setStabilization((current) => (current === 'on' ? 'off' : 'on'))
                }
              >
                {stabilization === 'on' ? (
                  <Vibrate size={22} color={cinema['text-1']} strokeWidth={1.75} />
                ) : (
                  <VibrateOff size={22} color={cinema['text-2']} strokeWidth={1.75} />
                )}
              </PillButton>
            )}
```

Das Ausblenden während der Aufnahme kommt gratis: die ganze Controls-Spalte hängt unter `{!capturing && (` (Zeile 1695).

5. Der Kommentar über der `PillButton`-Komponente (Zeile 220, «Spec §4 demands both verbatim ...») zitiert die Phase-4-Spec mit genau zwei Pills. Damit er mit dem dritten Knopf nicht falsch wirkt, am Ende seines ersten Absatzes ergänzen:

```
// The stabilization pill joined later (spec 2026-08-20), MultiCam branch
// only.
```

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `npx jest "src/app/(tabs)/capture/__tests__/camera.test.tsx"`
Expected: PASS, auch alle vorbestehenden Fälle (der neue Effekt darf keinen bestehenden Blitz- oder Aufnahme-Test kippen).

- [ ] **Step 5: Lint und Gesamtlauf**

Run: `npx eslint src` und `npx jest`
Expected: keine NEUEN Lint-Fehler (29 vorbestehende bekannt), Jest komplett grün.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(tabs)/capture/index.tsx" "src/app/(tabs)/capture/__tests__/camera.test.tsx"
git commit -m "feat(camera): Stabilisierungs-Pill unter dem Blitz, Default an"
```

---

### Task 4: Dev-Build und Geräte-Prüfliste

Natives Modul geändert: ein Metro-Reload reicht NICHT, es braucht einen frischen Build aufs Gerät (Muster Kamera-Zoom). Vorher `.env` prüfen (Supabase-Adresse, DHCP-Falle).

**Files:** keine Code-Änderungen; Ausnahme Rückzugslinie (siehe Step 3).

- [ ] **Step 1: Build aufs Gerät**

Run: `npx expo run:ios --device`
Expected: Build kompiliert ohne neue Warnungen; App startet bis in den Sucher.

- [ ] **Step 2: Manuelle Prüfliste am Gerät**

1. Beim Gehen filmen, Stabilisierung an: sichtbar glatter als mit Schalter aus (direkt nacheinander vergleichen).
2. Schalter aus- und wieder einschalten: kein Ruckler oder Session-Abriss im Sucher.
3. Drei Streams laufen lassen (Zoomen über 0.5x/1x, Front-Wechsel): kein `pressureChanged`-Event auf `ernst`/`kritisch` im Metro-Log, das vorher nicht kam.
4. Foto-Frame-Grab: Auslöser tippen, Bild erscheint weiterhin ohne spürbare Wartezeit; mit Blitz stimmt der 150-ms-Vorlauf noch (Bild hell, nicht schwarz).
5. Video mit Stabilisierung: Clip in der Vorschau prüfen, Bildausschnitt leicht enger (Crop erwartet), keine Wobble-Artefakte.
6. Aufnahme starten: die drei Pills oben verschwinden, nach Stopp stehen sie wieder.

- [ ] **Step 3: Rückzugslinie bei Budget-Problemen**

Meldet Punkt 3 dauerhaft Druck oder ruckelt der Sucher: Default auf «aus» drehen, das ist genau EIN Wert je Schicht: in `MultiCameraModule.swift` `_stabilizationWanted = false`, im Screen `useState<'on' | 'off'>('off')`, im Mount-Test `toHaveBeenLastCalledWith(false)` und Labels im ersten Toggle-Test tauschen. Befund in der Spec unter «Entscheid» nachtragen, dann committen:

```bash
git add modules/camera-zoom/ios/MultiCameraModule.swift "src/app/(tabs)/capture/index.tsx" "src/app/(tabs)/capture/__tests__/camera.test.tsx" ../docs/superpowers/specs/2026-08-20-kamera-stabilisierung-design.md
git commit -m "fix(camera): Stabilisierung Default aus, MultiCam-Budget am Geraet zu knapp"
```

- [ ] **Step 4: Abschluss**

Branch via superpowers:finishing-a-development-branch abschliessen (Merge nach `main` erst nach bestandener Prüfliste).
