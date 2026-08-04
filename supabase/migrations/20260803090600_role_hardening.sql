-- ============================================================================
-- Rollen-Kontrakt
-- ----------------------------------------------------------------------------
--   anon:          nichts. Keine Tabellen-Privilegien, kein EXECUTE auf die
--                  Membership-/Sichtbarkeits-Funktionen (kein "Orakel", das
--                  Mitgliedschaften oder Sichtbarkeit vor dem Reveal verrät).
--   authenticated: ausschliesslich policy-geführt. Zugriff läuft über die RLS-
--                  Policies der bisherigen Migrationen; explizit KEIN UPDATE
--                  auf posts (unveränderlich) und keine geschützten Spalten
--                  (posts.created_at/upload_status, trips.status/revealed_at/
--                  invite_code/plan bleiben serverseitige Vertrauensanker).
--   service_role:  volle DML auf allen 8 Tabellen. RLS wird von service_role
--                  ohnehin umgangen (BYPASSRLS) — die Absicherung liegt NICHT
--                  in der DB, sondern ausschliesslich im Edge-Function-Code
--                  (Phasen 3–6), der als service_role läuft.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. [Critical] service_role-Grants: volle DML auf allen 8 Tabellen.
-- Ohne diese Grants scheitert jeder Edge-Function-Zugriff (Phasen 3–6) bereits
-- am fehlenden Tabellen-Privileg, da dieses Supabase-Image keine Default-DML-
-- Grants vergibt — auch nicht für service_role.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on
  public.profiles,
  public.trips,
  public.trip_members,
  public.posts,
  public.reactions,
  public.comments,
  public.share_links,
  public.reports
to service_role;

-- ----------------------------------------------------------------------------
-- 2. [Important] posts-Spalten-Grant: created_at/upload_status sind
-- serverseitige Vertrauensanker (Einsende-Zeitpunkt bzw. Upload-Bestätigung
-- durch die Upload-Edge-Function, Phase 4) und dürfen von Clients beim Insert
-- NIE gesetzt werden — sonst könnten Clients ihre eigene Chronologie fälschen
-- oder Posts als "uploaded" vortäuschen, bevor die Datei tatsächlich liegt.
-- ----------------------------------------------------------------------------
revoke insert on public.posts from authenticated;
grant insert (
  id, trip_id, author_id, type, storage_key, thumb_key, duration_s,
  caption, captured_at, captured_tz, lat, lng, place_name
) on public.posts to authenticated;

-- ----------------------------------------------------------------------------
-- 3. [Important] Video-Dauer-Pflicht: ein Video OHNE duration_s war bisher
-- erlaubt (die alte Check-Constraint prüfte die Grenze nur, wenn duration_s
-- gesetzt war). Ein Video MUSS eine Dauer tragen, sonst kann die Upload-
-- Pipeline (Phase 4) das clientseitige Zeitlimit nicht serverseitig
-- verifizieren.
-- ----------------------------------------------------------------------------
alter table public.posts drop constraint posts_duration_s_check;
alter table public.posts add constraint posts_duration_s_check check (
  (type <> 'video' or (duration_s is not null and duration_s between 0 and 30))
  and (duration_s is null or duration_s between 0 and 30)
);

-- ----------------------------------------------------------------------------
-- 4. [Important] Funktions-EXECUTE einschränken: is_trip_member/
-- shares_trip_with/can_see_post/my_post_count sind SECURITY DEFINER und daher
-- standardmässig auch für PUBLIC (also auch anon) ausführbar — als direkter
-- RPC-Aufruf verraten sie z.B. "ist Nutzer X Mitglied von Trip Y", auch ohne
-- jede Tabellen-Sichtbarkeit. Das ist das "Mitgliedschafts-Orakel", das hier
-- geschlossen wird: nur authenticated (für die eigenen Policies) und
-- service_role (Edge Functions) dürfen sie aufrufen.
-- ----------------------------------------------------------------------------
revoke execute on function public.is_trip_member(uuid, uuid) from public;
grant execute on function public.is_trip_member(uuid, uuid) to authenticated, service_role;

revoke execute on function public.shares_trip_with(uuid) from public;
grant execute on function public.shares_trip_with(uuid) to authenticated, service_role;

revoke execute on function public.can_see_post(uuid) from public;
grant execute on function public.can_see_post(uuid) to authenticated, service_role;

