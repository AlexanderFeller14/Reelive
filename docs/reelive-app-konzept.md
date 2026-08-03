# Reelive — App-Konzept & Screen-Übersicht (für Mockups)

Dieses Dokument beschreibt die komplette App aus Produkt- und UI-Sicht. Es ist als Briefing für Mockups/Designs gedacht — technische Details stehen bewusst nicht drin.

## 1. Die Idee in drei Sätzen

Reelive ist ein gemeinsames Reisetagebuch für Freundesgruppen. Während der Reise fängt jede Person spontane Foto- und Video-Momente aus der eigenen Perspektive ein — wie bei Snapchat, schnell und ungefiltert. Der Clou: Alle Beiträge sind bis nach der Reise **versiegelt** (auch die eigenen!), und erst der gemeinsame **Recap** zeigt die ganze Reise chronologisch aus allen Perspektiven.

## 2. Die Kernmechanik: «Filmrolle»

- Wie eine analoge Einwegkamera: Auslösen, einsenden — und der Moment verschwindet in der versiegelten Filmrolle.
- Während der Reise sieht man **nur einen Zähler** («Du hast 23 Momente eingefangen»), nie die Aufnahmen selbst. Kein Kuratieren, kein Löschen, kein Vergleichen.
- Nach der Reise schliesst der Ersteller die Reise ab → alle bekommen einen Push → der Recap ist da. Das ist der emotionale Höhepunkt der App: gemeinsam anschauen, wie jede Person dieselben Tage anders erlebt hat.

## 3. Zielgruppe & Gefühl

- **Zielgruppe:** 16–30, reist mit Freunden (Interrail, Roadtrips, Festivals, Skiwochenende), Snapchat-/BeReal-sozialisiert.
- **Gefühl:** jung, persönlich, unkompliziert, spontan. Keine Likes-Jagd, kein öffentliches Profil — alles privat innerhalb der Gruppe.
- **Design-Richtung (Vorschlag, gerne interpretieren):** Kamera-first und immersiv; dunkle UI mit warmen Akzentfarben (Sonnenuntergangs-Vibe: Koralle/Amber), grosszügige Rundungen, verspielte aber klare Typo. Der Recap darf sich festlich anfühlen («Kino-Moment»), der Rest der App federleicht. Emotionale Momente (Reveal!) dürfen Konfetti/Animation haben.

## 4. User Journey (eine Reise von A bis Z)

1. **Vor der Reise:** Lea erstellt das Projekt «Interrail 2026», teilt den Invite-Link im Gruppenchat. Vier Freunde tippen drauf, installieren die App, sind drin.
2. **Während der Reise:** Jede Person öffnet die App direkt in die Kamera, fängt Momente ein (Foto oder Video bis 30 Sek., optional mit Text drauf). Ort und Zeit werden automatisch mitgespeichert. Danach: versiegelt. Die App zeigt nur den eigenen Zähler und wer alles dabei ist. Funktioniert auch komplett offline (Zug, Berge, Flugmodus) — hochgeladen wird, sobald wieder Netz da ist.
3. **Nach der Reise:** Lea tippt «Reise abschliessen». Alle Handys ploppen: «✈️ Euer Recap ist bereit!» Die Gruppe schaut den Recap zusammen (oder jeder für sich): alle Momente aller Personen, streng chronologisch, nach Reisetagen gruppiert. Man reagiert mit Emojis, kommentiert, lacht über die verschiedenen Perspektiven desselben Abends.
4. **Danach:** Recap bleibt für alle Mitglieder erhalten. Per Share-Link können auch Aussenstehende (Eltern, Partner) den Recap schreibgeschützt anschauen. Medien lassen sich in die eigene Galerie exportieren.

## 5. Alle Screens im Detail

