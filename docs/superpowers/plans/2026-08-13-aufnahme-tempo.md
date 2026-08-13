# Aufnahme-Tempo und Zug-Zoom — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder spürbare Delay im Aufnahme-Fluss verschwindet (Instant-Foto, sofortiger Video-Start, übergangslose Navigation), und der Auslöser zoomt per Hochziehen während der Videoaufnahme.

**Architecture:** Die Kamera läuft dauerhaft in `mode="video"` (kein Session-Umbau mehr), Fotos gehen als `PictureRef` im nativen Speicher über ein Übergabe-Modul an die Vorschau, gespeichert wird im Hintergrund. Der `Ausloeser` meldet die vertikale Fingerbewegung, eine reine Funktion in `zoom.ts` rechnet daraus den Zoomfaktor. Spec: `docs/superpowers/specs/2026-08-13-aufnahme-tempo-design.md`.

**Tech Stack:** Expo SDK 57 (expo-camera 57.0.3: `pictureRef`, `pausePreview`/`resumePreview`, `mute`-Prop), expo-image (nimmt `SharedRef<'image'>` als `source`), expo-router, Jest + @testing-library/react-native.

## Global Constraints

- Arbeitsverzeichnis ist `mobile/`; alle Pfade unten relativ zum Repo-Root.
- TypeScript strict; Expo-SDK-57-APIs nur wie in `mobile/node_modules/expo-camera/build/*.d.ts` verifiziert verwenden (AGENTS.md: versionierte Docs sind massgeblich).
- DESIGN-LANGUAGE.md ist verbindlich. Die Abweichung «Navigation ohne Slide» ist in der Spec §6 als begründete §5-Ausnahme dokumentiert — im Code-Kommentar darauf verweisen.
- UI-Texte Deutsch, Du-Form, keine Gedankenstriche. Neuer Fehlertext wörtlich: `Das Foto hat nicht geklappt. Versuch es nochmal.`
- Kommentare auf Deutsch, im erklärenden Stil der jeweiligen Datei (WARUM, nicht WAS).
- Keine neuen Dependencies, kein Prebuild, kein neues natives Modul.
- ESLint immer über ganz `src/` laufen lassen (`npx eslint src`), nie nur über die eigene Datei; es gibt 29 bekannte Alt-Fehler, es dürfen keine NEUEN dazukommen.
- Jeder Commit endet mit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_01X1FabBoDWCJnEfefRxEiX5`
- Testlauf: `cd mobile && npm test -- <datei>` für Einzeldateien, `npm test` für alles.

---

### Task 1: `zugFaktor` — das Zoom-Mapping als reine Funktion

**Files:**
- Modify: `mobile/src/features/kamera/zoom.ts` (ans Dateiende anfügen)
- Test: `mobile/src/features/kamera/__tests__/zoom.test.ts` (Fälle anfügen)

**Interfaces:**
- Consumes: `begrenzen(anzeige, grenzen, basis)` aus derselben Datei (existiert).
- Produces: `zugFaktor(hub: number, start: number, grenzen: { min: number; max: number }, basis: number, wege: { hoch: number; runter: number }): number` — Task 7 ruft sie im Screen auf. `hub` in pt (nach oben positiv), `start` ist der Anzeige-Faktor beim Aufnahmestart, `grenzen` in Geräte-Zählung (wie `zoomGrenzen` sie liefert), `wege` in pt.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `mobile/src/features/kamera/__tests__/zoom.test.ts` anfügen (Import um `zugFaktor` erweitern):

```ts
// ——— Zug-Zoom (Spec 2026-08-13-aufnahme-tempo-design.md §7) ———
//
// Der Hub ist die vertikale Fingerbewegung seit dem Aufsetzen, nach oben
// positiv. Das Mapping ist exponentiell (Zoom ist multiplikativ, ein
// linearer Weg fühlt sich am oberen Ende träge an) und die Referenz ist der
// Faktor beim Aufnahmestart, nicht 1×.
describe('zugFaktor', () => {
  const GRENZEN = { min: 1, max: 120 }; // Geräte-Zählung, wie zoomGrenzen liefert
  const BASIS = 0.5; // Ultraweitwinkel-Gerät: Anzeige-Grenzen sind 0,5× bis 60×
  const WEGE = { hoch: 500, runter: 100 };

  test('Hub 0 gibt den Startfaktor zurück', () => {
    expect(zugFaktor(0, 1, GRENZEN, BASIS, WEGE)).toBe(1);
  });

  test('der volle Weg nach oben erreicht das Maximum', () => {
    expect(zugFaktor(500, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
  });

  test('über den Weg hinaus bleibt es beim Maximum', () => {
    expect(zugFaktor(1600, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
  });

  test('exponentiell: der halbe Weg steht beim geometrischen Mittel', () => {
    // Von 1× nach 60× ist die Hälfte des Weges √60, nicht 30,5.
    expect(zugFaktor(250, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(Math.sqrt(60));
  });

  test('der volle Weg nach unten erreicht das Minimum', () => {
    expect(zugFaktor(-100, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(0.5);
  });

  test('unter dem Weg nach unten bleibt es beim Minimum', () => {
    expect(zugFaktor(-400, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(0.5);
  });

  test('ein Start am Maximum bleibt beim Hochziehen dort', () => {
    expect(zugFaktor(300, 60, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
  });

  test('die Referenz ist der Startfaktor, nicht 1×', () => {
    // Wer bei 4× startet und den vollen Weg zieht, landet ebenfalls beim
    // Maximum — der Weg deckt immer die Strecke Startfaktor → Grenze ab.
    expect(zugFaktor(500, 4, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
    expect(zugFaktor(-100, 4, GRENZEN, BASIS, WEGE)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- src/features/kamera/__tests__/zoom.test.ts`
Expected: FAIL — `zugFaktor` existiert nicht.

- [ ] **Step 3: `zugFaktor` implementieren**

Ans Ende von `mobile/src/features/kamera/zoom.ts`:

```ts
// Der Zug-Zoom des Auslösers (Snapchat-Muster): Halten und nach oben ziehen.
// `hub` ist die Fingerbewegung seit dem Aufsetzen (nach oben positiv, pt),
// `start` der Anzeige-Faktor beim Aufnahmestart, `wege` die Strecken, die
// den vollen Bereich abdecken — nach oben bis zum Maximum, nach unten bis
// zum Minimum (der Auslöser sitzt fast am Boden, viel Weg gibt es dort
// nicht, deshalb zwei getrennte Strecken).
//
// Exponentiell statt linear: Zoom ist multiplikativ. Linear gemappt läge
// zwischen 30× und 60× die halbe Strecke, obwohl es EIN Verdopplungsschritt
// ist — das fühlt sich oben träge und unten hektisch an. So trägt jeder
// Zentimeter Weg denselben Faktor.
export function zugFaktor(
  hub: number,
  start: number,
  grenzen: { min: number; max: number },
  basis: number,
  wege: { hoch: number; runter: number }
): number {
  const ziel =
    hub >= 0
      ? start * Math.pow((grenzen.max * basis) / start, Math.min(hub / wege.hoch, 1))
      : start * Math.pow((grenzen.min * basis) / start, Math.min(-hub / wege.runter, 1));
  return begrenzen(ziel, grenzen, basis);
}
```

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `cd mobile && npm test -- src/features/kamera/__tests__/zoom.test.ts`
Expected: PASS (alle, auch die bestehenden Fälle der Datei).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/kamera/zoom.ts mobile/src/features/kamera/__tests__/zoom.test.ts
git commit -m "feat(kamera): zugFaktor rechnet den Hub des Auslösers in den Zoom um"
```

---

### Task 2: `uebergabe.ts` — das Foto wandert im Speicher zur Vorschau

**Files:**
- Create: `mobile/src/features/kamera/uebergabe.ts`
- Test: `mobile/src/features/kamera/__tests__/uebergabe.test.ts`

**Interfaces:**
- Consumes: nichts (nur den Typ `PictureRef` aus `expo-camera`, als reiner Typ-Import — zur Laufzeit wird nichts von expo-camera geladen, die Tests brauchen keinen Mock).
- Produces:
  - `type FotoUebergabe = { ref: PictureRef; datei: Promise<{ uri: string }> }`
  - `uebergeben(uebergabe: FotoUebergabe): void`
  - `abholen(): FotoUebergabe | null` — einmalig, danach leer.
  - Task 6 (Kamera) ruft `uebergeben`, Task 5 (Vorschau) ruft `abholen`.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`mobile/src/features/kamera/__tests__/uebergabe.test.ts`:

```ts
import { uebergeben, abholen, type FotoUebergabe } from '../uebergabe';
import type { PictureRef } from 'expo-camera';

// Ein PictureRef ist zur Laufzeit nur ein natives Handle; für das Modul
// zählt allein, dass dasselbe Objekt wieder herauskommt.
const fakeRef = (name: string) => ({ name }) as unknown as PictureRef;

const uebergabe = (ref: PictureRef, uri = 'file://gespeichert.jpg'): FotoUebergabe => ({
  ref,
  datei: Promise.resolve({ uri }),
});

test('abholen liefert die Übergabe genau einmal', async () => {
  const u = uebergabe(fakeRef('a'));
  uebergeben(u);
  expect(abholen()).toBe(u);
  expect(abholen()).toBeNull();
});

test('eine neue Übergabe ersetzt eine liegengebliebene', () => {
  uebergeben(uebergabe(fakeRef('alt')));
  const neu = uebergabe(fakeRef('neu'));
  uebergeben(neu);
  expect(abholen()).toBe(neu);
  expect(abholen()).toBeNull();
});

test('eine scheiternde Datei bleibt für den Abholer als Ablehnung erhalten', async () => {
  const fehler = new Error('kein Speicherplatz');
  uebergeben({ ref: fakeRef('x'), datei: Promise.reject(fehler) });
  // Die Mikrotasks durchlaufen lassen: hinge KEIN Handler an der Ablehnung,
  // schlüge Jest hier mit «Unhandled promise rejection» fehl.
  await new Promise((weiter) => setTimeout(weiter, 0));
  await expect(abholen()!.datei).rejects.toBe(fehler);
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- src/features/kamera/__tests__/uebergabe.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Modul implementieren**

`mobile/src/features/kamera/uebergabe.ts`:

```ts
// Das aufgenommene Foto wandert als natives Speicher-Objekt (PictureRef) vom
// Kamera-Screen zur Vorschau. Router-Params sind Strings, ein Ref passt
// nicht hindurch — deshalb dieser Holder, das kleinste Ding, das die Lücke
// schliesst (Spec 2026-08-13-aufnahme-tempo-design.md §4). Er hält genau
// EINE Übergabe: mehr als eine Aufnahme ist nie gleichzeitig unterwegs.
import type { PictureRef } from 'expo-camera';

export type FotoUebergabe = {
  /** Fürs Anzeigen: expo-image nimmt einen SharedRef direkt als source. */
  ref: PictureRef;
  /** savePictureAsync des Refs, fürs Einsenden — läuft ab der Aufnahme im Hintergrund. */
  datei: Promise<{ uri: string }>;
};

let liegt: FotoUebergabe | null = null;

export function uebergeben(uebergabe: FotoUebergabe): void {
  // Ersetzt Liegengebliebenes kommentarlos: der alte Ref fällt dem GC anheim.
  liegt = uebergabe;
  // Solange niemand wartet, darf eine Ablehnung (voller Speicher) keine
  // «Unhandled rejection» werden. Der leere Handler hängt an einem ZWEIG des
  // Promises, nicht am Promise selbst — wer `datei` später awaited (die
  // Vorschau beim Einsenden), bekommt die Ablehnung unverändert.
  void uebergabe.datei.catch(() => {});
}

export function abholen(): FotoUebergabe | null {
  const uebergabe = liegt;
  liegt = null;
  return uebergabe;
}
```

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `cd mobile && npm test -- src/features/kamera/__tests__/uebergabe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/kamera/uebergabe.ts mobile/src/features/kamera/__tests__/uebergabe.test.ts
git commit -m "feat(kamera): Übergabe-Modul trägt das Foto im Speicher zur Vorschau"
```

---

### Task 3: `Ausloeser` meldet den vertikalen Hub

**Files:**
- Modify: `mobile/src/components/Ausloeser.tsx`
- Test: `mobile/src/components/__tests__/Ausloeser.test.tsx` (Fälle anfügen)

**Interfaces:**
- Consumes: nichts Neues.
- Produces: neuer optionaler Prop `onZoomZug?: (hub: number) => void` — feuert bei jeder Fingerbewegung ab Phase `video`, `hub` = `startY − aktuellesPageY` (nach oben positiv, pt). Task 7 hängt den Screen daran.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `mobile/src/components/__tests__/Ausloeser.test.tsx` anfügen. Die Datei hat bereits `jest.useFakeTimers()`, den Helfer `knopf()` und das Muster `fireEvent(knopf(), 'touchMove', {...})` (Sperr-Tests ab «——— Sperren ———»):

```ts
// ——— Zug-Zoom (Spec 2026-08-13-aufnahme-tempo-design.md §7) ———
//
// Der Auslöser meldet nur die Bewegung; was sie am Zoom bewirkt, entscheidet
// der Screen (zugFaktor in zoom.ts). Gemessen wird gegen den Aufsetzpunkt,
// wie bei der Sperr-Geste — ein Daumen setzt selten mittig auf.
test('während der Aufnahme meldet der Auslöser den Hub nach oben', async () => {
  const onZoomZug = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSekunden={30}
      onZoomZug={onZoomZug}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(200);

  // Unter den Aufsetzpunkt gezogen: negativ, der Screen zoomt dann raus.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 560 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(-60);
});

test('vor der Halte-Schwelle meldet der Auslöser keinen Hub', async () => {
  const onZoomZug = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSekunden={30}
      onZoomZug={onZoomZug}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  // Schwelle (500 ms) bewusst NICHT erreicht: das hier wird ein Foto-Tipp.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300 } });
  expect(onZoomZug).not.toHaveBeenCalled();
});

test('die Sperr-Geste funktioniert auch mit gleichzeitigem Hub', async () => {
  const onZoomZug = jest.fn();
  const onVideoStop = jest.fn();
  const onSperre = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={onVideoStop}
      maxSekunden={30}
      onSperre={onSperre}
      onZoomZug={onZoomZug}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Diagonal: 60 pt nach rechts (jenseits der Sperr-Schwelle 48) und 100 pt
  // nach oben — beide Achsen melden, keine verdrängt die andere.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 160, pageY: 400 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(100);

  await fireEvent(knopf(), 'pressOut');
  expect(onSperre).toHaveBeenCalledWith(true);
  expect(onVideoStop).not.toHaveBeenCalled();
});
```

Falls der Helfer `knopf()` erst unterhalb der neuen Einfügestelle definiert ist: die neuen Tests NACH den Sperr-Tests anfügen, dort existiert er bereits.

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- src/components/__tests__/Ausloeser.test.tsx`
Expected: FAIL — `onZoomZug` wird nie aufgerufen (Prop existiert nicht).

- [ ] **Step 3: `Ausloeser` erweitern**

In `mobile/src/components/Ausloeser.tsx`:

1. Props erweitern (nach `onSperre` in `type Props`):

```ts
  /**
   * Meldet ab Aufnahmestart die vertikale Fingerbewegung seit dem Aufsetzen
   * (nach oben positiv, pt). Der Screen macht daraus den Zug-Zoom; was vor
   * der Halte-Schwelle passiert, ist ein Tipp und meldet nichts.
   */
  onZoomZug?: (hub: number) => void;
```

2. Signatur der Komponente: `onZoomZug` mit destrukturieren:

```ts
export function Ausloeser({ onFoto, onVideoStart, onVideoStop, maxSekunden, onSperre, onZoomZug }: Props) {
```

3. Neben `startX` einen `startY`-Ref anlegen:

```ts
  // Wo der Daumen aufgesetzt hat, vertikal: daraus wird der Hub des
  // Zug-Zooms, wie startX für die Sperr-Geste.
  const startY = useRef(0);
```

4. In `onPressIn` nach `startX.current = ...`:

```ts
    startY.current = e?.nativeEvent?.pageY ?? 0;
```

5. In `onTouchMove` als erste Zeile nach dem `if (phase.current !== 'video') return;`:

```ts
    onZoomZug?.(startY.current - (e?.nativeEvent?.pageY ?? 0));
```

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `cd mobile && npm test -- src/components/__tests__/Ausloeser.test.tsx`
Expected: PASS (alle, auch die bestehenden Sperr- und Timer-Fälle).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/Ausloeser.tsx mobile/src/components/__tests__/Ausloeser.test.tsx
git commit -m "feat(kamera): der Auslöser meldet den vertikalen Hub für den Zug-Zoom"
```

---

### Task 4: Kamera-Screen — dauerhafter Video-Modus

**Files:**
- Modify: `mobile/src/app/(tabs)/aufnehmen/index.tsx`
- Test: `mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Consumes: nichts Neues (Bestand: `Ausloeser`, `nativeZoom`, `zoomGeraet`).
- Produces: der Screen führt ab jetzt `nimmtAuf: boolean` (Video läuft) und `fokussiert: boolean` (Tab im Fokus) als State; `aufnahmeFehler` wird `string | null` statt `boolean`. Task 6 und 7 bauen darauf auf.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx` anfügen (der Helfer `letzteKameraProps` existiert ab dem Blitz-Testblock):

```ts
// ——— Dauerhafter Video-Modus (Spec 2026-08-13-aufnahme-tempo-design.md §3) ———
//
// Der Moduswechsel Foto↔Video baute die native Session um und kostete den
// Video-Start bis zu ~1 s. Jetzt läuft die Kamera fest im Video-Modus; das
// Mikrofon hängt dauerhaft an der Session (oranger Punkt im Sucher, bewusst
// entschieden), bei Tab-Blur wird es über `mute` ausgehängt — sonst
// leuchtete der Punkt app-weit, Tab-Screens bleiben ja gemountet.
test('die Kamera läuft dauerhaft im Video-Modus, das Mikrofon ist im Fokus an', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(letzteKameraProps().mode).toBe('video');
  expect(letzteKameraProps().mute).toBe(false);
});
```

Hinweis: `mute={true}` bei Tab-Blur lässt sich mit dem `useFocusEffect`-Mock dieser Datei nicht auslösen (er simuliert nur erneutes Fokussieren, kein Blur) — das prüft die Geräte-Checkliste (Spec §9).

- [ ] **Step 2: Test laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx" -t "dauerhaft im Video-Modus"`
Expected: FAIL — `mode` ist `'picture'`, `mute` ist `undefined`.

- [ ] **Step 3: Screen umbauen**

In `mobile/src/app/(tabs)/aufnehmen/index.tsx`, in dieser Reihenfolge:

1. **State ersetzen.** `const [modus, setModus] = useState<'picture' | 'video'>('picture');` ersetzen durch:

```ts
  // Die Kamera läuft DAUERHAFT im Video-Modus (Spec 2026-08-13 §3): der
  // Wechsel des mode-Props baute die native Session um (Preset + Outputs,
  // setCameraMode auf der sessionQueue) und kostete den Video-Start bis zu
  // ~1 s. Fotos nimmt der Foto-Output derselben Session auf — er bleibt im
  // Video-Modus angeschlossen, liefert dann 16:9 mit 1920×1080, und die
  // Pipeline skaliert ohnehin auf 1080 px lange Kante (medien.ts).
  // `nimmtAuf` ersetzt die frühere Frage `modus === 'video'`: läuft gerade
  // eine Aufnahme?
  const [nimmtAuf, setNimmtAuf] = useState(false);
  // Ob dieser Tab gerade im Fokus steht: daran hängt `mute`. Das Mikrofon
  // gehört dauerhaft an die laufende Video-Session (sonst fehlte dem
  // Videoanfang der Ton), aber NUR solange der Sucher zu sehen ist — die
  // Tab-Screens bleiben gemountet, und der orange Mikrofon-Punkt soll nicht
  // app-weit leuchten, während man im Reise-Tab liest.
  const [fokussiert, setFokussiert] = useState(true);
```

2. **`aufnahmeFehler` wird der Text selbst.** `const [aufnahmeFehler, setAufnahmeFehler] = useState(false);` ersetzen durch:

```ts
  // Der Text der Meldung, oder null: seit dem Instant-Foto gibt es zwei
  // Quellen (Foto und Video), die Pille zeigt, was auch immer zuletzt
  // schiefging.
  const [aufnahmeFehler, setAufnahmeFehler] = useState<string | null>(null);
```

   Folgeänderungen: im Abräum-Effekt `if (!aufnahmeFehler) return;` bleibt, `setAufnahmeFehler(false)` → `setAufnahmeFehler(null)`; in `handleVideoStart` `setAufnahmeFehler(false)` → `setAufnahmeFehler(null)`; in `handleVideoStop` `setAufnahmeFehler(true)` → `setAufnahmeFehler(FEHLER_TEXT)`; beim Rendern `{FEHLER_TEXT}` → `{aufnahmeFehler}`.

3. **Fokus-Effekt erweitern.** Im ersten `useFocusEffect` (der mit `aktiv.current = true`):

```ts
      aktiv.current = true;
      setFokussiert(true);
      // ... bestehender Inhalt (setFokusStand, laden) ...
      return () => {
        aktiv.current = false;
        setFokussiert(false);
      };
```

4. **Video-Start-Effekt auflösen.** Den gesamten `useEffect(() => { if (modus !== 'video') return; ... }, [modus]);`-Block löschen. Die innere Funktion `starten` wandert unverändert in `handleVideoStart` (siehe Punkt 7). Den grossen Kommentarblock über `VIDEO_START_VERSUCHE` (Zeilen «Wie oft der Start …» bis «… was die Session sonst gerade tut.») ersetzen durch:

```ts
// Wie oft der Start einer Videoaufnahme wiederholt wird, und wie lange
// dazwischen gewartet wird.
//
// Seit die Kamera dauerhaft im Video-Modus läuft (Spec 2026-08-13 §3), ist
// die Session beim Druck aufs Halten längst gebaut und der erste Versuch
// trifft. Die Schleife bleibt als Sicherheitsnetz: ein Tab-Wechsel oder ein
// Unterbruch (Anruf) kann die Session genau dann beschäftigen, wenn der
// Startversuch sie trifft, und ein Ereignis «Session bereit» gibt es nicht
// (onCameraReady feuert genau einmal beim Sessionstart, nicht danach).
```

5. **Zoom-Nachsetzen entkoppeln.** `useEffect(() => { zoomNachsetzen(); }, [zoomNachsetzen, modus]);` → `useEffect(() => { zoomNachsetzen(); }, [zoomNachsetzen]);` und im Kommentar darüber den Satz zum Moduswechsel streichen (es gibt keinen mehr); der Rest (Gerätewechsel meldet sich über `onAvailableLensesChanged`) bleibt.

6. **Abgeleitete Ausdrücke.** `const zoomBedienbar = modus !== 'video' || aufnahmeGesperrt;` → `const zoomBedienbar = !nimmtAuf || aufnahmeGesperrt;` und `const darfWechseln = modus !== 'video';` → `const darfWechseln = !nimmtAuf;`. Die Kopfzeile: `{modus !== 'video' && (` → `{!nimmtAuf && (`.

7. **`handleVideoStart` startet selbst.** Ersetzen durch:

```ts
  const handleVideoStart = () => {
    videoStartZeit.current = Date.now();
    videoGestoppt.current = false;
    // Eine neue Aufnahme räumt die alte Klage weg, sonst stünde sie noch da,
    // während schon wieder aufgenommen wird.
    setAufnahmeFehler(null);
    setNimmtAuf(true);
    // Direkt starten statt über einen Effekt am Modus: die Session ist im
    // dauerhaften Video-Modus längst bereit, es gibt nichts zu committen.
    // Wiederholt wird trotzdem (siehe VIDEO_START_VERSUCHE oben) — und am
    // Simulator scheitert weiterhin JEDER Versuch («SimulatorNotSupported»),
    // am Ende bleibt es beim `undefined` und der Screen sagt es.
    const starten = async (): Promise<{ uri: string } | undefined> => {
      let letzterFehler: unknown = null;
      for (let versuch = 0; versuch < VIDEO_START_VERSUCHE; versuch++) {
        // Wer den Auslöser schon losgelassen hat, will kein Video mehr. Ohne
        // diese Abfrage begänne die nächste Runde eine Aufnahme, die niemand
        // mehr stoppt: `stopRecording()` ist längst gelaufen und war ein
        // Schlag ins Leere, die Aufnahme liefe bis `maxDuration`.
        if (videoGestoppt.current) return undefined;
        try {
          return await cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_SEKUNDEN });
        } catch (fehler) {
          letzterFehler = fehler;
          await new Promise((weiter) => setTimeout(weiter, VIDEO_START_WARTE_MS));
        }
      }
      // Alle Runden verbraucht. Was zuletzt schiefging, gehört ins Log: sonst
      // steht auf dem Gerät nur FEHLER_TEXT, und die eigentliche Ursache
      // (Simulator, kein Speicher, Berechtigung entzogen) ist verschluckt.
      console.error('[aufnehmen] Videoaufnahme kam nicht zustande', letzterFehler);
      return undefined;
    };
    videoPromise.current = starten();
  };
```

8. **`handleVideoStop` ohne Modus-Rückbau.** `setModus('picture');` ersetzen durch `setNimmtAuf(false);` (gleiche Stelle, nach dem `await`). Der Kommentar am `.catch()`-Absatz des alten Effekts ist mit dem Effekt gelöscht; in `handleVideoStop` bleibt alles Übrige unverändert.

9. **CameraView-Props.**

```tsx
        mode="video"
        mute={!fokussiert}
```

   statt `mode={modus}`, und `enableTorch={blitz === 'on' && modus === 'video'}` → `enableTorch={blitz === 'on' && nimmtAuf}`. Den Kommentar über `flash` ergänzen:

```tsx
        // `flash` gilt für Fotos; beim Video braucht es stattdessen das
        // Dauerlicht, derselbe Schalter, zwei Prop-Namen. Ob der Foto-Blitz
        // im Video-Preset am Gerät wirklich feuert, prüft die Geräte-
        // Checkliste (Spec 2026-08-13 §9); Fallback wäre die Torch.
```

10. **Kino-Kommentar zur CameraView-`mode`-Zeile:** der lange Kommentar über dem gelöschten Video-Start-Effekt («`mode` muss committet sein …») entfällt ersatzlos mit dem Effekt.

- [ ] **Step 4: Ganze Kamera-Suite laufen lassen**

Run: `cd mobile && npm test -- "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"`
Expected: PASS. Die bestehenden Video-Tests halten (der Retry und `recordAsync({ maxDuration: 30 })` laufen jetzt direkt ab der Schwelle, die Assertions sind identisch). Falls der Test «Wettlauf»/«mode=video erreicht die native View sofort» (um Zeile 1024) auf den gelöschten Effekt Bezug nimmt: seine Assertions (Retry bis Erfolg) bleiben gültig, nur sein Kommentar beschreibt die alte Welt — Kommentar auf das Sicherheitsnetz-Argument umschreiben, Assertions unverändert lassen.

- [ ] **Step 5: Volle Suite als Regressionsnetz**

Run: `cd mobile && npm test`
Expected: PASS (die Vorschau-Suite ist unberührt, `uri` geht weiter durch die Params).

- [ ] **Step 6: Commit**

```bash
git add "mobile/src/app/(tabs)/aufnehmen/index.tsx" "mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"
git commit -m "feat(kamera): die Session läuft dauerhaft im Video-Modus, der Start wartet auf nichts mehr"
```

---

### Task 5: Vorschau — Übergabe konsumieren, expo-image, Übergang ohne Slide

**Files:**
- Modify: `mobile/src/app/vorschau.tsx`
- Test: `mobile/src/app/__tests__/vorschau.test.tsx`

**Interfaces:**
- Consumes: `uebergabe.abholen(): FotoUebergabe | null` (Task 2).
- Produces: die Vorschau funktioniert mit BEIDEN Quellen — Übergabe (neu) und `uri`-Param (Videos, Alt-Foto-Weg, Deep-Link). Task 6 darf danach den `uri`-Param für Fotos weglassen. Neues `testID="foto-vorschau"` am Foto-Bild.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `mobile/src/app/__tests__/vorschau.test.tsx`:

1. Beim `expo-router`-Mock `Stack` ergänzen (die Vorschau rendert jetzt `<Stack.Screen options>`):

```ts
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
    canGoBack: () => mockKannZurueck,
  }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
```

2. expo-image mocken (Muster aus kamera.test.tsx, VOR dem `import PreviewScreen`):

```ts
// expo-image ist ein natives View; der Platzhalter reicht den source-Prop
// durch, damit die Tests prüfen können, ob Ref oder URI ankommt.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
```

3. Import und Aufräumen ergänzen:

```ts
import * as uebergabe from '@/features/kamera/uebergabe';
```

   und im bestehenden `beforeEach`: `uebergabe.abholen();` (leert den Holder zwischen den Tests).

4. Testfälle anfügen:

```ts
// ——— Instant-Foto (Spec 2026-08-13-aufnahme-tempo-design.md §4) ———
//
// Das Foto kommt als natives Speicher-Objekt über das Übergabe-Modul, nicht
// mehr als Datei-URI durch die Params. Die Datei entsteht im Hintergrund;
// Einsenden wartet auf sie, der Rest der Pipeline bleibt unverändert.
const fakeRef = { breite: 1920 } as never;

test('ein übergebenes Foto wird aus dem Speicher angezeigt', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  uebergabe.uebergeben({ ref: fakeRef, datei: Promise.resolve({ uri: 'file://gespeichert.jpg' }) });
  await render(<PreviewScreen />);
  expect(screen.getByTestId('foto-vorschau').props.source).toBe(fakeRef);
});

test('Einsenden wartet auf die im Hintergrund gespeicherte Datei', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  let dateiAufloesen: (v: { uri: string }) => void = () => {};
  uebergabe.uebergeben({
    ref: fakeRef,
    datei: new Promise((resolve) => {
      dateiAufloesen = resolve;
    }),
  });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('einsenden-knopf'));

  // Vor der Datei darf nichts aufbereitet werden.
  expect(mockFotoAufbereiten).not.toHaveBeenCalled();

  await act(async () => {
    dateiAufloesen({ uri: 'file://gespeichert.jpg' });
  });
  await waitFor(() => expect(mockFotoAufbereiten).toHaveBeenCalledWith('file://gespeichert.jpg'));
});

test('scheitert das Hintergrund-Speichern, sagt es der bestehende Fehlerpfad', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  uebergabe.uebergeben({ ref: fakeRef, datei: Promise.reject(new Error('voll')) });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('einsenden-knopf'));
  expect(
    await screen.findByText(
      'Der Moment konnte nicht gesichert werden, oft weil kein Speicherplatz mehr frei ist. Räum etwas Platz frei und versuch es nochmal.'
    )
  ).toBeTruthy();
  expect(mockJobEinreihen).not.toHaveBeenCalled();
});

test('Verwerfen räumt auch die im Hintergrund entstandene Datei ab', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  uebergabe.uebergeben({ ref: fakeRef, datei: Promise.resolve({ uri: 'file://gespeichert.jpg' }) });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('verwerfen-knopf'));
  await waitFor(() => expect(mockDateiVerwerfen).toHaveBeenCalledWith('file://gespeichert.jpg'));
  expect(mockBack).toHaveBeenCalled();
});

test('ohne Übergabe und ohne uri führt die Vorschau zurück zur Kamera', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  await render(<PreviewScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/aufnehmen'));
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- src/app/__tests__/vorschau.test.tsx`
Expected: Die neuen Fälle FAILen (kein `foto-vorschau`-testID, kein Übergabe-Weg); die bestehenden PASSen.

- [ ] **Step 3: Vorschau umbauen**

In `mobile/src/app/vorschau.tsx`:

1. **Imports.** Aus dem `react-native`-Import `Image` entfernen; dazu:

```ts
import { Image } from 'expo-image';
import { Stack } from 'expo-router';   // in die bestehende expo-router-Zeile aufnehmen
import * as uebergabe from '@/features/kamera/uebergabe';
```

2. **Params-Typ:** `uri` optional machen: `uri?: string` in `useLocalSearchParams<{...}>`.

3. **Übergabe einmalig abholen** (bei den States, lazy init wie `zeit`):

```ts
  // Das Foto kommt seit dem Instant-Foto (Spec 2026-08-13 §4) als natives
  // Speicher-Objekt über das Übergabe-Modul, nicht als Datei-URI: EINMAL
  // beim Erscheinen abgeholt, wie `zeit` daneben. Videos (und der
  // Deep-Link-Fall) tragen weiterhin eine uri in den Params — `foto` ist
  // dann null und alles läuft den alten Weg.
  const [foto] = useState(() => (typ === 'photo' ? uebergabe.abholen() : null));
```

4. **Verwaiste Vorschau umleiten** (bei den Effekten):

```ts
  // Weder Übergabe noch uri: per Deep Link geöffnet, ohne dass je eine
  // Aufnahme entstand. Zurück zur Kamera statt eines leeren Screens.
  const quelleFehlt = typ === 'photo' ? !foto && !uri : !uri;
  useEffect(() => {
    if (quelleFehlt) router.replace('/aufnehmen');
  }, [quelleFehlt, router]);
```

   und direkt vor dem `return (`:

```ts
  if (quelleFehlt) return null;
```

5. **Foto-Anzeige** ersetzen:

```tsx
        <Image
          testID="foto-vorschau"
          source={foto ? foto.ref : { uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
```

6. **Übergang ohne Slide** als erstes Kind des Screen-Views:

```tsx
      {/* Ohne Slide, als dokumentierte §5-Ausnahme (Spec 2026-08-13 §6):
          eingefrorenes Sucherbild und Aufnahme sind deckungsgleich, ein
          Parallax-Slide würde dasselbe Vollbild wegschieben und wieder
          hereinholen — er inszeniert einen Ortswechsel, den es nicht gibt. */}
      <Stack.Screen options={{ animation: 'none' }} />
```

7. **`verwerfen`** — die Quelle kann noch unterwegs sein:

```ts
  const verwerfen = () => {
    if (sendet) return;
    // Final-Review, Critical 2 (unverändert gültig): auch der Verwerfen-Weg
    // darf keine Datei hinterlassen. Beim Instant-Foto entsteht sie im
    // Hintergrund und ist womöglich noch nicht fertig — deshalb hängt das
    // Abräumen am Promise statt an einem Wert. Scheiterte das Speichern,
    // gibt es nichts zu räumen.
    if (foto) {
      void foto.datei.then((d) => medien.dateiVerwerfen(d.uri)).catch(() => {});
    } else if (uri) {
      medien.dateiVerwerfen(uri);
    }
    zurueckZurKamera();
  };
```

8. **`absenden`** — die Quelle erst im `try` auflösen. Nach den beiden Guard-Blöcken (`tripId`, `userId`) und vor `setSendeFehler(null)` nichts ändern; dann:

```ts
    setSendeFehler(null);
    setSendet(true);
    const postId = medien.neuePostId();
    // Ausserhalb des try: der catch-Zweig muss wissen, was schon entstanden
    // ist, um genau das Abgeleitete freizugeben, und nichts sonst.
    let aufbereitet: { medium: string; thumb: string } | null = null;
    // Die Quelle der Aufnahme: beim Instant-Foto die im Hintergrund
    // gespeicherte Datei (das await unten wartet, falls sie noch schreibt,
    // und wirft, falls sie scheiterte — voller Speicher landet damit im
    // selben catch wie bisher), sonst die uri aus den Params.
    let quelle: string | null = null;
    try {
      quelle = foto ? (await foto.datei).uri : (uri ?? null);
      if (!quelle) {
        // quelleFehlt leitet bereits um, hierher kommt es nie — aber wenn
        // doch, darf der Knopf nicht für immer im Lade-Zustand hängen.
        setSendet(false);
        return;
      }
      aufbereitet =
        typ === 'video' ? await medien.videoAufbereiten(quelle) : await medien.fotoAufbereiten(quelle);
```

   Im weiteren `try`-Verlauf und im `catch` jedes bisherige `uri` durch `quelle` ersetzen:
   - `medien.dateiVerwerfen(uri);` → `medien.dateiVerwerfen(quelle);`
   - `medien.zwischenfassungenVerwerfen(uri, aufbereitet);` → `medien.zwischenfassungenVerwerfen(quelle, aufbereitet);`
   - im `catch`: `if (aufbereitet) medien.zwischenfassungenVerwerfen(uri, aufbereitet);` → `if (aufbereitet && quelle) medien.zwischenfassungenVerwerfen(quelle, aufbereitet);`
     (ist `aufbereitet` gesetzt, war `quelle` zwingend schon aufgelöst — die Bedingung dokumentiert das für TypeScript).

9. **Video-Player-Zeile** verträgt das optionale `uri` bereits (`typ === 'video' ? uri : null`); bei TypeScript-Klagen `uri ?? null` einsetzen.

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `cd mobile && npm test -- src/app/__tests__/vorschau.test.tsx`
Expected: PASS — die neuen UND alle bestehenden Fälle (Alt-Weg über `uri` bleibt funktionsfähig, die bestehenden Foto-Tests setzen `uri` in den Params und laufen über den `foto === null`-Zweig, weil der Holder in `beforeEach` geleert wird).

- [ ] **Step 5: Volle Suite**

Run: `cd mobile && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/vorschau.tsx mobile/src/app/__tests__/vorschau.test.tsx
git commit -m "feat(vorschau): zeigt das Foto aus dem Speicher und wartet aufs Hintergrund-Speichern"
```

---

### Task 6: Kamera-Screen — Instant-Foto

**Files:**
- Modify: `mobile/src/app/(tabs)/aufnehmen/index.tsx`
- Test: `mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Consumes: `uebergabe.uebergeben({ ref, datei })` (Task 2); `takePictureAsync({ pictureRef: true, shutterSound: false }): Promise<PictureRef>`, `ref.savePictureAsync(): Promise<PhotoResult>`, `pausePreview()`/`resumePreview()` (expo-camera 57).
- Produces: Fotos navigieren OHNE `uri`-Param zur Vorschau (Task 5 kann das bereits konsumieren). Neuer Fehlertext `FOTO_FEHLER_TEXT`.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `kamera.test.tsx`:

1. Kamera-Mock erweitern — bei den bestehenden Mock-Konstanten:

```ts
const mockPausePreview = jest.fn();
const mockResumePreview = jest.fn();
const mockSavePictureAsync = jest.fn();
```

   und im `useImperativeHandle`-Objekt des CameraView-Mocks ergänzen:

```ts
        pausePreview: mockPausePreview,
        resumePreview: mockResumePreview,
```

2. Im `beforeEach` die Foto-Voreinstellung ersetzen. Statt
   `mockTakePictureAsync.mockResolvedValue({ uri: 'file://foto.jpg', ... })`:

```ts
  mockSavePictureAsync.mockResolvedValue({ uri: 'file://gespeichert.jpg', width: 1920, height: 1080 });
  // takePictureAsync liefert mit pictureRef:true einen PictureRef — im Test
  // reicht ein Objekt, das savePictureAsync trägt.
  mockTakePictureAsync.mockResolvedValue({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
```

3. Import ergänzen (bei den anderen `@/`-Imports NACH den jest.mock-Blöcken):

```ts
import * as uebergabe from '@/features/kamera/uebergabe';
```

   und im `beforeEach`: `uebergabe.abholen();`

4. Den bestehenden Test «ein Tipp auf den Auslöser nimmt ein Foto auf und navigiert zur Vorschau» ersetzen durch:

```ts
test('ein Tipp friert den Sucher ein, übergibt das Foto im Speicher und navigiert sofort', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // Ohne Shutter-Sound (die Haptik bleibt das Feedback) und als Ref im
  // Speicher statt als JPEG auf der Platte — DAS ist der Instant-Anteil.
  expect(mockTakePictureAsync).toHaveBeenCalledWith({ pictureRef: true, shutterSound: false });
  expect(mockPausePreview).toHaveBeenCalledTimes(1);

  // Die Navigation trägt kein uri mehr: das Bild geht über die Übergabe.
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { typ: 'photo', dauer: '0', tripId: 't1' },
  });
  const abgeholt = uebergabe.abholen();
  expect(abgeholt).not.toBeNull();
  await expect(abgeholt!.datei).resolves.toEqual(
    expect.objectContaining({ uri: 'file://gespeichert.jpg' })
  );
});
```

5. Neue Fälle anfügen:

```ts
// Ohne dieses Auftauen bliebe der Sucher nach einem gescheiterten Foto
// eingefroren — pausePreview ist gelaufen, und niemand navigiert weg.
test('scheitert das Foto, läuft der Sucher weiter und der Screen sagt es', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockTakePictureAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.')).toBeTruthy();
  expect(mockResumePreview).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('beim Video-Stopp friert der Sucher ein, die Rückkehr taut ihn auf', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // Das letzte Bild steht ruhig, während die Datei finalisiert.
  expect(mockPausePreview).toHaveBeenCalled();

  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });

  // Zurück aus der Vorschau: der Sucher läuft wieder.
  await erneutFokussieren();
  expect(mockResumePreview).toHaveBeenCalled();
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"`
Expected: die neuen Fälle FAILen (takePictureAsync ohne Optionen, push mit uri, kein pause/resume).

- [ ] **Step 3: Screen umbauen**

In `mobile/src/app/(tabs)/aufnehmen/index.tsx`:

1. **Imports:**

```ts
import * as uebergabe from '@/features/kamera/uebergabe';
```

2. **Neue Konstante** neben `FEHLER_TEXT`:

```ts
// Das Foto-Gegenstück: scheitert takePictureAsync (am Simulator immer, am
// Gerät bei vollem Speicher oder entzogener Berechtigung), bleibt man im
// Sucher und die Pille sagt es (DESIGN-LANGUAGE §6).
const FOTO_FEHLER_TEXT = 'Das Foto hat nicht geklappt. Versuch es nochmal.';
```

3. **`zurPreview`-Signatur:** `uri` optional:

```ts
  const zurPreview = (params: { typ: 'photo' | 'video'; dauer: string; tripId: string; uri?: string }) => {
    router.push({ pathname: '/vorschau', params } as unknown as Href);
  };
```

4. **`handleFoto` ersetzen:**

```ts
  const handleFoto = async () => {
    try {
      // Erst die Aufnahme anstossen, DANN die Vorschau einfrieren: die
      // SDK-Doku rät von takePictureAsync bei pausierter Vorschau ab, und
      // der Reihenfolge sieht man den Unterschied nicht an, beides läuft im
      // selben Tick. Das eingefrorene Bild ist der gefühlte Shutter.
      const versprochen = cameraRef.current?.takePictureAsync({
        pictureRef: true,
        shutterSound: false,
      });
      void cameraRef.current?.pausePreview();
      const ref = await versprochen;
      if (!ref) throw new Error('keine Kamera');
      // Der Ref ist in Millisekunden da (kein JPEG, kein Platten-I/O);
      // gespeichert wird ab jetzt im Hintergrund, «Einsenden» in der
      // Vorschau wartet auf genau dieses Promise (Spec 2026-08-13 §4).
      uebergabe.uebergeben({ ref, datei: ref.savePictureAsync() });
      zurPreview({ typ: 'photo', dauer: '0', tripId: reise.id });
    } catch (fehler) {
      console.error('[aufnehmen] Foto kam nicht zustande', fehler);
      // Ohne das Auftauen bliebe der Sucher eingefroren stehen: pausePreview
      // ist gelaufen, und niemand navigiert weg.
      void cameraRef.current?.resumePreview();
      setAufnahmeFehler(FOTO_FEHLER_TEXT);
    }
  };
```

5. **Video-Stopp friert ein.** In `handleVideoStop` direkt nach `cameraRef.current?.stopRecording();`:

```ts
    // Das letzte Bild steht ruhig, während die Datei finalisiert (~100 bis
    // 300 ms) — statt dass der Sucher weiterläuft und die Vorschau dann
    // sichtbar zurückspringt.
    void cameraRef.current?.pausePreview();
```

   und im Fehlerzweig (`if (!ergebnis?.uri)`) vor `setAufnahmeFehler(FEHLER_TEXT);`:

```ts
      void cameraRef.current?.resumePreview();
```

6. **Rückkehr taut auf.** Im ersten `useFocusEffect` (der mit `aktiv.current = true`), nach `setFokussiert(true);`:

```ts
      // Rückkehr aus der Vorschau: der Sucher war fürs Foto oder den
      // Video-Stopp eingefroren (pausePreview) und läuft jetzt weiter. Beim
      // allerersten Fokus ist die Kamera noch nicht gemountet, das optionale
      // Chaining macht den Aufruf dann zum No-op.
      void cameraRef.current?.resumePreview();
```

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `cd mobile && npm test -- "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"`
Expected: PASS (alle).

- [ ] **Step 5: Volle Suite**

Run: `cd mobile && npm test`
Expected: PASS — insbesondere die Vorschau-Suite: der neue Foto-Weg (Task 5) und der hier umgestellte Push passen zusammen.

- [ ] **Step 6: Commit**

```bash
git add "mobile/src/app/(tabs)/aufnehmen/index.tsx" "mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"
git commit -m "feat(kamera): das Foto erscheint sofort, gespeichert wird im Hintergrund"
```

---

### Task 7: Kamera-Screen — Zug-Zoom anbinden

**Files:**
- Modify: `mobile/src/app/(tabs)/aufnehmen/index.tsx`
- Test: `mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Consumes: `zugFaktor` (Task 1), `onZoomZug`-Prop des `Ausloeser` (Task 3), bestehendes `zoomSetzen(neu, sanft)` und `nativeZoom.zoomGrenzen`.
- Produces: nichts für spätere Tasks — letzter Feature-Baustein.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `kamera.test.tsx` anfügen:

```ts
// ——— Zug-Zoom (Spec 2026-08-13-aufnahme-tempo-design.md §7) ———
//
// Der Auslöser meldet den Hub (Task «Ausloeser»), der Screen rechnet ihn
// über zugFaktor in einen Faktor um und setzt HART (sanft=false), damit der
// Zoom dem Finger folgt. Deterministisch geprüft werden die beiden Enden:
// weit über den vollen Weg hinaus steht das Gerätemaximum, zurück am
// Aufsetzpunkt der Startfaktor — beides unabhängig von der Fensterhöhe des
// Testgeräts.
test('Hochziehen während der Aufnahme zoomt bis zum Maximum, Zurückziehen stellt den Start wieder her', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, pageY: 600 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  mockSetzeZoom.mockClear();
  // Hub 1600 pt: jenseits jedes 40-%-Wegs, also geklemmt aufs Maximum des
  // Geräts (zoomGrenzen-Mock: max 120 nativ).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -1000 },
  });
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 120, false);

  // Zurück am Aufsetzpunkt: Startfaktor 1× — auf dem Ultraweitwinkel-Gerät
  // ist das nativ 2,0 (Basis 0,5).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: 600 },
  });
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 2, false);
});
```

- [ ] **Step 2: Test laufen lassen, Scheitern bestätigen**

Run: `cd mobile && npm test -- "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx" -t "Hochziehen während der Aufnahme"`
Expected: FAIL — `setzeZoom` wird beim touchMove nicht aufgerufen.

- [ ] **Step 3: Screen anbinden**

In `mobile/src/app/(tabs)/aufnehmen/index.tsx`:

1. **Imports:** `Dimensions` in den `react-native`-Import aufnehmen; `zugFaktor` in den `@/features/kamera/zoom`-Import.

2. **Konstanten** (bei den anderen Screen-Konstanten):

```ts
// Die Strecken des Zug-Zooms (Spec 2026-08-13 §7). Nach oben deckt ein
// fester Anteil der Fensterhöhe den Weg vom Startfaktor zum Maximum ab —
// Anteil statt Punkte, damit sich ein iPhone SE und ein Pro Max gleich
// anfühlen. Nach unten bleibt vom Auslöser (sitzt fast am Boden) nur eine
// kurze Reststrecke bis zum Rand, sie führt zurück zum Minimum. Beides
// Feintuning-Kandidaten für den Gerätetest.
const ZUG_WEG_HOCH_ANTEIL = 0.4;
const ZUG_WEG_RUNTER = 96;
```

3. **Grenzen-Helfer** (DRY mit dem Pinch) — direkt nach `zoomNachsetzen` einfügen:

```ts
  // Die Grenzen des aktiven Formats, mit demselben Fallback, den bisher nur
  // der Pinch kannte: kennt das Modul keine Grenzen, dient die oberste
  // Stufe als Maximum. Von Pinch UND Zug-Zoom benutzt.
  const zoomGrenzenAktuell = useCallback(() => {
    if (!zoom) return null;
    return (
      nativeZoom.zoomGrenzen(zoom.name) ?? {
        min: 1,
        max: nativerFaktor(zoom.stufen[zoom.stufen.length - 1], zoom.basis),
      }
    );
  }, [zoom]);
```

   Im Pinch (`onResponderGrant`) den Inline-Fallback durch den Helfer ersetzen:

```ts
      pinchStart.current = {
        abstand,
        faktor: faktorRef.current,
        grenzen: zoomGrenzenAktuell()!,
      };
```

   (Das `!` ist begründet: der Zweig läuft nur nach `if (!zoom ...) return;`.)

4. **Zug-Anker** bei den Refs:

```ts
  // Was beim Start der Aufnahme galt: der Zug-Zoom rechnet relativ dazu,
  // wie der Pinch relativ zu seinem Aufsetzen.
  const zugStart = useRef<{ faktor: number; grenzen: { min: number; max: number } } | null>(null);
```

5. **In `handleVideoStart`** (nach `setNimmtAuf(true);`):

```ts
    // Anker des Zug-Zooms: Faktor und Grenzen beim Aufnahmestart. Grenzen
    // erst jetzt erfragen, nicht beim Rendern — sie hängen am aktiven Format.
    const grenzen = zoomGrenzenAktuell();
    zugStart.current = zoom && grenzen ? { faktor: faktorRef.current, grenzen } : null;
```

6. **Zug-Handler** (nach der `kameraWechseln`-Funktion):

```ts
  // Der Zug-Zoom (Spec 2026-08-13 §7): Hochziehen ab Aufnahmestart zoomt
  // rein, zurück nach unten wieder raus. Hart gesetzt wie der Pinch — der
  // Zoom folgt dem Finger, nicht hinterher.
  const zoomZug = (hub: number) => {
    const start = zugStart.current;
    if (!zoom || !start) return;
    zoomSetzen(
      zugFaktor(hub, start.faktor, start.grenzen, zoom.basis, {
        hoch: Dimensions.get('window').height * ZUG_WEG_HOCH_ANTEIL,
        runter: ZUG_WEG_RUNTER,
      }),
      false
    );
  };
```

7. **An den Auslöser** (im JSX):

```tsx
        <Ausloeser
          onFoto={() => void handleFoto()}
          onVideoStart={handleVideoStart}
          onVideoStop={() => void handleVideoStop()}
          onZoomZug={zoomZug}
          maxSekunden={MAX_VIDEO_SEKUNDEN}
          onSperre={setAufnahmeGesperrt}
        />
```

- [ ] **Step 4: Tests laufen lassen, Bestehen bestätigen**

Run: `cd mobile && npm test -- "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"`
Expected: PASS (alle).

- [ ] **Step 5: Commit**

```bash
git add "mobile/src/app/(tabs)/aufnehmen/index.tsx" "mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"
git commit -m "feat(kamera): Halten und Hochziehen zoomt, wie bei Snapchat"
```

---

### Task 8: Gesamtlauf und Abschluss

**Files:**
- Modify: keine geplanten (nur, was die Prüfungen aufdecken)

**Interfaces:**
- Consumes: alles Vorherige.
- Produces: grüner Gesamtzustand; Geräte-Checkliste als Übergabe an den Menschen.

- [ ] **Step 1: Volle Testsuite**

Run: `cd mobile && npm test`
Expected: PASS, keine Suite rot.

- [ ] **Step 2: Lint über ganz src/**

Run: `cd mobile && npx eslint src`
Expected: höchstens die 29 bekannten Alt-Fehler, KEINE neuen (Abgleich: die neuen Dateien/geänderten Stellen tauchen nicht in der Fehlerliste auf).

- [ ] **Step 3: TypeScript**

Run: `cd mobile && npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 4: Aufdecktes fixen und committen**

Nur falls Schritt 1 bis 3 etwas fanden; Fix + `git commit -m "fix(kamera): <was der Gesamtlauf aufdeckte>"`.

- [ ] **Step 5: Geräte-Checkliste an den Menschen übergeben**

Kein Code. Im Abschlussbericht die Checkliste aus der Spec (§9, «Gerät») aufführen — die Jest-Suite sieht Navigation und Kamera-Timing nicht:

1. Foto: Tipp → Vorschau gefühlt sofort; Bild scharf und richtig orientiert; Einsenden funktioniert; 16:9-Ausschnitt in Vorschau und Recap.
2. Foto mit Blitz im Video-Preset (feuert `flash`? Sonst Torch-Fallback nachrüsten).
3. Video: Aufnahme beginnt unmittelbar nach der Halte-Schwelle; Stopp → Vorschau zügig; Ton ab der ersten Sekunde.
4. Zug-Zoom: Hochziehen/Zurückziehen, Sperren mit gezogenem Zoom, danach Pinch nahtlos ab demselben Faktor; Strecken-Konstanten (`ZUG_WEG_HOCH_ANTEIL`, `ZUG_WEG_RUNTER`) nach Gefühl nachziehen.
5. Oranger Mikrofon-Punkt: an im Sucher, aus in allen anderen Tabs.
6. Kein Regress: Doppeltipp-Kamerawechsel, Pinch, Zoom-Reihe, Sperr-Geste, Zähler-Pille, Trip-Umschalter, Verwerfen, Versiegelung.
