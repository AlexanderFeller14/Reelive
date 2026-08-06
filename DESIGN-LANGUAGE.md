# Reelive — Design Language v2

**Diese Datei ist verbindlich.** Jede AI-Session und jeder Mensch, der Frontend-Code oder
Mockups für Reelive erstellt, liest sie vorher und hält sich strikt daran. Bei Konflikt
gilt: diese Datei > persönlicher Geschmack > Framework-Defaults.

**Ausführliches Konzept mit Begründungen:**
`docs/superpowers/specs/2026-08-06-design-language-v2-airbnb-design.md`
**Hinweis:** `docs/design/referenz-mockup.png` zeigt noch v1 (dunkel) — für die
Medien-Screens weiterhin Referenz, für alle anderen Screens überholt.

## Leitidee

**«Helles Reisejournal, dunkles Kino.»** Im Alltag ist Reelive hell, luftig und
freundlich wie Airbnb: viel Weiss, weiche Schatten, grosse Headlines, grosszügige
Abstände. Die Medien-Screens — Kamera, Aufnahme-Preview, Versiegeln, Recap-Player —
sind ein dunkler Kinosaal, in dem die Fotos das Licht tragen. Der Wechsel wird
inszeniert («das Licht geht aus»), nicht versteckt. Die Filmrollen-Mechanik zeigt sich
leise (Siegel, Filmstreifen, Gold-Funke ✦), nie als Retro-Kostüm.

## 1. Farben

**Die App ist light-only.** Kein Dark Mode, keine System-Theme-Folge. Einzige Ausnahme:
die Medien-Screens nutzen die feste Kino-Palette. Es wird IMMER über Tokens gestylt,
nie mit festen Hex-Werten im Code.

**Licht (Standard):**

| Token | Wert | Verwendung |
|---|---|---|
| `bg-0` | `#FFFFFF` | App-Hintergrund |
| `bg-1` | `#F7F7F7` | Chips, Skeletons, abgesetzte Flächen |
| `line` | `#EBEBEB` | Hairlines, Divider (1 px, nie dicker) |
| `line-strong` | `#B0B0B0` | Input-Rahmen, Grabber |
| `text-1` | `#222222` | Primärtext, Zähler |
| `text-2` | `#6A6A6A` | Sekundärtext, Labels |
| `text-3` | `#B0B0B0` | Platzhalter, deaktiviert |
| `accent` | `#FF385C` | DER Akzent (Rausch): Primär-Buttons, aktive Tabs |
| `accent-pressed` | `#E31C5F` | Pressed-State |
| `accent-text` | `#C4103C` | Akzent als kleiner Text/Link (Kontrast ≥ 4.5:1) |
| `seal` | `#B8752F` | NUR Versiegelungs-Symbolik auf hellem Grund |
| `danger` | `#C13515` | Nur Fehler und destruktive Aktionen |

**Kino (Medien-Screens, fix):** `cinema-0` `#131110` · `cinema-1` `#1C1917` ·
Text `#F2EEE8` / `#A79F96` · `seal-glow` `#E8A13C` (Gold darf hier glühen).

Regeln:
- `accent` = Interaktion, `seal` = Versiegelungs-Symbolik. Nie mischen.
- Kein Blau, Violett, Türkis; kein Grün als Erfolgsfarbe.
- Auf Fotos liegt UI ausschliesslich als translucente Pille: `rgba(19,17,16,0.55)` + Blur 10.
- Foto-Scrims (oben/unten `rgba(0,0,0,0.35) → transparent`) sind der EINZIGE erlaubte
  Gradient der App.

## 2. Typografie

**Eine Familie: Figtree** (variable, Google Fonts) — sonst nichts. Der Reelive-Wortzug
ist ein eigenes Asset (SVG), nie als Text gesetzt.

| Rolle | Grösse/Weight | Details |
|---|---|---|
| Zähler-Display | 84 px / 300 | Signature der App. `tabular-nums`, letter-spacing −2 % |
| H1 | 30 px / 700 | Screen-Titel — gross und selbstbewusst |
| H2 | 22 px / 600 | Sektionstitel |
| H3 | 18 px / 600 | Karten-Header, Dialog-Titel |
| Body | 16 px / 400 | line-height 1.5 |
| Body-Medium | 16 px / 500 | Kartentitel, Button-Labels |
| Sekundär | 14 px / 400 | `text-2` |
| Caption | 12 px / 500 | letter-spacing 0.02 em |
| Tab-Label | 11 px / 500 | |

Regeln: keine weiteren Grössen erfinden. Sentence case, NIE Versalien-Schreien. Zahlen
immer `tabular-nums`. Headlines dürfen zweizeilig umbrechen.

