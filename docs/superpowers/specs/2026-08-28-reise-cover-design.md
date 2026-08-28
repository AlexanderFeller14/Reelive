# Reise-Cover beim Anlegen: Design-Spezifikation

**Datum:** 2026-08-28
**Status:** Abgenommen (Brainstorming-Session, Vorschlag A «Bühne» aus drei Varianten)
**Vorschau:** https://claude.ai/code/artifact/1741f684-c053-4dbc-973d-076c50cb421f

## 1. Ziel

Wer eine Reise anlegt, kann ihr direkt ein eigenes Cover geben: ein Foto aus
der Fotos-App, das danach überall dort steht, wo die Reise-Seite heute ein
Platzhalterbild zeigt (Hero-Karte der laufenden Reise, Raster der geplanten
Reisen, Kopf des Reise-Details). Das Cover ist optional. Ohne Cover bleibt
alles, wie es ist.

`trips.cover_key` existiert seit der ersten Migration
(`20260803090000_core_tables.sql`), inklusive Spalten-Grant für `insert` und
`update` an `authenticated` (`20260803090200_membership_rls.sql`). Geschrieben
hat sie kein Codepfad, gelesen wird sie in der App nirgends, und die
Delete-Account-Function nennt sie wörtlich eine Spalte ohne Schreiber.
`TripCover` trägt bereits ein `coverUrl`-Prop und fällt ohne Wert auf
`placeholderCover(position)` zurück. Diese Spec verbindet beides.

## 2. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Wo | Screen «Neue Reise», als grosse Fläche über Name und Zeitraum (Vorschlag A) |
| Quelle | Ein Foto aus der Fotos-App. Keine Kamera, kein Zuschnitt-Dialog in dieser Runde |
| Format | Mittiger Zuschnitt auf 3:2, höchstens 1200 × 800, JPEG |
| Speicher | Öffentlicher Supabase-Storage-Bucket `covers`, unratbarer Schlüssel unter `trips/<trip_id>/` |
| Reihenfolge | Reise anlegen, dann Cover laden, dann `cover_key` setzen |
| Pflicht | Nie. Ohne Cover Platzhalter wie heute |

### Warum der Speicher nicht R2 ist

Momente liegen in R2 hinter kurzlebigen signierten URLs, weil die
Versiegelung daran hängt. Ein Cover ist kein Moment: Die Person, die die Reise
anlegt, wählt es bewusst als Aushängeschild, und jedes Mitglied darf es
jederzeit sehen. Darum gilt derselbe Weg wie beim Profilbild
(`2026-08-12-profilbild-design.md` §2): öffentlicher Bucket, Schutz durch den
unratbaren Schlüssel, keine neue Action in `media-urls`, kein Signier-Aufruf
bei jeder Liste. Die `covers`-Action der Recap-Liste bleibt unangetastet, dort
zählt weiterhin das erste Moment nach dem Reveal.

## 3. Der Screen

### 3.1 Aufbau

`mobile/src/app/(tabs)/trip/new.tsx` bekommt zwischen Untertitel und Namensfeld
die Cover-Fläche. Alles andere bleibt an seinem Platz: Name, Zeitraum, Füller,
Primär-Button «Reise anlegen» unten.

Untertitel neu: «Name und Zeitraum reichen, ein Cover ist optional. Freunde
lädst du gleich danach ein.»

Die Fläche ist eine neue Komponente `TripCoverPicker`
(`mobile/src/components/TripCoverPicker.tsx`), gebaut auf `TripCover` (3:2,
Radius 24, `bg-1`-Unterlage, DESIGN-LANGUAGE §4):

- **Leer:** in der Mitte ein weisser Kreis 48 px (`bg-0`, Radius 999) mit dem
  Lucide-`Plus` (24 px, Stroke 1.75, `text-1`), darunter «Cover wählen»
  (Body-Medium, `text-1`) und «Optional» (Sekundär, `text-2`). Kein Bild in
  der Fläche: Der leere Zustand ist wirklich leer, nicht ein
  Platzhalterbild. Die ganze Fläche ist ein Button
  (`accessibilityLabel="Cover wählen"`), Press-Feedback Scale 0.98.
- **Gewählt:** das Foto füllt die Fläche (lokale URI, `contentFit="cover"`),
  oben rechts sitzt ein `ReliefBadge` «Ändern» (Badge-Sprache auf Covern,
  §4), 12 px vom Rand, als eigener Button
  (`accessibilityLabel="Cover ändern"`). Die Fläche selbst ist in diesem
  Zustand nicht tippbar; nur das Badge.
