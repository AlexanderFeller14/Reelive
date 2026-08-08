# Phase 7 — Die Karte des Recaps

**Status:** Entwurf, wartet auf Freigabe
**Datum:** 2026-08-08
**Vorgänger:** Phase 6 (Teilen, Export, Store-Readiness), gemergt als `bcf4147`

---

## 1. Ziel & Deliverable

> «Auf einer Karte sehen, wo genau die Fotos und Videos entstanden sind — damit
> man Dinge leichter findet.»

Der Recap hat heute zwei Lesarten: die **Übersicht** (nach Reisetagen sortiert)
und den **Player** (die Reise am Stück). Beide beantworten «wann». Diese Phase
fügt die dritte hinzu, die «wo» beantwortet — und sie ist nicht Dekoration,
sondern ein Sucheinstieg: Wer sich an einen Ort erinnert, aber nicht an den Tag,
findet den Moment heute nur durch Blättern.

**Deliverable:** Eine Karte pro Recap. Jeder Moment mit Koordinaten sitzt als
Nadel darauf, die Reihenfolge der Aufnahme ist als Linie sichtbar, ein Tipp auf
eine Nadel öffnet den Moment und führt von dort in den Player.

---

## 2. Was diese Phase NICHT braucht

Das Ungewöhnliche an dieser Phase: **sie braucht keine einzige Migration.**

`posts.lat`, `posts.lng` und `posts.place_name` existieren seit Phase 1 und
werden seit Phase 4 von `ortUndZeit.ortBestimmen()` befüllt. Sie stehen unter
derselben Select-Policy wie alles andere am Moment — die Karte macht also nichts
sichtbar, was Mitglieder nicht ohnehin schon lesen dürfen. Sie zeigt nur, was
längst da ist.

Was die Phase durch den Entscheid R4 dennoch am Server ändert: `share-link`
gibt zwei Spalten mehr aus. Keine Migration, keine Policy — die Function läuft
mit `service_role` und wählt ihre Spalten selbst.

Konkret nicht Teil dieser Phase:

- keine neue Tabelle, keine neue Policy, keine neue Edge Function
- kein zweiter Ortsdienst, kein eigenes Geocoding — `place_name` reicht
- keine Karte für eine laufende, noch versiegelte Reise (§3, R3)

---

## 3. Rahmenentscheide

Diese Entscheide sind ohne Rückfrage getroffen worden (stehende Vollmacht des
Users vom 2026-08-07) und stehen hier zur Prüfung.

**R1 — `react-native-maps`, nicht `expo-maps`.**
`expo-maps` ist laut Expo-Doku für SDK 57 ausdrücklich *alpha* mit häufigen
Breaking Changes, läuft nicht in Expo Go und trennt iOS und Android in zwei
verschiedene Komponenten (`AppleMaps.View` / `GoogleMaps.View`). `react-native-maps`
hat eine gemeinsame `<MapView>`-API, läuft **in Expo Go** und nutzt auf iOS
Apple Maps ohne API-Schlüssel. Das Letzte wiegt hier schwer: die Karte lässt
sich damit im Simulator prüfen, statt auf den nächsten Dev-Build zu warten.
Preis: für den Android-Store-Build braucht es einen Google-Maps-API-Schlüssel —
das kommt auf dieselbe Liste wie die übrigen Konten-Schritte aus Phase 6.

**R2 — Die Kartenkacheln sind eine Fremdfläche, so wie Fotos es sind.**
Apple Maps bringt Blau für Wasser und Grün für Parks mit; die DESIGN-LANGUAGE
verbietet beides. Der Konflikt ist scheinbar: die Kacheln sind Inhalt, kein
Interface — genau wie ein Foto, das ebenfalls jede Farbe mitbringt. Bindend
bleibt, was **auf** der Karte liegt: Nadeln, Pillen, Sheet, Knöpfe folgen §1
bis §5 ohne Ausnahme. Die Karte bekommt keine `customMapStyle`-Bastelei, die
Apple ohnehin nicht unterstützt.

