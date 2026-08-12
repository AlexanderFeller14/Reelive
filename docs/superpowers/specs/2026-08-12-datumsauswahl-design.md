# Zeitraum-Auswahl statt getippter Datumsfelder

**Status:** freigegeben (2026-08-12)
**Betrifft:** `reise/neu.tsx`, `reise/[id]/bearbeiten.tsx`, `features/trips/tripDay.ts`

## 1. Ausgangslage

Beide Reise-Formulare verlangen heute zwei getippte Datumsfelder im Format
`01.08.2026`. Daraus folgen drei Fehlerquellen, die der Nutzer selbst tragen
muss: ein unlesbares Format, ein Ende vor dem Beginn, und eine Tastatur, die
sich über das Formular legt. `parseGermanDate` fängt das erste ab,
`validateDateRange` das zweite, beide melden feldgenaue Fehler. Der Nutzer
tippt für einen Zeitraum von zwei Wochen zwanzig Zeichen.

Ziel ist eine Auswahl, die aussieht und sich anfühlt wie der Datepicker von
Airbnb: ein Kalender, zwei Tipper, kein Format.

## 2. Entscheidungen

| Frage | Entscheidung | Grund |
|---|---|---|
| Zeitraum am Stück oder zwei Daten? | Am Stück, ein Sheet | Ein Ende vor dem Beginn kann strukturell nicht entstehen |
| Tippen weiterhin möglich? | Nein, nur Kalender | Ohne Textpfad entfallen Parser, Tastatur und zwei Fehlermeldungen |
| Welche Tage? | Ein Jahr zurück, zwei Jahre vorwärts | Deckt geplante und bereits laufende Reisen ab, bleibt am Stück renderbar |
| Fertige Bibliothek? | Nein, eigene Komponente | Die Zeitraum-Markierung schreibt man ohnehin selbst, die Design-Language schlägt Framework-Defaults |

Ausdrücklich verworfen: `@react-native-community/datetimepicker` kennt keine
Zeitraum-Auswahl und trägt Systemoptik. `react-native-calendars` bringt eigene
Farben und Schriftgrössen mit, die nur über Style-Durchgriffe und
Render-Overrides an DESIGN-LANGUAGE §1 bis §4 heranzuführen wären.

## 3. Verhalten

Der Zustand ist `{ start: string | null, end: string | null }`, beide als
ISO-Kalendertag `YYYY-MM-DD`.

`naechsteAuswahl(aktuell, getippt)` bildet vier Regeln ab:

1. Kein Beginn gesetzt: der getippte Tag wird Beginn, das Ende bleibt leer.
2. Beginn gesetzt, Ende leer, getippter Tag liegt auf oder nach dem Beginn:
   der getippte Tag wird Ende.
3. Beginn gesetzt, Ende leer, getippter Tag liegt vor dem Beginn: der
   getippte Tag wird der neue Beginn, das Ende bleibt leer.
4. Beginn und Ende gesetzt: der getippte Tag wird Beginn, das Ende wird
   geleert. Jeder Tipp auf einen fertigen Zeitraum beginnt neu.

Regel 2 lässt `getippt === start` ausdrücklich zu: Beginn und Ende auf
demselben Tag ist die Tagesreise, `tripLength` liefert dafür 1.

ISO-Kalendertage sind lexikografisch sortierbar. Die Vergleiche laufen direkt
auf den Strings, nicht über `Date`-Objekte. Das hält die Funktion frei von
Zeitzonen, in derselben Linie wie die UTC-Rechnung in `tripDay.ts`.

## 4. Aussehen

**Das Feld im Formular.** An die Stelle von «Beginn» und «Ende» tritt ein
Feld «Zeitraum». Es übernimmt die Masse des `Input` aus DESIGN-LANGUAGE §4:
Höhe 56, `radius.control`, Rand 1 px `line-strong`, Label darüber. Gefüllt
zeigt es `formatRange(start, end)`, also `1.–14. Aug 2026`. Leer steht nur
das Label. Es ist kein Textfeld, sondern eine Fläche, die das Sheet öffnet.

