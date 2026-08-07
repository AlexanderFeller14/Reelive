-- ============================================================================
-- can_see_post: Archiv-Erweiterung nachziehen
-- ----------------------------------------------------------------------------
-- 20260806120100_counts_and_archived.sql hat posts_select_revealed_members auf
-- status in ('revealed', 'archived') erweitert — Mitglieder verlieren beim
-- Archivieren also NICHT den Zugriff auf die Momente selbst («archiviert
-- heisst weggelegt, nicht zugesperrt»). can_see_post wurde dabei übersehen
-- und prüfte weiterhin nur status = 'revealed'. Ohne diese Nachbesserung
-- wären reactions, comments UND reports (alle drei hängen an can_see_post,
-- siehe 20260803090500_social_rls.sql) für eine archivierte Reise tot,
-- obwohl die Posts selbst lesbar bleiben.
--
-- Signatur, security definer, set search_path und Grants bleiben unverändert:
-- CREATE OR REPLACE FUNCTION ersetzt nur den Funktionskörper und erhält die
-- bestehende ACL aus 20260803090600_role_hardening.sql (EXECUTE für
-- authenticated und service_role, kein PUBLIC/anon) unangetastet.
-- ============================================================================
create or replace function public.can_see_post(p_post_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    join public.trips t on t.id = p.trip_id
    where p.id = p_post_id
      and t.status in ('revealed', 'archived')
      and public.is_trip_member(p.trip_id, auth.uid())
  );
$$;
