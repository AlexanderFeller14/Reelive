# Profilbild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Person kann ein Profilbild hinterlegen; es ersetzt überall die Initiale, in der App und im geteilten Recap.

**Architecture:** Ein öffentlicher Supabase-Storage-Bucket `avatare` mit unratbarem Schlüssel `profiles/{user_id}/{32 Hex}.jpg`. `profiles.avatar_key` hält den Schlüssel und reist in den bestehenden Abfragen mit; die Lese-URL ist eine feste Formel aus `EXPO_PUBLIC_SUPABASE_URL`, kein Signieren, kein Ablauf. Ein neues Bild bekommt einen neuen Zufallsanteil, wodurch sich der Bildcache von selbst auflöst.

**Tech Stack:** Expo SDK 57 (TypeScript strict), Supabase (Postgres + Storage + Edge Functions/Deno), Jest + @testing-library/react-native, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-12-profilbild-design.md`

## Global Constraints

- **DESIGN-LANGUAGE.md schlägt Framework-Defaults und eigenen Geschmack.** Avatare: rund, 32–44 px, 2 px Ring, Gruppen −8 px überlappend (§4). Radius nur 12 / 24 / 999. Icons: Lucide Outline.
- **Avatar-Grösse: 44 px im Profil-Tab und im Onboarding** (Obergrenze §4, zugleich iOS-Minimum für ein Tap-Ziel, weil der Kreis dort ein Tap-Ziel IST). Überall sonst bleibt es bei den bestehenden 36 px — Facepile, Mitglieder-Sheet, Recap-Player und geteilter Recap zeigen Avatare an, sie sind dort nicht drückbar. `Avatar` behält deshalb `size = 36` als Vorgabe, und nur `AvatarWaehler` setzt 44.
- **UI-Sprache Deutsch, Du-Form.**
- **Schlüsselschema `profiles/{user_id}/{32 Hex-Zeichen}.jpg`** — unveränderlich, weil `konto-loeschen/index.ts:255` genau dieses Präfix als erlaubt führt.
- **Bucket-Name `avatare`** als Konstante im Code, nie als Umgebungsvariable.
- **Keine neue Umgebungsvariable.** Die Lese-URL kommt aus `EXPO_PUBLIC_SUPABASE_URL`.
- **Schema-Änderungen nur über Migrationen** in `supabase/migrations/`; jede RLS-Policy bekommt pgTAP-Tests in `supabase/tests/`.
- **Beiträge sortieren immer nach `captured_at`** — von diesem Feature nicht berührt, aber nicht versehentlich anfassen.
- Nach jedem Task müssen `npx tsc --noEmit` und `npm test` (in `mobile/`) grün sein.

## Dateien

**Neu:**
- `supabase/migrations/20260812130000_avatar_bild.sql` — Bucket, `with check` auf den profiles-Policies, RLS auf `storage.objects`
- `supabase/tests/20_avatar_test.sql` — pgTAP für beide Policy-Gruppen
- `mobile/src/features/auth/avatar.ts` — Schlüsselbildung und URL-Formel, reine Logik
- `mobile/src/features/auth/avatarApi.ts` — hochladen, setzen, entfernen (Reihenfolge)
- `mobile/src/components/AvatarWaehler.tsx` — Kreis mit Kamera-Badge plus Auswahl-Sheet
- Vier Testdateien dazu

**Geändert:**
- `supabase/config.toml` — Bucket-Deklaration
- `mobile/src/components/Avatar.tsx` — Bild statt Initiale, `cinema`-Variante, `AvatarGroup` auf `Gesicht[]`
- `mobile/src/components/TripCard.tsx`, `mobile/src/app/(tabs)/reise/[id]/index.tsx` — Aufrufer nachziehen
- `mobile/src/features/auth/profileApi.ts`, `features/trips/{tripsApi,types}.ts`, `features/recap/{recapApi,types}.ts` — `avatar_key` mitladen
- `mobile/src/app/(tabs)/profil.tsx`, `app/(auth)/profile-setup.tsx` — Wähler einbauen
- `mobile/src/app/(tabs)/recap/[id]/player.tsx`, `app/teilen/[token].tsx` — lokale `AvatarInitiale`-Kopien entfernen
- `supabase/functions/share-link/{aufloesung,store}.ts` — `avatar_key` durchreichen
- `supabase/functions/konto-loeschen/{ablauf,store,index}.ts` — Avatar mitlöschen
- `mobile/app.json`, `mobile/package.json` — `expo-image-picker`

---

### Task 1: Bucket, Policies und pgTAP

**Files:**
- Create: `supabase/migrations/20260812130000_avatar_bild.sql`
- Create: `supabase/tests/20_avatar_test.sql`
- Modify: `supabase/config.toml:132` (nach dem `[storage.buckets.media]`-Block)

**Interfaces:**
- Produces: Bucket `avatare` (öffentlich); `profiles.avatar_key` ist nur noch mit dem Präfix `profiles/<auth.uid()>/` beschreibbar; `storage.objects` im Bucket nur im eigenen Ordner schreibbar.

- [ ] **Step 1: Bucket in config.toml deklarieren**

Nach dem `allowed_mime_types`-Eintrag von `[storage.buckets.media]` einfügen:

```toml
# Profilbilder (Spec 2026-08-12-profilbild-design.md). ÖFFENTLICH, anders als
# `media`: Avatare hängen nicht an der Versiegelung, werden vor dem Reveal
# gebraucht und auch von Betrachtern ohne Konto (geteilter Recap). Der Schutz
# liegt im unratbaren Schlüssel (32 Hex), derselben Klasse wie der Share-Token.
[storage.buckets.avatare]
public = true
file_size_limit = "2MiB"
# Nur JPEG: der Client rechnet ohnehin nach JPEG (features/auth/avatarApi.ts).
allowed_mime_types = ["image/jpeg"]
```

- [ ] **Step 2: Migration schreiben**

```sql
-- Profilbild (Spec docs/superpowers/specs/2026-08-12-profilbild-design.md).
--
-- profiles.avatar_key gibt es seit 20260803090000_core_tables.sql, beschreibbar
-- seit 20260808150000_leerstrings_und_profil_grants.sql. Geschrieben hat sie
-- bisher kein Codepfad. Diese Migration bindet sie an einen Pfad, der der
-- schreibenden Person gehört, und legt den Bucket an, in dem die Bytes liegen.

-- ---------------------------------------------------------------------------
-- 1. Der Bucket
-- ---------------------------------------------------------------------------
-- Auch in supabase/config.toml deklariert, hier trotzdem MIT den Limits:
-- config.toml wirkt nur über die lokale CLI. In der Produktion entsteht der
-- Bucket allein durch diese Migration, und ein öffentlicher Bucket ohne
-- Grössen- und Typgrenze nimmt beliebig grosse Dateien beliebigen Typs an,
-- direkt vom Client geschrieben und über eine öffentliche URL ausgeliefert.
-- Lokal fällt das nicht auf, weil die CLI die Werte NACH der Migration
-- nachträgt.
--
-- `do update` statt `do nothing`: Bei `do nothing` bekäme ein Bucket, den die
-- CLI oder jemand von Hand schon angelegt hat, die Limits nie, und ein
-- späterer Lauf könnte das auch nicht mehr reparieren.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatare', 'avatare', true, 2097152, array['image/jpeg'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

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

-- Lesen NUR für Angemeldete, obwohl der Bucket öffentlich ist. Das ist kein
-- Widerspruch: Ein Objekt aus einem public-Bucket geht über den
-- `/object/public/`-Pfad auch ohne jede Sitzung heraus, diese Policy betrifft
-- die Storage-API. Stünde `anon` hier, könnte jeder den Bucket AUFLISTEN, und
-- damit wäre jeder Schlüssel und jede user_id aufzählbar — womit die
-- Begründung, auf der die ganze Speicherwahl ruht («der Schutz liegt im
-- unratbaren Schlüssel», Spec §2), keinen Boden mehr hätte.
--
-- Der geteilte Recap bleibt intakt, weil er die öffentliche URL benutzt und
-- nicht die API. Das ist zu VERIFIZIEREN, nicht anzunehmen (Schritt 4).
create policy avatare_select_angemeldete on storage.objects
  for select to authenticated
  using (bucket_id = 'avatare');
```

- [ ] **Step 3: pgTAP-Test schreiben**

```sql
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
```

- [ ] **Step 4: Migration und Test laufen lassen**

Run: `supabase db reset && supabase test db`
Expected: alle Testdateien grün, `20_avatar_test.sql` mit 8 bestandenen Zusicherungen.

Läuft `supabase test db` in einen Fehler bei `storage.foldername`, prüfen, ob die lokale Storage-Version die Funktion mitbringt (`select storage.foldername('a/b/c.jpg');`). Fehlt sie, statt ihrer `split_part(name, '/', 1)` und `split_part(name, '/', 2)` verwenden — gleiche Semantik für dieses Schema.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/migrations/20260812130000_avatar_bild.sql supabase/tests/20_avatar_test.sql
git commit -m "feat(profil): Bucket und Pfadbindung fuer das Profilbild"
```

---

### Task 2: Schlüssel und URL

**Files:**
- Create: `mobile/src/features/auth/avatar.ts`
- Test: `mobile/src/features/auth/__tests__/avatar.test.ts`

**Interfaces:**
- Produces:
  - `AVATAR_BUCKET: 'avatare'`
  - `neuerAvatarSchluessel(userId: string): string` → `profiles/{userId}/{32 Hex}.jpg`
  - `avatarUrl(avatarKey: string | null | undefined): string | null`

- [ ] **Step 1: Die Supabase-URL für Tests setzen**

`avatarUrl()` liest `process.env.EXPO_PUBLIC_SUPABASE_URL`. In der Jest-Umgebung ist sie nicht gesetzt, die Funktion gäbe dort immer `null` zurück, und **jeder Test, der ein Bild erwartet, wäre grün-durch-Irrtum oder rot ohne echte Ursache** — auch in den Tasks 3, 6 und 7.

Deshalb einmalig ans Ende von `mobile/jest.setup.ts`:

```ts
// avatarUrl() (src/features/auth/avatar.ts) baut die öffentliche Bild-URL aus
// dieser Variable. Ohne sie liefert sie null, und jeder Test, der ein
// Profilbild erwartet, prüfte in Wahrheit nur den Initialen-Fall. Der Wert ist
// frei erfunden und absichtlich keine echte Adresse: es wird nichts geladen,
// die Tests vergleichen nur die zusammengebaute Zeichenkette.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://test.local:54321';
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

```ts
import { avatarUrl, neuerAvatarSchluessel } from '../avatar';

