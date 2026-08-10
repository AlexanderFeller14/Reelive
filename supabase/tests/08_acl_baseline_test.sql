create extension if not exists pgtap with schema extensions;
begin;
select plan(4);

-- MAINTAIN (PG17) wurde in Migration 090600 nicht miterfasst, jetzt entzogen.
-- Bewusst über ALLE acht Tabellen und beide Client-Rollen statt über zwei
-- Stichproben: der Entzug in 20260804090000 läuft über `all tables in schema
-- public`, und genau das soll hier belegt werden, sonst fällt eine später
-- hinzugekommene Tabelle durch das Raster.
select is(
  (select count(*)::int
     from (values ('profiles'), ('trips'), ('trip_members'), ('posts'),
                  ('reactions'), ('comments'), ('share_links'), ('reports')) as t(name),
          (values ('anon'), ('authenticated')) as r(rolle)
    where has_table_privilege(r.rolle, 'public.' || t.name, 'MAINTAIN')),
  0,
  'weder anon noch authenticated hat MAINTAIN auf einer der acht Tabellen');

-- Default-ACL bereinigt: eine NEUE Tabelle erbt keinerlei Grants an Client-Rollen
create table public.acl_probe (x int);
select is(has_table_privilege('anon', 'public.acl_probe', 'TRUNCATE'), false,
  'neue Tabelle: anon erbt kein TRUNCATE');
select is(has_table_privilege('authenticated', 'public.acl_probe', 'TRIGGER'), false,
  'neue Tabelle: authenticated erbt kein TRIGGER');
select is(has_table_privilege('authenticated', 'public.acl_probe', 'MAINTAIN'), false,
  'neue Tabelle: authenticated erbt kein MAINTAIN');

select * from finish();
rollback;
