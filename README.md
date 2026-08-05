# Reelive

Gemeinsames Reisetagebuch: privates Reiseprojekt, Freunde einladen, spontane
Foto-/Videomomente einsenden — versiegelt bis zum Reveal. Nach der Reise ein
chronologischer Recap aus allen Perspektiven.

Design-Spec: docs/superpowers/specs/2026-08-03-reelive-design.md
Roadmap: docs/superpowers/plans/2026-08-03-reelive-v1-roadmap.md

## Entwicklung (Backend)

Voraussetzungen: Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`)

```bash
supabase start        # lokale Instanz (API :54321, DB :54322, Studio :54323)
supabase db reset     # Migrationen neu einspielen
supabase test db      # pgTAP-Tests (RLS-Policies!) ausführen
```

Regel: Schema-Änderungen NUR über Migrationen in `supabase/migrations/`.
Jede RLS-Policy braucht Tests in `supabase/tests/`.

## Entwicklung (App)

Voraussetzungen: Node ≥ 20, Expo Go auf dem Gerät (App Store / Play Store)

```bash
cd mobile
cp .env.example .env   # URL + Anon-Key eintragen (siehe supabase status)
npm install
npx expo start         # QR-Code für Expo Go; i = iOS-Simulator, a = Android-Emulator
npm test               # Jest
```

Login lokal: Testnummern `+41 79 000 00 01` / `…02`, Code jeweils `123456`
(supabase/config.toml → [auth.sms.test_otp]).
