-- ============================================================================
-- push_tokens — Expo-Push-Token je Geräteinstallation, Grundlage für die
-- Reveal-Benachrichtigung («Euer Recap von … ist bereit!», Phase 5).
-- ----------------------------------------------------------------------------
-- Primärschlüssel ist der TOKEN, nicht (user_id, token): dasselbe Gerät kann
-- den Account wechseln (Abmelden, neu anmelden). Meldet sich danach eine neue
-- Person auf demselben Gerät an, MUSS die Zeile ihr gehören statt doppelt zu
-- existieren — sonst bekäme die vorige Person weiterhin Pushes für Reisen,
-- die sie nichts mehr angehen. Der Client schreibt darum immer mit `upsert`
-- auf `token`.
-- ============================================================================
create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

comment on table public.push_tokens is
  'Primärschlüssel ist der Token (nicht user_id+token): dasselbe Gerät kann den Account wechseln, dann muss die Zeile per Upsert auf token der neuen Person gehören statt doppelt zu existieren.';

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_select_own on public.push_tokens
  for select using (user_id = auth.uid());
create policy push_tokens_insert_own on public.push_tokens
  for insert with check (user_id = auth.uid());
create policy push_tokens_update_own on public.push_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_delete_own on public.push_tokens
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Geräte-/Account-Wechsel: warum die vier Policies oben allein NICHT reichen
-- ----------------------------------------------------------------------------
-- Postgres verlangt für UPDATE (und damit auch für den UPDATE-Zweig von
-- INSERT … ON CONFLICT DO UPDATE, den ein `upsert` erzeugt) zusätzlich zur
-- USING-Klausel der UPDATE-Policy, dass die BESTEHENDE Zeile bereits über
-- eine SELECT-Policy sichtbar ist — das ist dokumentiertes RLS-Kernverhalten,
-- keine Eigenheit dieses Schemas. push_tokens_select_own zeigt einer Person
-- nur eigene Zeilen; ein Upsert von Ben auf Annas Token bekäme Annas
-- bestehende Zeile also nie zu Gesicht (0 betroffene Zeilen bei UPDATE,
-- Fehler bei ON CONFLICT DO UPDATE) — unabhängig davon, wie offen
-- push_tokens_update_own formuliert ist. Am laufenden Stack verifiziert,
-- Details im Task-1-Report.
--
-- Diese Tabelle braucht die Sichtbarkeitssperre aber ausdrücklich (fremde
-- Tokens bleiben unsichtbar, Step 3 des Tests). Der Ausweg ist deshalb kein
-- RLS-Policy-Trick, sondern ein SECURITY DEFINER-Trigger: er entfernt VOR dem
-- Insert gezielt eine fremde Zeile mit demselben Token, falls die neue Zeile
-- einer anderen Person gehört. Der anschliessende Insert trifft dadurch nie
-- mehr auf einen Konflikt mit einer fremden Zeile — er läuft als normaler,
-- durch push_tokens_insert_own gedeckter Insert. Gehört das Token bereits
-- derselben Person, läuft der gewöhnliche ON-CONFLICT-DO-UPDATE-Zweig unter
-- den Policies oben (dort passt die SELECT-Sichtbarkeit, weil es die eigene
-- Zeile ist).
-- ----------------------------------------------------------------------------
create or replace function public.push_tokens_take_over()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_tokens
    where token = new.token and user_id <> new.user_id;
  return new;
end $$;

comment on function public.push_tokens_take_over() is
  'BEFORE-INSERT-Trigger auf push_tokens: entfernt vor dem Insert eine fremde Zeile mit demselben Token, damit ein Account-/Geräte-Wechsel per Upsert die Zeile übernimmt statt an der RLS-Sichtbarkeit der fremden Zeile zu scheitern (siehe Tabellenkommentar).';

revoke execute on function public.push_tokens_take_over() from public;

create trigger push_tokens_take_over_trigger
  before insert on public.push_tokens
  for each row execute function public.push_tokens_take_over();

-- Ohne dieses ausdrückliche Grant ist die Tabelle für niemanden nutzbar:
-- 20260804090000_acl_baseline.sql hat die Default-Privilegien für neue
-- Tabellen abgeräumt (kein anon-/authenticated-Zugriff ohne Grant). anon
-- bekommt hier bewusst nichts.
grant select, insert, update, delete on public.push_tokens to authenticated;

-- Ebenso ohne Default-Grant für service_role (20260803090600_role_hardening.sql,
-- Punkt 1: dieses Image vergibt auch service_role keine Default-DML-Grants).
-- Die Edge Function reveal-trip (Phase 5, Task 2) liest push_tokens für den
-- Versand und löscht Tokens, deren Ticket "DeviceNotRegistered" meldet — ohne
-- dieses Grant scheitert das am fehlenden Tabellen-Privileg, obwohl
-- service_role RLS ohnehin umgeht (BYPASSRLS ersetzt kein Tabellen-Privileg).
grant select, insert, update, delete on public.push_tokens to service_role;