**R3 — Vor dem Reveal gibt es keine Karte.**
Eine Karte der laufenden Reise würde verraten, wo die anderen gerade waren —
und damit die Versiegelung an ihrer empfindlichsten Stelle brechen. Die Karte
hängt am Recap, nicht an der Reise. Serverseitig ist das ohnehin erzwungen
(`posts_select_revealed_members`), der Client muss die Route trotzdem gar nicht
erst anbieten.

**R4 — Der geteilte Recap bekommt dieselbe Karte. Entscheid des Users,
2026-08-08.**
Der Entwurf sah das Gegenteil vor, mit dieser Begründung: der geteilte Recap
läuft im Browser und zeigt Fremden ohne Konto die Momente; Koordinaten sind
etwas anderes als Bilder, sie sagen, wo jemand geschlafen hat, und ein Link
wandert weiter, als man denkt. Der User hat den Einwand gehört und
**vollständig** entschieden — dieselbe Karte, ungerundet, für jeden mit dem
Link. Das gilt.

Was daran hängt, damit es niemanden später überrascht:

- Die Edge Function `share-link` gibt `lat`/`lng` mit aus. Sie ist der einzige
  Weg, auf dem Koordinaten an Aussenstehende gelangen — und läuft mit
  `verify_jwt = false`. Der Widerruf eines Links entzieht damit auch die Orte;
  eine zweite Sperre gibt es nicht.
- `react-native-maps` liefert im Web-Bundle nichts Brauchbares. Die Karte
  braucht deshalb eine zweite Umsetzung für Web (Leaflet mit
  OpenStreetMap-Kacheln, inklusive der vorgeschriebenen Namensnennung) hinter
  demselben Plattform-Schalter, den Phase 6 schon dreimal benutzt
  (`*.web.ts`).
- Der Teilen-Screen läuft auf **beiden** Plattformen: ein Reelive-Nutzer, der
  einen geteilten Link auf dem Handy öffnet, landet nativ auf derselben Route.
  Die Kartenfläche ist deshalb ohnehin zweimal nötig — App-Karte und geteilte
  Karte teilen sie sich.

**Nicht verhandelbar bleibt R3:** vor dem Reveal gibt es überhaupt keine
Karte, auch keinen geteilten Link darauf. Ein Link auf eine versiegelte Reise
wird von `share-link` schon heute abgewiesen.

**R5 — Genauigkeit bleibt, wie sie aufgenommen wurde.**
Kein Runden, kein Verschleiern für Mitglieder. Wer den Moment sehen darf, darf
auch sehen, wo er entstand — die Reise ist ein privater Kreis, den man selbst
zusammengestellt hat. Der Schutz sitzt an der Mitgliedschaft, nicht an der
Nachkommastelle.

---

## 4. Die Versprechen dieser Phase

| # | Versprechen |
|---|---|
| K1 | Jeder aufgedeckte Moment mit `lat`/`lng` sitzt als Nadel auf der Karte, an genau seiner Koordinate. |
| K2 | Die Karte öffnet sich so, dass alle Nadeln der Reise sichtbar sind — ohne dass jemand zoomen muss. |
| K3 | Die Reihenfolge der Aufnahme ist als Linie zu sehen, und sie folgt `captured_at`, nie der Upload-Zeit. |
| K4 | Ein Tipp auf eine Nadel zeigt den Moment: Bild, Autor, Uhrzeit, Ort, Caption. |
| K5 | Aus diesem Sheet führt genau ein Knopf in den Player, und der startet bei genau diesem Moment. |
| K6 | Momente ohne Ort verschwinden nicht: die Karte sagt, wie viele es sind, und macht sie erreichbar. |
| K7 | Liegen mehrere Momente dicht beieinander, zeigt die Karte eine Gruppe statt eines Nadelhaufens; ein Tipp fächert sie auf. |
| K8 | Ein Tag-Filter dünnt die Karte auf einen einzelnen Reisetag aus. |
| K9 | Hat kein einziger Moment einen Ort, gibt es keine leere Karte, sondern eine Erklärung. |
| K10 | Für eine versiegelte Reise ist die Karte nicht erreichbar — kein Einstieg, keine Route. |
| K11 | Die Karte hält sich an DESIGN-LANGUAGE §1–§6; die Kartenkacheln selbst sind davon ausgenommen (R2). |
| K12 | Reduced Motion schaltet die Kamerafahrten der Karte auf sofortiges Springen um. |
| K13 | Der geteilte Recap zeigt dieselbe Karte, ohne Konto und im Browser (Entscheid R4). |
| K14 | Die Web-Karte nennt die Quelle ihrer Kacheln, so wie deren Lizenz es verlangt. |
| K15 | Ein widerrufener oder abgelaufener Link gibt auch keine Koordinaten mehr her. |

