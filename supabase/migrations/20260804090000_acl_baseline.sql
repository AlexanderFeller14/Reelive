-- ----------------------------------------------------------------------------
-- ACL-Baseline (Nachtrag aus dem Phase-1-Final-Review):
-- 1. MAINTAIN (neu in PG17) war vom TRUNCATE/TRIGGER/REFERENCES-Entzug in
--    Migration 090600 nicht erfasst — Clients brauchen es nie (enthält u.a.
--    LOCK TABLE).
-- 2. Die Default-ACL dieses Images vergibt an anon/authenticated für JEDE neue
--    Tabelle TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Einmalig bereinigen, damit
--    spätere Phasen mit einer leeren Baseline starten und Grants immer
--    explizit in der jeweiligen Migration stehen.
-- ----------------------------------------------------------------------------
revoke maintain on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger, maintain
  on tables from anon, authenticated;
