-- Security-Definer-Helper: bricht die RLS-Rekursion auf trip_members
create or replace function public.is_trip_member(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = p_user_id
  );
$$;

create or replace function public.shares_trip_with(p_other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.trip_members me
    join public.trip_members other on other.trip_id = me.trip_id
    where me.user_id = auth.uid() and other.user_id = p_other
  );
$$;

-- Owner wird bei Trip-Erstellung automatisch Mitglied
create or replace function public.add_owner_membership()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger trips_add_owner_membership
  after insert on public.trips
  for each row execute function public.add_owner_membership();

alter table public.profiles     enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_members enable row level security;

-- profiles: eigenes Profil verwalten; Mitreisende sehen
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());
create policy profiles_select_own_or_shared on public.profiles
  for select using (id = auth.uid() or public.shares_trip_with(id));

-- trips: Mitglieder lesen; nur Owner erstellt/ändert/löscht
create policy trips_select_member on public.trips
  for select using (public.is_trip_member(id, auth.uid()));
create policy trips_insert_owner on public.trips
  for insert with check (owner_id = auth.uid());
create policy trips_update_owner on public.trips
  for update using (owner_id = auth.uid());
create policy trips_delete_owner on public.trips
  for delete using (owner_id = auth.uid());

-- Status/revealed_at/invite_code/plan sind für Clients schreibgeschützt:
-- Tabellen-Grant entziehen, nur harmlose Spalten freigeben
revoke update on public.trips from authenticated;
grant update (name, cover_key, start_date, end_date) on public.trips to authenticated;

-- trip_members: Mitglieder sehen die Liste; beitreten NUR via Edge Function
-- (Service-Role, Phase 3) oder Owner-Trigger, darum keine Insert-Policy.
create policy trip_members_select_member on public.trip_members
  for select using (public.is_trip_member(trip_id, auth.uid()));
-- Verlassen (selbst, ausser Owner) oder Entfernen (durch Owner)
create policy trip_members_delete on public.trip_members
  for delete using (
    (user_id = auth.uid() and role <> 'owner')
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.owner_id = auth.uid() and user_id <> t.owner_id
    )
  );

-- ============================================================================
-- Ergänzung ohne Brief-Deckung (siehe task-4-report.md, Abschnitt Deviations):
-- Dieses Supabase-Postgres-Image (17.6.1.156, lokal) gewährt neu angelegten
-- Tabellen standardmässig NUR REFERENCES/TRIGGER/TRUNCATE an anon/authenticated
-- (verifiziert via pg_default_acl und einer Test-Tabelle), SELECT/INSERT/
-- UPDATE/DELETE fehlen ohne explizites GRANT. Ohne die folgenden Grants sind
-- die obigen Policies unerreichbar: jede Operation scheitert bereits am
-- fehlenden Tabellen-Privileg ("permission denied for table ..."), bevor RLS
-- überhaupt ausgewertet wird. Diese Grants ändern KEINE Policy-Logik, sie
-- schalten lediglich frei, was die Policies oben ohnehin bereits erlauben/
-- einschränken. Spalten-Restriktion bei trips-Insert folgt demselben Prinzip
-- wie beim bestehenden Update-Grant (Status/revealed_at/invite_code/plan
-- bleiben client-seitig nicht direkt setzbar).
grant select, insert, update on public.profiles to authenticated;

grant select on public.trips to authenticated;
grant insert (id, name, cover_key, start_date, end_date, owner_id) on public.trips to authenticated;
grant delete on public.trips to authenticated;

grant select, delete on public.trip_members to authenticated;
