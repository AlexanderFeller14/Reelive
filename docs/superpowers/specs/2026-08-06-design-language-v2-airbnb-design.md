# Reelive — Design Language v2: «Helles Reisejournal, dunkles Kino»

**Status:** freigegeben (Brainstorming-Session 2026-08-06)
**Ersetzt:** die visuelle Richtung der Design Language v1 (warmes, dunkles Kino überall)
**Verbindliche Kurzreferenz:** `DESIGN-LANGUAGE.md` (wird aus diesem Konzept gespeist)

Dieses Dokument ist das vollständige Design-Konzept: Es erklärt die Entscheidungen,
spezifiziert alle Foundations, Komponenten und das Motion-System und beschreibt die
Anwendung Screen für Screen. Die `DESIGN-LANGUAGE.md` bleibt die kompakte, verbindliche
Regel-Referenz für jede Session — bei Konflikt gilt die `DESIGN-LANGUAGE.md`.

---

## 1. Ausgangslage & Entscheid

Reelive v1 war durchgehend dunkel («warmes, dunkles Kino»). Entschieden wurde ein
Neuausrichten auf den Look von Airbnb: hell, luftig, freundlich, mit weichen Schatten,
grossen selbstbewussten Headlines und einem spürbar smoothen Motion-System.

Festgelegte Eckwerte (User-Entscheid, nicht neu verhandeln):

- **Airbnb-Look wird übernommen** — nicht nur die Systemtiefe, auch die visuelle Richtung.
- **Light-only** für alle Alltags-Screens. Kein Dark Mode, keine System-Theme-Folge.
- **Medien-Screens bleiben immer dunkel** (Kamera, Aufnahme-Preview, Versiegelungs-Moment,
  Recap-Player): Kinosaal-Prinzip, dort tragen die Fotos das Licht.
- **Akzent:** Rausch-Pink-Rot `#FF385C` (ersetzt Koralle `#ED5B3D`).
- **Schrift:** Figtree (ersetzt Manrope) — die freie Schrift, die Airbnbs «Cereal» am
  nächsten kommt.

## 2. Leitidee & Prinzipien

> **«Helles Reisejournal, dunkles Kino.»**

Im Alltag ist Reelive hell und luftig wie ein aufgeschlagenes Reisejournal auf einem
sonnigen Tisch. Die Medien-Momente sind ein dunkler Kinosaal. Der Wechsel dazwischen wird
nicht versteckt, sondern inszeniert («das Licht geht aus»).

Fünf Prinzipien, an denen jede Design-Entscheidung gemessen wird:

1. **Die Fotos sind die Farbe.** Das helle UI ist eine ruhige weisse Bühne; Farbe kommt
   von den Covern, Avataren und Momenten. Genau ein Akzent (`accent`), genau eine
   Symbolfarbe (`seal`).
2. **Luft ist Luxus.** Grosszügige Ränder (24 px), viel Weissraum, wenig Chrome. Eine
   Karte ist ein Bild mit Text darunter, kein Rahmen mit Schatten drumherum.
3. **Alles federt.** Interaktion läuft auf Springs, Zeitbasiertes auf ausklingenden
   Kurven. Nichts bewegt sich linear, nichts ruckt.
4. **Die Filmrolle flüstert.** Die Versiegelungs-Mechanik zeigt sich leise: Siegel,
   Filmstreifen, Gold-Funke ✦, Wortwahl. Nie als Retro-Kostüm.
5. **Zwei Momente dürfen glänzen.** Versiegeln und Reveal sind die einzigen inszenierten
   Animationen (700–900 ms, Gold). Alles andere ist diszipliniert schnell.

## 3. Foundations

### 3.1 Farben

Gestylt wird IMMER über Tokens, nie mit festen Hex-Werten im Code.

**Licht-Palette (Standard, alle Alltags-Screens):**