- **Fehler:** eine Zeile unter der Fläche in `danger` (Sekundär), Text aus
  §3.3.

«Ändern» öffnet ein `Sheet` mit Titel «Cover» und zwei Einträgen im Stil von
`AvatarSheetContent`: «Anderes Foto wählen» und «Cover entfernen». Das Sheet
folgt dem Muster der Sheets im Reise-Detail (`trip/[id]/index.tsx`, ohne
`bottomInset`). «Cover entfernen» verwirft nur die lokale Auswahl; vor dem
Anlegen gibt es nichts auf dem Server zu löschen.

### 3.2 Tastatur und Scrollen

Die Fläche ist 228 px hoch (342 × 228 bei 390 px Breite). Mit dem Namensfeld
im Autofokus steht die Tastatur sofort, und Titel, Fläche, zwei Felder und
Button passen nicht mehr übereinander. Darum:

- Der Inhalt wandert in eine `ScrollView` innerhalb der bestehenden
  `KeyboardAvoidingView`, `contentContainerStyle` mit `flexGrow: 1`, damit der
  Füller den Button weiterhin an den unteren Rand drückt, solange Platz ist.
- `keyboardShouldPersistTaps="handled"` und `keyboardDismissMode="on-drag"`:
  ein Tipp auf die Cover-Fläche oder ein Wischen schliesst die Tastatur, der
  Tipp geht nicht verloren.
- Vor dem Öffnen der Fotos-Auswahl ruft der Screen `Keyboard.dismiss()`, sonst
  steht die Tastatur hinter dem System-Picker und springt danach zurück.
- Der Autofokus des Namensfelds bleibt. Wer zuerst ein Cover will, tippt auf
  die Fläche; sie liegt oberhalb der Tastatur, weil sie direkt unter dem
  Titel steht.

### 3.3 Copy

| Situation | Text |
|---|---|
| Leer, unter dem Plus | «Cover wählen» / «Optional» |
| Badge auf dem Foto | «Ändern» |
| Sheet | Titel «Cover», Einträge «Anderes Foto wählen», «Cover entfernen» |
| Fotos-Zugriff verweigert | «Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.» |
| Picker gescheitert | «Das Bild liess sich nicht öffnen. Probier es nochmal oder nimm ein anderes.» |
| Upload gescheitert | «Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.» |
| Button nach Upload-Fehler | «Nochmal versuchen» |
| Textlink nach Upload-Fehler | «Ohne Cover weiter» |

Vokabular gemäss DESIGN-LANGUAGE §6, keine Gedankenstriche. «hochladen»
kommt in keinem sichtbaren Text vor.

## 4. Bild wählen und aufbereiten

### 4.1 Auswahl

Neue Funktion `pickImageFromLibrary()` in `mobile/src/lib/pickImage.ts`,
herausgelöst aus dem Ablauf in `AvatarSheetContent`
(`mobile/src/components/AvatarPicker.tsx`), damit der Cover-Picker nicht die
Profilbild-Wortwahl erbt:

```ts
type PickResult =
  | { status: 'picked'; uri: string; width: number; height: number }
  | { status: 'canceled' }
  | { status: 'denied' }
  | { status: 'failed' };
export async function pickImageFromLibrary(): Promise<PickResult>;
```

- `requestMediaLibraryPermissionsAsync()`; nicht erteilt heisst `denied`.
- `launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 })`, ohne
  `allowsEditing`: Der System-Zuschnitt erzwingt auf iOS den alten
  `UIImagePickerController` und bricht bei grossen Originalen still mit
  `canceled: true` ab (Befund vom 2026-08-13, Kommentar in `AvatarPicker.tsx`).
  Wer ihn hier einbaut, bringt den Fehler zurück.
- Eine geworfene Exception ist `failed`, `canceled` oder ein leeres
  `assets` ist `canceled`. Die beiden Fälle «abgebrochen» und «Picker
  gestorben» sind auf dieser Ebene nicht unterscheidbar, darum gibt es für
  `canceled` keine Meldung.

`AvatarPicker` bleibt in dieser Runde unverändert. Ihn auf die neue Funktion
umzustellen ist ein eigener, kleiner Schritt.

### 4.2 Aufbereitung

`asCoverJpeg(uri)` in `mobile/src/features/trips/coverApi.ts`, nach dem
Muster von `asSquareJpeg` (`features/auth/avatarApi.ts`), mit
`expo-image-manipulator` im Kontext-Stil inklusive `release()` im `finally`:

