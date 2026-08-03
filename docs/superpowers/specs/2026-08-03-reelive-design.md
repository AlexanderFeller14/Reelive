# Reelive — Design-Spezifikation

**Datum:** 2026-08-03
**Status:** Vom Team abgenommen (Brainstorming-Session)

## 1. Produktidee

Reelive verbindet spontane Foto-/Videoaufnahmen mit einem gemeinsamen Reisetagebuch. Nutzer erstellen für eine Reise ein privates Projekt («Trip») und laden Freunde ein. Während der Reise sendet jedes Mitglied kurze Aufnahmen aus der eigenen Perspektive ein. Nach der Reise entsteht daraus ein gemeinsamer, chronologischer Recap im Snapchat-Story-Stil.

**Kernmechanik «Filmrolle»:** Alle Beiträge sind bis zum Reveal versiegelt — auch die eigenen. Während der Reise sieht man nur einen Zähler («Du hast 23 Momente eingefangen»). Erst der Recap zeigt alles, für alle. Das erzeugt den Überraschungs-Moment und ist das Alleinstellungsmerkmal: dieselben Tage, verschiedene Perspektiven.

**Zielbild:** Echtes Produkt, Launch in App Store + Play Store in 3–4 Monaten. Team: 2 Personen, AI-unterstützte Entwicklung. Betriebskosten so tief wie möglich.

## 2. Umfang V1

**Kern:**
- Trip erstellen, Freunde per Invite-Link/QR einladen (Beitritt auch mitten in der Reise)
- Kamera-first Aufnahme (Foto + Video bis 30 s), optionale Text-Caption auf der Aufnahme
- Ort (GPS + Ortsname) und Aufnahmezeitpunkt werden pro Beitrag gespeichert
- Versiegelung bis zum Reveal, serverseitig erzwungen
- Reveal durch Owner («Reise abschliessen») → Push an alle → Recap
- Recap: durchtippbarer Story-Player, chronologisch nach Aufnahmezeitpunkt, gruppiert nach Reisetagen («Tag 3 · Lissabon»), mit Autor/Zeit/Ort
- Emoji-Reaktionen und Text-Kommentare auf Beiträge im Recap
- Recap teilen: Share-Link für Nicht-Mitglieder (schreibgeschützter Web-Player) + Export der Medien in die eigene Galerie

**Pflicht für Store-Freigabe:**
- Beiträge melden, Mitglieder entfernen (Moderation durch Owner)
- Account-Löschung in der App

**Bewusst nicht in V1 (Roadmap):** gerendertes Highlight-Video mit Musik, täglicher Reveal-Modus, Kartenansicht, öffentliche Profile/Discovery, Bezahlmodell.

## 3. Tech-Stack (Entscheid: Ansatz A)

| Bereich | Technologie | Begründung |
|---|---|---|
| App | Expo / React Native, TypeScript, expo-router | Eine Codebase für iOS + Android; bestes Ökosystem für AI-unterstützte Entwicklung |
| Kamera | react-native-vision-camera | Schneller Kaltstart, Foto + Video, Kamera-first UX |
| Kompression | On-Device (Fotos ~1080p, Video H.264 max. 1080p, Clips ≤ 30 s) | Drückt Speicher-/Transferkosten massiv |
| Backend | Supabase (EU-Region Frankfurt): Postgres, Auth, Edge Functions | Managed, relationales Modell passt, RLS erzwingt Versiegelung, EU-Datenhaltung |
| Auth | SMS-OTP + Sign in with Apple + Google, Account-Verknüpfung | Beide Wege; Onboarding bevorzugt Apple/Google (keine SMS-Kosten) |
| Medien-Storage | Cloudflare R2 (S3-kompatibel, EU-Jurisdiktion) | Keine Egress-Kosten — Recaps werden mehrfach abgespielt |
| Push | Expo Push Notifications | Gratis; Reveal-Benachrichtigung, Beitritts-Info |
| Builds/Releases | EAS Build + Submit, TestFlight / Internal Testing | Store-Pipeline ohne eigene CI-Infrastruktur |
| Monitoring | Sentry (Free Tier) für App + Edge Functions | Fehler sichtbar ab Tag 1 |

