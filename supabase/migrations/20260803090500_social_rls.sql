alter table public.reactions   enable row level security;
alter table public.comments    enable row level security;
alter table public.share_links enable row level security;
alter table public.reports     enable row level security;

-- Sichtbarkeit eines Posts (= Mitglied + Trip revealed) als wiederverwendbare Regel
create or replace function public.can_see_post(p_post_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    join public.trips t on t.id = p.trip_id
    where p.id = p_post_id
      and t.status = 'revealed'
      and public.is_trip_member(p.trip_id, auth.uid())
  );
$$;

-- reactions: lesen/reagieren nur auf sichtbare Posts, nur im eigenen Namen
create policy reactions_select on public.reactions
  for select using (public.can_see_post(post_id));
create policy reactions_insert on public.reactions
  for insert with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy reactions_delete_own on public.reactions
  for delete using (user_id = auth.uid());

-- comments: gleiches Prinzip; löschen darf der Verfasser
create policy comments_select on public.comments
  for select using (public.can_see_post(post_id));
create policy comments_insert on public.comments
  for insert with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy comments_delete_own on public.comments
  for delete using (user_id = auth.uid());

-- share_links: ausschliesslich der Trip-Owner, nur für revealed Trips.
-- Öffentliche Auflösung eines Tokens läuft NIE über diese Tabelle direkt,
-- sondern über eine Edge Function mit Service-Role (Phase 6).
create policy share_links_all_owner on public.share_links
  for all using (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid()
              and t.status = 'revealed')
  );

-- reports: melden kann jedes Mitglied (nur sichtbare Posts, eigener Name);
-- lesen darf sie der Trip-Owner (Moderation)
create policy reports_insert on public.reports
  for insert with check (reporter_id = auth.uid() and public.can_see_post(post_id));
create policy reports_select_owner on public.reports
  for select using (
    exists (
      select 1 from public.posts p
      join public.trips t on t.id = p.trip_id
      where p.id = post_id and t.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- Ergänzung ohne Brief-Deckung (siehe task-4-report.md / task-5-report.md,
-- Abschnitt Deviations): Dieses Supabase-Postgres-Image vergibt KEINE
-- Default-DML-Grants für authenticated/anon auf neue Tabellen (verifiziert
-- bereits in Task 4/5). Ohne die folgenden Grants sind obige Policies
-- unerreichbar: jede Operation scheitert am fehlenden Tabellen-Privileg
-- ("permission denied for table ..."), bevor RLS überhaupt ausgewertet wird.
-- Diese Grants ändern KEINE Policy-Logik — sie schalten lediglich frei, was
-- die Policies oben ohnehin bereits erlauben/einschränken. Minimal, exakt was
-- die Brief-Policies implizieren:
--   reactions:   select, insert, delete   (keine Update-Policy vorgesehen)
--   comments:    select, insert, delete   (keine Update-Policy vorgesehen)
--   share_links: select, insert, update, delete (eine "for all"-Policy deckt
--                alle vier Operationen ab; owner-scoped bleibt durch die
--                Policy selbst erzwungen, das Grant öffnet nur die Tabelle)
--   reports:     insert, select           (keine Update/Delete-Policy vorgesehen)
-- Nichts für anon.
grant select, insert, delete on public.reactions to authenticated;
grant select, insert, delete on public.comments to authenticated;
grant select, insert, update, delete on public.share_links to authenticated;
grant select, insert on public.reports to authenticated;