const UID = '11111111-2222-3333-4444-555555555555';

// Das Präfix ist nicht Geschmackssache: konto-loeschen/index.ts führt genau
// `profiles/<user_id>/` als erlaubtes Präfix, und was nicht darauf passt,
// bleibt beim Kontolöschen für immer im Speicher liegen.
test('der Schluessel liegt im eigenen profiles-Ordner', () => {
  expect(neuerAvatarSchluessel(UID)).toMatch(
    new RegExp(`^profiles/${UID}/[0-9a-f]{32}\\.jpg$`)
  );
});

test('zwei Schluessel derselben Person unterscheiden sich', () => {
  expect(neuerAvatarSchluessel(UID)).not.toBe(neuerAvatarSchluessel(UID));
});

test('avatarUrl haengt den Schluessel an den oeffentlichen Pfad', () => {
  expect(avatarUrl(`profiles/${UID}/abc.jpg`)).toBe(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatare/profiles/${UID}/abc.jpg`
  );
});

// Ohne Bild gibt es keine URL, und der Aufrufer zeigt die Initiale. `null`
// statt einer URL auf ein Objekt, das es nicht gibt: eine kaputte Kachel wäre
// schlimmer als eine ehrliche Lücke.
test('ohne Schluessel gibt es keine URL', () => {
  expect(avatarUrl(null)).toBeNull();
  expect(avatarUrl(undefined)).toBeNull();
  expect(avatarUrl('')).toBeNull();
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/auth/__tests__/avatar.test.ts`
Expected: FAIL, `Cannot find module '../avatar'`

- [ ] **Step 4: Implementieren**

```ts
import * as Crypto from 'expo-crypto';

// Der Bucket heisst lokal und produktiv gleich (angelegt in
// 20260812130000_avatar_bild.sql, deklariert in supabase/config.toml), deshalb
// eine Konstante und keine Umgebungsvariable: eine Variable mehr ist eine
// Fehlerquelle mehr, und diese hier hätte nie zwei verschiedene Werte.
export const AVATAR_BUCKET = 'avatare';

// ---------------------------------------------------------------------------
// ACHTUNG: Das Präfix ist ABGESPROCHEN, nicht frei wählbar.
// ---------------------------------------------------------------------------
// konto-loeschen/index.ts baut seine erlaubten Präfixe als
// `profiles/${anfragendeId}/` und löscht nur, was darauf passt (der Wächter
// pfadGehoertUns in konto-loeschen/ablauf.ts, mit ausführlicher Begründung
// dort). Ein Schlüssel nach einem anderen Schema bliebe beim Kontolöschen für
// immer im Speicher liegen, ohne dass jemand seinen Pfad noch kennt.
//
// Der Zufallsanteil leistet zweierlei: Die URL ist nicht aus einer bekannten
// user_id ableitbar, und jedes neue Bild bekommt eine neue URL. Damit löst sich
// der Bildcache von selbst auf, ohne Cache-Buster-Parameter.
export function neuerAvatarSchluessel(userId: string): string {
  const zufall = Crypto.randomUUID().replace(/-/g, '');
  return `profiles/${userId}/${zufall}.jpg`;
}

// Die EINZIGE Stelle, die weiss, wie eine Avatar-URL aussieht. Auch die Edge
// Function gibt nur den Schlüssel heraus, nie eine fertige URL.
export function avatarUrl(avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const basis = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!basis) return null;
  return `${basis}/storage/v1/object/public/${AVATAR_BUCKET}/${avatarKey}`;
}
```

- [ ] **Step 5: Test laufen lassen**

Run: `cd mobile && npx jest src/features/auth/__tests__/avatar.test.ts`
Expected: PASS, 4 Tests

- [ ] **Step 6: Commit**

```bash
git add mobile/jest.setup.ts mobile/src/features/auth/avatar.ts mobile/src/features/auth/__tests__/avatar.test.ts
git commit -m "feat(profil): Schluesselbildung und URL-Formel fuer Avatare"
```

---

### Task 3: Avatar zeigt ein Bild

**Files:**
- Modify: `mobile/src/components/Avatar.tsx`
- Modify: `mobile/src/components/TripCard.tsx:79`
- Modify: `mobile/src/app/(tabs)/reise/[id]/index.tsx:659` und `:851`
- Modify: `mobile/src/features/trips/types.ts:10`
- Modify: `mobile/src/features/trips/tripsApi.ts:26-31`
- Test: `mobile/src/components/__tests__/Avatar.test.tsx`

**Interfaces:**
- Consumes: `avatarUrl` aus Task 2
- Produces:
  - `export type Gesicht = { name: string; avatarKey: string | null }`
  - `Avatar({ name, avatarKey?, size?, kino? })`
  - `AvatarGroup({ gesichter, max?, kino? })`
  - `Trip.mitglieder: Gesicht[]` ersetzt `Trip.member_names: string[]`

**Hinweis zur Task-Grenze:** Die Aufrufer werden hier mechanisch nachgezogen, damit der Baum kompiliert. Sie liefern noch `avatarKey: null` — die echten Daten kommen in Task 8. Das ist Absicht: ein Task, der den Baum rot hinterlässt, ist nicht überprüfbar.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `mobile/src/components/__tests__/Avatar.test.tsx` anhängen, und die bestehenden `AvatarGroup`-Aufrufe im selben Zug von `names={[...]}` auf `gesichter={[...]}` umstellen (Hilfsfunktion unten):

```tsx
import { Avatar, AvatarGroup, type Gesicht } from '../Avatar';
import { avatarUrl } from '@/features/auth/avatar';

// Die bestehenden Tests arbeiten mit Namen; diese Brücke hält sie unverändert
// lesbar, statt jeden Aufruf mit `{ name: …, avatarKey: null }` aufzublähen.
const ohneBild = (namen: string[]): Gesicht[] =>
  namen.map((name) => ({ name, avatarKey: null }));

const SCHLUESSEL = 'profiles/11111111-2222-3333-4444-555555555555/abc.jpg';

test('ohne Schluessel bleibt die Initiale stehen', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.queryByTestId('avatar-bild')).toBeNull();
});

test('mit Schluessel zeigt der Kreis das Bild', async () => {
  await wrap(<Avatar name="Lea" avatarKey={SCHLUESSEL} />);
  const bild = screen.getByTestId('avatar-bild');
  expect(bild.props.source).toEqual({ uri: avatarUrl(SCHLUESSEL) });
});

// Der Kreis muss randlos gefüllt sein, sonst steht das Bild als Rechteck im
// Rund (DESIGN-LANGUAGE §4: Avatare sind rund).
test('das Bild fuellt den Kreis', async () => {
  await wrap(<Avatar name="Lea" avatarKey={SCHLUESSEL} />);
  expect(screen.getByTestId('avatar-bild').props.contentFit).toBe('cover');
});

// Solange das Bild lädt, steht die Initiale da. Ohne sie blitzt ein leerer
// Kreis auf, und in einer Facepile springt dabei die ganze Reihe.
test('waehrend des Ladens traegt der Kreis weiter die Initiale', async () => {
  await wrap(<Avatar name="Lea" avatarKey={SCHLUESSEL} />);
  expect(screen.getByText('L')).toBeTruthy();
});

test('die Gruppe zeigt Bilder und Initialen nebeneinander', async () => {
  await wrap(
    <AvatarGroup
      gesichter={[
        { name: 'Lea', avatarKey: SCHLUESSEL },
        { name: 'Mira', avatarKey: null },
      ]}
    />
  );
  expect(screen.getByTestId('avatar-bild')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
});

// Die Kino-Variante ersetzt in Task 9/10 zwei handkopierte AvatarInitiale-
// Komponenten. Sie muss die dunkle Palette benutzen, nicht die des Providers.
test('die Kino-Variante nimmt die dunkle Palette', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} kino />);
  const kreis = screen.getByTestId('avatar-kreis');
  expect(StyleSheet.flatten(kreis.props.style).backgroundColor).toBe(cinema['bg-1']);
});
```

Import in derselben Datei ergänzen: `import { cinema, palette, spacing } from '@/theme/tokens';`

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/components/__tests__/Avatar.test.tsx`
Expected: FAIL — `gesichter` ist keine bekannte Prop, `avatar-bild` nicht gefunden.

- [ ] **Step 3: Avatar.tsx umbauen**

```tsx
import { Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import { avatarUrl } from '@/features/auth/avatar';

// DESIGN-LANGUAGE v2 §4: rund, 32–44 px, 2 px Ring, Gruppen −8 px überlappend.
// Ohne Bild trägt der Kreis die Initiale.
function kreis(size: number, flaeche: string, ring: string): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: radius.pill,
    backgroundColor: flaeche,
    borderWidth: 2,
    borderColor: ring,
    alignItems: 'center',
    justifyContent: 'center',
    // Das Bild ist quadratisch und würde sonst über die Rundung hinausstehen.
    overflow: 'hidden',
  };
}

// Name UND Schlüssel gehören zusammen: Wer ein Gesicht zeichnet, braucht das
// Bild, wenn es eines gibt, und sonst den Namen für die Initiale. Zwei
// getrennte Listen (Namen hier, Schlüssel dort) liefen unweigerlich
// auseinander.
export type Gesicht = { name: string; avatarKey: string | null };

// `kino` ist ein expliziter Schalter und nicht aus dem Theme ableitbar:
// ThemeProvider ist light-only, im Recap-Player und im geteilten Recap gilt
// aber die Kino-Palette. Gleiche Begründung wie bei Sheet.kino.
export function Avatar({
  name, avatarKey = null, size = 36, kino = false,
}: {
  name: string;
  avatarKey?: string | null;
  size?: number;
  kino?: boolean;
}) {
  const { colors } = useTheme();
  const flaeche = kino ? cinema['bg-1'] : colors['bg-1'];
  const ring = kino ? cinema['bg-0'] : colors['bg-0'];
  const schrift = kino ? cinema['text-2'] : colors['text-2'];
  const url = avatarUrl(avatarKey);

  return (
    <View testID="avatar-kreis" style={kreis(size, flaeche, ring)}>
      {/* Die Initiale steht IMMER im Baum, das Bild legt sich darüber. So
          trägt der Kreis während des Ladens etwas (sonst blitzt eine leere
          Fläche auf und die ganze Facepile springt), und ein Bild, das nicht
          lädt, fällt auf die Initiale zurück statt auf ein Loch. */}
      <Text style={[type.label, { color: schrift }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
      {url && (
        <Image
          testID="avatar-bild"
          source={{ uri: url }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          contentFit="cover"
          accessible={false}
        />
      )}
    </View>
  );
}

// Die Facepile nach Airbnb-Vorbild: drei Gesichter, der Rest wird gezählt.
//
// Der Rest ist ein vierter KREIS in derselben Reihe, keine Textzeile daneben.
// Das ist der Unterschied, an dem die Gruppe als eine Sache gelesen wird
// («acht Leute») statt als drei Bilder mit einer Fussnote. Er überlappt
// deshalb wie jedes Gesicht davor (§4), abgesetzt wäre er wieder eine Fussnote.
//
// Ohne eigenes Tap-Verhalten: wer die Gruppe drückbar braucht, legt
// `PressScale` darum.
export function AvatarGroup({
  gesichter, max = 3, kino = false,
}: {
  gesichter: Gesicht[];
  max?: number;
  kino?: boolean;
}) {
  const { colors } = useTheme();
  const sichtbar = gesichter.slice(0, max);
  const rest = gesichter.length - sichtbar.length;
  const flaeche = kino ? cinema['bg-1'] : colors['bg-1'];
  const ring = kino ? cinema['bg-0'] : colors['bg-0'];
  const schrift = kino ? cinema['text-2'] : colors['text-2'];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {sichtbar.map((gesicht, i) => (
        <View key={`${gesicht.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -spacing.s }}>
          <Avatar name={gesicht.name} avatarKey={gesicht.avatarKey} kino={kino} />
        </View>
      ))}
      {rest > 0 && (
        <View
          testID="avatar-rest"
          style={[kreis(36, flaeche, ring), { marginLeft: -spacing.s }]}
        >
          <Text style={[type.label, { color: schrift }]}>{`+${rest}`}</Text>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Aufrufer nachziehen**

`features/trips/types.ts:10` — `member_names` ersetzen:

```ts
  mitglieder: Gesicht[]; // Gesichter für die überlappenden Avatare auf der Karte
```

mit `import type { Gesicht } from '@/components/Avatar';` am Dateikopf.

`features/trips/tripsApi.ts` — `toTrip` liefert jetzt Gesichter statt Namen. Der Select bleibt in diesem Task unverändert, `avatar_key` kommt in Task 8 dazu:

```ts
  const mitglieder: Gesicht[] = (row.trip_members ?? [])
    .map((m) => m.profiles?.display_name)
    .filter((n): n is string => !!n)
    .map((name) => ({ name, avatarKey: null }));
```

und im zurückgegebenen Objekt `member_names: names` durch `mitglieder` ersetzen.

`components/TripCard.tsx:79`:

```tsx
            <AvatarGroup gesichter={trip.mitglieder} />
```

`app/(tabs)/reise/[id]/index.tsx:659`:

```tsx
              <AvatarGroup gesichter={mitglieder.map((m) => ({ name: m.display_name, avatarKey: null }))} />
```

`app/(tabs)/reise/[id]/index.tsx:851`:

```tsx
              <Avatar name={m.display_name} avatarKey={null} />
```

- [ ] **Step 5: Alle Tests und den Typcheck laufen lassen**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS. Schlagen `TripCard.test.tsx` oder `reise/__tests__/detail.test.tsx` fehl, weil sie `member_names` in Testdaten setzen, dort auf `mitglieder: [{ name: 'Lea', avatarKey: null }]` umstellen — die Zusicherungen selbst (Initialen, Anzahl) bleiben unverändert.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/Avatar.tsx mobile/src/components/TripCard.tsx mobile/src/components/__tests__/ mobile/src/features/trips/ "mobile/src/app/(tabs)/reise/[id]/index.tsx"
git commit -m "feat(profil): Avatar zeigt ein Bild, Gruppe arbeitet mit Gesichtern"
```

---

### Task 4: Hochladen, setzen, entfernen

**Files:**
- Create: `mobile/src/features/auth/avatarApi.ts`
- Test: `mobile/src/features/auth/__tests__/avatarApi.test.ts`

**Interfaces:**
- Consumes: `neuerAvatarSchluessel`, `AVATAR_BUCKET` aus Task 2
- Produces:
  - `setzeAvatar(userId: string, lokaleUri: string, alterKey: string | null): Promise<{ avatarKey: string | null; error: string | null }>`
  - `entferneAvatar(userId: string, alterKey: string | null): Promise<{ error: string | null }>`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

```ts
import { entferneAvatar, setzeAvatar } from '../avatarApi';

const UID = '11111111-2222-3333-4444-555555555555';
const ALT = `profiles/${UID}/alt.jpg`;

const hochgeladen = jest.fn();
const entfernt = jest.fn();
const aktualisiert = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => ({ uri: 'file:///cache/fertig.jpg' }),
        release: jest.fn(),
      }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('expo-file-system', () => ({
  File: class {
    constructor(public uri: string) {}
    upload = (...args: unknown[]) => {
      hochgeladen(...args);
      return Promise.resolve({ status: 200 });
    };
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({
      update: (werte: unknown) => ({
        eq: async (_s: string, _v: string) => {
          aktualisiert(werte);
          return { error: null };
        },
      }),
    }),
    storage: { from: () => ({ remove: async (keys: string[]) => { entfernt(keys); return { error: null }; } }) },
  },
}));

// mockReset, nicht mockClear: mehrere Tests unten setzen eine eigene
// Implementation (werfen, Reihenfolge protokollieren). mockClear löscht nur die
// Aufrufliste und liesse sie in den nächsten Test überlaufen — ein Test, der
// dann aus dem falschen Grund grün oder rot wird.
beforeEach(() => {
  hochgeladen.mockReset();
  entfernt.mockReset();
  aktualisiert.mockReset();
});

test('setzeAvatar laedt hoch, setzt die Spalte und raeumt das alte Objekt weg', async () => {
  const { avatarKey, error } = await setzeAvatar(UID, 'file:///gewaehlt.jpg', ALT);
  expect(error).toBeNull();
  expect(avatarKey).toMatch(new RegExp(`^profiles/${UID}/[0-9a-f]{32}\\.jpg$`));
  expect(aktualisiert).toHaveBeenCalledWith({ avatar_key: avatarKey });
  expect(entfernt).toHaveBeenCalledWith([ALT]);
});

// Die Reihenfolge ist die eigentliche Zusicherung: erst das Objekt, dann die
// Spalte. Umgekehrt zeigte die Zeile auf etwas, das noch nicht da ist, und
// alle Mitreisenden sähen eine kaputte Kachel.
test('die Spalte wird erst nach dem Hochladen gesetzt', async () => {
  const reihenfolge: string[] = [];
  hochgeladen.mockImplementation(() => reihenfolge.push('upload'));
  aktualisiert.mockImplementation(() => reihenfolge.push('update'));
  await setzeAvatar(UID, 'file:///gewaehlt.jpg', null);
  expect(reihenfolge).toEqual(['upload', 'update']);
});

// Ein liegengebliebenes altes Objekt kostet ~50 KB. Ein Fehlschlag hier darf
// das neue, bereits gesetzte Bild nicht zurücknehmen.
test('ein gescheitertes Aufraeumen laesst das neue Bild stehen', async () => {
  entfernt.mockImplementation(() => { throw new Error('weg ist weg'); });
  const { avatarKey, error } = await setzeAvatar(UID, 'file:///gewaehlt.jpg', ALT);
  expect(error).toBeNull();
  expect(avatarKey).not.toBeNull();
});

test('ein gescheiterter Upload setzt die Spalte nicht', async () => {
  hochgeladen.mockImplementation(() => { throw new Error('kein Netz'); });
  const { avatarKey, error } = await setzeAvatar(UID, 'file:///gewaehlt.jpg', null);
  expect(avatarKey).toBeNull();
  expect(error).toBe('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.');
  expect(aktualisiert).not.toHaveBeenCalled();
});

// Beim Entfernen umgekehrt: erst die Spalte, dann das Objekt. Sonst zeigte die
// Zeile auf etwas, das schon weg ist.
test('entferneAvatar leert die Spalte vor dem Objekt', async () => {
  const reihenfolge: string[] = [];
  aktualisiert.mockImplementation(() => reihenfolge.push('update'));
  entfernt.mockImplementation(() => reihenfolge.push('remove'));
  const { error } = await entferneAvatar(UID, ALT);
  expect(error).toBeNull();
  expect(reihenfolge).toEqual(['update', 'remove']);
  expect(aktualisiert).toHaveBeenCalledWith({ avatar_key: null });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/auth/__tests__/avatarApi.test.ts`
Expected: FAIL, `Cannot find module '../avatarApi'`

- [ ] **Step 3: Implementieren**

```ts
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { AVATAR_BUCKET, neuerAvatarSchluessel } from './avatar';

// Grösster Anzeigeort ist der 44-px-Kreis, das trägt 512 auch auf einem
// 3x-Display mit Reserve. Bei Qualität 0.8 sind das rund 50 KB.
const KANTE = 512;
const JPEG_QUALITAET = 0.8;

// Das Bild kommt quadratisch aus dem System-Zuschnitt (allowsEditing), beide
// Kanten zu setzen verzerrt es also nicht. Dasselbe kontextbasierte Muster wie
// features/moments/medien.ts, inklusive release() im finally: die SharedObjects
// werden auch im Fehlerfall freigegeben.
async function alsQuadratJpeg(uri: string): Promise<string> {
  const kontext = ImageManipulator.manipulate(uri);
  try {
    kontext.resize({ width: KANTE, height: KANTE });
    const gerendert = await kontext.renderAsync();
    try {
      const ergebnis = await gerendert.saveAsync({
        format: SaveFormat.JPEG,
        compress: JPEG_QUALITAET,
      });
      return ergebnis.uri;
    } finally {
      gerendert.release();
    }
  } finally {
    kontext.release();
  }
}

// NICHT supabase.storage.from().upload(): der Storage-Client erwartet ein Blob,
// und `fetch(uri).blob()` ist unter React Native unzuverlässig. Stattdessen
// dasselbe File.upload()-Muster wie features/moments/uploadWorker.ts, das im
// Projekt erprobt ist.
async function hochladen(schluessel: string, uri: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Nicht angemeldet.');
  const basis = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!basis) throw new Error('Supabase-URL fehlt.');

  const antwort = await new File(uri).upload(
    `${basis}/storage/v1/object/${AVATAR_BUCKET}/${schluessel}`,
    {
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    }
  );
  // upload() wirft bei 4xx/5xx NICHT, es liefert die Antwort zurück (derselbe
  // Stolperstein wie in uploadWorker.ts). Ohne diese Prüfung ginge ein
  // abgelehnter Upload als erledigt durch, und die Spalte zeigte ins Leere.
  if (antwort.status < 200 || antwort.status >= 300) {
    throw new Error(`Upload abgelehnt (${antwort.status}).`);
  }
}

// Räumt ein altes Objekt weg. Bewusst OHNE Fehlerrückgabe: ein liegen-
// gebliebenes Objekt kostet ~50 KB, ein zurückgenommenes Bild kostet die
// Person ihre gerade getroffene Wahl. Die harmlosere Fehlerrichtung gewinnt.
async function altesWegraeumen(alterKey: string | null): Promise<void> {
  if (!alterKey) return;
  try {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([alterKey]);
    if (error) console.error('[avatarApi] altes Bild blieb liegen', error);
  } catch (fehler) {
    console.error('[avatarApi] altes Bild blieb liegen', fehler);
  }
}

// Reihenfolge (Spec §5.3): hochladen → Spalte setzen → altes Objekt löschen.
// So zeigt die Zeile nie auf etwas, das noch nicht oder nicht mehr da ist.
export async function setzeAvatar(
  userId: string,
  lokaleUri: string,
  alterKey: string | null,
): Promise<{ avatarKey: string | null; error: string | null }> {
  const schluessel = neuerAvatarSchluessel(userId);

  try {
    const fertig = await alsQuadratJpeg(lokaleUri);
    await hochladen(schluessel, fertig);
  } catch (fehler) {
    console.error('[avatarApi] Hochladen fehlgeschlagen', fehler);
    return {
      avatarKey: null,
      error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.',
    };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: schluessel })
    .eq('id', userId);
  if (error) {
    console.error('[avatarApi] avatar_key setzen fehlgeschlagen', error);
    // Das frische Objekt liegt schon im Speicher, die Spalte kennt es aber
    // nicht. Wegräumen, sonst bleibt es für immer, ohne dass jemand seinen
    // Pfad noch kennt (dieselbe Überlegung wie in konto-loeschen/ablauf.ts).
    await altesWegraeumen(schluessel);
    return {
      avatarKey: null,
      error: 'Das Bild konnte nicht gespeichert werden. Probier es gleich nochmal.',
    };
  }

  await altesWegraeumen(alterKey);
  return { avatarKey: schluessel, error: null };
}

// Umgekehrte Reihenfolge: erst die Spalte leeren, dann das Objekt. Andersherum
// zeigte die Zeile auf etwas, das es nicht mehr gibt.
export async function entferneAvatar(
  userId: string,
  alterKey: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: null })
    .eq('id', userId);
  if (error) {
    console.error('[avatarApi] avatar_key leeren fehlgeschlagen', error);
    return { error: 'Das Bild konnte nicht entfernt werden. Probier es gleich nochmal.' };
  }
  await altesWegraeumen(alterKey);
  return { error: null };
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `cd mobile && npx jest src/features/auth/__tests__/avatarApi.test.ts`
Expected: PASS, 6 Tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/auth/avatarApi.ts mobile/src/features/auth/__tests__/avatarApi.test.ts
git commit -m "feat(profil): Bild hochladen, setzen und entfernen"
```

---

### Task 5: Der Auswahl-Wähler

**Files:**
- Create: `mobile/src/components/AvatarWaehler.tsx`
- Test: `mobile/src/components/__tests__/AvatarWaehler.test.tsx`
- Modify: `mobile/package.json` (Abhängigkeit), `mobile/app.json` (Config-Plugin)

**Interfaces:**
- Consumes: `Avatar` aus Task 3
- Produces: `AvatarWaehler({ name, avatarKey, onGewaehlt, onEntfernen, laeuft? })`
  - `onGewaehlt: (lokaleUri: string) => void` — der Zuschnitt ist erledigt, das Hochladen macht der Aufrufer
  - `onEntfernen: () => void`
  - `laeuft?: boolean` — zeigt einen Spinner über dem Kreis

- [ ] **Step 1: Abhängigkeit installieren und Berechtigungstexte setzen**

Run: `cd mobile && npx expo install expo-image-picker`

In `mobile/app.json` unter `expo.plugins` ergänzen:

```json
[
  "expo-image-picker",
  {
    "photosPermission": "Reelive braucht Zugriff auf deine Fotos, damit du ein Profilbild auswählen kannst.",
    "cameraPermission": "Reelive braucht die Kamera, damit du ein Selfie als Profilbild aufnehmen kannst."
  }
]
```

Steht dort bereits ein `expo-camera`-Plugin-Eintrag, kommt dieser daneben, nicht hinein.

**Ein Config-Plugin wirkt erst nach einem neuen nativen Build.** Die Berechtigungstexte in einer laufenden Dev-Build-Instanz zu prüfen sagt nichts aus; der Gerätelauf in Task 6 braucht deshalb ein `npx expo run:ios` und nicht bloss einen Neustart des Bundlers.

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AvatarWaehler } from '../AvatarWaehler';

const ausGalerie = jest.fn();
const ausKamera = jest.fn();
const galerieRecht = jest.fn();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => ausGalerie(...a),
  launchCameraAsync: (...a: unknown[]) => ausKamera(...a),
  requestMediaLibraryPermissionsAsync: () => galerieRecht(),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  ausGalerie.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///gewaehlt.jpg' }] });
  ausKamera.mockResolvedValue({ canceled: true, assets: null });
  galerieRecht.mockResolvedValue({ granted: true });
});

test('ein Tap auf den Kreis oeffnet das Sheet', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Foto auswählen')).toBeTruthy();
  expect(screen.getByText('Selfie aufnehmen')).toBeTruthy();
});

// «Bild entfernen» darf nicht dastehen, wenn es nichts zu entfernen gibt.
test('ohne Bild fehlt der Entfernen-Eintrag', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.queryByText('Bild entfernen')).toBeNull();
});

test('mit Bild steht der Entfernen-Eintrag da', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey="profiles/u/a.jpg" onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Bild entfernen')).toBeTruthy();
});

test('die Galerie liefert die URI an onGewaehlt', async () => {
  const onGewaehlt = jest.fn();
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={onGewaehlt} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(onGewaehlt).toHaveBeenCalledWith('file:///gewaehlt.jpg'));
});

// Quadratischer Zuschnitt ist eine Zusicherung, keine Kosmetik: ein
// nicht-quadratisches Bild stünde im runden Kreis verzerrt.
test('die Auswahl verlangt einen quadratischen Zuschnitt', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() =>
    expect(ausGalerie).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1], mediaTypes: 'images' })
    )
  );
});

