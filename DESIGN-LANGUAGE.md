# Reelive — Design Language

**Diese Datei ist verbindlich.** Jede AI-Session und jeder Mensch, der Frontend-Code oder
Mockups für Reelive erstellt, liest sie vorher und hält sich strikt daran. Bei Konflikt
gilt: diese Datei > persönlicher Geschmack > Framework-Defaults.

**Referenz:** `docs/design/referenz-mockup.png` — vier Screens (Kamera, Preview,
Versiegelt-Bestätigung, Trip-Home). Richtung verbindlich, Details nicht final.

## Leitidee

Warmes, dunkles Kino für Erinnerungen. Die **Fotos und Videos sind die Farbe** der App —
das UI ist eine ruhige, fast schwarze Bühne mit einem einzigen warmen Akzent. Die
Filmrollen-Mechanik zeigt sich leise (Filmstreifen-Icon, Schloss, Wortwahl), nie als
Retro-Kostüm. Emotionale Momente (Versiegeln, Reveal) dürfen glühen — alles andere ist
diszipliniert.

## 1. Farben

Dunkles Theme only in V1. Kein pures Schwarz, kein pures Weiss — alle Neutralen sind warm.

| Token | Hex | Verwendung |
|---|---|---|
| `bg-0` | `#131110` | App-Hintergrund |
| `bg-1` | `#1C1917` | Karten, Sheets, Tab-Bar |
| `bg-2` | `#26221F` | Angehobene Flächen: Pills, sekundäre Buttons, Inputs |
| `line` | `#2E2A26` | Hairlines, Divider (1 px, nie dicker) |
| `text-1` | `#F2EEE8` | Primärtext, grosse Zahlen |
| `text-2` | `#A79F96` | Sekundärtext, Labels |
| `text-3` | `#6E675F` | Deaktiviert, Platzhalter |
| `accent` | `#ED5B3D` | DER Akzent (Koralle-Ember): Primär-Buttons, aktive Tabs, Links |
| `glow` | `#E0913F` | NUR für Versiegelungs-Ikonografie (Schloss, Filmstreifen, Funke ✦) |
| `danger` | `#E5484D` | Nur destruktive Aktionen und Fehler |

Regeln:
- `accent` und `glow` nie mischen: Buttons/Interaktion = `accent`, Versiegelungs-Symbolik = `glow`.
- Auf Fotos liegt UI ausschliesslich als translucente Pille: `rgba(19,17,16,0.55)` + Blur 10.
- Fotos bekommen Scrims (oben/unten `rgba(0,0,0,0.35) → transparent`), damit Text lesbar ist —
  das ist der EINZIGE erlaubte Gradient in der App.

## 2. Typografie

**Eine Familie: Manrope** (variable, Google Fonts) — sonst nichts. Der Reelive-Wortzug ist
ein eigenes Asset (SVG), nie als Text gesetzt.

| Rolle | Grösse/Weight | Details |
|---|---|---|
| Zähler-Display | 88 px / 200 | Die Signature der App: riesige, federleichte Ziffern. `tabular-nums` |
| H1 (Trip-Titel) | 28 px / 600 | |
| H2 (Sektionstitel) | 22 px / 600 | |
| Body | 16 px / 400 | line-height 1.45 |
| Sekundär | 14 px / 400 | `text-2` |
| Label/Caption | 12 px / 500 | letter-spacing 0.02 em |
| Tab-Label | 11 px / 500 | |

Regeln: keine weiteren Grössen erfinden. Sentence case («Momente eingefangen»), NIE
Versalien-Schreien. Zahlen immer `tabular-nums`.

## 3. Form & Raum

- **Radius, genau drei Werte:** 12 (Buttons, Inputs), 24 (Karten, Sheets, Tab-Bar),
  999 (Pills, Avatare, Shutter). Nichts dazwischen.
- **Abstände nur aus dem 4er-Raster:** 4 · 8 · 12 · 16 · 24 · 32 · 48. Screen-Ränder 20 px.
- **Schatten: keine.** Dunkles UI trennt über Flächenhelligkeit (`bg-0 → bg-1 → bg-2`),
  nicht über Schatten. Einzige Ausnahme: weicher `glow`-Schein hinter
  Versiegelungs-Icons (Blur 24, Opacity ≤ 25 %).
- **Fotos immer randlos** (edge-to-edge), nie in Rahmen oder mit Rand — Ausnahme:
  Thumbnails in Karten (Radius 12).

## 4. Komponenten

Maximal 2–3 Komponentenarten pro Screen. Bestand:

