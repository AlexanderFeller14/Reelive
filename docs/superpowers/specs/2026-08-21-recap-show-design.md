# Reelive: Der Recap als Show

**Status:** freigegeben (Brainstorming-Session 2026-08-21)
**Betrifft:** Recap-Tab (Liste), Recap-Übersicht, Recap-Player
**Verbindlich darüber:** `DESIGN-LANGUAGE.md` (bei Konflikt gilt sie)

Dieses Dokument beschreibt, was gebaut wird und warum. Die Reihenfolge der Umsetzung
steht im zugehörigen Implementierungsplan.

---

## 1. Ausgangslage

Der Recap-Tab listet abgeschlossene Reisen als Karten. Ein Tap führt auf die Übersicht,
dort steht ein Wachssiegel, das man aufzieht, danach erscheint ein Popcorn-Bild mit
Spruch und darunter die Momente in einem Dreier-Raster, nach Tagen gruppiert. Ein Tap
auf eine Kachel startet den Vollbild-Player ab diesem Moment.

Drei Dinge stimmen daran nicht:

1. **Der Einstieg auf der Karte** ist ein heller Pill oben links auf dem Cover. Er sieht
   aus wie ein Statusabzeichen, nicht wie ein Abspiel-Versprechen.
2. **Der Weg zur Show ist verstellt.** Wer einen Recap ansehen will, landet zuerst in
   einer Galerie und muss sich selbst einen Einstiegspunkt suchen. Die Show, das
   eigentliche Produkt, ist damit ein Nebenweg.
3. **Die Übersicht sieht nach Beta aus.** Ein Titel, ein Popcorn-Bild und ein
   gleichförmiges Raster: kein Bild trägt die Reise, kein Tag hat ein Gesicht.

Alle Recap-Karten und Übersichten zeigen ausserdem eingebaute Platzhalter-Bilder
(`placeholderCover`), keine Fotos der Reise. Jeder Recap sieht damit aus wie jeder andere.

## 2. Entscheide (User, nicht neu verhandeln)

- **Der Karten-Tap startet die Show**, nicht die Galerie.
- **Das Siegel wird die erste Vollbild-Karte der Show**, im dunklen Kino. Es steht bei
  jedem Öffnen von aussen neu, es wird nicht als "schon gesehen" gemerkt.
- **Der Einstieg auf der Karte** ist eine translucente Pille mit Play-Icon unten links
  auf einem Foto-Scrim (Variante B des Mockups).
- **Die Übersicht bekommt einen Foto-Hero und ein Mosaik pro Tag** (Variante B des
  Mockups).
- **Recap-Karte und Hero zeigen ein echtes Foto der Reise**, Platzhalter nur als Fallback.
- **Die Show endet automatisch**: die End-Karte steht kurz, dann Fade in die Übersicht.

## 3. Der Flow

```
Recap-Tab
  │  Tap auf Karte (kein start-Index)
  ▼
Player im Show-Modus
  │  Kino-Fade, Siegel als erste Vollbild-Karte
  │  Aufziehen
  ▼
Tag-1-Zwischenkarte, Moment, Moment, Tag-2-Zwischenkarte, …
  │  Ende erreicht: End-Karte, ca. 2 s
  ▼  (router.replace)
Recap-Übersicht  ──  Kachel-Tap ──▶ Player ab diesem Moment (ohne Siegel)
                 ◀── zurück ─────
```

Abbruch der Show (X oder Swipe nach unten) führt ebenfalls auf die Übersicht, per
`replace`. Damit gilt in beiden Fällen: der Zurück-Weg aus der Übersicht führt in den
Tab, nie zurück in einen bereits gelaufenen Player.

**Das Siegel gehört zum Betreten von aussen.** Es steht genau dann, wenn der Player ohne
`start`-Parameter geöffnet wird, also beim Tap auf die Recap-Karte. Innerhalb der
Übersicht laufen "Nochmal ansehen" und Kachel-Taps ohne Siegel: Wer bereits in der
Übersicht steht, hat den Recap offensichtlich schon geöffnet.

Die bestehende Session-Logik der Übersicht (`unsealed`/`unsealedRef`) entfällt damit
ersatzlos.

## 4. Die Recap-Karte im Tab