test('ein Abbruch im Bildwaehler meldet nichts nach oben', async () => {
  const onGewaehlt = jest.fn();
  ausGalerie.mockResolvedValue({ canceled: true, assets: null });
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={onGewaehlt} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(ausGalerie).toHaveBeenCalled());
  expect(onGewaehlt).not.toHaveBeenCalled();
});

// Eine abgelehnte Berechtigung darf kein stummes Nichts sein.
test('eine abgelehnte Berechtigung zeigt eine Meldung', async () => {
  galerieRecht.mockResolvedValue({ granted: false });
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() =>
    expect(screen.getByText('Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.')).toBeTruthy()
  );
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/components/__tests__/AvatarWaehler.test.tsx`
Expected: FAIL, `Cannot find module '../AvatarWaehler'`

- [ ] **Step 4: Implementieren**

```tsx
import { useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// DESIGN-LANGUAGE §4 begrenzt Avatare auf 32–44 px. 44 ist die Obergrenze und
// zugleich das iOS-Minimum für ein Tap-Ziel — beides zusammen ist der Grund,
// warum hier genau dieser Wert steht und kein grösserer Profil-Kreis.
const GROESSE = 44;
const BADGE = 18;

// Beide Aufrufe mit denselben Optionen. `aspect` wirkt laut SDK-57-Doku nur
// unter Android; auf iOS erzwingt der System-Editor bei allowsEditing ohnehin
// ein Quadrat. Ohne Zuschnitt stünde ein Hochformat verzerrt im runden Kreis.
const OPTIONEN = {
  mediaTypes: 'images',
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
} as const;

export function AvatarWaehler({
  name, avatarKey, onGewaehlt, onEntfernen, laeuft = false,
}: {
  name: string;
  avatarKey: string | null;
  onGewaehlt: (lokaleUri: string) => void;
  onEntfernen: () => void;
  laeuft?: boolean;
}) {
  const { colors } = useTheme();
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const oeffnen = () => {
    setFehler(null);
    setOffen(true);
  };

  const waehlen = async (quelle: 'galerie' | 'kamera') => {
    setFehler(null);
    const recht = quelle === 'galerie'
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!recht.granted) {
      setFehler(
        quelle === 'galerie'
          ? 'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.'
          : 'Ohne Zugriff auf die Kamera geht es nicht. Du kannst das in den Einstellungen ändern.'
      );
      return;
    }

    const ergebnis = quelle === 'galerie'
      ? await ImagePicker.launchImageLibraryAsync(OPTIONEN)
      : await ImagePicker.launchCameraAsync(OPTIONEN);

    // Abbruch ist kein Fehler: das Sheet schliesst, sonst nichts.
    if (ergebnis.canceled || !ergebnis.assets?.[0]) {
      setOffen(false);
      return;
    }
    setOffen(false);
    onGewaehlt(ergebnis.assets[0].uri);
  };

  return (
    <View>
      <PressScale
        testID="avatar-waehler"
        accessibilityRole="button"
        accessibilityLabel={avatarKey ? 'Profilbild ändern' : 'Profilbild hinzufügen'}
        onPress={oeffnen}
      >
        <View>
          <Avatar name={name} avatarKey={avatarKey} size={GROESSE} />
          {/* Ohne dieses Badge liest sich der Kreis als blosse Anzeige. Es
              sagt «hier lässt sich etwas ändern», ohne eine zweite Zeile Text. */}
          <View
            testID="avatar-waehler-badge"
            style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors['bg-0'] }]}
          >
            <Camera size={10} color={colors['on-accent']} strokeWidth={1.75} />
          </View>
          {laeuft && (
            <View style={[styles.spinner, { backgroundColor: colors['bg-0'] }]}>
              <ActivityIndicator testID="avatar-laeuft" size="small" color={colors['text-1']} />
            </View>
          )}
        </View>
      </PressScale>

      {fehler && (
        <Text style={[type.secondary, styles.fehler, { color: colors.danger }]}>{fehler}</Text>
      )}

      <Sheet sichtbar={offen} titel="Profilbild" onSchliessen={() => setOffen(false)}>
        <PressScale accessibilityRole="button" onPress={() => void waehlen('galerie')}>
          <Text style={[type.bodyMedium, styles.eintrag, { color: colors['text-1'] }]}>
            Foto auswählen
          </Text>
        </PressScale>
        <PressScale accessibilityRole="button" onPress={() => void waehlen('kamera')}>
          <Text style={[type.bodyMedium, styles.eintrag, { color: colors['text-1'] }]}>
            Selfie aufnehmen
          </Text>
        </PressScale>
        {avatarKey && (
          <PressScale
            accessibilityRole="button"
            onPress={() => {
              setOffen(false);
              onEntfernen();
            }}
          >
            <Text style={[type.bodyMedium, styles.eintrag, { color: colors.danger }]}>
              Bild entfernen
            </Text>
          </PressScale>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: BADGE,
    height: BADGE,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  eintrag: { paddingVertical: spacing.m },
  fehler: { marginTop: spacing.xs },
});
```

- [ ] **Step 5: Test und Typcheck laufen lassen**

Run: `cd mobile && npx tsc --noEmit && npx jest src/components/__tests__/AvatarWaehler.test.tsx`
Expected: PASS, 7 Tests

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/AvatarWaehler.tsx mobile/src/components/__tests__/AvatarWaehler.test.tsx mobile/package.json mobile/package-lock.json mobile/app.json
git commit -m "feat(profil): Auswahl-Sheet fuer das Profilbild"
```

