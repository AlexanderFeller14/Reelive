-- Zurückgestellte Minors aus dem Phase-1-Final-Review, nachgeholt.
--
-- Zwei Löcher, die beide dieselbe Form haben: eine Spalte steht dem Client
-- offen, die ihm nicht gehört, oder eine Prüfung lässt den einen Wert durch,
-- den sie eigentlich meint auszuschliessen.

-- ----------------------------------------------------------------------------
-- 1. profiles-Spalten-Grant: created_at ist ein serverseitiger Zeitstempel und
-- id die Identität selbst. Beide standen dem Client offen, weil profiles als
-- einzige Tabelle noch einen Grant auf die GANZE Tabelle hatte (posts und
-- trips haben ihre Spalten-Grants seit 090600 bzw. 090200).
--
-- id im Insert-Grant, aber NICHT im Update-Grant: beim Anlegen muss der Client
-- die eigene uid mitschicken (profiles_insert_own prüft `id = auth.uid()`),
-- danach ist die Zeile identitätsgebunden. Ein Update auf id wäre ein
-- Identitätswechsel — profiles_update_own prüft nur `using`, also die ALTE
-- Zeile, und hätte einen Wechsel auf eine fremde uid durchgelassen, solange
-- für diese noch kein Profil existiert.
-- ----------------------------------------------------------------------------
revoke insert, update on public.profiles from authenticated;
grant insert (id, username, display_name, avatar_key) on public.profiles to authenticated;
grant update (username, display_name, avatar_key) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Leerstrings: `not null` schliesst NULL aus, nicht ''. Beide Spalten sind
-- genau dort not null, wo der leere String genauso wertlos ist.
--
-- captured_tz trägt die IANA-Zone der Aufnahme und ist die Grundlage der
-- Tagesgruppierung im Recap ('Europe/Lisbon'). Leer heisst dort: der Moment
-- landet in keiner Zone und die Gruppierung fällt auf UTC zurück. Die obere
-- Grenze ist grosszügig — die längsten IANA-Namen liegen bei rund 32 Zeichen.
--
-- emoji hatte bereits eine Obergrenze, aber keine Untergrenze; eine Reaktion
-- ohne Zeichen ist eine unsichtbare Reaktion, die trotzdem zählt.
-- ----------------------------------------------------------------------------
alter table public.posts add constraint posts_captured_tz_check
  check (char_length(captured_tz) between 1 and 64);

alter table public.reactions drop constraint reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check
  check (char_length(emoji) between 1 and 16);