`TripCard` mit `asRecap` bekommt statt des hellen Pills oben links:

- einen **Foto-Scrim** unten auf dem Cover (`rgba(0,0,0,0.35)` nach transparent, der
  einzige erlaubte Gradient, DESIGN-LANGUAGE §1),
- darauf unten links eine **translucente Pille**: `rgba(19,17,16,0.55)` + Blur 10,
  Radius 999, Play-Icon (Lucide, Stroke 1.75) und "Recap ansehen" in Weiss.

Das Cover selbst zeigt das echte Reise-Foto (§6), sonst den Platzhalter wie bisher.

Der Tap auf die Karte führt neu auf `/recap/[id]/player` **ohne** `start`-Parameter.

Unberührt bleibt: das versiegelte Wachssiegel auf aktiven Reisen (`sealed`), die
Verwendung von `TripCard` ohne `asRecap` im Reise-Tab, Titel, Zeitraum, Avatare und
Momente-Zahl unter dem Cover.

## 5. Der Player

### 5.1 Show-Modus

Neu unterscheidet der Player zwei Betriebsarten, abgeleitet allein aus der Route:

| | `start` fehlt | `start` gesetzt |
|---|---|---|
| Modus | Show | Sprung |
| Siegel davor | ja | nein |
| Startindex | 0 | `start` |
| Ende und Abbruch | `replace` auf die Übersicht | `back` auf die Übersicht |

Die Ableitung ist eine reine Funktion in `features/recap` und wird dort getestet, nicht
im Screen verstreut.

**Achtung, `start=0` ist ein gültiger Sprung.** Die Übersichts-Pille "Nochmal ansehen"
und ein Tap auf die erste Kachel setzen beide `start=0`. Die Unterscheidung muss deshalb
auf "Parameter fehlt" prüfen, nie auf Wahrheitswert: ein `Number(start) || 0` würde die
Null als fehlend lesen und dem Wiederholen aus der Übersicht ein Siegel vorsetzen.

### 5.2 Das Siegel als erste Karte

Vor dem ersten Moment steht die bestehende `SealPeel`-Komponente formatfüllend auf
`cinema-0`, darunter der Hinweis "Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu
öffnen." in `cinema` `text-2`. Gold (`seal-glow`) darf hier glühen, der Reveal ist eine
der zwei inszenierten Ausnahmen (DESIGN-LANGUAGE §5).

Während das Siegel steht:

- läuft **kein** Fortschrittsbalken und **kein** Auto-Advance-Timer,
- lädt der Player im Hintergrund bereits Momente, URL-Pool und die ersten Vorschaubilder,
- greifen die Tap-Zonen der Story-Navigation nicht (nur das Siegel nimmt Berührungen an).

Ist der Ladevorgang beim Aufziehen noch nicht fertig, folgt der bestehende
Lade-Zustand des Players; das Siegel wartet nicht darauf.

Führt das Laden zu einem Fehler (kein Zugriff, noch versiegelt, Netz weg), zeigt der
Player seinen bestehenden Fehler-Zustand, das Siegel wird übersprungen. Ein Siegel,
hinter dem nichts steht, wäre ein gebrochenes Versprechen.

### 5.3 Zwischenkarten

Aus der einzeiligen Karte "Tag 3 · Lissabon · 12. August" wird eine Staffelung im selben
Duktus wie die neuen Tagesköpfe der Übersicht:

- "Tag 3" gross (H1, `cinema` `text-1`),
- darunter "Lissabon · 12. August" (Sekundär, `cinema` `text-2`); ohne Ort nur das Datum.

Dauer bleibt bei 1,5 Sekunden, der Tap zum Überspringen bleibt.

### 5.4 Das Ende

Die End-Karte "Das war der Recap." bleibt inhaltlich wie sie ist (inklusive der Hinweise
zu Nachzüglern und übersprungenen Momenten), verliert aber den Button: Nach 2000 ms fährt
der Player selbst auf die Übersicht (`replace`). Ein Tap auf die Karte geht sofort
dorthin, wer nicht warten will, wartet nicht.

Bei `prefers-reduced-motion` gilt dieselbe Wartezeit; sie ist eine Lesezeit, keine
Animation.