Abgelehnte Alternativen: Flutter + Firebase (zweites Ökosystem, NoSQL-Umwege, Kosten-/Lock-in-Risiko), eigenes Python-Backend (4–6 Wochen Mehraufwand für Auth/Storage/Push, gefährdet den Zeitplan).

## 4. Architektur

```
┌─────────────────────────────┐
│  Expo App (iOS / Android)   │
│  Kamera · Upload-Queue ·    │
│  Story-Player · Push        │
└──────┬──────────────┬───────┘
       │              │ Medien-Up/Download
       │              │ (signierte URLs)
       ▼              ▼
┌─────────────┐  ┌─────────────┐
│  Supabase   │  │ Cloudflare  │
│  Postgres+RLS│  │     R2      │
│  Auth        │  │ (Fotos/     │
│  Edge Funcs ─┼──▶  Videos)   │
└─────────────┘  └─────────────┘
```

- Die App spricht direkt mit Supabase (Postgres via RLS-geschützter API, Auth) und lädt Medien direkt zu R2 hoch/herunter — über kurzlebige signierte URLs, die eine Edge Function ausstellt.
- Edge Functions kapseln alles, was der Client nicht entscheiden darf: Invite einlösen, Reveal auslösen, signierte Lese-/Schreib-URLs ausstellen, Share-Link auflösen.
- Der Recap ist kein gerendertes Artefakt, sondern eine Abfrage: alle Beiträge des Trips sortiert nach Aufnahmezeitpunkt. «Recap erstellen» = Statuswechsel `active → revealed` + Push.

### Versiegelung (serverseitig erzwungen)

1. **Metadaten (Postgres RLS):** `posts` eines Trips sind für niemanden lesbar — auch nicht für den Autor — solange der Trip nicht `revealed` ist. Erlaubt ist nur ein Zähler (Aggregat über eine dedizierte View/Funktion).
2. **Medien (R2):** Lese-URLs stellt die Edge Function nur aus, wenn (a) der Trip `revealed` ist und (b) der Anfragende Mitglied ist — oder ein gültiger Share-Link-Token vorliegt.

## 5. Datenmodell

| Tabelle | Felder (Kern) | Bemerkungen |
|---|---|---|
| `profiles` | id (= auth.users), username, display_name, avatar_key | |
| `trips` | id, name, cover_key, start_date, end_date, status (`active`/`revealed`/`archived`), invite_code, owner_id, plan | `plan` als Vorbereitung für spätere Monetarisierung |
| `trip_members` | trip_id, user_id, role (`owner`/`member`), joined_at | Unique (trip_id, user_id) |
| `posts` | id, trip_id, author_id, type (`photo`/`video`), storage_key, thumb_key, duration_s, caption, captured_at (UTC), captured_tz, lat, lng, place_name, upload_status | Sortierung IMMER nach `captured_at` (Gerätezeit), nie nach Upload-Zeit |
| `reactions` | post_id, user_id, emoji | Unique (post_id, user_id, emoji) |
| `comments` | id, post_id, user_id, text, created_at | |
| `share_links` | trip_id, token, expires_at, revoked | Nur für revealed Trips |
| `reports` | post_id, reporter_id, reason, created_at | Moderations-Pflicht (Store) |

## 6. Kern-Abläufe