1. Einmal unverändert rendern, um Breite und Höhe zu kennen.
2. Mittiger Zuschnitt auf 3:2: ist das Bild breiter als 3:2, wird die Breite
   auf `höhe × 1.5` beschnitten, sonst die Höhe auf `breite / 1.5`. Ganzzahlig
   gerundet, Ursprung zentriert.
3. Verkleinern auf höchstens 1200 × 800, nie vergrössern: ist der Ausschnitt
   schmaler als 1200 px, bleibt er, wie er ist.
4. JPEG, `compress: 0.8`. Ergebnis typischerweise 150 bis 250 KB, weit unter
   dem Bucket-Limit von 2 MiB.

Die grösste Anzeige ist die Hero-Karte mit 342 × 228 auf 3x-Displays, also
1026 × 684; 1200 × 800 trägt das mit Reserve.

## 5. Speicher und Schlüssel

`mobile/src/features/trips/cover.ts`, analog `features/auth/avatar.ts`:

```ts
export const COVER_BUCKET = 'covers';
export function newCoverKey(tripId: string): string;   // trips/<tripId>/<32 hex>.jpg
export function coverUrl(coverKey: string | null | undefined): string | null;
```

- Der Bucket heisst lokal und in der Produktion gleich, darum eine Konstante.
- Das Präfix `trips/<trip_id>/` ist VEREINBART, nicht frei gewählt:
  `delete-account/index.ts` baut genau dieses Präfix als erlaubtes und
  `pathBelongsToUs` (`delete-account/process.ts`) lässt nur solche Pfade zur
  Löschung durch. Ein anderes Schema bliebe bei der Kontolöschung liegen.
- Der Zufallsteil (`Crypto.randomUUID()` ohne Bindestriche) macht die URL
  unratbar und gibt jedem neuen Cover eine neue URL, sodass der Bildcache
  ohne Cache-Buster auskommt.
- `coverUrl` ist die EINE Stelle, die weiss, wie eine Cover-URL aussieht:
  `${supabaseBaseUrl}/storage/v1/object/public/covers/${key}`.

## 6. Datenbank

Eine Migration `supabase/migrations/20260828120000_trip_cover.sql`.

### 6.1 Der Bucket

`insert into storage.buckets (id, name, public, file_size_limit,
allowed_mime_types) values ('covers', 'covers', true, 2097152,
array['image/jpeg']) on conflict (id) do update …`, mit denselben Gründen wie
in `20260812130000_avatar_bild.sql` (config.toml wirkt nur lokal, Limits
gehören in die Migration, `do update` statt `do nothing`). Dazu der Eintrag
`[storage.buckets.covers]` in `supabase/config.toml` (public, 2MiB,
`image/jpeg`).

### 6.2 Pfadbindung in den trips-Policies

Heute darf `authenticated` beliebigen Text in `cover_key` schreiben (Grant
seit der ersten Migration, `trips_insert_owner` und `trips_update_owner`
prüfen nur `owner_id`). Ohne Bindung könnte eine Person den Pfad eines
fremden Covers in ihre Reise schreiben und es als eigenes führen, und die
Kontolöschung müsste sich weiter auf ihren Guard verlassen.

```sql
drop policy if exists trips_insert_owner on public.trips;
create policy trips_insert_owner on public.trips
  for insert with check (
    owner_id = auth.uid()
    and (cover_key is null or cover_key like 'trips/' || id::text || '/%')
  );

drop policy if exists trips_update_owner on public.trips;
create policy trips_update_owner on public.trips
  for update
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (cover_key is null or cover_key like 'trips/' || id::text || '/%')
  );
```

`owner_id = auth.uid()` steht im `with check` mit drin, sonst prüfte die neue
Zeile nur den Pfad. Der Owner-Wechsel bleibt ohnehin unmöglich, `owner_id`
steht nicht im Spalten-Grant.

### 6.3 RLS auf storage.objects

`storage.foldername('trips/<id>/abc.jpg')` liefert `{trips,<id>}`. Geprüft
werden beide Teile und die Eigentümerschaft der Reise:

```sql
create policy covers_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = 'trips'
    and exists (
      select 1 from public.trips t
      where t.id::text = (storage.foldername(name))[2]
        and t.owner_id = auth.uid()
    )
  );
-- covers_update_owner (using) und covers_delete_owner (using) mit derselben
-- Bedingung; covers_select_authenticated: for select to authenticated using
-- (bucket_id = 'covers').
```