### 5.1 Onboarding & Login
- **Welcome-Screen:** Logo, ein Satz Pitch («Eure Reise. Alle Perspektiven. Ein Recap.»), Buttons: «Mit Apple fortfahren», «Mit Google fortfahren», «Mit Handynummer».
- **SMS-Verifikation:** Nummerneingabe → 6-stelliger Code.
- **Profil-Setup (einmalig):** Username, Anzeigename, optional Avatar (Kamera/Galerie). Freundlich und kurz, max. 2 Schritte.

### 5.2 Home — «Meine Reisen»
- Liste der eigenen Reiseprojekte in zwei Gruppen:
  - **Aktive Reisen:** Karte mit Cover, Name, Zeitraum, Mitglieder-Avatare, eigener Momente-Zähler, dezenter «versiegelt»-Indikator (z.B. Siegel-/Filmrollen-Icon).
  - **Recaps (vergangene Reisen):** Karte wirkt «entwickelt» — Cover-Collage, «Recap ansehen»-Play-Button.
- Prominenter Floating-Button: **«Neue Reise»**.
- Empty State (neuer Nutzer): illustrativ, «Erstelle deine erste Reise oder tritt per Link bei».

### 5.3 Neue Reise erstellen
- Formular, bewusst minimal: Name, Zeitraum (von–bis), optional Cover-Foto.
- Danach direkt der **Einladungs-Screen**: grosser QR-Code, «Link teilen»-Button (Share-Sheet), Hinweis «Freunde können jederzeit beitreten, auch mitten in der Reise».

### 5.4 Beitritt (Invite-Flow)
- Freund tippt Link → App öffnet sich (oder Store, falls nicht installiert) → nach Login: Beitritts-Screen mit Trip-Name, Cover, Mitglieder-Avataren, Button «Reise beitreten».

### 5.5 Kamera (Herzstück, Standard-Ansicht bei aktiver Reise)
- Vollbild-Kamera wie Snapchat: Auslöser unten (Tippen = Foto, Halten = Video, Ring zeigt max. 30 Sek.), Kamera wechseln, Blitz.
- Oben dezent: aktiver Trip-Name (bei mehreren aktiven Reisen wechselbar) + eigener Zähler.
- **Nach der Aufnahme (Preview):** Foto/Video mit Möglichkeit, Text-Caption draufzuschreiben (verschiebbar, wie bei Snapchat). Zwei Aktionen: **«Einsenden»** (primär) oder verwerfen. Ort/Zeit werden automatisch angehängt, kleine Anzeige («📍 Lissabon · 14:32»).
- **Einsende-Moment (wichtig für die Emotion):** kurze Versiegelungs-Animation — der Moment «wandert in die Filmrolle», Zähler springt hoch. Kein Zurück, das kommuniziert die App charmant («Bis zum Recap versiegelt ✨»).

### 5.6 Trip-Ansicht während der Reise (versiegelt)
- Kein Feed! Stattdessen: Cover, Reisetag-Anzeige («Tag 4 von 10»), Mitgliederliste mit Avataren, **eigener** Zähler gross inszeniert, Gesamtstimmung («Die Filmrolle füllt sich…»).
- Upload-Status dezent: «3 Momente warten auf Upload» (Offline-Fall), Toggle «nur über WLAN hochladen».
- Owner sieht zusätzlich: «Reise abschliessen»-Button (mit Bestätigungs-Dialog), Mitglieder verwalten (entfernen).

### 5.7 Reveal-Moment
- Owner schliesst ab → Bestätigung («Danach kann niemand mehr Momente einsenden. Bereit?»).
- Alle Mitglieder erhalten Push: «✈️ Euer Recap von ‹Interrail 2026› ist bereit!»
- Beim ersten Öffnen: kurzer, feierlicher Intro-Moment (Animation: Siegel bricht auf / Filmrolle entrollt sich), dann «Recap starten».