---

## 5. Der Screen

### 5.1 Einstieg

In der Recap-Übersicht, direkt unter dem Kopf, sitzt eine Zeile mit den beiden
Lesarten — das ist der einzige Ort, an dem die Karte auftaucht:

> **Nach Tagen** · **Auf der Karte**

Als Segment-Zeile aus zwei Pillen (§4, Pill-Control), nicht als Tab-Bar: die
untere Tab-Bar bleibt bei vier Einträgen (§4), und die Karte ist eine Sicht auf
*diesen* Recap, kein eigener Bereich der App.

Ist `trip.status === 'active'`, gibt es die Zeile nicht (K10). Für `revealed`
und `archived` gibt es sie.

### 5.2 Route

`mobile/src/app/(tabs)/recap/[id]/karte.tsx` — dieselbe Ebene wie
`uebersicht.tsx` und `player.tsx`, damit `[id]` geteilt bleibt.

### 5.3 Aufbau

Die Karte füllt den Screen. Darüber liegen genau drei Dinge:

1. **Oben links** eine Zurück-Pille (translucent, §1) — die Karte hat keinen
   eigenen Kopf, sie soll gross sein.
2. **Oben rechts** die Tag-Filter-Pille mit dem aktuellen Stand («Alle Tage»,
   «Tag 2»). Ein Tipp öffnet ein Sheet mit der Tagesliste (K8).
3. **Unten** eine Leiste, wenn es Momente ohne Ort gibt: «3 Momente ohne Ort» —
   antippbar, öffnet ein Sheet mit ihnen (K6).

Der Screen ist **hell**, nicht Kino: er zeigt keine Medien im Vollbild, sondern
ist ein Werkzeug zum Finden. Das Sheet und die Pillen folgen der Licht-Palette.
Erst der Sprung in den Player wechselt ins Kino, mit dem bestehenden Fade.

### 5.4 Die Nadel

Keine Standard-Stecknadel. Jede Nadel ist ein **rundes Thumbnail** des Moments
(Radius 999, 2 px weisser Ring, `shadow-2`) — dieselbe Form wie die Avatare
(§4), und sie beantwortet die Frage «was war hier» ohne einen einzigen Tipp.
Videos tragen zusätzlich ein kleines Play-Icon (Lucide, Outline).

Solange die Thumbnails noch laden, steht dort ein `bg-1`-Kreis mit Opacity-Puls
(§4, Skeleton).

### 5.5 Die Gruppe (K7)

Momente näher als ~40 Bildschirmpunkte zueinander werden zu einer Gruppe
zusammengefasst: das Thumbnail des **frühesten** Moments der Gruppe, mit einer
Zähler-Pille am Rand («4»). Ein Tipp zoomt auf die Gruppe, bis sie auseinander-
fällt — nicht auf ein Listen-Sheet. Wer auf der Karte sucht, will die Karte
benutzen.

Die Gruppierung rechnet in Bildschirmpunkten, nicht in Metern: sie soll
verhindern, dass Nadeln einander verdecken, und das hängt am Zoom, nicht an der
Geografie.

