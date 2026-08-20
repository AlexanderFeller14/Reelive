# Reelive

Gemeinsames Reisetagebuch: privates Reiseprojekt, Freunde einladen, Momente einsenden,
versiegelt bis zum Reveal, danach chronologischer Recap aus allen Perspektiven.

## Pflichtlektüre nach Aufgabe

- **Frontend/UI (Code ODER Mockups): Lies zuerst `DESIGN-LANGUAGE.md` und halte dich
  strikt daran.** Sie schlägt Framework-Defaults und eigenen Geschmack.
- Produkt/Features: `docs/superpowers/specs/2026-08-03-reelive-design.md` (freigegebene Spec)
- Reihenfolge der Umsetzung: `docs/superpowers/plans/2026-08-03-reelive-v1-roadmap.md`
- Screens/UX-Referenz: `docs/reelive-app-konzept.md` + `docs/design/referenz-mockup.png`

## Eckpfeiler (nicht neu verhandeln)

- Stack: Expo/React Native (TypeScript strict), Supabase (EU), Cloudflare R2, EAS
- Die Versiegelung wird serverseitig erzwungen (RLS + signierte URLs), nie nur in der UI
- Beiträge sortieren IMMER nach `captured_at` (Gerätezeit), nie nach Upload-Zeit
- Schema-Änderungen nur über Migrationen in `supabase/migrations/`; jede RLS-Policy
  bekommt pgTAP-Tests in `supabase/tests/`
- UI-Sprache Deutsch (Du-Form), Vokabular gemäss DESIGN-LANGUAGE.md §6
- Quellcode ist englisch: Bezeichner, Datei- und Ordnernamen, Kommentare und
  Testbeschreibungen. Nur sichtbare UI-Texte sind deutsch (Du-Form, Vokabular
  gemäss DESIGN-LANGUAGE.md §6). Persistente Keys, Wire-Felder und Log-Texte
  zählen zum Code. Stehende Ausnahmen: DB-Spalten, die historisch deutsch
  sind (SQLite-Queue-Spalten), und frei erfundene Testfixture-Werte ohne
  eigene Bedeutung (z. B. Mock-Fehlertexte).
