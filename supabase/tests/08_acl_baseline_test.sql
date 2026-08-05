create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

-- MAINTAIN (PG17) wurde in Migration 090600 nicht miterfasst — jetzt entzogen
select is(has_table_privilege('anon', 'public.posts', 'MAINTAIN'), false,
  'anon hat kein MAINTAIN auf posts');
select is(has_table_privilege('authenticated', 'public.posts', 'MAINTAIN'), false,
  'authenticated hat kein MAINTAIN auf posts');
select is(has_table_privilege('authenticated', 'public.trips', 'MAINTAIN'), false,
  'authenticated hat kein MAINTAIN auf trips');

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