## 3. Form, Raum & Elevation

- **Radius, genau drei Werte:** 12 (Buttons, Inputs, Thumbnails), 24 (Cover-Bilder,
  Sheets), 999 (Pills, Avatare, Shutter, FAB). Nichts dazwischen.
- **Abstände nur aus dem 4er-Raster:** 4 · 8 · 12 · 16 · 24 · 32 · 48. **Screen-Ränder 24 px.**
- **Schatten nur aus dieser Skala** (immer neutral-schwarz, nie farbig):
  - `shadow-1` `0 1 2 rgba(0,0,0,0.08)` + `0 4 12 rgba(0,0,0,0.05)` — ruhende Karten mit Chrome
  - `shadow-2` `0 6 16 rgba(0,0,0,0.12)` — Schwebendes (FAB, Sticky-CTA)
  - `shadow-3` `0 8 28 rgba(0,0,0,0.28)` — Sheets, Modals
- Flächentrennung primär über Weissraum und Hairlines. Ein Schatten heisst «schwebt» —
  nie Dekoration. Randlose Reise-Karten haben KEINEN Schatten.
- **Fotos randlos** in Medien-Screens; im hellen UI Radius 24 (Cover) / 12 (Thumbnails).

## 4. Komponenten

Maximal 2–3 Komponentenarten pro Screen. Bestand:

- **Button primär:** `accent`, Text `#FFFFFF`, Radius 12, Höhe 52. Press: Scale 0.97 +
  `accent-pressed`. Genau EINER pro Screen.
- **Button sekundär (Outline):** `bg-0`, 1 px Rand `#222222`, Text `text-1`, Radius 12.
- **Text-Link:** `text-1` unterstrichen; `accent-text` nur für hervorgehobene Aktionen.
- **Reise-Karte (randlos):** Cover 3:2 Radius 24, darunter ohne Rahmen: Titel
  Body-Medium, Zeitraum Sekundär, Avatare (−8 px Overlap) + Momente-Chip. Versiegelt-
  Badge als Pille auf dem Cover (Icon in `seal-glow`).
- **Input:** Höhe 56, Radius 12, Rand 1 px `line-strong`, Floating Label. Fokus: Rand
  2 px `#222222` (nicht Akzent). Fehler: Rand + Text `danger`.
- **Tab-Bar:** volle Breite, `bg-0`, Hairline oben, keine Rundung. Aktiv `accent`,
  inaktiv `text-2`. Tabs: **Aufnehmen · Reise · Recap · Profil**.
- **Sheet:** von unten, Radius 24 oben, Grabber, `shadow-3`, öffnet per `spring-ui`.
- **FAB «Neue Reise»:** `accent`, 56 px, Radius 999, `shadow-2`, unten rechts.
- **Pill-Control (auf Fotos):** translucent + Blur, Radius 999.
- **Avatare:** rund, 32–44 px, 2 px weisser Ring, Gruppen −8 px überlappend.
- **Skeleton:** `bg-1`-Blöcke, Opacity-Puls 0.6 ↔ 1.0 (kein Gradient-Shimmer).

**Icons:** Lucide, Outline, Stroke 1.75, runde Kappen. NIE gefüllt, NIE Emoji als UI-Icon.

## 5. Motion

Nur `transform` und `opacity` animieren (Reanimated, UI-Thread). Tokens:

- `duration-fast` 150 ms · `duration-base` 250 ms · `duration-gentle` 400 ms ·
  `duration-feature` 700–900 ms (NUR Inszenierungen)
- `ease-smooth` `cubic-bezier(0.22, 1, 0.36, 1)` — Standard für alles Zeitbasierte
- `spring-ui` damping 18 · stiffness 180 · mass 1 — für Interaktives (Press, Sheets)
- `linear` ist verboten (Ausnahme: Fortschritt, der reale Zeit abbildet)

Micro-Interactions: Press = Scale 0.97 per Spring (nie Opacity-Dimmen) · Zähler =
Digit-Roll · Listen = Stagger 40 ms · Tab-Icon-Pop 1 → 1.15 → 1.
Übergänge: Stack = Parallax-Slide 400 ms · Sheets = Spring · hell → Kino =
Fade durch Dunkel 350 ms («Licht geht aus») · Reise-Karte → Trip = Shared-Element 450 ms.

**Zwei inszenierte Ausnahmen** (700–900 ms, `seal-glow` erlaubt):
1. **Versiegeln:** Moment schrumpft in die Filmrolle, Siegel schliesst mit Gold-Glow,
   Zähler rollt hoch. Haptik: success.