**Das Sheet.** Titel «Zeitraum», darunter die Wochentagszeile `M D M D F S S`
fest oben, darunter ein senkrecht scrollender Monatsstapel. Die Woche beginnt
am Montag. Jeder Monat trägt seinen Namen in `type.h3` über dem Raster. Unten
sitzt der Primärknopf «Übernehmen», inaktiv bis Beginn und Ende stehen.

**Die Tageszelle** ist das Touch-Ziel und misst 48 in der Höhe, in der Breite
ein Siebtel des Rasters, damit die Woche die Sheet-Breite ohne Restspalte
füllt: bei 24 px Screen-Rand sind das rund 50 px auf einem iPhone 17 und rund
47 px auf einem iPhone SE. Beide Masse liegen über den 44 px, die Apples
Human Interface Guidelines als kleinstes Touch-Ziel nennen.

Der sichtbare Kreis darin ist mit 40 px kleiner als seine Zelle und zentriert.
Das ist auch bei Airbnb so: die berührbare Fläche reicht über den gezeichneten
Kreis hinaus, und ein fester Durchmesser bleibt unabhängig von der
Gerätebreite ein Kreis statt eines Ovals.

Die halbseitige Fläche an Beginn und Ende reicht von der Zellmitte bis an die
äussere Zellkante, nicht nur bis an den Kreisrand. Sonst klafft zwischen dem
Beginn und dem ersten Tag der Spanne eine Lücke im Balken.

| Zustand | Darstellung |
|---|---|
| Beginn, Ende | Gefüllter Kreis `radius.pill` in `text-1`, Zahl in `bg-0` |
| Dazwischen | Fläche `bg-1` über die volle Zellbreite, Zahl in `text-1` |
| Beginn bei gesetztem Ende | Zusätzlich `bg-1` in der rechten Zellhälfte hinter dem Kreis |
| Ende bei gesetztem Beginn | Zusätzlich `bg-1` in der linken Zellhälfte hinter dem Kreis |
| Beginn und Ende auf demselben Tag | Nur der Kreis, keine halbseitige Fläche |
| Heute | Punkt 4 px unter der Zahl, `text-2`, auf gefüllter Zelle `bg-0` |
| Ausserhalb des Bereichs | Zahl in `text-3`, reagiert nicht auf Tipps |

Die Spanne bricht an der Wochenkante ab, ohne Sonderbehandlung. Das ist auch
bei Airbnb so.

Beginn und Ende liegen bewusst auf `text-1`, nicht auf `accent`: unten im
Sheet sitzt bereits der Primärknopf, und §4 lässt genau einen Akzent pro
Screen zu. Derselbe Grund, aus dem der Input-Fokus in §4 auf `#222222` liegt.
Bei Airbnb sind die gewählten Tage ebenfalls dunkel gefüllt, die Optik
stimmt damit überein.

**Der Bereich** reicht vom Ersten des Monats vor zwölf Monaten bis zum letzten
Tag des Monats in vierundzwanzig Monaten, gerechnet ab
`heutigerKalendertag()`. Das sind 37 Monate. Beim Öffnen springt die Liste auf
den Monat des gewählten Beginns, sonst auf den aktuellen Monat.

## 5. Aufbau

Drei Einheiten mit je einem Zweck.

### `src/features/trips/kalender.ts`

Die gesamte Logik, ohne React. Exportiert:

- `type Auswahl = { start: string | null; end: string | null }`
- `type Zellrolle = 'frei' | 'beginn' | 'ende' | 'dazwischen' | 'einzeln' | 'gesperrt'`
- `monateImBereich(heute: string): Monat[]` mit
  `Monat = { jahr: number; monat: number; titel: string; wochen: (string | null)[][] }`.
  Führende Leerzellen sind `null`, der Wochentag-Offset ist
  `(getUTCDay() + 6) % 7`, damit die Woche am Montag beginnt.