| Token | Wert | Verwendung |
|---|---|---|
| `bg-0` | `#FFFFFF` | App-Hintergrund |
| `bg-1` | `#F7F7F7` | Abgesetzte Flächen: Chips, Skeletons, Input-Hintergründe |
| `line` | `#EBEBEB` | Hairlines, Divider (1 px, nie dicker) |
| `line-strong` | `#B0B0B0` | Input-Rahmen, Grabber |
| `text-1` | `#222222` | Primärtext, Zähler, Outline-Buttons |
| `text-2` | `#6A6A6A` | Sekundärtext, Labels, inaktive Tabs |
| `text-3` | `#B0B0B0` | Platzhalter, deaktiviert |
| `accent` | `#FF385C` | DER Akzent (Rausch): Primär-Buttons, aktive Tabs, Fortschritt |
| `accent-pressed` | `#E31C5F` | Pressed-State von Akzent-Flächen |
| `accent-text` | `#C4103C` | Akzent als kleiner Text/Link/Icon (Kontrast ≥ 4.5:1) |
| `seal` | `#B8752F` | NUR Versiegelungs-Symbolik auf hellem Grund |
| `danger` | `#C13515` | Fehler, destruktive Aktionen — bewusst klar vom Pink-Rot getrennt |

**Kino-Palette (Medien-Screens, fix — kein Theme, keine Umschaltung):**

| Token | Wert | Verwendung |
|---|---|---|
| `cinema-0` | `#131110` | Hintergrund Kamera/Preview/Versiegeln/Recap |
| `cinema-1` | `#1C1917` | Karten/Sheets im Kino-Kontext |
| `cinema-text-1` | `#F2EEE8` | Primärtext im Kino |
| `cinema-text-2` | `#A79F96` | Sekundärtext im Kino |
| `seal-glow` | `#E8A13C` | Gold der Versiegelung — darf im Kino glühen |
| `overlay-pill` | `rgba(19,17,16,0.55)` + Blur 10 | Das EINZIGE UI direkt auf Fotos |

Die Kino-Palette behält bewusst die warme v1-Dunkelheit — sie ist das Erbe der alten
Design Language und macht den Kinosaal wärmer als ein neutrales Schwarz.

**Regeln:**

- `accent` = Interaktion. `seal` = Versiegelungs-Symbolik. Nie mischen: ein Button ist
  nie gold, ein Siegel ist nie pink.
- `danger` wird nie für Emphase benutzt — nur für Fehler und Destruktives.
- Kein Blau, Violett, Türkis. Kein Grün als Erfolgsfarbe (Erfolg kommuniziert Copy + Haptik).
- Fotos bekommen Scrims (oben/unten `rgba(0,0,0,0.35) → transparent`), damit Text lesbar
  ist — das ist der EINZIGE erlaubte Gradient der App.
- Auf Fotos liegt UI ausschliesslich als `overlay-pill`.

### 3.2 Typografie

**Eine Familie: Figtree** (variable, Google Fonts). Der Reelive-Wortzug bleibt ein
eigenes SVG-Asset, nie als Text gesetzt.

| Rolle | Grösse / Weight | Details |
|---|---|---|
| Zähler-Display | 84 px / 300 | Signature der App. `tabular-nums`, letter-spacing −2 % |
| H1 | 30 px / 700 | Screen-Titel («Meine Reisen») — gross und selbstbewusst |
| H2 | 22 px / 600 | Sektionstitel |
| H3 | 18 px / 600 | Karten-Header, Dialog-Titel |
| Body | 16 px / 400 | Fliesstext, line-height 1.5 |
| Body-Medium | 16 px / 500 | Kartentitel, Button-Labels |
| Sekundär | 14 px / 400 | `text-2`, line-height 1.45 |
| Caption | 12 px / 500 | Labels, letter-spacing 0.02 em |
| Tab-Label | 11 px / 500 | |

Regeln: keine weiteren Grössen erfinden. Sentence case («Momente eingefangen»), nie
Versalien-Schreien. Zahlen immer `tabular-nums`. Headlines dürfen zweizeilig sein —
lieber gross und umbrechend als klein und einzeilig (Airbnb-Prinzip).

### 3.3 Form & Raum

- **Radius, genau drei Werte:** 12 (Buttons, Inputs, Thumbnails) · 24 (Cover-Bilder,
  Sheets, grosse Karten-Bilder) · 999 (Pills, Avatare, Shutter, FAB). Nichts dazwischen.
- **Abstände nur aus dem 4er-Raster:** 4 · 8 · 12 · 16 · 24 · 32 · 48.
- **Screen-Ränder: 24 px** (v1: 20). Grosszügigkeit ist Teil des Looks.
- Fotos in Medien-Screens randlos (edge-to-edge). Im hellen UI tragen Bilder Radius 24
  (Cover) bzw. 12 (Thumbnails).

### 3.4 Elevation

Schatten sind erlaubt (Bruch mit v1) — aber nur aus dieser Skala, immer neutral-schwarz,
nie farbig, nie härter:

| Stufe | Wert | Verwendung |
|---|---|---|
| `shadow-1` | `0 1 2 rgba(0,0,0,0.08)` + `0 4 12 rgba(0,0,0,0.05)` | ruhende weisse Karten mit Chrome (z.B. Upload-Status) |
| `shadow-2` | `0 6 16 rgba(0,0,0,0.12)` | Schwebendes: FAB «Neue Reise», Sticky-CTAs |
| `shadow-3` | `0 8 28 rgba(0,0,0,0.28)` | Sheets, Modals, Dialoge |

Grundsatz: Flächentrennung im hellen UI läuft primär über Weissraum und 1-px-Hairlines.
Ein Schatten bedeutet «dieses Element schwebt über dem Inhalt» — er ist nie Dekoration.
Die Standard-Reise-Karte ist randlos und hat KEINEN Schatten (das Bild ist die Karte).

### 3.5 Ikonografie

Lucide, Outline, Stroke 1.75, runde Kappen. Nie gefüllte Icons, nie Emoji als UI-Icon
(Emoji existieren nur als Inhalt: Reaktionen, Captions). Icon-Grössen: 20 (inline),
24 (Navigation, Aktionen), 28 (Tab-Bar).

## 4. Komponenten

Maximal 2–3 Komponentenarten pro Screen. Der Bestand:

**Button primär**
`accent`-Fläche, Text `#FFFFFF` Body-Medium, Radius 12, Höhe 52. Press: Scale 0.97
(`spring-ui`) + Fläche `accent-pressed`. Disabled: `bg-1` + `text-3`. Genau EINER pro
Screen.

**Button sekundär (Outline)**
`bg-0`, 1 px Rand `#222222`, Text `text-1`, Radius 12, Höhe 52. Press: Scale 0.97 +
Hintergrund `bg-1`. («Verwerfen» neben «Einsenden»)

**Text-Link**
`text-1`, unterstrichen (Airbnb-Signature). `accent-text` nur für hervorgehobene
Aktionen (z.B. «Link teilen»). Kein Rahmen, keine Fläche.

**Reise-Karte (randlos, Listing-Stil)**
Cover-Bild 3:2, Radius 24. Darunter ohne Rahmen und ohne Schatten: Titel Body-Medium
`text-1`, Zeitraum Sekundär `text-2`, Avatar-Gruppe (−8 px Overlap) + Momente-Chip
(`bg-1`, Radius 999, Caption). Versiegelt-Badge als `overlay-pill` oben links auf dem
Cover: Siegel-Icon in `seal-glow` + «versiegelt». Press: Scale 0.98.

**Recap-Karte**
Wie Reise-Karte, Cover als Collage, zentrierter Play-Button als `overlay-pill`
(64 px, Play-Icon `#FFFFFF`). Badge-Text: «Recap ansehen».

**Input**
Höhe 56, Radius 12, Rand 1 px `line-strong`, Hintergrund `bg-0`. Floating Label: liegt
als Body `text-3` in der Mitte, schrumpft bei Fokus/Inhalt auf Caption nach oben
(150 ms `ease-smooth`). Fokus: Rand 2 px `#222222` — nicht Akzent. Fehler: Rand
`danger` + Fehlertext Caption `danger` darunter.

**Tab-Bar**
Volle Breite, `bg-0`, 1 px Hairline `line` oben, keine Rundung, kein Schatten (v1s
schwebende Pille entfällt). Höhe 56 + Safe-Area. Aktiv: Icon + Label `accent`; inaktiv
`text-2`. Tab-Wechsel: Icon-Pop 1 → 1.15 → 1 + Haptik selection.
Tabs: **Aufnehmen · Reise · Recap · Profil**.

**Sheet**
Von unten, Radius 24 oben, Grabber 36 × 4 `line-strong` zentriert, `shadow-3`,
Hintergrund `bg-0`. Öffnet mit `spring-ui`, Scrim `rgba(0,0,0,0.4)` faded 250 ms.

**Dialog (Bestätigungen)**
Zentriert, `bg-0`, Radius 24, `shadow-3`, Titel H3, Body Sekundär, Aktionen als
Buttons. Destruktive Aktion: Text-Button in `danger`.

**Pill-Control (auf Fotos)**
`overlay-pill`, Radius 999, Text/Icons `#FFFFFF`. (Zoom «0,5 · 1x · 2», Trip-Label,
Versiegelt-Badge)

