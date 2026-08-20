-- Sprachumstellung: die beiden verbliebenen deutschen SQL-Funktionen, die
-- Vault-Secrets und der Cron-Vertrag bekommen englische Namen. Drop und
-- Create statt alter ... rename, weil zwei Cron-Jobs auf den Namen zeigen
-- und in derselben Migration mitwandern muessen. Die Funktionskoerper sind
-- unveraendert uebernommen.

-- --- recap_ist_geteilt -> recap_is_shared -------------------------------
drop function if exists public.recap_ist_geteilt(uuid);

create or replace function public.recap_is_shared(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.aktive_share_links s where s.trip_id = p_trip_id
  )
  -- Unveraendert und weiterhin die wichtigste Zeile: `security definer` hebt
  -- RLS auf, ohne die Mitgliedschafts-Bedingung waere die Funktion ein Orakel,
  -- mit dem sich fuer beliebige trip_ids abfragen liesse, ob dort gerade
  -- geteilt wird.
  and public.is_trip_member(p_trip_id, auth.uid());
$$;

revoke execute on function public.recap_is_shared(uuid) from public;
grant execute on function public.recap_is_shared(uuid) to authenticated, service_role;

-- --- rufe_reveal_zeitplan -> call_reveal_schedule -----------------------
-- Erst die Jobs abhaengen, sonst zeigt der Scheduler auf eine Funktion, die
-- es zwischen drop und schedule nicht gibt. In do-Bloecke gewickelt und
-- Fehler geschluckt: cron.unschedule wirft hart, wenn der Job nicht
-- existiert (z. B. bei einem Wiederholungslauf nach einem Fehlschlag oder
-- nach migration repair), das darf diese Migration nicht abbrechen.
do $$ begin
  perform cron.unschedule('reveal-zeitplan-reveal');
exception when others then null; end $$;
do $$ begin
  perform cron.unschedule('reveal-zeitplan-erinnerung');
exception when others then null; end $$;

drop function if exists public.rufe_reveal_zeitplan(text);

create or replace function public.call_reveal_schedule(task text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  project_url text;
  secret      text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_secret';

  -- Warnung statt Exception: eine fehlende Konfiguration soll im Log
  -- auffallen, aber keinen dauerhaft roten Job-Verlauf erzeugen; der
  -- naechste Lauf nach dem Einrichten holt alles nach (der Reveal fragt
  -- end_date < heute ab, nicht end_date = gestern).
  if project_url is null or secret is null then
    raise warning 'call_reveal_schedule: Vault-Secrets project_url/cron_secret fehlen, Aufruf uebersprungen.';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/reveal-schedule',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', secret
    ),
    body := jsonb_build_object(
      'task', task,
      'today', to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM-DD')
    )
  );
end $$;

comment on function public.call_reveal_schedule(text) is
  'Cron wrapper: reads project_url/cron_secret from the vault and calls the reveal-schedule edge function with {task, today}; today is the calendar day in Europe/Zurich by the database clock.';

-- Nur der Cron (laeuft als postgres) ruft den Wrapper; Client-Rollen koennten
-- sonst beliebig oft Reveal-Laeufe anstossen (harmlos wegen CAS, aber ein
-- unnoetiger Hebel) und die Existenz der Vault-Secrets abfragen.
revoke execute on function public.call_reveal_schedule(text) from public, anon, authenticated;

select cron.schedule('reveal-schedule-reveal', '10 23 * * *',
  $$select public.call_reveal_schedule('reveal')$$);
select cron.schedule('reveal-schedule-reminder', '30 7 * * *',
  $$select public.call_reveal_schedule('reminder')$$);