### 5.6 Die Linie (K3)

Eine Polyline durch alle Momente **mit** Koordinaten, in `captured_at`-Reihenfolge.
Farbe `accent`, Breite 3, keine Pfeilspitzen. Sie zeigt die Reise als Bewegung
und gibt der Karte eine Leserichtung.

Bei aktivem Tagesfilter verbindet die Linie nur die Momente dieses Tages.

### 5.7 Das Moment-Sheet (K4, K5)

Tipp auf eine einzelne Nadel → Sheet von unten (§4):

- Bild in 3:2, Radius 24
- Autor und Uhrzeit als Sekundärzeile («Mira · 14:32»)
- `place_name`, wenn vorhanden
- Caption in Body
- **Ein** Primär-Button: «Im Recap ansehen» → Player mit `start` = Index dieses
  Moments in der sortierten Spielliste

Der `start`-Parameter existiert bereits (`player.tsx` liest ihn, `uebersicht.tsx`
setzt ihn) und ist ein **Index in die sortierte Liste**, keine ID. Die Karte
benutzt exakt dieselbe Sortierung (`tage.sortiereMomente`) und darf deshalb
denselben Index bilden.

### 5.8 Die Momente ohne Ort (K6)

Ohne Berechtigung, in Innenräumen oder bei Zeitüberschreitung liefert
`ortBestimmen()` bewusst drei `null` — der Moment wird trotzdem eingesendet
(Phase 4). Solche Momente hat jede echte Reise, und sie dürfen auf der Karte
nicht einfach fehlen, ohne dass es jemand merkt.

Die Leiste unten nennt ihre Zahl; ein Tipp öffnet ein Sheet mit derselben
Kachel-Liste wie in der Übersicht, aus der ebenfalls der Player erreichbar ist.

### 5.9 Wenn gar nichts einen Ort hat (K9)

Kein leerer Kartenausschnitt über dem Atlantik. Stattdessen der Screen mit
Erklärung und dem Weg zurück:

> **Diese Reise hat keine Orte**
> Momente bekommen ihren Ort beim Einsenden — nur, wenn die Ortungsdienste
> erlaubt sind. Für diese Reise war das nie der Fall.
> [Zurück zur Übersicht]

### 5.10 Die Karte im geteilten Recap (K13–K15)

Der geteilte Player (Phase 6) bekommt denselben Einstieg wie die App: eine
Segment-Zeile «Ansehen · Auf der Karte». Die Karte selbst ist dieselbe Fläche,
dieselben Thumbnail-Nadeln, dieselbe Linie, dasselbe Moment-Sheet — nur der
Knopf im Sheet heisst «Ab hier ansehen» und springt in den geteilten Player
statt in den Recap-Player der App.

Zwei Unterschiede, die aus der Umgebung kommen und nicht aus der Gestaltung:

- **Im Browser trägt Leaflet die Karte**, nicht Apple Maps. Die Kacheln kommen
  von OpenStreetMap und deren Lizenz verlangt eine sichtbare Namensnennung —
  sie steht unten rechts auf der Karte und ist nicht wegzulassen (K14).
- **Kein Tagesfilter.** Der geteilte Recap kennt keine Tagesgruppierung; die
  Karte dort zeigt immer die ganze Reise.

Der Widerruf eines Links entzieht auch die Orte (K15): die Koordinaten kommen
ausschliesslich aus `share-link/aufloesen`, und die Function weist einen
widerrufenen, abgelaufenen oder unbekannten Token schon heute mit derselben
byte-gleichen Antwort ab. Es gibt keinen zweiten Weg, auf dem sie
herausfinden.

---

## 6. Datenweg

`recapApi.fetchRecapMomente` liest heute alles ausser `lat`/`lng`. Diese beiden
Spalten kommen in `SPALTEN` dazu, `RecapMoment` bekommt zwei Felder. Damit
haben Übersicht, Player und Karte dieselbe Liste — es gibt keine zweite Abfrage
und keinen zweiten Sortierweg.