---

### Task 6: Der Profil-Tab

**Files:**
- Modify: `mobile/src/features/auth/profileApi.ts:3` und `:39`
- Modify: `mobile/src/app/(tabs)/profil.tsx:160-165`
- Test: `mobile/src/features/auth/__tests__/profilTab.test.tsx`

**Interfaces:**
- Consumes: `AvatarWaehler` (Task 5), `setzeAvatar`/`entferneAvatar` (Task 4)
- Produces: `Profile` trägt `avatar_key: string | null`

Ab hier ist das Feature erstmals von Hand erlebbar.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `profilTab.test.tsx` anhängen (die bestehenden Mocks der Datei weiterverwenden; liefert `fetchOwnProfile` dort ein Objekt, `avatar_key: null` ergänzen):

```tsx
test('der Profil-Tab zeigt den Bildwaehler neben dem Namen', async () => {
  await wrap(<ProfilScreen />);
  expect(await screen.findByTestId('avatar-waehler')).toBeTruthy();
});

// Der gewählte Pfad muss ohne erneutes Laden sichtbar werden, sonst wirkt der
// Tap folgenlos, bis der Screen zufällig neu lädt.
test('ein gewaehltes Bild erscheint sofort im Kreis', async () => {
  (setzeAvatar as jest.Mock).mockResolvedValue({
    avatarKey: 'profiles/u1/neu.jpg',
    error: null,
  });
  await wrap(<ProfilScreen />);
  fireEvent.press(await screen.findByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(screen.getByTestId('avatar-bild')).toBeTruthy());
});

test('ein Fehler beim Hochladen steht unter dem Kreis', async () => {
  (setzeAvatar as jest.Mock).mockResolvedValue({
    avatarKey: null,
    error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.',
  });
  await wrap(<ProfilScreen />);
  fireEvent.press(await screen.findByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() =>
    expect(screen.getByText('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.')).toBeTruthy()
  );
});
```

