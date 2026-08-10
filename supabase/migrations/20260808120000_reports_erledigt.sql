-- ============================================================================
-- reports.erledigt_am: eine Meldung wird erledigt, nicht gelöscht.
-- ----------------------------------------------------------------------------
-- «Meldung verwerfen» (Task 8, Phase 6) braucht ein Update-Recht, das es
-- bisher nicht gibt, reports hat für authenticated nur select, insert
-- (20260803090500_social_rls.sql). Ein DELETE wäre der naheliegendere Weg,
-- ist aber bewusst NICHT der gewählte: eine gelöschte Meldung ist für eine
-- spätere Rechenschaft wertlos, wer hat wann was gemeldet, und hat die
-- Owner-Person es überhaupt je gesehen? Eine Spalte erhält diese Spur.
-- NULL heisst offen, ein Zeitstempel heisst erledigt.
-- ============================================================================
alter table public.reports add column erledigt_am timestamptz;

-- Nur die Owner-Person der zugehörigen Reise darf erledigt_am setzen,
-- dieselbe Owner-über-post_id-Bedingung wie reports_select_owner
-- (20260803090500_social_rls.sql). using UND with check tragen dieselbe
-- Bedingung: using entscheidet, welche Zeile für ein Update überhaupt
-- sichtbar ist, with check verhindert, dass eine erlaubte Zeile in eine
-- unerlaubte verwandelt wird (hier irrelevant, da post_id ohnehin nicht
-- schreibbar ist, siehe Spalten-Grant unten, aber explizit statt implizit).
create policy reports_update_owner on public.reports
  for update using (
    exists (
      select 1 from public.posts p
      join public.trips t on t.id = p.trip_id
      where p.id = post_id and t.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.posts p
      join public.trips t on t.id = p.trip_id
      where p.id = post_id and t.owner_id = auth.uid()
    )
  );

-- Spalten-Grant NUR auf erledigt_am (Muster: posts.created_at/upload_status
-- in 20260803090600_role_hardening.sql). reason, post_id und reporter_id
-- bleiben für JEDE Rolle inklusive der Owner-Person unveränderlich, sonst
-- könnte die Owner-Person eine Meldung nachträglich verfälschen statt sie nur
-- abzuhaken. Ein Tabellen-Grant "update on public.reports" würde das nicht
-- verhindern, da die RLS-Policy oben nur WELCHE Zeile prüft, nicht WELCHE
-- Spalte, die Spalten-Beschränkung kommt ausschliesslich aus diesem Grant.
grant update (erledigt_am) on public.reports to authenticated;
