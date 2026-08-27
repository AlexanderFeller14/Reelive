# Reisewahl im Aufnehmen-Tab: nur laufende Reisen, Weg zurück, Liste

Stand: 2026-08-27, im Gespräch freigegeben (Mockup: Artefakt «Die Reisewahl
als Liste», finale Fassung).

## Problem

Der Screen «Für welche Reise?» (`TripPickerScreen` in
`app/(tabs)/capture/index.tsx`) hat drei Fehler und ein Aussehen:

1. **Geplante Reisen zählen als laufend.** Der Picker filtert nur nach
   `status === 'active'`; der Reise-Tab trennt über `groupTrips` nach
   `start_date`. Wer die nächste Reise anlegt, während eine läuft, sieht den
   Picker bei jedem Kamera-Start. Wer nur eine geplante Reise hat, bekommt sie
   still gewählt und kann Momente einsenden, bevor sie begonnen hat.
2. **Kein Weg zurück.** Aus dem Sucher öffnet die Reise-Pille den Picker auch
   bei einer einzigen Reise, und dann gibt es keinen Ausweg ausser einer Wahl.
3. **Nichts zum Wiedererkennen.** Graue `bg-1`-Kästen mit Name und Zähler,
   kein Bild, kein Zeitraum.

## Entscheide

- **Nur laufende Reisen.** Picker und Automatik nehmen
  `groupTrips(trips, todaysCalendarDay()).running`, dieselbe Regel wie im
  Reise-Tab (Start = heute zählt als laufend). Geplante Reisen erscheinen
  nicht. Der Server prüft das Aufnahmefenster heute nicht; das bleibt ein
  offener Punkt ausserhalb dieser Änderung.
- **`NoTripScreen` kennt die geplante Reise.** Ohne laufende, aber mit
  geplanter Reise heisst es weiter «Keine laufende Reise», der Text darunter
  nennt die nächste: «‹Roadtrip Portugal› beginnt am 1. Sep 2026. Sobald sie
  läuft, fängt hier deine Kamera an.» Der Knopf «Neue Reise anlegen» bleibt.
- **Die Pille ist nur bei mehreren Reisen ein Schalter** (Produktkonzept:
  «umschaltbar, wenn mehrere laufen»). Bei genau einer laufenden Reise zeigt
  sie Name und Zähler ohne Chevron und ohne Aktion. Ab zwei öffnet sie den
  Picker, und der bekommt einen Schliessen-Knopf, der zur bisherigen Reise
  zurückführt.
- **Der Picker wird eine Liste** (Mockup, finale Fassung):
  - Kopf: H1 «Für welche Reise?», darunter Sekundär «Dein Moment landet auf
    ihrer Filmrolle.», rechts der runde Schliessen-Knopf (40 px, `bg-1`,
    Lucide `X`), nur wenn der Screen aus dem Sucher kommt.
  - Caption (12/500, `text-2`) «Laufende Reisen», 24 px Abstand nach oben,
    12 nach unten.
  - Zeile 88 hoch (12 + 64 + 12): Bild 64 × 64, Radius 12, `bg-1` als Grund
    (Platzhalter-Cover nach Position, wie im Reise-Tab), Abstand 16; Name
    Body-Medium `text-1`, Zeitraum Sekundär `text-2` (`formatRange`), dritte
    Zeile Sekundär `text-2` «Noch 4 Tage · 12 Momente» («Letzter Tag»,
    «Noch 1 Tag», «Noch kein Moment» als Sonderfälle). Jede Zeile einzeilig
    mit Ellipse.
  - Hairline 1 px `line` zwischen den Zeilen, nicht über der ersten.
  - Häkchen 24 px im Akzent mit weissem Haken rechts, nur auf der aktuellen
    Reise und nur aus dem Sucher (`accessibilityState.selected`).
  - Letzte Zeile «Neue Reise anlegen»: Kachel 64 × 64 `bg-1` mit Lucide
    `Plus` in `text-2`, Text Body-Medium, «Wenn keine der Reisen passt» in
    Sekundär, führt nach `/trip/new`.
  - Press: ganze Zeile, Scale 0.97 per `spring-ui` (`PressScale`). Zeilen
    erscheinen mit 40 ms Stagger (§5), bei reduzierter Bewegung als ein Fade.
  - `StatusBarCover` bleibt (die einzige scrollende Liste dieser Datei).
- **Keine gemerkte letzte Wahl, kein Cover im Cache.** Beides wartet, bis
  Überlappungen im Alltag vorkommen. Ohne gemerkte Wahl gibt es genau einen
  Abschnitt.
- **Bausteine ziehen aus.** `TripRow` und `AddTripRow` nach
  `components/TripRow.tsx`, der Screen nach
  `features/camera/TripPickerScreen.tsx`; `capture/index.tsx` behält nur
  Auswahl und Verdrahtung. `FadeIn` (heute in `features/map/MomentSheet.tsx`)
  zieht nach `components/FadeIn.tsx`, die Karte re-exportiert es.
  `daysLeftLabel` und `formatDay` kommen nach `features/trips/tripDay.ts`;
  `TripHeroCard` nutzt `daysLeftLabel` statt seiner Kopie.

## Umsetzung (Reihenfolge)

1. `tripDay.ts`: `daysLeftLabel(endIso, todayIso)`, `formatDay(iso)`, Tests.
2. `components/FadeIn.tsx` aus `MomentSheet.tsx` herausziehen, Re-Export.
3. `components/TripRow.tsx` (`TripRow`, `AddTripRow`) mit Test für die
   Sonderfälle der dritten Zeile.
4. `features/camera/TripPickerScreen.tsx`.
5. `capture/index.tsx`: `groupTrips` statt `status`-Filter, `NoTripScreen`
   mit geplanter Reise, Pille nur ab zwei Reisen ein Schalter, Picker mit
   `selectedId`, `onClose`, `onCreate`; alte `TripPickerScreen`-Funktion und
   `pickerRow`-Styles raus.
6. `camera.test.tsx`: `todaysCalendarDay` auf `2026-08-10` pinnen (wie
   `list.test.tsx`), Tests für Filter, geplante Reise im `NoTripScreen`,
   Zeileninhalt, Pille bei einer Reise, Schliessen, Häkchen, Plus-Zeile.
7. `npm test`, `tsc`, ESLint auf `src/` (nicht nur die eigenen Dateien).
8. Sichtabnahme am Simulator: Hairlines, Kachel, Häkchen, Plus-Zeile,
   Schliessen-Knopf, Pille ohne Chevron.

## Offen

- Serverseitige Prüfung des Aufnahmefensters (`captured_at` innerhalb
  `[start_date, end_date + 1]`), heute erlaubt RLS jedes Datum, solange die
  Reise `active` ist.
- Gemerkte letzte Wahl über den App-Start hinaus, sobald Überlappungen
  vorkommen.
