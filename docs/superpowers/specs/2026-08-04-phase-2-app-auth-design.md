# Reelive Phase 2 — App-Grundgerüst & Auth: Design-Spezifikation

**Datum:** 2026-08-04
**Status:** Abgenommen (Brainstorming-Session)
**Basis:** [Produkt-Spec](2026-08-03-reelive-design.md) · [Roadmap](../plans/2026-08-03-reelive-v1-roadmap.md) · `DESIGN-LANGUAGE.md` (verbindlich für alle UI)

## 1. Ziel & Deliverable

Die erste sichtbare Reelive-App: Expo-Projekt mit Login, Profil-Onboarding und
Session-Handling gegen das Phase-1-Backend.

**Deliverable (Roadmap):** Auf Simulator und Gerät einloggen, Profil anlegen,
eingeloggt bleiben.

## 2. Rahmenentscheide (in der Session getroffen)

| Entscheid | Wahl | Begründung |
|---|---|---|
| Supabase-Instanz | **Nur lokal** (Docker, Phase-1-Stand) | Kein Cloud-Setup jetzt; hosted EU-Projekt folgt in einer späteren Phase |
| Login-Umfang | **SMS-OTP voll funktional; Apple/Google vorbereitet** hinter Feature-Flags | SMS-OTP läuft lokal über Test-Codes ohne Provider/Kosten; Apple braucht Developer-Account (99 USD/Jahr) + Dev-Build, Google braucht OAuth-Client-IDs |
| Plattformen | **iOS und Android parallel** (Simulator, Emulator, je ein echtes Gerät) | Deliverable verlangt Gerätetests; Cross-Platform-Probleme früh sichtbar |
| Build-Ansatz | **Expo Go** für Phase 2 | Null Build-Setup; Dev-Builds kommen erst, wenn native Module aktiv werden (Phase 3/4: Deep Links, Kamera, Apple Sign-In) |
| Avatar im Onboarding | **Verschoben** auf die Phase mit Upload-Infrastruktur (Phase 4) | `profiles.avatar_key` bleibt vorerst leer; Onboarding bleibt bei max. 2 Schritten |

## 3. Projektstruktur

Die App lebt in einem neuen Top-Level-Ordner `mobile/` (neben `supabase/` und
`docs/`). TypeScript strict, expo-router mit typisierten Routen.

```
mobile/
  app/                      # expo-router Routen
    _layout.tsx             # Root: Fonts, Theme, AuthProvider, Session-Guard
    (auth)/
      welcome.tsx           # Logo, Pitch, Login-Buttons
      phone.tsx             # Nummerneingabe
      otp.tsx               # 6-stelliger Code
      profile-setup.tsx     # Username + Anzeigename (einmalig)
    (tabs)/
      _layout.tsx           # Schwebende Tab-Bar (Design-Language §4)
      aufnehmen.tsx         # Platzhalter («kommt in Phase 4»)
      reise.tsx             # Platzhalter («kommt in Phase 3»)
      recap.tsx             # Platzhalter («kommt in Phase 5»)
      profil.tsx            # Eigenes Profil, Abmelden
  src/
    theme/                  # Tokens (§1–3 der Design-Language) + useTheme
    components/             # Button (primär/sekundär/Text), Card, Input, Pill, TabBar
    lib/supabase.ts         # Client + verschlüsselter Session-Storage
    features/auth/          # AuthProvider, useSession, Auth-Abstraktion, Profil-API
```

Konfiguration über `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`
(`.env` mit Beispieldatei; Simulator `127.0.0.1:54321`, Android-Emulator
`10.0.2.2:54321`, echtes Gerät LAN-IP des Dev-Macs).

## 4. Auth & Session

- **Client:** `supabase-js`. Session-Storage nach dem offiziellen Muster:
  Verschlüsselungs-Key in `expo-secure-store`, Session-Payload AES-verschlüsselt
  in AsyncStorage (SecureStore allein ist für Sessions zu klein).
- **SMS-OTP:** `signInWithOtp({ phone })` → `verifyOtp`. Lokal ausschliesslich
  **Test-Codes** in `supabase/config.toml` (`auth.sms.test_otp`, z.B.
  `+41790000001 → 123456`) — kein SMS-Provider, keine Kosten. Die Testnummern
  werden im README dokumentiert.
- **Apple/Google (vorbereitet):** eine Auth-Abstraktion
  (`signInWith('apple' | 'google' | 'phone')`) mit Feature-Flags
  (`EXPO_PUBLIC_AUTH_APPLE`, `EXPO_PUBLIC_AUTH_GOOGLE`, default aus). Die
  Welcome-Buttons erscheinen nur bei aktivem Flag. Aktivierung (inkl. nativer
  Module, Identity-Linking-Test gemäss Produkt-Spec §7) ist ein eigener kleiner
  Task in einer späteren Phase, sobald Accounts/Client-IDs vorliegen.