**FAB «Neue Reise»**
`accent`, Radius 999, 56 px, Plus-Icon `#FFFFFF`, `shadow-2`, unten rechts mit 24 px
Rand über der Tab-Bar. Press: Scale 0.94.

**Avatare**
Rund, 32–44 px, 2 px `bg-0`-Ring, in Gruppen −8 px überlappend, max. 4 + «+3»-Chip.

**Skeleton**
`bg-1`-Blöcke in Ziel-Geometrie (Radius 12/24), Opacity-Puls 0.6 ↔ 1.0 über 1 s
`ease-in-out`. Kein Gradient-Shimmer.

## 5. Motion-System

Der Kern des Airbnb-Gefühls: Alles federt, nichts ruckt. Es wird ausschliesslich
`transform` und `opacity` animiert (60 fps, Reanimated auf dem UI-Thread). Layout-
Properties (width/height/top) werden nie direkt animiert.

### 5.1 Motion-Tokens

| Token | Wert | Verwendung |
|---|---|---|
| `duration-fast` | 150 ms | Press-Feedback, Label-Float, kleine Zustandswechsel |
| `duration-base` | 250 ms | Fades, Chips, Scrims, Toasts |
| `duration-gentle` | 400 ms | Screen-Übergänge, Layout-Shifts, Kinosaal-Fade (350) |
| `duration-feature` | 700–900 ms | NUR Versiegeln und Reveal |
| `ease-smooth` | `cubic-bezier(0.22, 1, 0.36, 1)` | Standard für alles Zeitbasierte |
| `spring-ui` | damping 18 · stiffness 180 · mass 1 | Interaktives: Press, Sheets, Drags. Overshoot ≤ ~2 % |

Keine anderen Kurven, Dauern oder Spring-Parameter erfinden. `linear` ist verboten
(einzige Ausnahme: Fortschrittsbalken, die reale Zeit abbilden — Video-Ring,
Recap-Segmente).

### 5.2 Micro-Interactions

- **Press überall:** Buttons und Tabs → Scale 0.97, randlose Karten → 0.98, FAB → 0.94
  (alle `spring-ui`), Release federt zurück. Nie Opacity-Dimmen als Press-Feedback.
- **Digit-Roll (Signature):** Zähler wechseln nie hart — die Ziffer rollt nach oben aus
  und die neue von unten ein (250 ms `ease-smooth`, pro Ziffer). Überall, wo ein
  Momente-Zähler steht.
- **Stagger-Entrance:** Listen (Reise-Karten, Mitglieder) erscheinen gestaffelt: Fade +
  12 px Translate-Y, 40 ms Versatz pro Karte, `ease-smooth`.
- **Tab-Pop:** aktives Tab-Icon 1 → 1.15 → 1 (`spring-ui`).
- **Floating Label:** 150 ms `ease-smooth`.
- **Skeleton-Puls:** Opacity 0.6 ↔ 1.0, 1 s Zyklus.

### 5.3 Screen-Übergänge

- **Stack-Push:** Parallax-Slide (neuer Screen von rechts, alter −25 % versetzt),
  400 ms `ease-smooth`.
- **Sheets/Modals:** `spring-ui` von unten, Scrim-Fade 250 ms.
- **Kinosaal-Übergang** (heller Screen → Kamera oder Recap-Player): Fade durch Dunkel,
  350 ms — «das Licht geht aus». Rückweg: «das Licht geht an». Der Theme-Bruch wird
  inszeniert statt versteckt.
- **Shared-Element:** Reise-Karten-Cover expandiert beim Öffnen zur Trip-Ansicht
  (450 ms, `ease-smooth`); zurück kollabiert es in die Karte.

### 5.4 Die zwei Inszenierungen

Dürfen 700–900 ms dauern, `seal-glow` benutzen und weicher Gold-Schein (Blur 24,
Opacity ≤ 25 %) hinter Icons liegt nur hier.

1. **Versiegeln (nach «Einsenden»):** Das Foto schrumpft per Spring in die
   Filmstreifen-Leiste, das Siegel schliesst sich mit kurzem Gold-Glow, der Zähler
   rollt hoch (Digit-Roll), Copy «Bis zum Recap versiegelt.» Haptik: success.
2. **Reveal (erstes Öffnen eines Recaps):** Das Siegel bricht auf, Gold-Funken ✦
   steigen auf (Reelive-eigen statt Konfetti), dann «Recap starten». Haptik: success.