Dazu am Dateikopf `jest.mock('@/features/auth/avatarApi')` und `jest.mock('expo-image-picker', …)` wie in Task 5.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/auth/__tests__/profilTab.test.tsx`
Expected: FAIL, `avatar-waehler` nicht gefunden

- [ ] **Step 3: profileApi erweitern**

`profileApi.ts:3`:

```ts
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
};
```

`profileApi.ts:39` — Select ergänzen:

```ts
    .select('id, username, display_name, avatar_key')
```

- [ ] **Step 4: Den Profil-Tab umbauen**

Die Namens-Card in `profil.tsx:160-165` wird zur Zeile mit Bild:

```tsx
        <Card style={styles.profilZeile}>
          <AvatarWaehler
            name={profile?.display_name ?? ''}
            avatarKey={profile?.avatar_key ?? null}
            laeuft={bildLaeuft}
            onGewaehlt={(uri) => void bildSetzen(uri)}
            onEntfernen={() => void bildEntfernen()}
          />
          <View style={styles.profilText}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              {profile ? `@${profile.username}` : ''}
            </Text>
          </View>
        </Card>
        {bildFehler && (
          <Text style={[type.secondary, { color: colors.danger }]}>{bildFehler}</Text>
        )}
```

State und Handler oberhalb von `return`:

```tsx
  const [bildLaeuft, setBildLaeuft] = useState(false);
  const [bildFehler, setBildFehler] = useState<string | null>(null);

  // Der neue Schlüssel wird lokal in den State geschrieben, statt das Profil
  // neu zu laden: die Antwort von setzeAvatar IST der neue Stand, ein zweiter
  // Rundgang zur Datenbank brächte dasselbe Ergebnis eine Netzlatenz später.
  const bildSetzen = async (uri: string) => {
    if (!userId) return;
    setBildLaeuft(true);
    setBildFehler(null);
    const { avatarKey, error } = await setzeAvatar(userId, uri, profile?.avatar_key ?? null);
    setBildLaeuft(false);
    if (error) return setBildFehler(error);
    setProfile((vorher) => (vorher ? { ...vorher, avatar_key: avatarKey } : vorher));
  };

  const bildEntfernen = async () => {
    if (!userId) return;
    setBildLaeuft(true);
    setBildFehler(null);
    const { error } = await entferneAvatar(userId, profile?.avatar_key ?? null);
    setBildLaeuft(false);
    if (error) return setBildFehler(error);
    setProfile((vorher) => (vorher ? { ...vorher, avatar_key: null } : vorher));
  };
```

Styles ergänzen:

```tsx
  profilZeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  profilText: { flex: 1, gap: spacing.xs },
```

Der bisherige `style={{ gap: spacing.xs }}` an der Card entfällt dabei. Importe ergänzen: `AvatarWaehler`, `setzeAvatar`, `entferneAvatar`.

- [ ] **Step 5: Tests und Typcheck laufen lassen**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS. Bricht ein anderer Test, weil `Profile` jetzt `avatar_key` verlangt, dort `avatar_key: null` in die Testdaten ergänzen.

- [ ] **Step 6: Von Hand prüfen**

Run: `cd mobile && npx expo run:ios`
Prüfen: Profil-Tab öffnen, Kreis antippen, Foto aus der Galerie wählen, quadratisch zuschneiden, bestätigen. Das Bild erscheint im Kreis. App neu starten — das Bild ist noch da. Dann «Bild entfernen»: die Initiale kommt zurück.

Lädt das Bild nicht, zuerst `EXPO_PUBLIC_SUPABASE_URL` in `mobile/.env` gegen die aktuelle LAN-IP prüfen (`ifconfig | grep "inet "`). Eine per DHCP gewechselte Adresse ist hier die wahrscheinlichste Ursache, nicht der Code.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/features/auth/ "mobile/src/app/(tabs)/profil.tsx"
git commit -m "feat(profil): Profilbild im Profil-Tab setzen und entfernen"
```

---

### Task 7: Das Onboarding

**Files:**
- Modify: `mobile/src/app/(auth)/profile-setup.tsx`
- Modify: `mobile/src/features/auth/profileApi.ts:21-34` (`createProfile`)
- Test: `mobile/src/features/auth/__tests__/profileApi.test.ts`, neue Datei `mobile/src/app/(auth)/__tests__/profile-setup.test.tsx`

**Interfaces:**
- Consumes: `AvatarWaehler` (Task 5), `setzeAvatar` (Task 4)
- Produces: `createProfile(userId, username, displayName, avatarKey?: string | null)`

**Die Reihenfolge ist hier umgekehrt:** Im Onboarding existiert die Profilzeile noch nicht, wenn das Bild gewählt wird. Das Bild wird deshalb erst beim Absenden hochgeladen — vorher hält der Screen nur die lokale URI. Ein Upload vor dem Anlegen der Zeile würde zwar durchgehen (die Storage-Policy prüft nur den Ordner), hinterliesse aber ein Objekt ohne Zeile, wenn jemand das Onboarding abbricht.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Neue Datei `mobile/src/app/(auth)/__tests__/profile-setup.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import ProfileSetupScreen from '../profile-setup';
import { createProfile } from '@/features/auth/profileApi';
import { setzeAvatar } from '@/features/auth/avatarApi';

jest.mock('@/features/auth/profileApi', () => ({
  ...jest.requireActual('@/features/auth/profileApi'),
  createProfile: jest.fn(),
}));
jest.mock('@/features/auth/avatarApi');
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'u1', refreshProfile: jest.fn() }),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///gewaehlt.jpg' }] }),
  launchCameraAsync: async () => ({ canceled: true, assets: null }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  (createProfile as jest.Mock).mockResolvedValue({ error: null, feld: null });
  (setzeAvatar as jest.Mock).mockResolvedValue({ avatarKey: 'profiles/u1/neu.jpg', error: null });
});

test('das Onboarding zeigt den Bildwaehler', async () => {
  await wrap(<ProfileSetupScreen />);
  expect(screen.getByTestId('avatar-waehler')).toBeTruthy();
});

// Überspringbar heisst: ohne Bild kommt man durch, und createProfile bekommt
// null, keinen leeren String (Leerstrings waren in diesem Schema schon einmal
// ein Problem, siehe 20260808150000_leerstrings_und_profil_grants.sql).
test('ohne Bild geht es weiter, avatar_key bleibt null', async () => {
  await wrap(<ProfileSetupScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('lea_2026'), 'lea_2026');
  fireEvent.changeText(screen.getByPlaceholderText('Lea'), 'Lea');
  fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() => expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', null));
  expect(setzeAvatar).not.toHaveBeenCalled();
});

// Erst hochladen, dann die Zeile anlegen: createProfile schreibt avatar_key
// direkt mit, ein nachgelagertes Update wäre ein zweiter Schreibvorgang, der
// scheitern kann, nachdem das Profil schon steht.
test('ein gewaehltes Bild wird vor dem Anlegen hochgeladen', async () => {
  await wrap(<ProfileSetupScreen />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(screen.getByTestId('avatar-bild')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('lea_2026'), 'lea_2026');
  fireEvent.changeText(screen.getByPlaceholderText('Lea'), 'Lea');
  fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() =>
    expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', 'profiles/u1/neu.jpg')
  );
});

// Ein gescheiterter Upload darf das Onboarding nicht blockieren — der Name ist
// das Pflichtfeld, das Bild ist die Zugabe.
test('ein gescheiterter Upload legt das Profil trotzdem an', async () => {
  (setzeAvatar as jest.Mock).mockResolvedValue({ avatarKey: null, error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.' });
  await wrap(<ProfileSetupScreen />);
  fireEvent.press(screen.getByTestId('avatar-waehler'));
  fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(screen.getByTestId('avatar-bild')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('lea_2026'), 'lea_2026');
  fireEvent.changeText(screen.getByPlaceholderText('Lea'), 'Lea');
  fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() => expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', null));
});
```