Die Unterabfrage auf `public.trips` läuft unter RLS als `authenticated`; der
Owner sieht seine eigene Reise (`20260812120000_owner_sieht_eigene_reise.sql`),
auch unmittelbar nach dem Insert. Lesen auf den Objektzeilen nur für
`authenticated`: Der öffentliche Lesepfad braucht diese Zeilen nicht, ein
`select` für `anon` wäre ein Listing aller Schlüssel.

### 6.4 pgTAP

`supabase/tests/23_trip_cover_test.sql`, nach dem Muster von
`20_avatar_test.sql` (Fixtures Anna/Ben, `pg_temp.login_as`, `pg_temp.as_anon`):

- Insert mit `cover_key` unter der eigenen (clientseitig gewählten) Trip-ID
  geht; Insert mit `cover_key` unter fremder ID scheitert (`42501`).
- Update des eigenen `cover_key` auf `trips/<eigene id>/x.jpg` geht; auf
  `trips/<fremde id>/x.jpg` und auf `covers/norwegen.jpg` scheitert (`42501`).
- Update durch ein Mitglied, das nicht Owner ist: kein Fehler, aber
  `UPDATE 0`; danach ist der Wert unverändert (`is`).
- `null` bleibt erlaubt (Cover entfernen).
- `storage.objects`: Insert unter `trips/<eigene id>/` geht, unter
  `trips/<fremde id>/` scheitert, unter `profiles/…` im Bucket `covers`
  scheitert; Delete des eigenen Objekts geht; `anon` sieht keine Zeilen.
- `has_column_privilege('authenticated', 'public.trips', 'cover_key', 'UPDATE')`
  bleibt `true`.

## 7. Der Ablauf beim Anlegen

### 7.1 Zustand im Screen

```ts
const [cover, setCover] = useState<{ uri: string } | null>(null);
const [coverError, setCoverError] = useState<string | null>(null);
const [createdTripId, setCreatedTripId] = useState<string | null>(null);
```

### 7.2 Reihenfolge

1. Validierung wie heute (Name, Zeitraum).
2. Gibt es noch keine `createdTripId`: `createTrip(...)` wie heute. Scheitert
   das, Fehler am Namensfeld wie heute, Ende.
3. Gibt es ein `cover`: `setTripCover(tripId, cover.uri)`:
   `asCoverJpeg` → Upload per `File.upload` auf
   `${base}/storage/v1/object/covers/${key}` (POST, Bearer-Token,
   `Content-Type: image/jpeg`, Statuscode selbst prüfen, weil `upload()` bei
   4xx/5xx nicht wirft) → `update trips set cover_key = key where id = tripId`
   mit `.select('id')` (leeres Ergebnis heisst: nicht gespeichert). Scheitert
   das Update, wird das frische Objekt wieder entfernt, damit nichts ohne
   Zeiger im Bucket liegt.
4. Erfolg: `router.replace('/trip/${id}')`, dann `router.push('/trip/${id}/invite')`,
   wie heute.

Die Reihenfolge ist zwingend: Die Storage-Policy prüft die Eigentümerschaft
über `public.trips`, die Reise muss also vor dem Upload existieren.

### 7.3 Wenn der Upload scheitert

Die Reise existiert dann bereits. Der Screen:

- merkt sich `createdTripId`, damit ein zweiter Versuch KEIN zweites Insert
  auslöst;
- zeigt unter der Cover-Fläche den Fehlertext aus §3.3;
- benennt den Primär-Button in «Nochmal versuchen» um; ein Tipp wiederholt nur
  Schritt 3;
- zeigt unter dem Button den Textlink «Ohne Cover weiter»
  (`Button variant="text"`, wie «Später» im Einladungs-Screen), der Schritt 4
  ausführt;
- sperrt Name und Zeitraum (`editable={false}`), weil die Reise mit diesen
  Werten schon angelegt ist. Wer sie ändern will, tut das im
  Bearbeiten-Screen;
- entfernt die Person in diesem Zustand das Cover («Ändern» → «Cover
  entfernen»), verschwinden Fehlertext und Textlink, und der Primär-Button
  heisst «Ohne Cover weiter» und führt Schritt 4 aus. Ein neu gewähltes
  Cover bringt «Nochmal versuchen» zurück.

Die Kosten des Sonderfalls sind bewusst klein gehalten: kein Löschen der
angelegten Reise, kein zweiter Screen.

## 8. Anzeige