- **Button primär:** `accent`-Fläche, Text `#FFF6F2`, Radius 12, Höhe 52. Genau EINER pro Screen.
- **Button sekundär:** `bg-2`-Fläche, Text `text-1`, Radius 12. («Verwerfen» neben «Einsenden»)
- **Text-Button:** nur Text in `accent`, kein Rahmen.
- **Karte:** `bg-1`, Radius 24, Padding 16–24, kein Rand, kein Schatten.
- **Pill-Control** (auf Fotos): translucent + Blur, Radius 999. (Zoom «0,5 · 1x · 2», Trip-Label)
- **Tab-Bar:** `bg-1`, Radius 24, frei schwebend mit 20 px Rand. Aktiver Tab: Icon + Label
  in `accent`; inaktiv `text-2`. Tabs: **Aufnehmen · Reise · Recap · Profil**.
- **Avatare:** rund, 32–44 px, in Gruppen um −8 px überlappend.

**Icons:** Lucide, Outline, Strokes 1.75, runde Kappen. NIE gefüllte Icons, NIE Emoji als
UI-Icon. (Emoji existieren nur als Inhalt: Reaktionen, Captions.)

## 5. Motion

- Standard: 150–250 ms, ease-out. Zurückhaltend — die App fühlt sich ruhig an.
- **Zwei inszenierte Ausnahmen** (dürfen 600–900 ms und `glow` benutzen):
  1. **Versiegeln:** Moment schrumpft in die Filmrolle, Zähler tickt hoch.
  2. **Reveal/Recap-Start:** Siegel bricht auf.
- `prefers-reduced-motion` wird respektiert: Inszenierungen werden zu einfachen Fades.

## 6. Sprache (Copy)

Deutsch, Du-Form, warm und kurz. Sätze wie im Mockup: «Bis zum Recap versiegelt.»,
«Deine Filmrolle wartet auf dich.»

**Vokabular — immer dieselben Wörter:**

| Begriff | Nie |
|---|---|
| Moment | Post, Beitrag, Snap, Story |
| Reise | Trip, Projekt, Fahrt |
| Filmrolle | Galerie, Feed |
| versiegelt | gesperrt, hidden |
| Recap | Rückblick, Zusammenfassung |
| einsenden | posten, hochladen, teilen |

Buttons sagen, was passiert («Einsenden», «Reise abschliessen»). Fehler erklären Ursache
und Lösung, ohne Entschuldigung. Leere Screens laden zum Handeln ein («Erstelle deine
erste Reise oder tritt per Link bei.»).

## 7. Verbote (Anti-AI-Look)

- ❌ Gradients auf Flächen, Buttons oder Text (einzige Ausnahme: Foto-Scrims, §1)
- ❌ Pures `#000` oder `#FFF`
- ❌ Violett, Blau, Türkis — es gibt genau `accent` + `glow`
- ❌ Schatten auf Karten, Glassmorphism ausserhalb der Foto-Pills
- ❌ Andere Fonts als Manrope; Inter/Space Grotesk/Serifen sind tabu
- ❌ Radius-Werte ausser 12 / 24 / 999
- ❌ Emoji als Icons, Icons als Deko
- ❌ Vier gleiche KPI-Karten nebeneinander, Zahlen-Grids ohne Hierarchie
- ❌ Zentrierte Textwüsten; Text ist linksbündig, nur inszenierte Momente zentrieren

## 8. So nutzt du diese Datei mit AI

**Claude Code:** liest diese Datei automatisch (siehe CLAUDE.md) — bei Frontend-Aufgaben
gelten die Regeln ohne weiteres Zutun.

**ChatGPT/andere Tools (z.B. für Mockups)** — diesen Block an den Prompt anhängen:

> Halte dich strikt an folgenden Styleguide: Dunkles warmes UI (#131110 Hintergrund,
> #1C1917 Karten), Textfarben #F2EEE8/#A79F96, EIN Akzent #ED5B3D (Koralle) für Buttons
> und aktive Zustände, #E0913F nur für Schloss-/Filmstreifen-Icons. Font: Manrope,
> grosse Zähler in Weight 200. Radius nur 12/24/999. Keine Schatten, keine Gradients
> (ausser dunkle Scrims auf Fotos), keine anderen Farben. Icons: Lucide Outline.
> Fotos immer randlos, UI darauf nur als translucente dunkle Pillen. Deutsch, Du-Form,
> Vokabular: Moment, Reise, Filmrolle, versiegelt, Recap, einsenden.

## 9. Review-Checkliste (vor jedem Merge mit UI-Änderungen)

- [ ] Farben gezählt: nur Tokens aus §1? Kein neues Blau/Violett eingeschlichen?
- [ ] Alle Radius-Werte ∈ {12, 24, 999}?
- [ ] Alle Abstände auf dem 4er-Raster, Screen-Rand 20?
- [ ] Genau ein Primär-Button pro Screen?
- [ ] Keine neuen Schatten/Gradients?
- [ ] Copy: Vokabular-Tabelle eingehalten, Du-Form, sentence case?
- [ ] Grosse Zahlen in Weight 200 + `tabular-nums`?
