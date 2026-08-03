alter table public.posts enable row level security;

-- DIE Kernregel des Produkts: Lesen erst nach dem Reveal, nur für Mitglieder.
-- Es gibt bewusst KEINE weitere Select-Policy — dadurch liest vor dem Reveal
-- niemand irgendeinen Post, auch der Autor nicht (Spec §4 «Filmrolle»).
create policy posts_select_revealed_members on public.posts
  for select using (
    public.is_trip_member(trip_id, auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.status = 'revealed'
    )
  );

-- Einsenden: nur Mitglieder, nur im eigenen Namen.
-- Aktive Reise: immer. Nach Reveal: nur Nachzügler (Aufnahme lag vor dem Reveal).
create policy posts_insert_member on public.posts
  for insert with check (
    author_id = auth.uid()
    and public.is_trip_member(trip_id, auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and (t.status = 'active'
             or (t.status = 'revealed' and captured_at <= t.revealed_at))
    )
  );

-- Löschen nach Reveal: Autor den eigenen Post, Owner jeden (Moderation).
create policy posts_delete_after_reveal on public.posts
  for delete using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and t.status = 'revealed'
        and (posts.author_id = auth.uid() or t.owner_id = auth.uid())
    )
  );

-- Kein Update-Zugriff für Clients: Posts sind unveränderlich
-- (upload_status setzt die Upload-Edge-Function mit Service-Role, Phase 4)
revoke update on public.posts from authenticated;

-- ============================================================================
-- Ergänzung ohne Brief-Deckung (siehe task-4-report.md / task-5-report.md,
-- Abschnitt Deviations): Dieses Supabase-Postgres-Image vergibt KEINE
-- Default-DML-Grants für authenticated/anon auf neue Tabellen (verifiziert
-- bereits in Task 4). Ohne die folgenden Grants sind obige Policies
-- unerreichbar: jede Operation scheitert am fehlenden Tabellen-Privileg
-- ("permission denied for table posts"), bevor RLS überhaupt ausgewertet
-- wird. Diese Grants ändern KEINE Policy-Logik — sie schalten lediglich
-- frei, was die Policies oben ohnehin bereits erlauben/einschränken.
-- Die Policies implizieren genau SELECT, INSERT, DELETE für authenticated;
-- KEIN UPDATE-Grant (das obige "revoke update" bleibt bewusst wirksam).
-- Nichts für anon.
grant select, insert, delete on public.posts to authenticated;
