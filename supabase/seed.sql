-- Testdaten für die lokale Entwicklung.
-- Läuft automatisch bei `supabase db reset` (config.toml → [db.seed]).
-- NIE in ein hosted Projekt einspielen: legt Auth-Nutzer direkt an.
--
-- Login im Simulator (config.toml → [auth.sms.test_otp], Code immer 123456):
--   +41 79 000 00 01  → Lea, hat ein Profil  → landet direkt in den Tabs
--   +41 79 000 00 02  → Ben, ohne Profil     → durchläuft das Profil-Onboarding
--
-- Feste UUIDs, damit Seeds reproduzierbar und Verweise lesbar bleiben.

-- ===========================================================================
-- Auth-Nutzer
-- ===========================================================================
-- Nachbau dessen, was GoTrue bei einem Phone-OTP-Signup selbst schreibt.
-- Ohne Passwort (Phone-OTP prüft keins). Telefonnummern ohne "+", so speichert
-- GoTrue sie. phone_confirmed_at gesetzt = Nummer gilt als bestätigt.
-- confirmed_at wird NICHT gesetzt: die Spalte ist generiert (least(email_confirmed_at,
-- phone_confirmed_at)) und lehnt jeden expliziten Wert ab.
--
-- Die Token-Spalten MÜSSEN leere Strings sein, nicht NULL: GoTrue liest sie in
-- Go-`string`-Felder und quittiert NULL beim Login mit
-- «Scan error on column index 3, name "confirmation_token"» (HTTP 500).
insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', '41790000001', now(), '', '', '', '', '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', '41790000002', now(), '', '', '', '', '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', '41790000003', now(), '', '', '', '', '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', '41790000004', now(), '', '', '', '', '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', '41790000005', now(), '', '', '', '', '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now())
on conflict (id) do nothing;

-- Bei Phone-Identities ist provider_id die User-ID (nicht die Nummer).
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'phone', u.phone, 'phone_verified', true, 'email_verified', false),
  'phone', now(), now(), now()
from auth.users u
where u.id in (
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555'
)
on conflict (provider, provider_id) do nothing;

-- ===========================================================================
-- Profile
-- ===========================================================================
-- Ben (2222…) bekommt bewusst KEIN Profil: er zeigt beim Login das Onboarding.
insert into public.profiles (id, username, display_name, created_at) values
  ('11111111-1111-4111-8111-111111111111', 'lea',   'Lea',   '2026-04-02 09:12:00+02'),
  ('33333333-3333-4333-8333-333333333333', 'mira',  'Mira',  '2026-04-02 09:31:00+02'),
  ('44444444-4444-4444-8444-444444444444', 'jonas', 'Jonas', '2026-04-04 18:44:00+02'),
  ('55555555-5555-4555-8555-555555555555', 'sofia', 'Sofia', '2025-08-19 21:02:00+02')
on conflict (id) do nothing;

-- ===========================================================================
-- Reisen — je eine pro Status, damit alle Zustände sichtbar sind
-- ===========================================================================
insert into public.trips (id, name, cover_key, start_date, end_date, status, revealed_at, invite_code, owner_id, plan, created_at) values
  -- Läuft gerade (heute ist der 06.08.2026): versiegelt, niemand sieht die Momente.
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Norwegen mit dem Camper', 'covers/norwegen.jpg',
   '2026-08-01', '2026-08-14', 'active', null, 'a1b2c3d4e5f6',
   '11111111-1111-4111-8111-111111111111', 'free', '2026-07-18 20:05:00+02'),
  -- Reveal ist durch: Momente, Reaktionen und Kommentare sind sichtbar.
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Lissabon Städtetrip', 'covers/lissabon.jpg',
   '2026-05-08', '2026-05-12', 'revealed', '2026-05-13 19:00:00+02', 'b2c3d4e5f6a1',
   '33333333-3333-4333-8333-333333333333', 'free', '2026-04-21 12:40:00+02'),
  -- Archiviert: abgeschlossen und weggelegt.
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Sardinien im Van', 'covers/sardinien.jpg',
   '2025-09-06', '2025-09-20', 'archived', '2025-09-21 18:30:00+02', 'c3d4e5f6a1b2',
   '11111111-1111-4111-8111-111111111111', 'free', '2025-08-20 08:15:00+02')
on conflict (id) do nothing;