### 5.5 Reduced Motion

`prefers-reduced-motion` wird respektiert: alle Übergänge und Inszenierungen werden zu
200-ms-Fades. Keine Springs, kein Parallax, kein Stagger, keine Funken. Digit-Roll wird
zum Crossfade.

## 6. Haptik

| Ereignis | Haptik (expo-haptics) |
|---|---|
| Tab-Wechsel, Zoom-Stufe wechseln | `selectionAsync` |
| Auslöser, Zähler-Tick | Impact light |
| Einsenden/Versiegelt, Reveal | Notification success |
| Destruktiver Dialog öffnet | Notification warning |

Haptik ist sparsam: nie bei blossem Scrollen, nie bei jedem Listenelement.

## 7. Anwendung Screen für Screen

Referenz für Aufbau und Inhalte: `docs/reelive-app-konzept.md`. Hier nur, wie v2 die
Screens stylt.

- **Welcome/Login:** `bg-0`, Wortzug oben, H1-Pitch («Eure Reise. Alle Perspektiven.
  Ein Recap.»), Auth-Buttons als Outline-Buttons, «Mit Handynummer» primär. Viel
  Weissraum, Illustration/Foto optional als 3:2-Bild Radius 24.
- **SMS-Code/Profil-Setup:** Inputs mit Floating Label, ein Primär-Button, Fortschritt
  als Text («Schritt 1 von 2», Caption `text-2`).
- **Home «Meine Reisen»:** H1 30/700, Sektionen «Aktiv» / «Recaps» als H2. Randlose
  Reise-Karten unter einander (volle Breite minus 24er-Ränder), Stagger-Entrance. FAB
  unten rechts. Empty State: zentriertes Bild + Body + ein Primär-Button.
- **Neue Reise / Einladen:** Formular minimal (2 Inputs + Cover-Picker als 3:2-Fläche
  `bg-1` Radius 24 mit Kamera-Icon). Einladen: QR gross auf `bg-0`, «Link teilen»
  primär, Hinweistext Sekundär.
- **Beitritt:** Cover 3:2 Radius 24, Trip-Name H1, Avatar-Gruppe, «Reise beitreten»
  primär.
- **Trip-Ansicht (versiegelt):** Shared-Element-Cover oben, darunter helle Bühne:
  Reisetag als Caption («Tag 4 von 10»), Zähler-Display 84/300 mit Digit-Roll,
  «Die Filmrolle füllt sich…» Sekundär, Mitgliederliste, Upload-Status als Chip.
  Versiegelt-Symbolik in `seal`. Owner: «Reise abschliessen» als Outline-Button mit
  Dialog.
- **Kamera (Kino):** `cinema-0`, Pills für Trip-Label + Zähler oben, Zoom-Pille,
  Shutter 999. Betreten/Verlassen über Kinosaal-Fade.
- **Preview (Kino):** Foto randlos, Caption-Eingabe on-photo, «Einsenden» primär
  (`accent` funktioniert auf dunkel), «Verwerfen» als Kino-Sekundär (`cinema-1`).
- **Versiegeln (Kino):** Inszenierung 1 (§5.4).
- **Reveal-Intro (Kino):** Inszenierung 2 (§5.4).
- **Recap-Player (Kino):** Stories-Player, Segmente oben (aktiv `#FFFFFF`, linear —
  reale Zeit), Autorin als Pill, Reaktionen unten, Kommentar-Panel als Sheet
  (`cinema-1`). Tages-Trenner als ruhige Kino-Karte («Tag 3 · Lissabon · 12. August»).
- **Recap-Übersicht (hell!):** Grid nach Tagen ist ein Alltags-Screen — helle Bühne,
  Thumbnails Radius 12, Tages-Header H2. Tippen auf ein Thumbnail → Kinosaal-Fade in
  den Player.
- **Einstellungen:** Listen mit Hairline-Dividern, Sektionen H2, destruktive Zeile
  («Account löschen») in `danger`.
- **Web-Player (geteilter Recap):** Kino-Optik wie der Player, schreibgeschützt,
  dezentes Reelive-Branding + «Hol dir die App» als Primär-Button.

## 8. Accessibility