### 5.8 Recap — Story-Player (zweites Herzstück)
- Vollbild-Player wie Snapchat/Instagram-Stories: Tippen = weiter, Tippen links = zurück, Halten = Pause, Wischen nach unten = schliessen.
- Fortschrittsbalken oben, segmentiert pro Beitrag.
- **Tages-Trenner:** zwischen den Tagen eine kurze Zwischenkarte («Tag 3 · Lissabon · 12. August»).
- Auf jedem Beitrag eingeblendet: Avatar + Name der Autorin, Uhrzeit, Ort, ggf. Caption.
- **Reaktionen:** Emoji-Leiste am unteren Rand (schnell antippbar), Reaktionen anderer erscheinen dezent auf dem Beitrag.
- **Kommentare:** aufklappbares Panel pro Beitrag (wischen nach oben), kurze Texte.
- Zusätzlich eine **Übersichts-Ansicht** (Grid/Timeline nach Tagen) als Alternative zum linearen Abspielen — zum Springen und Wiederfinden.

### 5.9 Recap teilen & exportieren
- Im Recap: «Teilen»-Button (nur Owner) → erstellt einen Share-Link, mit Optionen «Link deaktivieren» und Ablaufdatum.
- Der Link öffnet einen **schreibgeschützten Web-Player** (gleiche Story-Optik, keine Reaktionen/Kommentare, dezentes Reelive-Branding + «Hol dir die App»).
- «Exportieren»: eigene oder alle Medien in die Foto-Galerie speichern.

### 5.10 Einstellungen & Pflicht-Screens
- Profil bearbeiten (Avatar, Namen).
- Benachrichtigungen, «nur WLAN»-Upload.
- Account löschen (Store-Pflicht, mit Bestätigung).
- Rechtliches: Datenschutz, AGB.
- **Moderation (Store-Pflicht):** Im Recap jeden Beitrag melden können (Long-Press → «Melden»); Owner kann Beiträge entfernen und Mitglieder ausschliessen.

## 6. Wichtige UI-Zustände (für realistische Mockups)

- **Offline während der Reise:** Kamera funktioniert normal, dezenter Hinweis «Momente werden hochgeladen, sobald du online bist».
- **Nachzügler im Recap:** «3 Momente von Ben werden noch hochgeladen» — sortieren sich chronologisch ein, sobald da.
- **Beitritt mitten in der Reise:** Neues Mitglied sieht denselben versiegelten Zustand wie alle.
- **Leere Zustände:** Neue Nutzer ohne Reisen; Recap einer Reise, bei der jemand nichts eingesendet hat.
- **Mehrere aktive Reisen gleichzeitig:** Trip-Umschalter in der Kamera.

## 7. Was die App bewusst NICHT ist

- Kein öffentliches Social Network: keine Follower, kein Explore-Feed, keine Likes-Zähler nach aussen.
- Kein Foto-Editor: keine Filter-Batterien, kein Nachbearbeiten — Spontaneität ist das Feature.
- Kein Chat: die Gruppe hat ihren Gruppenchat woanders; Reelive ist fürs Erinnern da.

## 8. Screen-Liste kompakt (Checkliste für Mockups)

1. Welcome / Login (Apple, Google, Handynummer)
2. SMS-Code-Eingabe
3. Profil-Setup
4. Home «Meine Reisen» (aktiv + Recaps, Empty State)
5. Neue Reise erstellen
6. Einladen (QR + Link)
7. Beitritts-Screen
8. Kamera (Standard-Ansicht)
9. Aufnahme-Preview mit Caption
10. Versiegelungs-Animation / Einsende-Bestätigung
11. Trip-Ansicht versiegelt (Mitglied + Owner-Variante)
12. «Reise abschliessen»-Dialog
13. Reveal-Intro (feierlich)
14. Recap Story-Player (mit Tages-Trenner, Reaktionen, Kommentar-Panel)
15. Recap Übersicht (Grid/Timeline)
16. Teilen-Dialog + Web-Player (schreibgeschützt)
17. Einstellungen inkl. Account löschen
18. Melden/Moderation (Long-Press-Menü)
