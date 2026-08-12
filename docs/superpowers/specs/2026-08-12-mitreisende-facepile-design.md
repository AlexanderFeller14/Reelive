# Mitreisende als Facepile im Reise-Detail

**Status:** freigegeben (Brainstorming-Session 2026-08-12)
**Betrifft:** `mobile/src/components/Avatar.tsx`, `mobile/src/app/(tabs)/reise/[id]/index.tsx`,
mittelbar `mobile/src/components/TripCard.tsx`
**Referenz:** Airbnbs Unterkunfts-Detail («Hosted by Kelly», darunter drei überlappende
Avatare und ein `+5`-Kreis)

---

## 1. Ausgangslage

Der Reise-Detail-Screen trägt heute weit unten eine Sektion «Wer dabei ist»: pro Person
eine Zeile mit Avatar, Anzeigename, Rolle und, für die Owner-Person, einem X zum
Entfernen. Bei acht Mitreisenden sind das acht Zeilen zwischen dem Momente-Zähler und
den Aktionen am Screen-Ende. Wer nur wissen will, wer mitfährt, muss dorthin scrollen;
wer eine Aktion sucht, scrollt an der Liste vorbei.

Airbnb löst dasselbe Problem oben: direkt unter dem Zeitraum steht eine kompakte
Facepile, die auf Tipp die volle Liste öffnet.

## 2. Entscheide

Vier Festlegungen aus der Session, nicht neu zu verhandeln:

1. **Die Sektion «Wer dabei ist» verschwindet aus dem Screen.** Ihr Inhalt lebt im Sheet
   weiter. Dieselbe Auskunft an zwei Stellen wäre doppelte Wahrheit mit doppelter
   Pflegelast.
2. **«Freunde einladen» steht künftig an zwei Stellen**, im Sheet und weiterhin unten am
   Screen. Ohne den Screen-Knopf verlöre eine laufende Reise ihren Primär-Button.
3. **Nach dem Reveal ist das Sheet nur noch eine Auskunft.** Kein Einladen, kein
   Entfernen, auch nicht für die Owner-Person.
4. **Die Reise-Karten übernehmen dieselbe Facepile.** Eine Optik in der ganzen App.

## 3. Der Baustein: `AvatarGroup`

`Avatar.tsx` exportiert `AvatarGroup` heute mit `max = 4` und dem Rest als nacktem Text
neben den Kreisen. Der Name bleibt, umgebaut wird das Verhalten:

- **Drei sichtbare Avatare.** Sind es genau vier Personen, werden es drei plus `+1`,
  nicht vier ohne Rest. Diese Kante ist die, an der ein Off-by-one am leichtesten
  passiert, und sie bekommt einen eigenen Test.
- **Der Rest ist ein vierter Kreis**, keine Textzeile: gleiche Grösse wie ein Avatar,
  gleicher 2 px weisser Ring, Fläche `bg-1`, Beschriftung `+N` in `text-2`.
- **Alle vier Kreise überlappen mit −8 px.** DESIGN-LANGUAGE §4 («Gruppen −8 px
  überlappend») gilt für die ganze Gruppe, der Rest-Kreis ist Teil davon und wird nicht
  abgesetzt.
- **Kein eigenes Tap-Verhalten.** Die Gruppe bleibt ein Anzeige-Baustein; wer sie
  tippbar braucht, legt `PressScale` darum. So bleibt sie in der Reise-Karte brauchbar,
  wo bereits die ganze Karte ein Tap-Ziel ist und ein zweites darin liegendes Ziel die
  Karte zerteilen würde.

Reihenfolge der Gesichter: die von `fetchMembers`, also nach `joined_at`. Die
Owner-Person steht damit immer vorn, die Auswahl ist über Neuladen hinweg stabil.

## 4. Der Detail-Screen

Die Facepile steht unter Titel, Zeitraum und der «Tag X von Y»-Zeile, abgesetzt mit
`spacing.m`. Sie liegt in einem `PressScale` mit `accessibilityRole="button"` und einer
Beschriftung, die Zweck und Umfang nennt («Wer dabei ist, 8 Personen»), weil die
Kreise selbst nichts vorzulesen haben.