insert into public.trip_members (trip_id, user_id, role, joined_at) values
  -- Norwegen: Lea + drei Mitreisende
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner',  '2026-07-18 20:05:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'member', '2026-07-18 21:12:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'member', '2026-07-19 07:48:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'member', '2026-07-21 19:30:00+02'),
  -- Lissabon: Mira ist Owner, Lea nur Mitglied
  ('aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'owner',  '2026-04-21 12:40:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'member', '2026-04-21 13:02:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'member', '2026-04-22 09:15:00+02'),
  -- Sardinien: zu zweit
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'owner',  '2025-08-20 08:15:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'member', '2025-08-20 12:44:00+02')
on conflict (trip_id, user_id) do nothing;

-- ===========================================================================
-- Momente — sortiert IMMER nach captured_at (Gerätezeit), nie nach Upload
-- ===========================================================================
-- storage_key/thumb_key zeigen auf noch nicht existierende R2-Objekte
-- (Upload kommt in Phase 4). upload_status bleibt darum ehrlich 'pending',
-- ausser wo ein fertiger Upload simuliert werden soll.

-- Norwegen (versiegelt) — bewusst durcheinander eingesendet, damit auffällt,
-- wenn irgendwo nach created_at statt nach captured_at sortiert wird.
insert into public.posts (trip_id, author_id, type, media_ext, storage_key, thumb_key, duration_s, caption, captured_at, captured_tz, lat, lng, place_name, upload_status, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/norwegen/001.jpg', 'trips/norwegen/001_t.jpg', null, 'Fähre ablegt, Regen von der Seite', '2026-08-01 07:12:00+02', 'Europe/Oslo', 59.9139, 10.7522, 'Oslo', 'uploaded', '2026-08-01 09:40:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'photo', 'jpg', 'trips/norwegen/002.jpg', 'trips/norwegen/002_t.jpg', null, 'Jonas hat den Gaskocher vergessen', '2026-08-01 19:48:00+02', 'Europe/Oslo', 60.3913, 5.3221, 'Bergen', 'uploaded', '2026-08-02 08:02:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'video', 'mp4', 'trips/norwegen/003.mp4', 'trips/norwegen/003_t.jpg', 12.4, 'Wasserfall, viel zu laut zum Reden', '2026-08-02 11:20:00+02', 'Europe/Oslo', 60.8641, 7.1155, 'Vøringsfossen', 'uploaded', '2026-08-02 11:26:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'photo', 'jpg', 'trips/norwegen/004.jpg', 'trips/norwegen/004_t.jpg', null, null, '2026-08-02 16:05:00+02', 'Europe/Oslo', 60.4675, 7.4900, 'Eidfjord', 'uploaded', '2026-08-02 20:11:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/norwegen/005.jpg', 'trips/norwegen/005_t.jpg', null, 'Erste Nacht ohne Dunkelheit', '2026-08-03 00:41:00+02', 'Europe/Oslo', 61.0625, 7.0910, 'Aurlandsfjord', 'uploaded', '2026-08-03 07:55:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'video', 'mp4', 'trips/norwegen/006.mp4', 'trips/norwegen/006_t.jpg', 8.1, 'Serpentinen runter nach Geiranger', '2026-08-03 14:33:00+02', 'Europe/Oslo', 62.1010, 7.2050, 'Geiranger', 'uploaded', '2026-08-03 18:20:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'photo', 'jpg', 'trips/norwegen/007.jpg', 'trips/norwegen/007_t.jpg', null, 'Kaffee auf dem Dach vom Camper', '2026-08-04 08:02:00+02', 'Europe/Oslo', 62.1010, 7.2050, 'Geiranger', 'uploaded', '2026-08-04 08:09:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/norwegen/008.jpg', 'trips/norwegen/008_t.jpg', null, 'Trollstigen im Nebel, sehen nichts', '2026-08-04 12:47:00+02', 'Europe/Oslo', 62.4581, 7.6708, 'Trollstigen', 'uploaded', '2026-08-04 15:02:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'photo', 'jpg', 'trips/norwegen/009.jpg', 'trips/norwegen/009_t.jpg', null, 'Zimtschnecken für alle', '2026-08-04 17:15:00+02', 'Europe/Oslo', 62.4722, 6.1495, 'Ålesund', 'uploaded', '2026-08-05 09:31:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'photo', 'jpg', 'trips/norwegen/010.jpg', 'trips/norwegen/010_t.jpg', null, null, '2026-08-05 06:58:00+02', 'Europe/Oslo', 62.4722, 6.1495, 'Ålesund', 'uploaded', '2026-08-05 07:04:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'video', 'mp4', 'trips/norwegen/011.mp4', 'trips/norwegen/011_t.jpg', 21.7, 'Mira springt rein, 9 Grad', '2026-08-05 13:26:00+02', 'Europe/Oslo', 63.1105, 7.6450, 'Atlantikstrasse', 'uploaded', '2026-08-05 19:40:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/norwegen/012.jpg', 'trips/norwegen/012_t.jpg', null, 'Elch. Wirklich. Kein Busch.', '2026-08-05 20:55:00+02', 'Europe/Oslo', 63.4305, 10.3951, 'Trondheim', 'uploaded', '2026-08-06 07:12:00+02'),
  -- Heute eingesendet, noch nicht durchgeladen
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'photo', 'jpg', 'trips/norwegen/013.jpg', null, null, 'Frühstück am Wasser', '2026-08-06 08:30:00+02', 'Europe/Oslo', 63.4305, 10.3951, 'Trondheim', 'pending', '2026-08-06 08:33:00+02')
on conflict do nothing;

-- Lissabon (revealed) — feste IDs, weil Reaktionen und Kommentare daran hängen
insert into public.posts (id, trip_id, author_id, type, media_ext, storage_key, thumb_key, duration_s, caption, captured_at, captured_tz, lat, lng, place_name, upload_status, created_at) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'photo', 'jpg', 'trips/lissabon/001.jpg', 'trips/lissabon/001_t.jpg', null, 'Angekommen, 28 Grad im Mai', '2026-05-08 14:20:00+01', 'Europe/Lisbon', 38.7223, -9.1393, 'Lissabon', 'uploaded', '2026-05-08 14:25:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/lissabon/002.jpg', 'trips/lissabon/002_t.jpg', null, 'Tram 28, wir stehen', '2026-05-08 17:45:00+01', 'Europe/Lisbon', 38.7115, -9.1354, 'Alfama', 'uploaded', '2026-05-08 21:03:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'video', 'mp4', 'trips/lissabon/003.mp4', 'trips/lissabon/003_t.jpg', 15.2, 'Fado im Hinterhof', '2026-05-08 22:30:00+01', 'Europe/Lisbon', 38.7115, -9.1354, 'Alfama', 'uploaded', '2026-05-09 09:12:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/lissabon/004.jpg', 'trips/lissabon/004_t.jpg', null, 'Pastéis, Nummer vier', '2026-05-09 10:05:00+01', 'Europe/Lisbon', 38.6966, -9.2033, 'Belém', 'uploaded', '2026-05-09 10:08:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'photo', 'jpg', 'trips/lissabon/005.jpg', 'trips/lissabon/005_t.jpg', null, null, '2026-05-09 16:40:00+01', 'Europe/Lisbon', 38.6916, -9.2159, 'Torre de Belém', 'uploaded', '2026-05-09 19:22:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'photo', 'jpg', 'trips/lissabon/006.jpg', 'trips/lissabon/006_t.jpg', null, 'Sonnenuntergang, alle auf der Mauer', '2026-05-09 20:51:00+01', 'Europe/Lisbon', 38.7139, -9.1305, 'Miradouro da Graça', 'uploaded', '2026-05-09 21:00:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'video', 'mp4', 'trips/lissabon/007.mp4', 'trips/lissabon/007_t.jpg', 6.8, 'Zug nach Sintra, Jonas schläft', '2026-05-10 09:15:00+01', 'Europe/Lisbon', 38.7970, -9.3907, 'Sintra', 'uploaded', '2026-05-10 12:44:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'photo', 'jpg', 'trips/lissabon/008.jpg', 'trips/lissabon/008_t.jpg', null, 'Pena, gelb und viel zu voll', '2026-05-10 13:30:00+01', 'Europe/Lisbon', 38.7876, -9.3904, 'Palácio da Pena', 'uploaded', '2026-05-10 18:05:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'photo', 'jpg', 'trips/lissabon/009.jpg', 'trips/lissabon/009_t.jpg', null, 'Cabo da Roca, Wind nimmt die Mütze', '2026-05-10 17:20:00+01', 'Europe/Lisbon', 38.7807, -9.4989, 'Cabo da Roca', 'uploaded', '2026-05-11 08:30:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/lissabon/010.jpg', 'trips/lissabon/010_t.jpg', null, 'Markthalle, dritter Anlauf beim Bacalhau', '2026-05-11 12:50:00+01', 'Europe/Lisbon', 38.7071, -9.1459, 'Time Out Market', 'uploaded', '2026-05-11 13:02:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'photo', 'jpg', 'trips/lissabon/011.jpg', 'trips/lissabon/011_t.jpg', null, 'Letzter Abend, keiner will heim', '2026-05-11 23:10:00+01', 'Europe/Lisbon', 38.7078, -9.1366, 'Cais do Sodré', 'uploaded', '2026-05-12 07:40:00+01'),
  ('bbbbbbbb-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'photo', 'jpg', 'trips/lissabon/012.jpg', 'trips/lissabon/012_t.jpg', null, 'Abflug, Sand noch in den Schuhen', '2026-05-12 11:25:00+01', 'Europe/Lisbon', 38.7756, -9.1354, 'Aeroporto de Lisboa', 'uploaded', '2026-05-12 11:30:00+01')
on conflict do nothing;

-- Sardinien (archiviert)
insert into public.posts (trip_id, author_id, type, media_ext, storage_key, thumb_key, duration_s, caption, captured_at, captured_tz, lat, lng, place_name, upload_status, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/sardinien/001.jpg', 'trips/sardinien/001_t.jpg', null, 'Van steht, Meer ist da', '2025-09-06 15:40:00+02', 'Europe/Rome', 40.9265, 9.4986, 'Olbia', 'uploaded', '2025-09-06 15:44:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'photo', 'jpg', 'trips/sardinien/002.jpg', 'trips/sardinien/002_t.jpg', null, 'Wasser unwirklich türkis', '2025-09-08 11:12:00+02', 'Europe/Rome', 41.2036, 9.4092, 'La Maddalena', 'uploaded', '2025-09-08 19:03:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'video', 'mp4', 'trips/sardinien/003.mp4', 'trips/sardinien/003_t.jpg', 18.9, 'Sofia klettert, ich halte die Kamera', '2025-09-11 09:50:00+02', 'Europe/Rome', 40.2733, 9.6280, 'Cala Goloritzé', 'uploaded', '2025-09-11 20:15:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'photo', 'jpg', 'trips/sardinien/004.jpg', 'trips/sardinien/004_t.jpg', null, null, '2025-09-14 18:22:00+02', 'Europe/Rome', 39.2238, 9.1217, 'Cagliari', 'uploaded', '2025-09-14 21:47:00+02'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'photo', 'jpg', 'trips/sardinien/005.jpg', 'trips/sardinien/005_t.jpg', null, 'Zwei Wochen, 400 Kilometer, ein Reifen', '2025-09-20 10:05:00+02', 'Europe/Rome', 40.9265, 9.4986, 'Olbia', 'uploaded', '2025-09-20 10:12:00+02')
on conflict do nothing;

-- ===========================================================================
-- Reaktionen & Kommentare — nur auf einer aufgedeckten Reise möglich
-- ===========================================================================
insert into public.reactions (post_id, user_id, emoji, created_at) values
  ('bbbbbbbb-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', '😍', '2026-05-13 19:22:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', '😂', '2026-05-13 19:31:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '😍', '2026-05-13 19:25:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000006', '44444444-4444-4444-8444-444444444444', '🔥', '2026-05-13 20:02:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', '😂', '2026-05-13 21:10:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', '🔥', '2026-05-14 08:15:00+02')
on conflict do nothing;

insert into public.comments (post_id, user_id, text, created_at) values
  ('bbbbbbbb-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Vier? Es waren sieben.', '2026-05-13 19:24:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Ich zähle nur die, die ich zugebe.', '2026-05-13 19:29:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Das Licht hat keiner erfunden.', '2026-05-13 19:26:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000007', '44444444-4444-4444-8444-444444444444', 'Ich habe die Augen zugemacht, nicht geschlafen.', '2026-05-13 21:14:00+02'),
  ('bbbbbbbb-0000-4000-8000-000000000011', '33333333-3333-4333-8333-333333333333', 'Nächstes Jahr wieder, gleiche Bar.', '2026-05-14 08:20:00+02')
on conflict do nothing;

-- Geteilter Recap-Link (Auflösung läuft später über eine Edge Function)
insert into public.share_links (token, trip_id, expires_at, revoked, created_at) values
  ('7f3c1a9e2b4d6058a1c3e5f70921b8d4', 'aaaaaaaa-0000-4000-8000-000000000002', '2026-11-13 19:00:00+02', false, '2026-05-13 19:40:00+02')
on conflict (token) do nothing;
