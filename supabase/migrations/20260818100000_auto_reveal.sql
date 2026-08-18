-- ============================================================================
-- Auto-Reveal (Spec docs/superpowers/specs/2026-08-18-auto-reveal-design.md):
-- eine Reise wird am Tag nach ihrem Enddatum automatisch aufgedeckt, die
-- Owner-Person bekommt am Morgen des letzten Tags eine Erinnerung.
-- Drei Bausteine:
--   1. trips.end_reminder_sent_at: Marker, dass die Erinnerung raus ist
--      (CAS auf «is null» in der Edge Function, ein doppelter Cron-Lauf
--      schickt nichts doppelt).
--   2. rufe_reveal_zeitplan(aufgabe): liest projekt_url/cron_geheimnis aus
--      dem Vault und stösst die Edge Function reveal-zeitplan per pg_net an.
--      Die Secrets liegen NICHT in dieser Datei, das Einrichten pro Umgebung
--      beschreibt supabase/README.md.
--   3. Zwei pg_cron-Jobs zu festen UTC-Zeiten (pg_cron kennt keine
--      Zeitzonen): 23:10 UTC liegt ganzjährig nach Zürcher Mitternacht
--      (00:10 im Winter, 01:10 im Sommer), 07:30 UTC ganzjährig am Zürcher
--      Morgen (08:30/09:30).
-- Der Kalendertag «heute» wird HIER in SQL berechnet (Europe/Zurich) und der
-- Function im Body mitgegeben: so hängt die Fällig-Entscheidung an derselben
-- einen Uhr, der des DB-Servers, die auch revealed_at schreibt
-- (revealStore.ts, Sonderwert 'now'), statt zusätzlich an der Uhr des
-- Deno-Hosts.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.trips add column end_reminder_sent_at timestamptz;

comment on column public.trips.end_reminder_sent_at is
  'Wann die Erinnerung «Heute ist der letzte Tag» an die Owner-Person rausging; gesetzt nur von der Edge Function reveal-zeitplan (Service-Role, CAS auf is null). Der spaltenweise Update-Grant für authenticated (20260803090200) nimmt die Spalte bewusst nicht auf.';

create or replace function public.rufe_reveal_zeitplan(aufgabe text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  projekt_url text;
  geheimnis   text;
begin
  select decrypted_secret into projekt_url
    from vault.decrypted_secrets where name = 'projekt_url';
  select decrypted_secret into geheimnis
    from vault.decrypted_secrets where name = 'cron_geheimnis';

  -- Warnung statt Exception: eine fehlende Konfiguration soll im Log
  -- auffallen, aber keinen dauerhaft roten Job-Verlauf erzeugen; der
  -- nächste Lauf nach dem Einrichten holt alles nach (der Reveal fragt
  -- end_date < heute ab, nicht end_date = gestern).
  if projekt_url is null or geheimnis is null then
    raise warning 'rufe_reveal_zeitplan: Vault-Secrets projekt_url/cron_geheimnis fehlen, Aufruf übersprungen.';
    return;
  end if;

  perform net.http_post(
    url     := projekt_url || '/functions/v1/reveal-zeitplan',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-geheimnis', geheimnis
    ),
    body := jsonb_build_object(
      'aufgabe', aufgabe,
      'heute', to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM-DD')
    )
  );
end $$;

comment on function public.rufe_reveal_zeitplan(text) is
  'Cron-Wrapper: liest projekt_url/cron_geheimnis aus dem Vault und ruft die Edge Function reveal-zeitplan mit {aufgabe, heute} auf; heute ist der Kalendertag in Europe/Zurich nach der DB-Uhr.';

-- Nur der Cron (läuft als postgres) ruft den Wrapper; Client-Rollen könnten
-- sonst beliebig oft Reveal-Läufe anstossen (harmlos wegen CAS, aber ein
-- unnötiger Hebel) und die Existenz der Vault-Secrets abfragen.
revoke execute on function public.rufe_reveal_zeitplan(text) from public, anon, authenticated;

select cron.schedule('reveal-zeitplan-reveal', '10 23 * * *',
  $$select public.rufe_reveal_zeitplan('reveal')$$);
select cron.schedule('reveal-zeitplan-erinnerung', '30 7 * * *',
  $$select public.rufe_reveal_zeitplan('erinnerung')$$);