revoke execute on function public.my_post_count(uuid) from public;
grant execute on function public.my_post_count(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. [Important] Owner-FK explizit auf RESTRICT (war zuvor die implizite
-- Default-Aktion NO ACTION — funktional identisch, aber hier bewusst
-- dokumentiert statt zufällig).
-- ----------------------------------------------------------------------------
alter table public.trips drop constraint trips_owner_id_fkey;
alter table public.trips add constraint trips_owner_id_fkey
  foreign key (owner_id) references public.profiles (id) on delete restrict;

comment on constraint trips_owner_id_fkey on public.trips is
  'Account-Löschung eines Owners läuft in Phase 6 über eine Edge Function, die Trips zuerst überträgt oder löscht — DB blockiert bewusst.';

-- ----------------------------------------------------------------------------
-- 6. [Important] invite_code-Rotation: entfernte/ausgetretene Mitglieder
-- behalten keinen gültigen Code. Ohne Rotation könnte ein aus einem Trip
-- entferntes Mitglied (oder wer den Code kannte) sich mit dem alten
-- invite_code erneut Zugang verschaffen.
-- ----------------------------------------------------------------------------
create or replace function public.rotate_invite_code_on_member_removal()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.trips
  set invite_code = encode(gen_random_bytes(6), 'hex')
  where id = old.trip_id;
  return old;
end $$;

comment on function public.rotate_invite_code_on_member_removal() is
  'Entfernte/ausgetretene Mitglieder behalten keinen gültigen Code — rotiert trips.invite_code nach jedem Delete auf trip_members.';

create trigger trip_members_rotate_invite_code
  after delete on public.trip_members
  for each row execute function public.rotate_invite_code_on_member_removal();

-- ----------------------------------------------------------------------------
-- 7. [Minor] TRUNCATE/TRIGGER/REFERENCES entziehen: dieses Supabase-Image
-- vergibt keine Default-DML-Grants, aber TRUNCATE/TRIGGER/REFERENCES waren
-- (siehe Kommentare in Migration 090200) bereits standardmässig an
-- anon/authenticated vergeben. Diese drei Privilegien sind für Clients nie
-- vorgesehen — TRUNCATE würde ganze Tabellen leeren, TRIGGER/REFERENCES
-- erlauben DDL-artige Eingriffe.
-- ----------------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. [Minor] Index für comments-Lookup nach Post (analog zu
-- posts_trip_captured_idx und trip_members_user_idx — comments_select/
-- comments_insert/reports_select_owner filtern regelmässig nach post_id).
-- ----------------------------------------------------------------------------
create index comments_post_idx on public.comments (post_id);

-- ============================================================================
-- 9. Dokumentation (kein Code, nur Kommentare)
-- ----------------------------------------------------------------------------
-- (a) trips.status = 'archived' versiegelt Posts erneut: posts_select_revealed
--     Members verlangt "t.status = 'revealed'" exakt — ein archivierter Trip
--     erfüllt das nicht mehr, Mitglieder verlieren also wieder den Zugriff auf
--     die Posts. Das ist eine bewusste V1-Entscheidung (Spec §4): "archived"
--     ist als zukünftiger Zustand im Enum vorgesehen, aber KEIN Codepfad in
--     Phase 1–7 setzt ihn je. Sollte ein späterer Edge-Function-Codepfad
--     Trips archivieren, muss zuerst geklärt werden, ob Posts dann weiterhin
--     lesbar bleiben sollen (vermutlich ja) — dafür braucht es dann eine
--     eigene Select-Policy-Erweiterung, keine stillschweigende Annahme.
--
-- (b) Hinweis für App-/Edge-Function-Code: `.insert()` auf posts NIE mit
--     `.select()` bzw. RETURNING verketten, solange der Trip noch nicht
--     revealed ist. Bei `.insert().select()` wird das GESAMTE Statement
--     zurückgerollt (Postgres-Atomarität pro Statement): INSERT gelingt
--     zwar initial (posts_insert_member erlaubt ihn), aber das implizite
--     RETURNING liest die soeben eingefügte Zeile über die Select-Policy
--     zurück — posts_select_revealed_members verlangt "status = 'revealed'",
--     und der Policy-Check schlägt mit 42501 fehl. Daraufhin wird die
--     GESAMTE Transaktion zurückgerollt — der Post ist NICHT gespeichert.
--     Clients müssen `.insert()` OHNE .select()/RETURNING ausführen und die
--     Werte lokal vorhalten, sonst geht der Moment des Users verloren.
-- ============================================================================