2. **Reveal:** Siegel bricht auf, Gold-Funken ✦ steigen (kein Konfetti).

Haptik: selection (Tabs, Zoom) · light (Auslöser, Zähler) · success (Versiegeln,
Reveal) · warning (destruktiver Dialog). Sparsam — nie beim Scrollen.
`prefers-reduced-motion`: alles wird zu 200-ms-Fades.

## 6. Sprache (Copy)

Deutsch, Du-Form, warm und kurz. «Bis zum Recap versiegelt.», «Deine Filmrolle wartet
auf dich.»

**Vokabular — immer dieselben Wörter:**

| Begriff | Nie |
|---|---|
| Moment | Post, Beitrag, Snap, Story |
| Reise | Trip, Projekt, Fahrt |
| Filmrolle | Galerie, Feed |
| versiegelt | gesperrt, hidden |
| Recap | Rückblick, Zusammenfassung |
| einsenden | posten, hochladen, teilen |

Buttons sagen, was passiert («Einsenden», «Reise abschliessen»). Fehler erklären
Ursache und Lösung, ohne Entschuldigung. Leere Screens laden zum Handeln ein.

## 7. Verbote (Anti-AI-Look)

- ❌ Gradients auf Flächen, Buttons oder Text (einzige Ausnahme: Foto-Scrims, §1)
- ❌ Blau, Violett, Türkis; Grün als Erfolgsfarbe
- ❌ Andere Fonts als Figtree
- ❌ Radius-Werte ausser 12 / 24 / 999
- ❌ Schatten ausserhalb der 3-Stufen-Skala, farbige Schatten, Schatten als Deko
- ❌ Emoji als Icons, gefüllte Icons, Icons als Deko
- ❌ Mehr als ein Primär-Button pro Screen
- ❌ Vier gleiche KPI-Karten nebeneinander, Zahlen-Grids ohne Hierarchie
- ❌ Zentrierte Textwüsten; Text ist linksbündig, nur inszenierte Momente zentrieren
- ❌ `linear` als Easing, Opacity-Dimmen als Press-Feedback

## 8. So nutzt du diese Datei mit AI

**Claude Code:** liest diese Datei automatisch (siehe CLAUDE.md) — bei Frontend-Aufgaben
gelten die Regeln ohne weiteres Zutun.

**ChatGPT/andere Tools (z.B. für Mockups)** — diesen Block an den Prompt anhängen:

> Halte dich strikt an folgenden Styleguide: Helles, luftiges UI wie Airbnb —
> Hintergrund #FFFFFF, abgesetzte Flächen #F7F7F7, Hairlines #EBEBEB, Text
> #222222/#6A6A6A. EIN Akzent #FF385C (Rausch-Pink-Rot) für Primär-Buttons und aktive
> Tabs; #B8752F (Gold) nur für Siegel-/Filmstreifen-Symbolik. Sekundär-Buttons als
> Outline (1px #222222 auf Weiss), Links schwarz unterstrichen. Weiche neutrale
> Schatten nur für Schwebendes (FAB, Sheets). Kamera-, Preview- und Recap-Player-
> Screens sind IMMER dunkel (#131110, Gold-Glow #E8A13C für das Siegel). Font: Figtree,
> grosse Zähler in Weight 300, Headlines 700. Radius nur 12/24/999, Screen-Ränder 24px.
> Keine Gradients (ausser dunkle Scrims auf Fotos), kein Blau/Violett/Türkis. Icons:
> Lucide Outline. Fotos randlos bzw. mit Radius 24, UI darauf nur als translucente
> dunkle Pillen. Deutsch, Du-Form, Vokabular: Moment, Reise, Filmrolle, versiegelt,
> Recap, einsenden.

## 9. Review-Checkliste (vor jedem Merge mit UI-Änderungen)

- [ ] Farben gezählt: nur Tokens aus §1? Kein Blau/Violett/Grün eingeschlichen?
- [ ] Medien-Screens in Kino-Palette, alle anderen hell? Kinosaal-Fade beim Übergang?
- [ ] Nirgends feste Hex-Werte im Code — alles über Tokens?
- [ ] Alle Radius-Werte ∈ {12, 24, 999}? Screen-Ränder 24?
- [ ] Schatten nur aus der 3-Stufen-Skala und nur für Schwebendes?
- [ ] Genau ein Primär-Button pro Screen?
- [ ] Press-Feedback als Scale per Spring, Zähler mit Digit-Roll, `tabular-nums`?
- [ ] `prefers-reduced-motion` respektiert?
- [ ] Copy: Vokabular-Tabelle eingehalten, Du-Form, sentence case?