- `tripsApi.COLUMNS` bekommt `cover_key`; `Trip` (`features/trips/types.ts`)
  bekommt `cover_key: string | null`; `toTrip` reicht es durch. Testfixtures
  in `tripsApi`-Tests und Komponententests ziehen nach.
- `TripHeroCard`, `TripGridCard` und `trip/[id]/index.tsx` übergeben
  `coverUrl={coverUrl(trip.cover_key)}` an `TripCover`. Ohne Key bleibt
  `placeholderCover(position)` der Fallback; `placeholderCover.ts` bleibt,
  sein Kommentar wird angepasst (die Datei geht nicht weg, solange nicht jede
  Reise ein Cover hat).
- Nach dem Anlegen lädt das Reise-Detail die Reise frisch vom Server und
  zeigt das Cover; die Reiseliste ebenso beim nächsten Fokus.
- `CachedTrip` (`tripsCache.ts`, Kamera-Screen) braucht kein Cover.
- Unverändert: `media-urls`/`covers`, Share-Link (`resolution.ts` schliesst
  `cover_key` bewusst aus), Einladungsvorschau.

## 9. Kontolöschung

`delete-account/index.ts` lässt Cover-Pfade unter `trips/<eigene id>/` heute
in die Schlüsselliste der Momente laufen, also in den S3-Bucket der Medien.
Dort liegen Cover nicht. Änderung: Cover-Pfade, die `pathBelongsToUs`
passieren, werden wie das Profilbild als eigener Schritt aus dem Bucket
`covers` gelöscht (Store-Funktion analog zum Avatar-Schritt). Der Guard
bleibt, wie er ist; Pfade ausserhalb des eigenen Präfixes werden weiter nur
gemeldet. Deno-Tests der Function ziehen nach: eigener Cover-Pfad landet im
Covers-Schritt und nicht in der Medienliste; fremder Pfad bleibt liegen.

## 10. Tests

- **Jest, `pickImage.test.ts`:** vier Ausgänge (`picked`, `canceled`,
  `denied`, `failed`) mit gemocktem `expo-image-picker`.
- **Jest, `coverApi.test.ts`:** Zuschnitt-Rechnung für breiter/schmaler/genau
  3:2 (Ursprung und Masse), kein Vergrössern; Upload-Statusprüfung (2xx
  gegen 4xx); Reihenfolge Upload → Update → Aufräumen bei Update-Fehler.
- **Jest, `cover.test.ts`:** Schlüsselform `trips/<id>/<32 hex>.jpg`, `coverUrl`
  mit und ohne Key.
- **Jest, `TripCoverPicker.test.tsx`:** leer (Plus, Texte, Button-Label),
  gewählt (Bild, Badge «Ändern»), Fehlerzeile, Sheet-Einträge rufen
  `onChoose`/`onRemove`.
- **Jest, `trip/__tests__/new.test.tsx`:** Erfolg ohne Cover (unverändert),
  Erfolg mit Cover (Reihenfolge `createTrip` → `setTripCover` → Navigation),
  Upload-Fehler (kein zweites `createTrip` beim zweiten Tipp, Button-Label,
  Textlink navigiert, Felder gesperrt), Picker verweigert (Fehlertext).
- **Jest, Karten:** `TripHeroCard`, `TripGridCard`, Reise-Detail reichen
  `coverUrl` durch; ohne Key Platzhalter (`testID="trip-cover"`-Quelle).
- **pgTAP:** §6.4.
- **Deno:** §9.

## 11. Nicht in diesem Schritt

- Zuschnitt-Dialog (der `AvatarCropper` mit 3:2-Rahmen wäre der Weg).
- Kamera als Quelle.
- Cover im Bearbeiten-Screen (`trip/[id]/edit.tsx`): dieselbe Fläche, dazu
  `setTripCover` mit `oldKey` und Löschen des alten Objekts.
- Cover im Share-Link und in der Einladungsvorschau.
- Aufräumen des Cover-Objekts beim Löschen einer Reise (gleiche Klasse wie
  die Momente heute).
- `AvatarPicker` auf `pickImageFromLibrary()` umstellen.

## 12. Betriebsschritte

- Lokal: `supabase db reset` oder Migration anwenden, pgTAP laufen lassen.
- Hosted: Migration ausrollen, dann prüfen, dass der Bucket `covers` mit den
  Limits existiert (die Migration legt ihn an; `config.toml` wirkt dort nicht).
- Kein neuer Native-Build nötig: `expo-image-picker`, `expo-image-manipulator`
  und `expo-file-system` sind bereits im Projekt.
