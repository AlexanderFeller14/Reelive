-- Profilbild (Spec docs/superpowers/specs/2026-08-12-profilbild-design.md).
--
-- profiles.avatar_key gibt es seit 20260803090000_core_tables.sql, beschreibbar
-- seit 20260808150000_leerstrings_und_profil_grants.sql. Geschrieben hat sie
-- bisher kein Codepfad. Diese Migration bindet sie an einen Pfad, der der
-- schreibenden Person gehört, und legt den Bucket an, in dem die Bytes liegen.

-- ---------------------------------------------------------------------------
-- 1. Der Bucket
-- ---------------------------------------------------------------------------
-- Auch in supabase/config.toml deklariert (Limits, MIME-Typen), hier trotzdem
-- ein Insert: config.toml wirkt nur über die lokale CLI. In der Produktion
-- entsteht der Bucket allein durch diese Migration, und die pgTAP-Tests unten
-- brauchen ihn ebenfalls, unabhängig davon, ob die CLI ihn gerade angelegt hat.
insert into storage.buckets (id, name, public)
  values ('avatare', 'avatare', true)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. avatar_key an die eigene uid binden
-- ---------------------------------------------------------------------------
-- profiles_update_own prüft bisher nur `using`, also die ALTE Zeile (im
-- Kommentar von 20260808150000 bereits als offene Kante vermerkt). Ohne
-- `with check` könnte jemand einen fremden Pfad in sein avatar_key schreiben
-- und ein fremdes Bild als eigenes führen.
--
-- `id = auth.uid()` steht im with check MIT DRIN, nicht nur im using: sonst
-- prüfte die neue Zeile nur den Pfad und nicht mehr die Identität.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (
      avatar_key is null
      or avatar_key like 'profiles/' || auth.uid()::text || '/%'
    )
  );

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert
  with check (
    id = auth.uid()
    and (
      avatar_key is null
      or avatar_key like 'profiles/' || auth.uid()::text || '/%'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. RLS auf den Objekten
-- ---------------------------------------------------------------------------
-- storage.foldername('profiles/<uid>/abc.jpg') liefert {profiles,<uid>}, also
-- ist [1] der feste Namensraum und [2] die Person. Beides wird geprüft: ohne
-- [1] liesse sich derselbe Ordnername auf oberster Ebene erfinden.
create policy avatare_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatare'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy avatare_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatare'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy avatare_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatare'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Lesen für alle. Der Bucket ist öffentlich, das Objekt ginge also ohnehin über
-- den public-Pfad heraus; die Policy hält den Zustand auch dann, wenn der
-- Bucket später auf privat gestellt würde.
create policy avatare_select_alle on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatare');
