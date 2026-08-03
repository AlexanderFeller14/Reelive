# Reelive V1 — Phasen-Roadmap

**Basis:** [Design-Spec](../specs/2026-08-03-reelive-design.md) (freigegeben am 2026-08-03)

V1 wird in 6 Phasen gebaut. Jede Phase liefert eigenständig lauffähige, testbare Software und hat einen eigenen detaillierten Implementierungsplan unter `docs/superpowers/plans/`. Der Plan der nächsten Phase wird jeweils erst nach Abschluss der Vorphase geschrieben (dann mit dem echten Stand statt mit Annahmen).

## Phase 1 — Backend-Fundament & Versiegelungs-Kern

**Plan:** [2026-08-03-phase-1-fundament.md](2026-08-03-phase-1-fundament.md) ✅ erstellt

Supabase-Projekt (lokal via CLI), komplettes Datenbankschema als Migrationen, Row-Level-Security-Policies inklusive Versiegelung, Zähler-Funktion, automatisierte Policy-Tests (pgTAP).

**Deliverable:** `supabase test db` grün — die Versiegelung ist bewiesen: kein Mitglied liest vor dem Reveal irgendeinen Beitrag, auch nicht die eigenen.

## Phase 2 — App-Grundgerüst & Auth

Expo-App (TypeScript strict, expo-router), Supabase-Client, Login mit Apple/Google und SMS-OTP, Account-Verknüpfung, Profil-Onboarding (Username, Anzeigename), Session-Handling.

**Deliverable:** Auf Simulator und Gerät einloggen, Profil anlegen, eingeloggt bleiben.

## Phase 3 — Trips & Invites

Trip erstellen/bearbeiten, Invite-Link + QR-Code, Deep Linking (Link → App/Store), Edge Function `redeem-invite`, Mitgliederliste, Mitglied entfernen / Trip verlassen.

**Deliverable:** Zwei echte Accounts teilen sich einen Trip über einen Invite-Link.

## Phase 4 — Kamera & Upload-Queue

Kamera-first UI (react-native-vision-camera), Foto/Video ≤ 30 s, Caption-Overlay, GPS + Ortsname, On-Device-Kompression, lokale neustart-feste Upload-Queue mit Retry/Backoff und «nur WLAN»-Option, Edge Function für signierte R2-Upload-URLs, Zähler-Ansicht («Du hast 23 Momente eingefangen»).

**Deliverable:** Aufnahme → versiegelt → landet komprimiert in R2 + Postgres, auch nach Offline-Phasen.

## Phase 5 — Reveal & Recap

Edge Function `reveal-trip` + Push an alle (Expo Push), Story-Player (tippen = weiter, halten = Pause), Tages-Gruppierung («Tag 3 · Lissabon»), Autor/Zeit/Ort-Einblendung, Emoji-Reaktionen, Kommentare, Nachzügler-Uploads.

**Deliverable:** Der komplette Kern-Loop funktioniert: aufnehmen → reveal → gemeinsamer Recap.

## Phase 6 — Teilen, Export & Store-Readiness

Share-Links (Edge Function + schreibgeschützter Web-Player via Expo Web), Export in die Galerie, Beitrag melden, Account-Löschung, Sentry, EAS Build + Submit, Store-Assets, Privacy Policy, TestFlight-Beta mit eigenem Reise-Testlauf.

**Deliverable:** Einreichbare Builds für App Store und Play Store.

## Abhängigkeiten

Die Phasen bauen linear aufeinander auf (1 → 2 → 3 → 4 → 5 → 6). Innerhalb von Phase 4–6 gibt es Parallelisierungs-Spielraum für zwei Personen (z.B. Queue vs. Kamera-UI, Web-Player vs. Store-Assets).
