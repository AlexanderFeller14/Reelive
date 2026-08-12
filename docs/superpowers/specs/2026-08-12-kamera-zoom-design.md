# Zoom-Stufen in der Kamera — Design-Spezifikation

**Datum:** 2026-08-12
**Status:** Abgenommen (Brainstorming-Session)

## 1. Ziel

Der Sucher bekommt eine Zoom-Auswahl, die sich verhält wie die Kamera-App des
iPhones: eine Reihe von Stufen über dem Auslöser (auf einem iPhone 17 Pro Max
`0,5×  1×  4×`), dazu stufenloses Zoomen mit zwei Fingern. Die Stufen sind
echte Linsen, kein digital vergrösserter Ausschnitt, und iOS schaltet
dazwischen nahtlos um.

## 2. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Welche Stufen | Die Umschaltpunkte des Geräts, nicht feste Zahlen |
| Woher die Zahlen | AVFoundation über ein eigenes Native-Modul, keine Gerätetabelle |
| Wie gezoomt wird | Virtuelle Mehrfach-Kamera, iOS wechselt die Linsen selbst |
| Pinch | Stufenlos, multiplikativ, begrenzt auf die Gerätegrenzen |
| Während der Videoaufnahme | Zoom bleibt bedienbar, die Kopfzeile bleibt verschwunden |
| Nach einer Aufnahme | Faktor bleibt stehen |
| Frontkamera | Keine Stufen (nur eine Linse), Faktor zurück auf 1× |
| Android | Keine Stufen, kein Pinch — die Linsen-API gibt es dort nicht |

## 3. Warum ein eigenes Native-Modul

`expo-camera` nimmt keinen Zoomfaktor entgegen. Sein `zoom`-Prop ist ein
Regler von 0 bis 1, den iOS exponentiell umrechnet:

```swift
device.videoZoomFactor = minZoom * pow(device.activeFormat.videoMaxZoomFactor / minZoom, delegate.zoom)
// ios/Current/CameraSessionManager.swift:221
```

Daraus folgen drei Dinge, die das Design bestimmen:

1. **`videoMaxZoomFactor` ist von JavaScript aus nicht lesbar.** Ohne diese
   Zahl trifft kein `zoom`-Wert einen bestimmten Faktor. Ein fest verdrahtetes
   „4×" wäre auf dem einen Gerät 2×, auf dem anderen 8×.
2. **Die Zahl hängt am aktiven Format,** und das wechselt beim Umschalten
   zwischen Foto und Video. Derselbe `zoom`-Wert bedeutet in den beiden Modi
   also verschiedene Ausschnitte.
3. **Unter 1× kommt man über `zoom` nie** (`minZoom = 1.0`, hart im Code;
   Android ebenso: `max(1f, zoom * maxZoomRatio)`). 0,5× ist über diesen Weg
   grundsätzlich unerreichbar.

Das Modul umgeht alle drei, indem es den Faktor **direkt** setzt
(`device.videoZoomFactor = 4.0`) statt über den Regler. Damit entfällt die
Umrechnung samt ihrer Format-Abhängigkeit: 4× ist 4×, im Foto- wie im
Videomodus. Das `zoom`-Prop von `CameraView` bleibt unbenutzt auf 0.

Zweiter Grund für das Modul: `expo-camera` wählt Linsen über den
**lokalisierten** Gerätenamen (`$0.localizedName == delegate.selectedLens`,
CameraSessionManager.swift:91). Auf einem deutschsprachigen iPhone heisst die
Kamera anders als auf einem englischen. Das Modul liefert die Zuordnung
Gerätetyp → lokalisierter Name und macht die Auswahl damit sprachunabhängig.

## 4. Die Stufen kommen vom Gerät

Mehrfach-Kameras kennen ihre eigenen Umschaltpunkte
(`virtualDeviceSwitchOverVideoZoomFactors`) — genau die Faktoren, bei denen
iOS von einer Linse auf die nächste wechselt. Es sind dieselben Zahlen, die
Apple in der Kamera-App als Stufen anbietet.

Ist die weiteste Linse ein Ultraweitwinkel, entspricht Faktor 1,0 der Anzeige
„0,5×". Der Umrechnungsschlüssel steckt im ersten Umschaltpunkt selbst:

```
basis        = bestandteile[0] == 'ultraWide' ? 1 / umschaltpunkte[0] : 1
anzeige(f)   = f * basis
stufen       = [1, ...umschaltpunkte] * basis
```

Damit ergibt sich ohne jede Gerätetabelle:

```
iPhone 17 Pro Max   Umschaltpunkte [2.0, 8.0]   →   0,5×   1×   4×
iPhone 15           Umschaltpunkte [2.0]        →   0,5×   1×
iPhone SE           keine (eine Linse)          →   keine Reihe
```

Neue iPhones sind damit von selbst richtig.

## 5. Bausteine

### `modules/kamera-zoom/` — lokales Expo-Modul (Swift, iOS)

```ts
linsen(position: 'back' | 'front'): Linse[]
zoomGrenzen(name: string): { min: number; max: number } | null
setzeZoom(name: string, faktor: number, sanft: boolean): void

type Linse = {
  name: string;            // localizedName, wie ihn expo-camera erwartet
  typ: 'ultraWide' | 'wide' | 'telephoto' | 'trueDepth' | 'triple' | 'dual' | 'dualWide' | 'unbekannt';
  bestandteile: string[];  // bei virtuellen Geräten die enthaltenen Linsen, in Reihenfolge
  umschaltpunkte: number[];
};
```