Ergänzend in `profileApi.test.ts`:

```ts
test('createProfile schreibt avatar_key mit', async () => {
  await createProfile('u1', 'lea', 'Lea', 'profiles/u1/a.jpg');
  expect(insertSpy).toHaveBeenCalledWith({
    id: 'u1',
    username: 'lea',
    display_name: 'Lea',
    avatar_key: 'profiles/u1/a.jpg',
  });
});

test('createProfile ohne Bild schreibt null', async () => {
  await createProfile('u1', 'lea', 'Lea');
  expect(insertSpy).toHaveBeenCalledWith({
    id: 'u1',
    username: 'lea',
    display_name: 'Lea',
    avatar_key: null,
  });
});
```

(`insertSpy` ist der bereits in dieser Datei vorhandene Mock des `insert`-Aufrufs; heisst er dort anders, den vorhandenen Namen verwenden.)

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/app/\(auth\)/__tests__ src/features/auth/__tests__/profileApi.test.ts`
Expected: FAIL — `avatar-waehler` fehlt, `createProfile` nimmt kein viertes Argument.

- [ ] **Step 3: createProfile erweitern**

```ts
export async function createProfile(
  userId: string,
  username: string,
  displayName: string,
  avatarKey: string | null = null
): Promise<{ error: string | null; feld: 'username' | null }> {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, username, display_name: displayName.trim(), avatar_key: avatarKey });
```

Der Rest der Funktion bleibt unverändert.

- [ ] **Step 4: Den Onboarding-Screen umbauen**

State ergänzen:

```tsx
  const [bildUri, setBildUri] = useState<string | null>(null);
```

`submit` erweitert sich um den Upload vor dem Anlegen:

```tsx
  const submit = async () => {
    const uErr = validateUsername(username);
    const dErr = validateDisplayName(displayName);
    setUsernameError(uErr ?? undefined);
    setDisplayNameError(dErr ?? undefined);
    setFormularFehler(null);
    if (uErr || dErr || !userId) return;
    setLoading(true);

    // Das Bild wird erst hier hochgeladen, nicht schon bei der Auswahl: vorher
    // gibt es die Profilzeile noch nicht, und ein Abbruch des Onboardings
    // hinterliesse ein Objekt, das zu niemandem gehört.
    //
    // Scheitert der Upload, geht es OHNE Bild weiter. Der Name ist das
    // Pflichtfeld, das Bild die Zugabe; jemanden am Onboarding scheitern zu
    // lassen, weil ein Foto nicht durchkam, wäre die falsche Gewichtung.
    let avatarKey: string | null = null;
    if (bildUri) {
      const ergebnis = await setzeAvatar(userId, bildUri, null);
      avatarKey = ergebnis.avatarKey;
    }

    const { error, feld } = await createProfile(userId, username, displayName, avatarKey);
    setLoading(false);
    if (error) {
      if (feld === 'username') return setUsernameError(error);
      return setFormularFehler(error);
    }
    await refreshProfile(); // Guard leitet zu den Tabs weiter
  };
```

**Achtung:** `setzeAvatar` setzt intern `profiles.avatar_key` per UPDATE — hier trifft das auf null Zeilen, weil die Zeile noch nicht existiert. Das ist kein Fehler (ein UPDATE ohne Treffer liefert keinen), und der zurückgegebene Schlüssel stimmt trotzdem, weil er vor dem Upload gebildet wird. Der Wert landet über `createProfile` in der Zeile.

Im JSX über den beiden Feldern:

```tsx
      <View style={styles.bildZeile}>
        <AvatarWaehler
          name={displayName}
          avatarKey={bildUri ? 'lokal' : null}
          onGewaehlt={setBildUri}
          onEntfernen={() => setBildUri(null)}
        />
        <Text style={[type.secondary, { color: colors['text-2'] }]}>Profilbild (optional)</Text>
      </View>
```

**Problem und Lösung:** `AvatarWaehler` zeigt Bilder über einen `avatarKey`, hier gibt es aber nur eine lokale URI. Statt eines Scheinwerts bekommt `AvatarWaehler` eine zusätzliche optionale Prop:

```tsx
  lokaleUri?: string | null;
```

und in `Avatar` wird sie durchgereicht, indem `AvatarWaehler` bei gesetzter `lokaleUri` ein eigenes `Image` statt des `Avatar` rendert:

```tsx
        {lokaleUri ? (
          <View style={[styles.lokalerKreis, { borderColor: colors['bg-0'], backgroundColor: colors['bg-1'] }]}>
            <Image testID="avatar-bild" source={{ uri: lokaleUri }} style={styles.lokalesBild} contentFit="cover" />
          </View>
        ) : (
          <Avatar name={name} avatarKey={avatarKey} size={GROESSE} />
        )}
```

mit

```tsx
  lokalerKreis: {
    width: GROESSE, height: GROESSE, borderRadius: radius.pill,
    borderWidth: 2, overflow: 'hidden',
  },
  lokalesBild: { width: '100%', height: '100%' },
```

Das Onboarding übergibt dann `lokaleUri={bildUri}` und `avatarKey={null}`; der Profil-Tab lässt die Prop weg.

Style im Onboarding:

```tsx
  bildZeile: { alignItems: 'center', gap: spacing.s },
```

- [ ] **Step 5: Tests und Typcheck laufen lassen**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "mobile/src/app/(auth)/" mobile/src/features/auth/ mobile/src/components/AvatarWaehler.tsx
git commit -m "feat(profil): Profilbild schon im Onboarding waehlen"
```

---

### Task 8: Gesichter in Reise-Karte und Mitglieder-Sheet

**Files:**
- Modify: `mobile/src/features/trips/tripsApi.ts:21`, `:24`, `:26-31`, `:200`, `:209`, `:218`
- Modify: `mobile/src/features/trips/types.ts:15-21` (`TripMember`)
- Modify: `mobile/src/app/(tabs)/reise/[id]/index.tsx:659`, `:851`
- Test: `mobile/src/features/trips/__tests__/tripsApi.test.ts`, `mobile/src/app/(tabs)/reise/__tests__/detail.test.tsx`

**Interfaces:**
- Consumes: `Gesicht` (Task 3)
- Produces: `TripMember` trägt `avatar_key: string | null`; `Trip.mitglieder` trägt echte Schlüssel

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `tripsApi.test.ts`. Die Datei mockt die Supabase-Antwort bereits; in den dortigen Antwortdaten bekommt das `profiles`-Objekt jeder Mitgliedszeile zusätzlich ein `avatar_key` — bei der ersten Person einen Pfad, bei der zweiten `null`, damit beide Fälle in einer Zusicherung stehen:

```ts
// Name und Schlüssel gehören zusammen. Zwei getrennte Listen (Namen hier,
// Schlüssel dort) liefen bei der ersten Person ohne Profil auseinander, und
// dann trüge ein Gesicht das Bild eines anderen.
test('die Reise-Karte bekommt Gesichter samt Bildschluessel', async () => {
  const trips = await fetchTrips();
  expect(trips[0].mitglieder).toEqual([
    { name: 'Lea', avatarKey: 'profiles/u1/a.jpg' },
    { name: 'Ben', avatarKey: null },
  ]);
});

test('fetchMembers liefert den Bildschluessel mit', async () => {
  const mitglieder = await fetchMembers('t1');
  expect(mitglieder[0].avatar_key).toBe('profiles/u1/a.jpg');
});
```

In `detail.test.tsx` gibt es bereits einen Test, der das Mitglieder-Sheet öffnet (der Kommentar «im Sheet stehen trotzdem alle» bei Zeile 297 markiert ihn). Den dortigen Öffnungsweg übernehmen und danach zusichern:

```tsx
test('das Mitglieder-Sheet zeigt vorhandene Profilbilder', async () => {
  await wrap(<ReiseDetailScreen />);
  fireEvent.press(await screen.findByTestId('mitglieder-oeffnen'));
  expect(await screen.findByTestId('avatar-bild')).toBeTruthy();
});
```

Heisst die testID im Screen anders, die vorhandene aus dem Nachbartest übernehmen statt eine neue einzuführen. In den Mock-Mitgliedern der Datei bei mindestens einer Person `avatar_key: 'profiles/u1/a.jpg'` setzen — sonst prüft der Test nichts.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/trips src/app/\(tabs\)/reise`
Expected: FAIL — `avatarKey` ist überall null, `avatar_key` existiert nicht auf `TripMember`.

- [ ] **Step 3: tripsApi erweitern**

Zeile 21:

```ts
const MIT_MITGLIEDERN = `${SPALTEN}, trip_members(profiles(display_name, avatar_key))`;
```

Zeile 24:

```ts
type TripRow = Omit<Trip, 'mitglieder' | 'member_count' | 'my_post_count'> & {
  trip_members: { profiles: { display_name: string; avatar_key: string | null } | null }[] | null;
};
```

Zeile 26-31 — Name und Schlüssel bleiben zusammen, statt zwei Listen zu führen:

```ts
  const mitglieder: Gesicht[] = (row.trip_members ?? [])
    .map((m) => m.profiles)
    .filter((p): p is { display_name: string; avatar_key: string | null } => !!p?.display_name)
    .map((p) => ({ name: p.display_name, avatarKey: p.avatar_key }));