- `naechsteAuswahl(aktuell: Auswahl, getippt: string): Auswahl` nach §3
- `zellrolle(iso: string, auswahl: Auswahl): Zellrolle`.
  `'einzeln'` gilt, wenn `start === end === iso`, und trennt die Tagesreise
  von `'beginn'`, damit die halbseitige Fläche entfällt.
- `monatHoehe(monat: Monat): number` und `monatVersatz(monate, index): number`
  als Grundlage für `getItemLayout`

Die Trennung folgt `wischUeberSchwelle` in `Sheet.tsx`: die Entscheidung ist
ohne simulierte Touch-Events prüfbar.

### `src/components/Kalender.tsx`

Rendert Wochentagszeile und Monatsstapel. Zustandslos, bekommt `auswahl` und
`onTag` herein. Die Zellen nutzen das vorhandene `PressScale`.

### `src/components/Zeitraumfeld.tsx`

Das Formularfeld samt Sheet. Props:
`{ wert: Auswahl; onAendern: (a: Auswahl) => void; fehler?: string }`.
Hält die vorläufige Auswahl, solange das Sheet offen ist, und meldet erst bei
«Übernehmen» nach oben. Schliessen ohne Übernehmen verwirft, das Feld behält
seinen alten Wert.

## 6. Leistung

37 Monate ergeben rund 1300 Tageszellen. Der Stapel ist deshalb eine
`FlatList` über die Monate, nicht eine `ScrollView`. `initialScrollIndex`
setzt den Zielmonat, `getItemLayout` liefert die Höhen aus `monatHoehe` und
`monatVersatz`. Ein Monat ist je nach Lage des Ersten 5 oder 6 Wochenzeilen
hoch, die Höhe ist also vorab berechenbar und muss nicht gemessen werden.

Das `Sheet` ist dafür vorbereitet: nur der Griffbereich trägt die
Wischgesten, der Inhalt darunter scrollt frei (`Sheet.tsx:209-216`).

## 7. Datenfluss und Änderungen am Bestand

Beide Screens halten künftig eine `Auswahl` statt zweier getippter Strings.

**`reise/neu.tsx`:** `createTrip({ startDate: start, endDate: end })` bekommt
die ISO-Werte direkt, `parseGermanDate` entfällt.

**`reise/[id]/bearbeiten.tsx`:** Die Vorbelegung setzt
`{ start: data.start_date, end: data.end_date }` ohne Umformatierung,
`formatGermanDate` entfällt. Eine bereits laufende Reise erreicht ihren
eigenen Beginn, weil der Bereich ein Jahr zurückreicht.

**`features/trips/tripDay.ts`:** `parseGermanDate` und `formatGermanDate`
haben danach keinen Aufrufer mehr und werden entfernt, samt ihrer Tests.
`validateDateRange` bleibt als letzte Prüfung vor dem Absenden, obwohl der
Kalender ein Ende vor dem Beginn strukturell verhindert. `formatRange`,
`tripDay`, `tripLength`, `heutigerKalendertag` und `groupTrips` bleiben
unberührt.

## 8. Fehler

Es bleibt genau eine Meldung: «Trag den Zeitraum ein.», wenn beim Absenden
nichts gewählt wurde. Sie erscheint im bestehenden Fehler-Slot unter dem Feld,
in `danger`, wie in §4 vorgesehen.

Ersatzlos entfallen «Trag den Beginn ein, z.B. 01.08.2026.», «Trag das Ende
ein, z.B. 14.08.2026.» und «Das Ende darf nicht vor dem Beginn liegen.» als
sichtbare Meldungen. Die letzte bleibt als Rückgabewert von
`validateDateRange` bestehen, erreicht die Oberfläche aber nicht mehr.