**Achtung, dokumentierte Falle:** `SPALTEN` enthält
`profiles!posts_author_id_fkey(display_name)`. Der Fremdschlüsselname ist
zwingend — zwischen `posts` und `profiles` gibt es zwei Wege, und PostgREST
verweigert eine mehrdeutige Einbettung mit HTTP 300, ohne irgendwelche Daten zu
liefern. Der Kommentar dazu steht in `recapApi.ts` und bleibt stehen.

Für den geteilten Recap ist der Weg ein anderer und läuft über die Edge
Function: `share-link/store.ts` holt die Momente-Seiten und muss `lat`/`lng`
mit auswählen, `aufloesung.ts` reicht sie in `OeffentlicherMoment` durch. Beide
Typen sind dort ausdrücklich als Vertrag beschrieben — wer eine Spalte
hinzufügt, fasst beide an, sonst fällt sie stillschweigend heraus.

Die Thumbnails kommen aus dem bestehenden `urlVorrat` (`holeVorrat(tripId)`),
genau wie in der Übersicht — inklusive der Erneuerung kurz vor Ablauf.

---

## 7. Testing

**Rein und ohne Karte testbar** (Jest), und genau dorthin gehört die Logik:

- `kartenPunkte.ts`: aus `RecapMoment[]` die Punkte mit Koordinaten ziehen, die
  ohne zählen, den Index in der Spielliste mitführen
- `gruppierung.ts`: Gruppieren nach Bildschirmabstand bei gegebenem Zoom;
  Randfälle: zwei identische Koordinaten, ein einzelner Punkt, leere Liste
- `ausschnitt.ts`: aus n Punkten die Region berechnen, die alle zeigt (K2);
  Randfälle: ein Punkt (fester Radius statt Division durch null), Punkte
  beiderseits des 180. Längengrads
- Tagesfilter: Momente eines Tages, Linie nur über diese

**Am laufenden System** (Simulator, Expo Go — R1 macht das möglich):

- Lissabon-Recap öffnen, Karte, alle Nadeln sichtbar
- Nadel antippen, Sheet, «Im Recap ansehen», Player startet beim richtigen Moment
- Tagesfilter auf Tag 2, Linie und Nadeln dünnen aus
- Momente ohne Ort: Zahl stimmt mit der Datenbank überein
- Norwegen (laufend, versiegelt): keine Karten-Pille in der Übersicht

Der Seed braucht dafür Momente **ohne** Ort — heute haben alle welche. Ein
kleiner Zusatz in `supabase/seed.sql` (drei Momente mit `lat`/`lng`/`place_name`
auf `null`) macht K6 und K9 überhaupt prüfbar.

---

## 8. Bewusst nicht in Phase 7

- **Heatmap oder Dichte-Darstellung** — beantwortet «wo wart ihr viel», nicht
  «wo war dieser Moment». Das ist eine andere Frage.
- **Karte über mehrere Reisen** («überall, wo ich je war») — reizvoll, aber ein
  eigenes Feature mit eigener Datenfrage.
- **Ort nachträglich setzen oder korrigieren** — sinnvoll, aber ein Schreibweg
  auf einen aufgedeckten Moment; das braucht eine eigene Runde über die
  Versiegelungsregeln.
- **Offline-Kacheln** — die Karte ist ein Nachhinein-Werkzeug, sie darf Netz
  voraussetzen.
- **Kartenkacheln aus eigener Quelle.** Die Web-Karte nutzt die öffentlichen
  OpenStreetMap-Kacheln. Deren Nutzungsrichtlinie ist für eine App dieser
  Grösse in Ordnung, aber sie ist kein Dauerzustand für eine Reichweite, die
  über den Freundeskreis hinausgeht — spätestens dann braucht es einen
  eigenen Kachel-Anbieter.
