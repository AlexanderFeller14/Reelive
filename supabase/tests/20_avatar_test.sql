-- Profilbild (Spec 2026-08-12-profilbild-design.md, §4.3).
--
-- Zwei Policy-Gruppen, ein Test: die Pfadbindung von profiles.avatar_key und
-- die Ordnerbindung auf storage.objects. Beide sagen dasselbe («nur der eigene
-- Ordner»), einmal in der Profilzeile und einmal am Objekt, und genau ihr
-- Zusammenspiel ist der Schutz: ohne die erste liesse sich ein fremdes Bild als
-- eigenes ausgeben, ohne die zweite ein fremdes überschreiben.
create extension if not exists pgtap with schema extensions;
begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
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

-- --- storage.objects -------------------------------------------------------
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