- **Session-Guard im Root-Layout:** keine Session → `(auth)`-Stack; Session ohne
  `profiles`-Zeile → `profile-setup`; sonst `(tabs)`. Guard reagiert auf
  `onAuthStateChange`; Token-Auto-Refresh an den AppState gekoppelt
  (aktiv im Vordergrund).
- **Abmelden** im Profil-Tab (`signOut`, zurück zum Welcome-Screen).

## 5. Profil-Onboarding

Einmalig nach dem ersten Login, ein Screen:

- **Username:** live-validiert gegen `^[a-z0-9_]{3,20}$`; Kollisionsprüfung
  gegen die DB (unique). Inline-Fehler («Dieser Username ist vergeben — probier
  einen anderen.»).
- **Anzeigename:** 1–40 Zeichen.
- Insert läuft über die in Phase 1 getestete Policy `profiles_insert_own`
  (id = auth.uid()). Kein Avatar (siehe §2).

## 6. Theming & Komponenten

Die Design-Language wird als Code-Fundament gegossen — alle späteren Phasen
erben es:

- **Tokens** (`src/theme/`): Farbtabelle §1 (Dark + Light, folgt der
  System-Einstellung), Typo-Rollen §2 (Manrope via
  `@expo-google-fonts/manrope`), Radius {12, 24, 999} und 4er-Raster §3.
  Nirgends feste Hex-Werte in Komponenten.
- **Basis-Komponenten** (§4): Button primär (genau einer pro Screen), Button
  sekundär, Text-Button, Karte, Input, Pill, schwebende Tab-Bar (Radius 24,
  20 px Rand, aktiver Tab in `accent`). Icons: Lucide Outline
  (`lucide-react-native`).
- **Platzhalter-Tabs** sind gestaltete Empty-States mit Copy nach §6
  (Du-Form, Vokabular), kein «TODO».
- **Wortzug-Platzhalter:** Der Reelive-Wortzug soll laut Design-Language ein
  SVG-Asset sein, das noch nicht existiert. Bis es geliefert wird, zeigt der
  Welcome-Screen einen schlichten Manrope-Schriftzug, markiert als Platzhalter
  (Code-Kommentar + Eintrag in den offenen Punkten).

## 7. Fehlerbehandlung

Copy-Regeln nach Design-Language §6 (Ursache + Lösung, ohne Entschuldigung):

- Falscher/abgelaufener OTP-Code → Meldung + erneut senden (Rate-Limit-Hinweis).
- Offline beim Login → «Du bist offline. Verbinde dich und probier es nochmal.»
- Username-Kollision → Inline-Fehler am Feld (siehe §5).
- Supabase nicht erreichbar (lokales Setup) → verständlicher Hinweis mit
  Dev-Kontext (URL prüfen), nur im Dev-Build sichtbar.

## 8. Testing

- **Jest (`jest-expo`), Unit:** Session-Guard-Zustandslogik (kein Login /
  Login ohne Profil / komplett), Username- und Telefonnummern-Validierung
  (E.164, z.B. `+41791234567`; Eingabe-UI normalisiert Landesvorwahl),
  Storage-Adapter (verschlüsselt, übersteht Neustart-Simulation).
- **Component-Tests** (`@testing-library/react-native`): Auth-Screens rendern
  und reagieren (Nummer eingeben → weiter, falscher Code → Fehler).
- **Manuell:** kompletter Login-Zyklus auf iOS-Simulator, Android-Emulator und
  beiden echten Geräten via Expo Go; App-Kill → wieder öffnen → eingeloggt.
- E2E (Maestro) kommt erst später (Produkt-Spec §8 nennt einen Happy-Path für
  den Kern-Loop — der existiert erst ab Phase 5).

## 9. Aufräumen aus dem Phase-1-Final-Review (Startaufgabe)

- Neue Migration: `revoke maintain` für anon/authenticated auf allen Tabellen +
  `alter default privileges` bereinigen (verhindert, dass künftige Tabellen
  wieder ungewollte Grants erben).
- `supabase/config.toml`: `project_id` von `phase-1-fundament` auf `reelive`.

## 10. Bewusst nicht in Phase 2

Echte SMS (Provider), aktives Apple/Google-Login, Avatar-Upload, Deep Links,
Push-Notifications, hosted Supabase-Projekt, EAS-Builds, Trip-Funktionalität
(Phase 3), Kamera (Phase 4).
