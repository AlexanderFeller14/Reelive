-- Profilbild (Spec 2026-08-12-profilbild-design.md, §4.3).
--
-- Zwei Policy-Gruppen, ein Test: die Pfadbindung von profiles.avatar_key und
-- die Ordnerbindung auf storage.objects. Beide sagen dasselbe («nur der eigene
-- Ordner»), einmal in der Profilzeile und einmal am Objekt, und genau ihr
-- Zusammenspiel ist der Schutz: ohne die erste liesse sich ein fremdes Bild als
-- eigenes ausgeben, ohne die zweite ein fremdes überschreiben.
create extension if not exists pgtap with schema extensions;
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna');
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

-- --- profiles.avatar_key ---------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$update public.profiles
      set avatar_key = 'profiles/00000000-0000-0000-0000-00000000000a/abc123.jpg'
      where id = '00000000-0000-0000-0000-00000000000a'$$,
  'eigener Pfad im eigenen avatar_key geht'
);

-- Der wichtigste Fall: Bens Ordner in Annas Zeile. Ohne with check ginge das
-- durch, weil `using` nur die alte Zeile ansieht.
select throws_ok(
  $$update public.profiles
      set avatar_key = 'profiles/00000000-0000-0000-0000-00000000000b/abc123.jpg'
      where id = '00000000-0000-0000-0000-00000000000a'$$,
  '42501',
  null,
  'fremder Ordner im eigenen avatar_key scheitert'
);

select throws_ok(
  $$update public.profiles
      set avatar_key = 'covers/norwegen.jpg'
      where id = '00000000-0000-0000-0000-00000000000a'$$,
  '42501',
  null,
  'Pfad ohne profiles/-Praefix scheitert'
);

select lives_ok(
  $$update public.profiles
      set avatar_key = null
      where id = '00000000-0000-0000-0000-00000000000a'$$,
  'avatar_key auf null zuruecksetzen geht (Bild entfernen)'
);

-- profiles_insert_own: die bisherigen Inserts oben (Anna, Ben) liessen
-- avatar_key auf NULL und prüften damit nur den `is null`-Zweig des with
-- check. Carla legt ihr Profil mit einem fremden Pfad an (Annas Ordner) — der
-- zweite Zweig (`avatar_key like 'profiles/' || auth.uid() || '/%'`) muss
-- das beim INSERT genauso verhindern wie profiles_update_own es beim UPDATE
-- tut.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$insert into public.profiles (id, username, display_name, avatar_key)
      values ('00000000-0000-0000-0000-00000000000c', 'carla', 'Carla',
              'profiles/00000000-0000-0000-0000-00000000000a/hack.jpg')$$,
  '42501',
  null,
  'fremder Pfad im avatar_key beim Insert scheitert'
);

-- --- storage.objects -------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
      values ('avatare',
              'profiles/00000000-0000-0000-0000-00000000000a/abc123.jpg',
              '00000000-0000-0000-0000-00000000000a')$$,
  'Objekt im eigenen Ordner anlegen geht'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
      values ('avatare',
              'profiles/00000000-0000-0000-0000-00000000000b/fremd.jpg',
              '00000000-0000-0000-0000-00000000000a')$$,
  '42501',
  null,
  'Objekt im fremden Ordner anlegen scheitert'
);

-- avatare_update_own ist die Policy hinter der eigentlichen Bedrohung, gegen
-- die diese Migration steht: ein fremdes Avatarbild überschreiben. Genau
-- diesen Pfad nimmt auch ein Upload mit `upsert: true` (Storage-API), der
-- intern ein UPDATE auf eine bestehende Zeile absetzt. Geprüft wird wieder
-- die ANZAHL, nicht eine Ausnahme, aus demselben Grund wie beim DELETE unten:
-- ein UPDATE ohne passende Policy trifft schlicht keine Zeile.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
with aktualisiert as (
  update storage.objects
    set name = 'profiles/00000000-0000-0000-0000-00000000000a/pwned.jpg'
    where bucket_id = 'avatare'
      and name = 'profiles/00000000-0000-0000-0000-00000000000a/abc123.jpg'
    returning 1
)
select is((select count(*)::int from aktualisiert), 0,
  'fremdes Objekt umbenennen trifft keine Zeile');

-- avatare_select_authenticated: jetzt auf authenticated beschränkt (Review-
-- Finding: anon-Lesen erlaubte das Auflisten aller Objektnamen und damit
-- aller user_id, genau das, was der unratbare Schlüssel verhindern soll). Der
-- öffentliche Lesepfad über die Storage-API bleibt davon unberührt (siehe
-- Task-1-Fix-Report für den curl-Nachweis) — hier wird nur das SQL-Select auf
-- storage.objects geprüft, also das Listing.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatare'),
  1,
  'authenticated liest das Objekt'
);

select pg_temp.as_anon();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatare'),
  0,
  'anon liest keine Zeile, kann storage.objects also nicht auflisten'
);

-- Ben darf Annas Objekt nicht wegräumen. Geprüft wird die ANZAHL, nicht eine
-- Ausnahme: ein DELETE ohne passende Policy trifft schlicht null Zeilen und
-- wirft nicht. Ein Test auf throws_ok wäre hier grün-durch-Irrtum.
--
-- Diese lokale Storage-Version bringt einen eigenen Guard mit (Migration
-- `prevent-direct-deletes`, Trigger storage.protect_objects_delete): JEDES
-- direkte SQL-DELETE auf storage.objects scheitert, unabhängig von RLS, ausser
-- die Session erlaubt es explizit. Gedacht ist das gegen Löschungen an der
-- Storage-API vorbei; pgTAP spricht aber direkt SQL. Also hier bewusst
-- freigeschaltet, damit wie in der Spec gemeint allein RLS über 0 oder 1
-- Zeile entscheidet, nicht der Guard.
select set_config('storage.allow_delete_query', 'true', true);

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
with geloescht as (
  delete from storage.objects
    where bucket_id = 'avatare'
      and name = 'profiles/00000000-0000-0000-0000-00000000000a/abc123.jpg'
    returning 1
)
select is((select count(*)::int from geloescht), 0,
  'fremdes Objekt loeschen trifft keine Zeile');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
with geloescht as (
  delete from storage.objects
    where bucket_id = 'avatare'
      and name = 'profiles/00000000-0000-0000-0000-00000000000a/abc123.jpg'
    returning 1
)
select is((select count(*)::int from geloescht), 1,
  'eigenes Objekt loeschen trifft genau eine Zeile');

select * from finish();
rollback;