1. **Trip erstellen & einladen:** Owner legt Trip an → App erzeugt Invite-Link (Deep Link, fällt auf Store-Seite zurück) + QR. Nach Login löst eine Edge Function den Code ein und erstellt die Mitgliedschaft.
2. **Aufnehmen:** App öffnet in die Kamera. Aufnahme → optionale Caption → «Einsenden» → versiegelt. Kein Review, kein Nachträglich-Anschauen (nur Zähler).
3. **Upload:** Aufnahme + Metadaten landen sofort in einer lokalen, neustart-festen Queue; Hintergrund-Worker komprimiert und lädt hoch, sobald Netz da ist (Retry mit Backoff, Option «nur WLAN»). Aufnehmen funktioniert vollständig offline.
4. **Reveal:** Owner schliesst die Reise ab (Erinnerung ab Enddatum). Edge Function setzt `revealed`, sendet Push an alle Mitglieder.
5. **Recap:** Story-Player (tippen = weiter, halten = Pause), Tages-Gruppierung, Autor/Zeit/Ort eingeblendet, Reaktionen + Kommentare im Player. Nachzügler-Uploads nach dem Reveal sortieren sich chronologisch ein («3 Momente werden noch hochgeladen»).
6. **Teilen/Export:** Share-Link → schreibgeschützter Web-Player (gleiche Codebase via Expo Web, token-gated, widerrufbar). Export: Medien des Trips in die eigene Galerie speichern.

## 7. Fehlerbehandlung & Edge-Cases

- **Offline ist der Normalfall:** Queue-Design wie oben; `captured_at` + Zeitzone vom Gerät sichern die Chronologie auch bei tagelangem Offline-Sein.
- **Reveal bei ausstehenden Uploads:** Recap bleibt offen für Nachzügler; UI zeigt ausstehende Anzahl.
- **Beitritt mitten in der Reise:** erlaubt; Mitglied sieht ab Beitritt denselben versiegelten Zustand.
- **Mitglied verlässt Trip / wird entfernt:** bereits eingesendete Beiträge bleiben im Trip (Hinweis beim Verlassen); entfernte Mitglieder verlieren jeden Zugriff.
- **Doppelte Accounts (SMS vs. Apple/Google):** Auth-Identitäten werden über Supabase-Identity-Linking demselben Account zugeordnet; Onboarding fragt bei Kollision nach.
- **Uhrzeit-Manipulation/Drift:** Server speichert zusätzlich `created_at`; grobe Plausibilitätsprüfung (captured_at innerhalb Trip-Zeitraum ± Toleranz), sonst Einsortierung mit Flag.
- **Monitoring:** Sentry in App und Edge Functions.

## 8. Testing

- TypeScript strict; Unit-Tests (Jest) für Kernlogik: Chronologie/Tages-Gruppierung, Upload-Queue-Zustandsmaschine, Invite-Einlösung.
- **RLS-Policy-Tests (höchste Priorität):** automatisierte Tests pro Policy — «Mitglied liest vor Reveal nichts, auch eigene Posts nicht», «Nicht-Mitglied liest nie», «Zähler funktioniert vor Reveal». Die Versiegelung ist das Produktversprechen; ein Policy-Fehler wäre der schlimmste denkbare Bug.
- Ein E2E-Happy-Path (Maestro): erstellen → beitreten → posten → reveal → Recap.
- Laufende TestFlight/Internal-Builds; eigener Reise-Testlauf des Teams vor dem Store-Launch.

## 9. Kosten & Datenschutz

- **Startkosten:** ~0–30 CHF/Monat (Supabase Free → Pro 25 $/Mt bei Bedarf, R2 im Free-Kontingent, Expo/Sentry Free). Grösster variabler Posten: SMS-OTP (~0.05–0.10 CHF/SMS) → Onboarding bevorzugt Apple/Google.
- **Kosten pro Trip (Schätzung):** bei On-Device-Kompression ~0.10–0.30 CHF — relevant als Untergrenze für das spätere «1 CHF pro Trip»-Modell (Achtung: In-App-Kauf-Abgabe Apple/Google 15–30 %, netto ~0.70–0.85 CHF).
- **Datenschutz (DSGVO/revDSG):** Daten in der EU (Supabase Frankfurt, R2 EU-Jurisdiktion), private Buckets, signierte kurzlebige URLs, Account- und Trip-Löschung inkl. Medien, Privacy Policy vor Store-Launch.

## 10. Offene Punkte (nach V1 zu entscheiden)

- Bezahlmodell konkret ausgestalten (1 CHF/Trip vs. Freemium-Limits)
- Gerendertes Highlight-Video (Export mit Musik/Übergängen)
- Täglicher Reveal-Modus als Option pro Trip
- Kartenansicht des Trips