- Kontraste: `accent` auf Weiss (≈3.9:1) nur für grosse Flächen/Buttons und aktive
  Tab-Icons; kleiner Akzent-Text immer `accent-text` (≥ 4.5:1). Alle Textfarben der
  Palette erfüllen ≥ 4.5:1 auf ihrem Hintergrund.
- Touch-Targets min. 44 × 44 px (Tab-Items, Icon-Buttons, Zoom-Stufen).
- Dynamic Type bis 1.3× ohne Layout-Bruch; Zähler-Display skaliert nicht mit (fix).
- `tabular-nums` überall, wo Zahlen ticken — nichts springt.
- Reduced Motion: §5.5. VoiceOver: Zähler als «24 Momente eingefangen» gelabelt, nicht
  als nackte Zahl.

## 9. Sprache (Copy)

Unverändert aus v1: Deutsch, Du-Form, warm und kurz. Vokabular — immer dieselben Wörter:

| Begriff | Nie |
|---|---|
| Moment | Post, Beitrag, Snap, Story |
| Reise | Trip, Projekt, Fahrt |
| Filmrolle | Galerie, Feed |
| versiegelt | gesperrt, hidden |
| Recap | Rückblick, Zusammenfassung |
| einsenden | posten, hochladen, teilen |

Buttons sagen, was passiert. Fehler erklären Ursache und Lösung, ohne Entschuldigung.
Leere Screens laden zum Handeln ein.

## 10. Verbote (Anti-AI-Look, v2)

- ❌ Gradients auf Flächen, Buttons oder Text (einzige Ausnahme: Foto-Scrims)
- ❌ Blau, Violett, Türkis; Grün als Erfolgsfarbe
- ❌ Andere Fonts als Figtree
- ❌ Radius-Werte ausser 12 / 24 / 999
- ❌ Schatten ausserhalb der 3-Stufen-Skala; farbige Schatten
- ❌ Schatten als Dekoration auf randlosen Karten
- ❌ Emoji als Icons, gefüllte Icons
- ❌ Mehr als ein Primär-Button pro Screen
- ❌ Vier gleiche KPI-Karten nebeneinander, Zahlen-Grids ohne Hierarchie
- ❌ Zentrierte Textwüsten; Text ist linksbündig, nur inszenierte Momente zentrieren
- ❌ `linear` als Easing (Ausnahme: Fortschritt, der reale Zeit abbildet)
- ❌ Opacity-Dimmen als Press-Feedback (immer Scale per Spring)

## 11. Migration

Betroffener Bestand (Phase 1–2):

1. **`mobile/src/theme/tokens.ts`:** neue Licht-Palette + `cinema`-Konstanten +
   Motion-/Elevation-Tokens. Die Dark/Light-Struktur entfällt.
2. **`mobile/src/theme/ThemeProvider.tsx`:** verliert die System-Theme-Umschaltung.
   Die Hook-API (`useTheme()` o.ä.) bleibt stabil, damit Screens nicht brechen;
   Medien-Screens beziehen die Kino-Konstanten explizit.
3. **Schrift:** `@expo-google-fonts/figtree` ersetzt Manrope; Weights 300–700 laden.
4. **Bestehende Screens** (Auth-Flow, Tab-Gerüst, Profil): Restyle auf v2 — heller
  Grund, neue Buttons/Inputs, Tab-Bar volle Breite.
5. **Token-Tests** (`mobile/src/theme/__tests__/tokens.test.ts`): an neue Struktur
   anpassen.
6. **`DESIGN-LANGUAGE.md`:** komplett neu als v2-Kurzreferenz (inkl. neuem
   Prompt-Block für externe Tools und neuer Review-Checkliste).

Die Migration wird nach Freigabe dieses Konzepts als eigener Implementierungsplan
geschrieben (`docs/superpowers/plans/`). Sie ist bewusst NICHT Teil dieses Dokuments.

## 12. Deliverables dieses Konzepts

1. Dieses Dokument (Spec).
2. `DESIGN-LANGUAGE.md` v2 — verbindliche Kurzreferenz.
3. HTML-Styleguide (Artifact): Tokens als Muster, Kern-Screens im neuen Look (Home,
   Reise-Karte, Trip-Ansicht, Kamera-Kontrast, Versiegeln), Motion live erlebbar
   (Press-Scale, Digit-Roll, Stagger, Kinosaal-Fade, Versiegeln-Inszenierung).

Nicht Teil dieses Konzepts: App-Implementierung (eigener Plan), Web-Player-Umsetzung,
App-Icon/Brand-Assets.