`setzeZoom` mit `sanft: true` nutzt `ramp(toVideoZoomFactor:withRate:)`, also
das weiche Hineinfahren der Kamera-App; der Pinch setzt hart, damit er dem
Finger folgt. Android liefert eine leere Liste, `setzeZoom` ist dort ein
No-op. Am Simulator gibt es keine Kamera, also ebenfalls eine leere Liste —
die Reihe erscheint dort nicht.

Das Modul greift auf dieselben `AVCaptureDevice`-Instanzen zu, die
`expo-camera` benutzt (AVFoundation gibt pro Gerät dasselbe Objekt heraus),
und findet sie über den Namen, den wir per `selectedLens` gesetzt haben.

### `src/features/kamera/zoom.ts` — Logik, ohne React

Wählt die virtuelle Kamera aus der Linsenliste (die mit den meisten
Bestandteilen), leitet Basis und Stufen ab, begrenzt Faktoren auf die
Gerätegrenzen, rechnet die Pinch-Skala auf einen Faktor um und formt die
Beschriftung (`0,5×`, `1×`, `2,3×`). Vollständig unit-testbar.

### `src/components/ZoomWahl.tsx` — die Reihe

Translucente Pille nach DESIGN-LANGUAGE §1 (`overlay-pill` + Blur, über
`components/Pille.tsx`), Radius 999, über dem Auslöser. Die aktive Stufe hebt
sich ab; steht der Faktor zwischen zwei Stufen, zeigt die aktive den laufenden
Wert (`2,3×`) statt ihrer Zahl — wie in der Kamera-App. Haptik `selection`,
wie in DESIGN-LANGUAGE §5 bereits für Zoom festgelegt.

### Einbau in `src/app/(tabs)/aufnehmen/index.tsx`

`selectedLens` bekommt den Namen der virtuellen Kamera. Der Zustand ist der
**Anzeige-Faktor**, nicht der Regler. Eine Pinch-Geste
(`react-native-gesture-handler`) liegt über dem Sucher.

## 6. Verhalten

- **Start:** 1×. Das muss aktiv gesetzt werden, siehe Fallstrick unten.
- **Tippen:** springt sanft auf die Stufe, Haptik `selection`.
- **Pinch:** multipliziert den Faktor mit der Geste, begrenzt auf
  `[min, max]` des Geräts. Keine Haptik, kein Rasten.
- **Videoaufnahme:** Zoom bleibt bedienbar. Er ändert nur eine
  Geräteeigenschaft und baut die Session nicht um — anders als der
  Kamerawechsel, dessentwegen die Kopfzeile während der Aufnahme verschwindet.
- **Kamerawechsel:** Faktor zurück auf 1×, an der Frontkamera keine Reihe.
- **Rückkehr aus der Vorschau:** Faktor bleibt stehen.

## 7. Fallstricke

**Faktor 1,0 ist 0,5×.** Auf der virtuellen Kamera bedeutet der native
Faktor 1,0 die weiteste Linse. Wer nichts tut, startet bei 0,5×. Der Startwert
1× muss deshalb aktiv gesetzt werden — und erneut nach jedem Ereignis, bei dem
`expo-camera` selbst an den Zoom greift: Wechsel der Linse, Wechsel der
Kamerarichtung, Wechsel zwischen Foto und Video. `expo-camera` setzt dabei
`videoZoomFactor` auf `maxZoom^0 = 1,0`, also auf 0,5×.

**Zwei Schreiber auf einer Eigenschaft.** `expo-camera` und das Modul setzen
beide `videoZoomFactor`. AVFoundation schützt die Konsistenz über
`lockForConfiguration`; wer zuletzt schreibt, gewinnt. Wir schreiben nach.

**Kein Ereignis für „Session umgebaut".** `onCameraReady` feuert genau einmal
(siehe den bestehenden Kommentar zu `VIDEO_START_VERSUCHE` im Screen). Nach
einem Moduswechsel wird der Faktor deshalb nachgesetzt, sobald der Wechsel
committet ist, und nicht auf ein Ereignis gewartet.

## 8. Tests

- **Unit** (`zoom.test.ts`): Stufen aus Umschaltpunkten, Basis bei
  Ultraweitwinkel und ohne, Clamping, Pinch-Umrechnung, Beschriftung,
  Sonderfälle (eine Linse, leere Liste, Android).
- **Komponente** (`ZoomWahl.test.tsx`): welche Stufen erscheinen, welche aktiv
  ist, Zwischenwert in der aktiven Stufe, Haptik-Aufruf, Accessibility-Labels.
- **Screen** (`kamera.test.tsx`): Reihe erscheint nur bei mehreren Linsen,
  `selectedLens` geht an `CameraView`, Tippen setzt den Faktor, Startwert 1×,
  Nachsetzen nach Kamera- und Moduswechsel, Frontkamera ohne Reihe.
- **Gerät** (iPhone 17 Pro Max): die drei Stufen gegen die Kamera-App halten,
  Pinch, Zoom während laufender Videoaufnahme, Wechsel Foto↔Video ohne
  Bildsprung. Der Simulator kann das nicht — er hat keine Kamera und das Modul
  liefert dort nichts.

## 9. Nicht in dieser Runde

- Zoom im Recap-Player oder in der Vorschau.
- Doppeltipp auf eine Stufe (in der Kamera-App wechselt er nichts, was wir
  hier bräuchten).
- Android-Zoom über `CameraX` — ohne Linsen-API bliebe es bei einem
  digitalen Ausschnitt ab 1×, also bei etwas anderem als dem hier
  Beschriebenen.