Im Sprung-Modus (Kachel-Tap aus der Übersicht) bleibt es beim heutigen Verhalten mit
Button, dort ist die Übersicht der Ort, von dem man kam.

### 5.5 Unberührt

Gesten, Fortschrittsbalken, Tap-Zonen, Halten, Kommentare, Reaktionen, Melden, Sichern,
URL-Pool-Erneuerung, Video-Wiedergabe: alles bleibt wie es ist.

## 6. Das echte Cover

Recap-Karte und Übersichts-Hero zeigen den **frühesten hochgeladenen Moment der Reise,
der ein Thumbnail hat** (Foto oder Video-Standbild, beide bekommen beim Einsenden eines).
Fehlt eines oder scheitert der Aufruf, steht der bisherige Platzhalter.

**Übersicht:** braucht keine neue Datenquelle. Der Screen holt den URL-Pool ohnehin; das
Cover ist der erste Eintrag der bereits sortierten, mit Thumbnail versehenen Liste.

**Tab-Liste:** braucht eine neue Action `covers` in der bestehenden Edge Function
`media-urls`:

- Eingabe `{ action: 'covers', trip_ids: string[] }`, Obergrenze 50 Einträge pro Aufruf.
- Pro Reise wird dieselbe Zugriffskette geprüft wie bei `read` (`evaluateReadAccess`:
  Reise existiert, Status `revealed` oder `archived`, aufrufende Person ist Mitglied).
  Reisen, die durchfallen, erscheinen schlicht nicht in der Antwort, ohne Fehlermeldung
  und ohne Unterscheidung des Grundes. Die Antwort darf nicht zum Orakel werden, an dem
  sich fremde Reise-IDs prüfen lassen.
- Ausgabe `{ covers: [{ trip_id, thumb_url }], valid_until }`, eine signierte URL pro
  Reise.
- Ein Fehler dieser Action darf die Liste nie blockieren: die Karten stehen dann mit
  Platzhaltern da.

Das ist eine Server-Änderung ohne Migration; die Versiegelung bleibt serverseitig
erzwungen (CLAUDE.md, Eckpfeiler).

**Kein Caching über die Sitzung hinaus.** Die Cover-URLs sind signiert und laufen ab; sie
werden pro Fokus der Liste neu geholt, wie die Reisen selbst auch.

## 7. Die Übersicht

### 7.1 Aufbau

```
┌─────────────────────────────────┐
│ Foto-Hero (3:2, Radius 24)      │
│ ‹  Scrim oben           ▶ pille │
│                                 │
│ Sommer in Lissabon              │
│ 1.–14. Aug 2026 · 42 Momente…   │
└─────────────────────────────────┘
[Nach Tagen] [Auf der Karte]   ⤓  ⤴
Tag 1
Lissabon · 1. August
┌───────────┬─────┐
│           │     │
│   gross   ├─────┤
│           │     │
└───────────┴─────┘
┌────┬────┬────┐
└────┴────┴────┘
Tag 2 …
```

**Hero:** Foto 3:2, Radius 24, Scrim oben und unten. Oben links die Zurück-Chevron als
Glaspille, oben rechts die Pille "Nochmal ansehen" mit Play-Icon. Unten links der
Titelblock in Weiss: Reisename (H2-Grösse, Weight 700), darunter sekundär
"1.–14. Aug 2026 · 42 Momente · zu dritt".

Die Momente-Zahl im Hero ist die Zahl der **angezeigten** Momente des Recaps, also aller
Mitreisenden zusammen, nicht `my_post_count` wie auf der Karte im Tab. Die Karte spricht
vom eigenen Beitrag, der Recap vom gemeinsamen Ergebnis. "zu dritt" kommt aus
`member_count`; bei einer einzelnen Person entfällt dieser dritte Teil ersatzlos.

Der Reisename darf zweizeilig umbrechen (DESIGN-LANGUAGE §2) und wird danach mit Ellipse
gekappt, damit der Titelblock den Scrim nie nach oben durchbricht.

Die Zeile darunter trägt links die bestehenden Segment-Pills (Nach Tagen / Auf der
Karte), rechts die bestehenden Icons für Sichern und Teilen. Damit verschwindet die
heutige Header-Zeile über dem Titel vollständig.