```

`member_count` weiterhin aus `mitglieder.length` ableiten, falls es das bisher aus `names.length` tat.

Zeile 200:

```ts
    .select('user_id, role, profiles(username, display_name, avatar_key)')
```

Zeile 209:

```ts
  type Row = {
    user_id: string;
    role: 'owner' | 'member';
    profiles: { username: string; display_name: string; avatar_key: string | null } | null;
  };
```

Zeile 218 — im gemappten Objekt ergänzen:

```ts
      avatar_key: r.profiles?.avatar_key ?? null,
```

`types.ts` — `TripMember` ergänzen:

```ts
export type TripMember = {
  user_id: string;
  role: 'owner' | 'member';
  username: string;
  display_name: string;
  avatar_key: string | null;
};
```

- [ ] **Step 4: Die zwei Anzeigestellen füttern**

`reise/[id]/index.tsx:659`:

```tsx
              <AvatarGroup
                gesichter={mitglieder.map((m) => ({ name: m.display_name, avatarKey: m.avatar_key }))}
              />
```

`reise/[id]/index.tsx:851`:

```tsx
              <Avatar name={m.display_name} avatarKey={m.avatar_key} />
```

- [ ] **Step 5: Tests und Typcheck laufen lassen**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/trips/ "mobile/src/app/(tabs)/reise/"
git commit -m "feat(profil): Gesichter in Reise-Karte und Mitglieder-Sheet"
```

---

### Task 9: Der Recap-Player

**Files:**
- Modify: `mobile/src/features/recap/recapApi.ts:40`, `:44`, `:79`
- Modify: `mobile/src/features/recap/types.ts:23`
- Modify: `mobile/src/app/(tabs)/recap/[id]/player.tsx:262-270`, `:1381`, `:1671`
- Test: `mobile/src/features/recap/__tests__/recapApi.test.ts`, `mobile/src/app/(tabs)/recap/__tests__/player.test.tsx`

**Interfaces:**
- Consumes: `Avatar` mit `kino` (Task 3)
- Produces: `RecapMoment` trägt `autor_avatar_key: string | null`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `recapApi.test.ts`:

```ts
test('ein Moment traegt den Bildschluessel seiner Autorin', async () => {
  const momente = await fetchRecapMomente('t1');
  expect(momente[0].autor_avatar_key).toBe('profiles/u1/a.jpg');
});

// display_name fällt auf '' zurück, wenn das Profil fehlt; der Schlüssel muss
// denselben Weg gehen und null werden, nicht undefined.
test('ohne Profil bleibt der Bildschluessel null', async () => {
  const momente = await fetchRecapMomente('t2');
  expect(momente[0].autor_avatar_key).toBeNull();
});
```

In `player.test.tsx`:

```tsx
test('der Player zeigt das Profilbild der Autorin', async () => {
  await wrap(<PlayerScreen />);
  expect(await screen.findByTestId('avatar-bild')).toBeTruthy();
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/recap src/app/\(tabs\)/recap`
Expected: FAIL — `autor_avatar_key` existiert nicht.

- [ ] **Step 3: recapApi erweitern**

Zeile 40:

```ts
  'profiles!posts_author_id_fkey(display_name, avatar_key)',
```

Zeile 44:

```ts
  profiles: { display_name: string; avatar_key: string | null } | null;
```

Zeile 79 — daneben ergänzen:

```ts
    autor_avatar_key: row.profiles?.avatar_key ?? null,
```

`recap/types.ts:23` — beim bestehenden `autor_name` ergänzen:

```ts
  // Wie autor_name aus dem profiles-Join (recapApi.fetchRecapMomente). Null
  // heisst «kein Bild», dann trägt der Kreis die Initiale.
  autor_avatar_key: string | null;
```

- [ ] **Step 4: Die lokale Kopie durch die Kino-Variante ersetzen**

In `player.tsx` die lokale Funktion `AvatarInitiale` (Zeilen 262-270) samt ihrem Style `avatarKreis` (Zeile 1671) **löschen** und den Aufruf bei Zeile 1381 ersetzen:

```tsx
              <Avatar name={aktivMoment.autor_name} avatarKey={aktivMoment.autor_avatar_key} kino />
```

Import ergänzen: `import { Avatar } from '@/components/Avatar';`

Der Kommentar über der gelöschten Funktion («Initiale statt echtem Bild, Avatar.tsx macht dasselbe für die helle Palette») verschwindet mit ihr — er beschreibt genau den Zustand, den dieser Task beendet.

- [ ] **Step 5: Tests und Typcheck laufen lassen**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/recap/ "mobile/src/app/(tabs)/recap/"
git commit -m "feat(profil): Gesichter im Recap-Player, lokale Kopie entfaellt"
```

---

### Task 10: Der geteilte Recap

**Files:**
- Modify: `supabase/functions/share-link/store.ts` (Select um `avatar_key`)
- Modify: `supabase/functions/share-link/aufloesung.ts:183`, `:267`, `:345`
- Modify: `mobile/src/app/teilen/[token].tsx:182-190`, `:1052`, `:1143`
- Test: `supabase/functions/share-link/aufloesung_test.ts`, `mobile/src/app/teilen/__tests__/token.test.tsx`

**Interfaces:**
- Produces: `OeffentlicherMoment` trägt `autor_avatar_key: string | null`

**Die Function gibt nur den Schlüssel heraus, nie eine URL.** Der Web-Betrachter baut sie mit derselben Formel. Damit bleibt `avatarUrl()` die einzige Stelle im System, die das Format kennt.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `aufloesung_test.ts`, im Stil der bestehenden Fälle:

```ts
// Eine Zeile, wie store.ts sie geflacht liefert. `storage_key` muss zur
// Ableitung aus keys.ts passen (`trips/<trip>/<post>.<ext>`), sonst sortiert
// baueMedien den Moment aus und `medien` wäre leer.
const zeile = (avatarKey: string | null): MomentZeile => ({
  id: 'p1',
  type: 'photo',
  media_ext: 'jpg',
  storage_key: 'trips/t1/p1.jpg',
  thumb_key: 'trips/t1/p1_t.jpg',
  captured_at: '2026-08-01T10:00:00Z',
  captured_tz: 'Europe/Zurich',
  place_name: null,
  lat: null,
  lng: null,
  caption: null,
  duration_s: null,
  autor_name: 'Lea',
  autor_avatar_key: avatarKey,
});

Deno.test('baueMedien reicht den Avatar-Schluessel durch', async () => {
  const { medien } = await baueMedien('t1', [zeile('profiles/u1/a.jpg')], async (k) => `https://sig/${k}`);
  assertEquals(medien[0].autor_avatar_key, 'profiles/u1/a.jpg');
});

