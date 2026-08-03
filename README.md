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