Siegel-Bühne, Popcorn-Bild und der Spruch "Dein Recap wartet…" entfallen.

### 7.2 Das Mosaik

Pro Tag: Kopf "Tag 1" (H2), darunter "Lissabon · 1. August" (Sekundär). Der Kopf ist
zweizeilig statt der heutigen Einzeile mit Mittelpunkten, damit die Tagesnummer trägt.

Das Muster der Kacheln je Tag ist eine **reine Funktion** in `features/recap` mit eigenen
Tests, damit die Randfälle nicht im Screen verstecken:

| Momente am Tag | Layout |
|---|---|
| 1 | ein Bild über die volle Breite, 3:2 |
| 2 | zwei Quadrate nebeneinander |
| 3 oder mehr | ein grosses Bild links (zwei Spalten breit, zwei Reihen hoch), zwei Quadrate rechts gestapelt, der Rest in Dreier-Reihen |

Abstände 4 px (aus dem Raster), Kacheln Radius 12 (Thumbnails, DESIGN-LANGUAGE §3).

**Video-Kacheln** bekommen unten links ein kleines translucentes Play-Badge, damit
sichtbar ist, was sich bewegt, auf der grossen Kachel wie auf den kleinen. Ein Tap auf
jede Kachel startet den Player an dieser Stelle, wie heute.

Die Reihenfolge innerhalb eines Tages bleibt die nach `captured_at` sortierte (CLAUDE.md,
Eckpfeiler): Das Mosaik ändert die Grösse der Kacheln, nie ihre Folge. Der grosse
Aufmacher ist immer der früheste Moment des Tages, nicht ein ausgewählter.

### 7.3 Skeleton und Hinweise

Der Lade-Skeleton bildet den neuen Aufbau ab: ein Hero-Block, darunter Tageskopf und
Mosaik, im bestehenden Puls (`bg-1`, Opacity 0.6 bis 1.0).

Die Hinweise zu Momenten, die noch unterwegs sind oder sich nicht laden liessen, bleiben
unverändert am Fuss der Seite. Die Fehler- und Leer-Zustände bleiben inhaltlich wie sie
sind; ohne ein einziges Bild steht statt des Heros der bestehende Platzhalter.

## 8. Sprache

Neue oder geänderte sichtbare Texte:

| Ort | Text |
|---|---|
| Recap-Karte, Pille | Recap ansehen |
| Übersicht, Hero-Pille | Nochmal ansehen |
| Übersicht, Hero-Zeile | 1.–14. Aug 2026 · 42 Momente · zu dritt |
| Player, Siegel | Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu öffnen. |

Vorlese-Beschriftungen: die Karte sagt "Recap von Sommer in Lissabon ansehen", die
Hero-Pille "Recap nochmal ansehen", Kacheln bleiben bei "Moment N öffnen". Kein
Gedankenstrich in sichtbarem Text (DESIGN-LANGUAGE §6).

## 9. Was nicht angefasst wird

Karte (`map.tsx`), Share-Flow, Export, Kommentare, Reaktionen, Melden, Reveal-Mechanik,
Auto-Reveal, Push, Datenbank-Schema. Es gibt keine Migration in dieser Arbeit.

## 10. Tests und Abnahme

**Jest deckt ab:** die Modus-Ableitung des Players (Show gegen Sprung), das Mosaik-Muster
inklusive der Randfälle 1 und 2, die Cover-Auswahl (frühester Moment mit Thumbnail,
Fallback auf Platzhalter), die neue `covers`-Action auf Server-Seite (Deno-Test, analog
zu den bestehenden), und auf Screen-Ebene das Routing: Karten-Tap ohne `start`, Siegel
steht im Show-Modus und fehlt im Sprung-Modus, Ende und Abbruch verlassen per `replace`.

**Jest deckt nicht ab und muss am Gerät oder im Simulator abgenommen werden:** wie das
Mosaik bei echten Fotos wirkt, ob der Kino-Fade zum Siegel sauber läuft, ob die 2 Sekunden
der End-Karte sich richtig anfühlen, und ob der Hero mit langen Reisenamen umbricht, ohne
den Titelblock aus dem Scrim zu schieben.