**Der Fehlerfall darf nicht mitverschwinden.** Lassen sich die Mitglieder nicht laden
(`mitgliederFehler`), tritt an der Stelle der Facepile die heutige Fehlerzeile in
`danger`. Ohne sie stünde dort stumm nichts, und der Screen behauptete, die Reise habe
keine Mitreisenden: die eine Richtung, in die diese Stelle nie irren darf.

Sind die Mitglieder geladen und die Liste ist trotzdem leer, wird nichts gerendert.
Praktisch tritt das nicht ein, jede Reise hat mindestens ihre Owner-Person.

## 5. Das Sheet «Wer dabei ist»

Übernimmt den Inhalt der alten Sektion unverändert: Avatar, Anzeigename, darunter «Hat
die Reise angelegt» oder `@username`.

| Wer | Was er kann |
|---|---|
| alle, jederzeit | die Namen lesen |
| Owner-Person, Reise läuft | zusätzlich pro Person ein X (nicht bei sich selbst), plus «Freunde einladen» |
| alle, nach dem Reveal | nur lesen |

- Der Entfernen-Dialog bleibt der heutige: `Alert.alert` mit warning-Haptik und dem Satz
  «Bereits eingesendete Momente bleiben in der Reise.» Nach Erfolg lädt der Screen neu,
  das Sheet bleibt offen.
- Die Liste scrollt innerhalb des Sheets, begrenzt auf `SHEET_SCROLL_ANTEIL` der
  Fensterhöhe (`Sheet.tsx`). Ohne diese Grenze schneidet der 85-%-Deckel des Panels
  einer langen Liste die letzten Zeilen ersatzlos ab.
- «Freunde einladen» schliesst das Sheet, bevor es auf `/reise/[id]/einladen` navigiert.

## 6. Genau ein Primär-Button (§7)

Das Sheet trägt mit «Freunde einladen» eine Akzentfläche. Solange es offen ist, treten
die Screen-Knöpfe auf `secondary` zurück, dieselbe Mechanik, die der Screen für das
Abschliessen-Sheet schon fährt, erweitert um eine Bedingung:

```
variant={… || bestaetigenSichtbar || mitgliederSichtbar ? 'secondary' : 'primary'}
```

Betroffen sind «Reise abschliessen» (oben, ab dem Enddatum) und «Freunde einladen»
(unten). «Recap starten» kollidiert nie: es erscheint erst nach dem Reveal, und dann hat
das Sheet keinen Knopf mehr.

## 7. Tests

**`Avatar.test.tsx`** (neu):
- zwei Personen → zwei Kreise, kein Rest-Kreis
- acht Personen → drei Avatare und `+5`
- genau vier Personen → drei Avatare und `+1`, nicht vier ohne Rest

**`reise/__tests__/detail.test.tsx`**:
- die Facepile ist da, die alte Sektion nicht mehr
- Tipp öffnet das Sheet
- Owner bei laufender Reise sieht die X-Knöpfe und «Freunde einladen»
- ein Mitglied sieht beides nicht
- nach dem Reveal sieht auch die Owner-Person beides nicht
- `mitgliederFehler` erscheint an der Stelle der Facepile

**`components/__tests__/TripCard.test.tsx`**: erwartet den Rest-Kreis statt der Textzeile.

## 8. Ausdrücklich nicht Teil davon

- **Echte Avatar-Bilder.** `profiles.avatar_key` existiert im Schema, wird aber von
  keinem Client-Pfad geschrieben oder gelesen. Die Kreise tragen weiterhin Initialen.
  Sobald es Bilder gibt, ist `Avatar` die einzige Stelle, die davon erfährt.
- **Rollenwechsel.** Wer die Reise angelegt hat, bleibt Owner-Person; das Sheet fügt
  keine Möglichkeit hinzu, das zu übertragen.