Lade- und Speicherfehler in `bearbeiten.tsx` bleiben unverändert.

## 9. Vorlesen und Motion

Jede Tageszelle ist ein Knopf mit `accessibilityRole="button"`, einer
Beschriftung wie «14. August 2026» und gesetztem
`accessibilityState={{ selected }}`. Tage ausserhalb des Bereichs tragen
`disabled`. Das Feld liest sich als «Zeitraum, 1. August 2026 bis 14. August
2026»: §6 erlaubt den Bis-Strich in Bereichen, schreibt ihn aber nicht vor,
und vorgelesen trägt das Wort besser. Beide Monate werden ausgeschrieben,
statt `formatRange` zu verwenden, dessen Kurzform «Aug» vorgelesen nicht
verlässlich als «August» ankommt. Sichtbar bleibt am Feld die Kurzform.

Press-Feedback läuft über `PressScale` mit 0.97 (§5), das seinerseits
`prefers-reduced-motion` bereits berücksichtigt. Das Sheet öffnet per
`spring-ui`, wie es das schon tut. Haptik: `selection` beim Wählen eines Tages,
sparsam gemäss §5.

## 10. Tests

**Neu, `features/trips/__tests__/kalender.test.ts`** (reine Logik):
die vier Auswahlregeln je einzeln, die Tagesreise (`start === end`), die
Bereichsgrenzen (erster und letzter Monat), der Wochentag-Offset über einen
Monatswechsel, ein Schaltjahr (Februar 2028 mit 29 Tagen), und `zellrolle`
für alle sechs Rollen.

**Neu, `components/__tests__/Zeitraumfeld.test.tsx`:**
Feld zeigt den formatierten Bereich, Tipp öffnet das Sheet, zwei Tipps im
Kalender füllen die Auswahl, «Übernehmen» meldet ISO-Werte nach oben,
Schliessen ohne Übernehmen lässt den alten Wert stehen, «Übernehmen» ist bei
halber Auswahl inaktiv.

**Umbau, `app/(tabs)/reise/__tests__/formular.test.tsx`:**
Von den acht Tests fassen fünf die Datumsfelder an. Zwei davon entfallen
ersatzlos, «Ende vor Beginn wird abgefangen, Fehler landet am Ende-Feld» und
«unlesbares Datum wird dem betroffenen Feld zugeordnet», weil der Kalender
beide Zustände nicht mehr entstehen lässt. Die übrigen drei wechseln von
`fireEvent.changeText` auf die Kalender-Bedienung: «leerer Name wird
abgefangen», «gültige Eingabe legt an und führt zum Einladen» und «Bearbeiten
kommt mit vorbelegten Werten und speichert», wobei bei letzterem die Prüfung
`getByDisplayValue('01.08.2026')` durch den formatierten Bereich am Feld
ersetzt wird. Die drei Tests zu Lade- und Speicherfehlern bleiben unberührt.

**Entfernt:** die Fälle zu `parseGermanDate` und `formatGermanDate` in
`features/trips/__tests__/tripDay.test.ts`. Die Fälle zu `validateDateRange`
bleiben.

## 11. Nicht Teil dieser Arbeit

- Ein «Zurücksetzen»-Knopf im Sheet. Ein Tipp auf einen beliebigen Tag
  beginnt die Auswahl ohnehin neu.
- Unbegrenztes Scrollen mit Nachladen weiterer Monate.
- Eine Mindest- oder Höchstdauer für eine Reise.
- Das Touch-Ziel des bestehenden `Input`: dessen obere Hälfte reagiert nicht
  auf Tipps, weil der `TextInput` bei `justifyContent: 'flex-end'` nur die
  unteren rund 28 px des 56-px-Rahmens belegt (`Input.tsx:84-138`). Das
  betrifft alle übrigen Felder der App und gehört in eine eigene Änderung.