// Wie autor_name: ein fehlender Wert wird zu null, nie zu undefined. Ein Feld,
// das mal fehlt, wird beim Bauen des Web-Players übersehen.
Deno.test('ohne Bild steht null im Vertrag, nicht undefined', async () => {
  const { medien } = await baueMedien('t1', [zeile(null)], async (k) => `https://sig/${k}`);
  assertEquals(medien[0].autor_avatar_key, null);
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd supabase/functions/share-link && deno test --allow-all aufloesung_test.ts`
Expected: FAIL — `autor_avatar_key` existiert auf keinem der beiden Typen.

- [ ] **Step 3: Die Function erweitern**

`aufloesung.ts:183`, bei `autor_name` in `MomentZeile`:

```ts
  // Wie autor_name aus dem PostgREST-Embed geflacht (store.ts). Der Schlüssel
  // geht heraus, nie eine fertige URL: die Formel kennt allein der Client
  // (mobile/src/features/auth/avatar.ts), und sie soll genau einen Ort haben.
  autor_avatar_key: string | null;
```

`aufloesung.ts:267`, in `OeffentlicherMoment` (nicht optional, `| null`, aus demselben Grund wie `lat`/`lng` dort):

```ts
  autor_avatar_key: string | null;
```

`aufloesung.ts:345`, im gebauten Objekt neben `autor_name`:

```ts
        autor_avatar_key: zeile.autor_avatar_key,
```

In `store.ts` den `profiles`-Embed des Momente-Selects von `profiles(display_name)` auf `profiles(display_name, avatar_key)` erweitern und beim Flachklopfen `autor_avatar_key: zeile.profiles?.avatar_key ?? null` ergänzen (analog zum vorhandenen `autor_name`).

- [ ] **Step 4: Den Web-Betrachter umbauen**

`teilen/[token].tsx`: Die lokale `AvatarInitiale` (Zeilen 182-190) und ihr Style `avatarKreis` (Zeile 1143) **löschen**, Aufruf bei Zeile 1052 ersetzen:

```tsx
            <Avatar name={aktivMoment.autor_name} avatarKey={aktivMoment.autor_avatar_key} kino />
```

**Vor dem Import prüfen:** `teilen/__tests__/modulgraph.test.ts` verbietet diesem Screen bestimmte Importe, damit er `recapApi`/`urlVorrat`/`tripsApi` nicht in seinen Modulgraph zieht. `components/Avatar.tsx` importiert nach Task 3 `features/auth/avatar.ts`, und das importiert nur `expo-crypto`. Nach dem Umbau `npx jest src/app/teilen/__tests__/modulgraph.test.ts` laufen lassen. Schlägt er an, `avatarUrl` in eine Datei ohne weitere Abhängigkeiten ziehen, statt die Prüfung zu lockern — sie ist der Grund, warum der geteilte Recap schlank bleibt.

Den lokalen Typ des Moments im Screen um `autor_avatar_key: string | null` erweitern.

- [ ] **Step 5: Alle Tests laufen lassen**

Run: `cd supabase/functions/share-link && deno test --allow-all` und `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/share-link/ mobile/src/app/teilen/
git commit -m "feat(profil): Gesichter im geteilten Recap"
```

---

### Task 11: Kontolöschung räumt den Avatar mit weg

**Files:**
- Modify: `supabase/functions/konto-loeschen/ablauf.ts:138-145` (`fuehreLoeschungAus`)
- Modify: `supabase/functions/konto-loeschen/store.ts` (neuer Löscher)
- Modify: `supabase/functions/konto-loeschen/index.ts:264-302`
- Test: `supabase/functions/konto-loeschen/ablauf_test.ts`

**Interfaces:**
- Produces: `fuehreLoeschungAus(speicher: Schritt[], datenbank: Schritt[])` — der erste Parameter wird zur Liste; `store.loescheAvatar(key: string | null): Promise<{ fehler: unknown }>`

**Warum die Signatur wechselt:** Es gibt jetzt zwei Speicherorte (R2 für Momente, Supabase Storage für Avatare). Beide müssen vor der Datenbank fertig sein, und bei einem Fehlschlag darf die Datenbank unberührt bleiben — genau die Zusicherung, die die Funktion heute für einen Schritt gibt. Sie auf eine Liste zu heben bewahrt diese Zusicherung und lässt `gescheitertBei` weiterhin benennen, *welcher* Speicher versagt hat. Ein zusammengesetzter Einzelschritt täte das nicht.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `ablauf_test.ts` — die bestehenden Aufrufe von `fuehreLoeschungAus(speicher, datenbank)` auf `[speicher]` umstellen und ergänzen:

```ts
Deno.test('alle Speicherschritte laufen vor der Datenbank', async () => {
  const reihenfolge: string[] = [];
  const ergebnis = await fuehreLoeschungAus(
    [
      { name: 'medien', ausfuehren: async () => { reihenfolge.push('medien'); return { fehler: null }; } },
      { name: 'avatar', ausfuehren: async () => { reihenfolge.push('avatar'); return { fehler: null }; } },
    ],
    [{ name: 'db', ausfuehren: async () => { reihenfolge.push('db'); return { fehler: null }; } }],
  );
  assertEquals(ergebnis.ok, true);
  assertEquals(reihenfolge, ['medien', 'avatar', 'db']);
});

// Der Kern der Zusicherung: scheitert IRGENDEIN Speicherschritt, bleibt die
// Datenbank unberührt. Ein Konto, das noch existiert, ist besser als eines,
// dessen Bilder verwaist im Speicher liegen.
Deno.test('ein gescheiterter zweiter Speicherschritt laesst die Datenbank in Ruhe', async () => {
  let dbLief = false;
  const ergebnis = await fuehreLoeschungAus(
    [
      { name: 'medien', ausfuehren: async () => ({ fehler: null }) },
      { name: 'avatar', ausfuehren: async () => ({ fehler: new Error('weg') }) },
    ],
    [{ name: 'db', ausfuehren: async () => { dbLief = true; return { fehler: null }; } }],
  );
  assertEquals(ergebnis.ok, false);
  assertEquals(dbLief, false);
  if (!ergebnis.ok) {
    assertEquals(ergebnis.gescheitertBei, 'avatar');
    assertEquals(ergebnis.datenbankBeruehrt, false);
  }
});

// Nach einem Fehlschlag darf kein weiterer Speicherschritt mehr laufen: der
// zweite könnte löschen, was der erste noch braucht, wenn jemand später
// Abhängigkeiten zwischen ihnen einführt.
Deno.test('nach einem gescheiterten Speicherschritt stoppt die Kette', async () => {
  let zweiterLief = false;
  await fuehreLoeschungAus(
    [
      { name: 'medien', ausfuehren: async () => ({ fehler: new Error('weg') }) },
      { name: 'avatar', ausfuehren: async () => { zweiterLief = true; return { fehler: null }; } },
    ],
    [],
  );
  assertEquals(zweiterLief, false);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd supabase/functions/konto-loeschen && deno test --allow-all ablauf_test.ts`
Expected: FAIL — `fuehreLoeschungAus` nimmt kein Array.

- [ ] **Step 3: fuehreLoeschungAus auf eine Liste heben**

```ts
// speicher läuft ZUERST und allein. Erst wenn ALLE Speicherschritte ohne
// Fehler zurückkommen, beginnt die Datenbank, und die Schritte darin laufen
// streng nacheinander, jeder erst nach dem vorigen.
//
// Seit dem Profilbild sind es zwei Speicherorte: die Momente in R2 und der
// Avatar in Supabase Storage. Beide müssen fertig sein, bevor die Datenbank
// angefasst wird, denn ein Objekt ohne Zeile ist Müll, den niemand mehr
// findet. Eine Liste statt eines Schritts hält diese Zusicherung und lässt
// `gescheitertBei` weiterhin benennen, welcher Speicher versagt hat.
export async function fuehreLoeschungAus(
  speicher: Schritt[],
  datenbank: Schritt[],
): Promise<LoeschErgebnis> {
  for (const schritt of speicher) {
    let ergebnis: { fehler: unknown };
    try {
      ergebnis = await schritt.ausfuehren();
    } catch (err) {
      // Eine geworfene Ausnahme ist derselbe Fall wie ein zurückgegebener
      // Fehler: die Datenbank bleibt unberührt.
      return { ok: false, gescheitertBei: schritt.name, fehler: err, datenbankBeruehrt: false };
    }
    if (ergebnis.fehler) {
      return {
        ok: false,
        gescheitertBei: schritt.name,
        fehler: ergebnis.fehler,
        datenbankBeruehrt: false,
      };
    }
  }

  for (const schritt of datenbank) {
    let ergebnis: { fehler: unknown };
    try {
      ergebnis = await schritt.ausfuehren();
    } catch (err) {
      return { ok: false, gescheitertBei: schritt.name, fehler: err, datenbankBeruehrt: true };
    }
    if (ergebnis.fehler) {
      return { ok: false, gescheitertBei: schritt.name, fehler: ergebnis.fehler, datenbankBeruehrt: true };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Den Avatar-Löscher ergänzen**

In `store.ts` als **neue Methode von `erstelleKontoStore`**, nicht als eigene Factory: die Funktion bekommt `supabaseAdmin` (Typ `AdminClient`, Zeile 194) bereits übergeben, und jeder andere Datenbank- und Speicherzugriff dieser Function liegt ebenfalls dort. Neben `holeAvatarKey` einfügen:

```ts
    // Der Avatar liegt NICHT im S3-Bucket der Momente, sondern im
    // Supabase-Storage-Bucket `avatare` (Spec 2026-08-12-profilbild-design.md).
    // Deshalb dieser Weg statt loescheObjekte/erstelleS3Loescher: derselbe
    // Admin-Client, den der Store ohnehin hält, und ein Bucket-Name als
    // Konstante, weil er lokal und produktiv gleich heisst.
    //
    // Ein bereits gelöschtes Objekt ist kein Fehler (remove() ist idempotent),
    // dieselbe Eigenschaft, auf der die Wiederholbarkeit der ganzen Löschung
    // ruht (siehe erstelleS3Loescher).
    async loescheAvatar(key: string | null): Promise<{ fehler: unknown }> {
      if (!key) return { fehler: null };
      const { error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([key]);
      return { fehler: error };
    },
```

Und am Dateikopf, bei den übrigen Konstanten:

```ts
const AVATAR_BUCKET = 'avatare';
```

- [ ] **Step 5: index.ts umbauen**

Bei Zeile 264 den Avatar aus der S3-Schlüsselliste heraushalten — er wird separat gelöscht, gehört aber weiterhin durch den Wächter:

```ts
  // Der Wächter entscheidet unverändert, ob der Pfad zu dieser Löschung
  // gehört (pfadGehoertUns, ausführliche Begründung dort). Nur das Ziel ist
  // ein anderes: der Avatar liegt im Bucket `avatare`, nicht im S3-Bucket der
  // Momente, und wird darum unten als eigener Speicherschritt gelöscht statt
  // hier in die Schlüsselliste geworfen.
  let avatarZumLoeschen: string | null = null;
  if (pfadGehoertUns(avatarKey, erlaubtePraefixe)) {
    avatarZumLoeschen = avatarKey;
  } else if (avatarKey) {
    ungeklaertePfade.push(avatarKey);
  }

  for (const kandidat of trips.map((t) => t.cover_key)) {
    if (kandidat === null || kandidat === undefined || kandidat.length === 0) continue;
    if (pfadGehoertUns(kandidat, erlaubtePraefixe)) schluessel.push(kandidat);
    else ungeklaertePfade.push(kandidat);
  }
```

(Die vorhandene `for`-Schleife über `[avatarKey, ...trips.map(…)]` wird dadurch ersetzt.)

Und die Schrittliste:

```ts
  const speicher: Schritt[] = [
    { name: 'speicher-medien', ausfuehren: () => store.loescheObjekte(schluessel) },
    // Nach den Medien: scheitert schon jener Schritt, bleibt ohnehin alles
    // liegen, und die Datenbank wird nicht angefasst.
    { name: 'speicher-avatar', ausfuehren: () => store.loescheAvatar(avatarZumLoeschen) },
  ];
```

Der Aufruf wird zu `await fuehreLoeschungAus(speicher, datenbank)` — unverändert, weil `speicher` jetzt die Liste ist.

- [ ] **Step 6: Alle Tests laufen lassen**

Run: `cd supabase/functions/konto-loeschen && deno test --allow-all`
Expected: PASS, inklusive der angepassten bestehenden Fälle.

- [ ] **Step 7: Von Hand prüfen**

Mit dem Seed-Konto anmelden, ein Profilbild setzen, dann in Supabase Studio unter Storage → `avatare` nachsehen, dass das Objekt liegt. Konto löschen. Erneut nachsehen: der Ordner `profiles/<user_id>/` ist leer.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/konto-loeschen/
git commit -m "feat(profil): Kontoloeschung raeumt das Profilbild mit weg"
```

---

## Abschluss

- [ ] **Voller Testlauf**

Run: `cd mobile && npx tsc --noEmit && npm test && npx expo lint`
Run: `supabase test db`
Run: `cd supabase/functions && for d in media-urls share-link konto-loeschen reveal-trip; do (cd $d && deno test --allow-all); done`

`expo lint` meldet in diesem Projekt vorbestehende Fehler. Vor dem Anfangen einmal laufen lassen und die Zahl notieren; am Ende darf sie nicht gestiegen sein.

- [ ] **Gerätelauf**

Auf einem echten Gerät: Bild im Onboarding setzen, Reise anlegen, mit einem zweiten Konto beitreten, prüfen dass beide Gesichter in der Facepile und im Mitglieder-Sheet stehen. Reise abschliessen, Recap öffnen, Bild am Moment prüfen. Recap teilen, Link im Browser öffnen, Bild dort prüfen.

Die Jest-Suite sieht weder echte Navigation noch einen echten Bildwähler — dieser Durchlauf ist der einzige Beleg, dass Auswahl und Zuschnitt auf dem Gerät funktionieren.
