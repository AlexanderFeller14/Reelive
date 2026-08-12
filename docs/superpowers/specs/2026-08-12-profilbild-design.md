# Profilbild — Design-Spezifikation

**Datum:** 2026-08-12
**Status:** Vom Team abgenommen (Brainstorming-Session)

## 1. Ziel

Jede Person kann im Profil ein Bild hinterlegen. Es ersetzt überall dort die
Initiale, wo heute ein Avatar-Kreis steht — in der App und im per Link
geteilten Recap.

`profiles.avatar_key` gibt es seit der ersten Migration
(`20260803090000_core_tables.sql`), inklusive Spalten-Grant für `insert` und
`update` (`20260808150000_leerstrings_und_profil_grants.sql`). Geschrieben hat
sie bisher kein Codepfad. Auch `Avatar.tsx` ist darauf vorbereitet: «Bis zum
Avatar-Upload trägt der Kreis die Initiale.» Diese Spec füllt die Lücke.

## 2. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Sichtbarkeit | Überall statt der Initiale, auch im öffentlich geteilten Recap |
| Auswahl | Galerie oder Kamera, danach quadratischer Zuschnitt |
| Einstiege | Profil-Tab und Onboarding (dort überspringbar) |
| Speicher | Öffentlicher Supabase-Storage-Bucket, unratbarer Schlüssel |

### Warum der Speicher nicht R2 ist

Momente liegen in R2 und werden über kurzlebige signierte URLs gelesen, weil
die Versiegelung daran hängt. Für Avatare trägt das nicht: Sie werden vor dem
Reveal gebraucht (Facepile einer laufenden Reise), an sechs Stellen gleichzeitig,
und für Betrachter ohne Konto. Der Signierweg müsste an jeder dieser Stellen um
einen Roundtrip, eine Ablaufsteuerung und einen `cacheKey` ergänzt werden — für
ein Bild von rund 50 KB.

Ein unratbarer Schlüssel ist hier dieselbe Sicherheitsklasse, die das Projekt
beim Share-Link bereits akzeptiert (32-stelliger Hex-Token, «Raten ist
dadurch sinnlos», `share-link/index.ts`). Und weil Gesichter ohnehin im
öffentlich geteilten Recap erscheinen sollen, würde der Signierapparat etwas
schützen, das an anderer Stelle bewusst herausgegeben wird.

Der Preis, ausdrücklich benannt: Avatare liegen nicht in R2, und eine
abgegriffene URL bleibt gültig, bis das Bild ersetzt oder gelöscht wird.

## 3. Speicher und Schlüsselschema

Ein Bucket `avatare`, deklariert in `supabase/config.toml` neben
`[storage.buckets.media]` — ohne Deklaration existiert er nur als
Laufzeitzustand und überlebt weder `supabase db reset` noch einen frischen
Checkout:

```toml
[storage.buckets.avatare]
public = true
file_size_limit = "2MiB"
allowed_mime_types = ["image/jpeg"]
```

Das Limit ist grosszügig gegenüber den erwarteten ~50 KB und trotzdem ein
Riegel. Nur JPEG, weil der Client ohnehin nach JPEG rechnet.

**Schlüssel:** `profiles/{user_id}/{32 Hex-Zeichen}.jpg`

Das Präfix ist keine freie Wahl. `konto-loeschen/index.ts` baut seine
erlaubten Präfixe bereits als `profiles/${anfragendeId}/`, und `pfadGehoertUns`
in `konto-loeschen/ablauf.ts` ist genau dafür geschrieben — inklusive des
Kommentars, dass die Löschung «von selbst greift», sobald ein
eigentümer-gebundenes Schema existiert. Dieses Schema ist es.

Der Zufallsanteil (16 Bytes aus `expo-crypto`, hex) leistet zweierlei: Die URL
ist nicht aus einer bekannten `user_id` ableitbar, und jedes neue Bild bekommt
eine neue URL. Damit löst sich der Bildcache von selbst auf, ohne
Cache-Buster-Parameter.

**Lese-URL**, eine feste Formel ohne Serverfrage:

```
${SUPABASE_URL}/storage/v1/object/public/avatare/${avatar_key}
```

Lokal und produktiv identisch, `EXPO_PUBLIC_SUPABASE_URL` steht bereits in
`mobile/.env`. **Keine neue Umgebungsvariable** — bewusst, eine falsch
gesetzte `S3_ENDPOINT`-Variable hat das Projekt schon einmal einen Tag
gekostet.

Dieselbe Falle gilt hier allerdings geerbt: Lokal trägt
`EXPO_PUBLIC_SUPABASE_URL` die LAN-IP des Rechners (`.env.example` zeigt
`http://192.168.1.10:54321`). Wechselt die per DHCP, laden Avatare auf dem
Gerät nicht mehr — dasselbe Symptom wie bei den Momenten, dieselbe Ursache,
derselbe Handgriff. Neu ist nichts, aber die Fehlersuche greift beim Bild
sonst daneben.

Die Formel gehört in **eine** Funktion (`avatarUrl(key: string | null)` in
`features/auth/avatar.ts`), nicht in sechs Screens.

## 4. Datenbank

Eine neue Migration `20260812130000_avatar_bild.sql` mit zwei Teilen.

### 4.1 Pfadbindung in den profiles-Policies

`profiles_update_own` prüft heute nur `using`, also die alte Zeile — im
Kommentar von `20260808150000` bereits als offene Kante vermerkt. Ohne
`with check` könnte jemand einen fremden Pfad in sein `avatar_key` schreiben
und ein fremdes Bild als eigenes führen.

Beide Policies (`profiles_insert_own`, `profiles_update_own`) bekommen deshalb
ein `with check`, das verlangt:

```sql
avatar_key is null
  or avatar_key like 'profiles/' || auth.uid()::text || '/%'
```

zusätzlich zur bestehenden Bedingung `id = auth.uid()`.

### 4.2 RLS auf storage.objects

Für den Bucket `avatare`:

- `insert`, `update`, `delete` nur, wenn
  `bucket_id = 'avatare'` und `(storage.foldername(name))[1] = 'profiles'`
  und `(storage.foldername(name))[2] = auth.uid()::text`
- `select` für alle (der Bucket ist öffentlich; die Policy hält den Zustand
  auch dann, wenn der Bucket später auf privat gestellt würde)

### 4.3 pgTAP

Eine neue Datei in `supabase/tests/`, wie der Eckpfeiler es für jede
RLS-Policy verlangt. Sie belegt:

1. Eigenes `avatar_key` mit korrektem Präfix setzen → geht
2. `avatar_key` mit fremder `user_id` im Pfad setzen → abgelehnt
3. `avatar_key` ohne `profiles/`-Präfix setzen → abgelehnt
4. `avatar_key` auf `null` zurücksetzen → geht
5. Objekt im eigenen Ordner schreiben/löschen → geht
6. Objekt im fremden Ordner schreiben/löschen → abgelehnt

## 5. Das Bild setzen

### 5.1 Wo

**Profil-Tab** (`app/(tabs)/profil.tsx`): Der Avatar steht **in der
Namens-Card, links neben Name und `@username`**. Der freigestellte Reisepass
bleibt unverändert das grosse Bild des Screens.

**Onboarding** (`app/(auth)/profile-setup.tsx`): Der Avatar steht zentriert
über den beiden Feldern, darunter «Profilbild (optional)». Überspringbar — wer
nichts wählt, kommt wie bisher mit «Los geht's» weiter.

Beide nutzen dieselbe Komponente `AvatarWaehler`.

**Grösse: 44 px, an beiden Stellen.** DESIGN-LANGUAGE v2 §4 begrenzt Avatare
auf 32–44 px, und die Regel schlägt laut CLAUDE.md Framework-Defaults und
eigenen Geschmack. 44 ist die Obergrenze und zugleich das iOS-Minimum für ein
Tap-Ziel. Damit der Kreis als *änderbar* lesbar ist und nicht als blosse
Anzeige, trägt er unten rechts ein kleines Kamera-Badge (Lucide Outline, §4).

Das ist die konservative Lesart. Ein Profilbild ist kein Listen-Avatar, und
ein grösserer Kreis wäre auf dem Profil-Tab denkbar — aber das wäre eine
Änderung an §4 und gehört dann dort hinein, nicht als Ausnahme hierher.

### 5.2 Der Auswahl-Flow

Ein Tap öffnet ein `Sheet` (die bestehende Komponente) mit:

- «Foto auswählen» → `launchImageLibraryAsync`
- «Selfie aufnehmen» → `launchCameraAsync`
- «Bild entfernen» in `danger`, nur wenn schon eines da ist

Beide Aufrufe mit `mediaTypes: 'images'`, `allowsEditing: true`,
`aspect: [1, 1]`, `quality: 1`. `aspect` wirkt laut SDK-57-Doku nur unter
Android; auf iOS erzwingt der System-Editor bei `allowsEditing` ohnehin ein
Quadrat.

Berechtigungen über `requestMediaLibraryPermissionsAsync` bzw.
`requestCameraPermissionsAsync`, mit deutschen Texten über das Config-Plugin in
`app.json`. Bei Ablehnung eine Meldung im Sheet statt eines stummen Nichts.

Danach `expo-image-manipulator`: auf 512×512 rechnen, JPEG bei Qualität 0.8.
512 trägt den grössten Anzeigeort (Profil-Tab) auch auf einem 3x-Display.

### 5.3 Die Reihenfolge beim Speichern

1. Neues Objekt hochladen
2. `profiles.avatar_key` auf den neuen Schlüssel setzen
3. Altes Objekt löschen

In dieser Reihenfolge zeigt die Zeile nie auf etwas, das noch nicht oder nicht
mehr da ist. Scheitert Schritt 3, bleibt ein verwaistes Objekt liegen — die
harmlosere der beiden Fehlerrichtungen, sie wird geloggt.

Beim Entfernen umgekehrt: erst `avatar_key = null`, dann das Objekt löschen.

### 5.4 Wie hochgeladen wird

**Nicht** über `supabase.storage.from().upload()`. Der Storage-Client erwartet
ein Blob, und `fetch(uri).blob()` ist unter React Native unzuverlässig.

Stattdessen dasselbe Muster wie im bestehenden Upload-Worker, das im Projekt
erprobt ist:

```ts
new File(uri).upload(`${SUPABASE_URL}/storage/v1/object/avatare/${key}`, {
  httpMethod: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'image/jpeg',
  },
})
```

Der Status muss selbst geprüft werden — `upload()` wirft bei 4xx/5xx nicht,
sondern liefert die Antwort zurück (derselbe Stolperstein wie in
`uploadWorker.ts:73`).

Das **Löschen** dagegen über `supabase.storage.from('avatare').remove([key])`:
ein reiner JSON-Aufruf, kein Blob im Spiel.

## 6. Das Bild anzeigen

`avatar_key` reist in den bestehenden Abfragen mit — Mitreisende dürfen
`profiles` bereits lesen (`profiles_select_own_or_shared`). Betroffen:

| Ort | Datei |
|---|---|
| Facepile der Reise | `features/trips/tripsApi.ts` (`MIT_MITGLIEDERN`) |
| Mitglieder-Sheet | `features/trips/tripsApi.ts` (`fetchMembers`) |
| Autor eines Moments | `features/recap/recapApi.ts` |
| Geteilter Recap | `supabase/functions/share-link/aufloesung.ts` |
| Eigenes Profil | `features/auth/profileApi.ts` (`fetchOwnProfile`, `Profile`) |

Die Edge Function gibt nur den **Schlüssel** heraus, keine URL — die Formel
baut auch der Web-Betrachter selbst. Damit bleibt eine einzige Stelle, die
weiss, wie eine Avatar-URL aussieht.

### 6.1 Umbau von Avatar.tsx

`Avatar` bekommt ein optionales `avatarKey`. Ist es `null`, bleibt alles wie
bisher: der Kreis mit der Initiale. Sonst ein `expo-image` im selben Kreis,
mit `contentFit="cover"` und der Initiale als `placeholder`, damit beim Laden
nichts springt.

Dabei fällt eine Doppelung weg. `player.tsx:265` und `teilen/[token].tsx:182`
haben je eine eigene `AvatarInitiale`-Kopie, weil `Avatar` über `useTheme()`
geht und dort die Kino-Palette gilt. Die Bildlogik ein drittes Mal zu
schreiben wäre der falsche Weg — `Avatar` bekommt stattdessen eine
`cinema`-Variante, und beide Kopien verschwinden.

Die Form bleibt unverändert bei DESIGN-LANGUAGE v2 §4: rund, 32–44 px, 2 px
Ring, Gruppen −8 px überlappend.

## 7. Kontolöschung

Der Wächter greift bereits: Ein Schlüssel unter `profiles/{eigene user_id}/`
passt auf die erlaubten Präfixe und wird zur Löschung vorgemerkt.

Aber `konto-loeschen` löscht heute ausschliesslich aus `S3_BUCKET`, dem
Momente-Bucket. Der Avatar liegt woanders. Ohne Anpassung bliebe er für immer
liegen — genau die Fehlerrichtung, die `ablauf.ts` als «die schlimmere, weil
sie unsichtbar und unumkehrbar ist» beschreibt.

Deshalb: Der Wächter bleibt genau wie er ist und entscheidet weiterhin, ob der
Schlüssel zu dieser Löschung gehört. Nur das Ergebnis wandert woanders hin —
nicht in die S3-Schlüsselliste, sondern in einen eigenen Schritt über
`supabaseAdmin.storage.from('avatare').remove()`. Den Client hat die Function
ohnehin. Der Bucket-Name ist eine Konstante im Code, keine Umgebungsvariable,
weil er lokal und produktiv gleich heisst.

Der Schritt gehört in dieselbe Reihenfolge-Struktur wie die übrigen (Schritte
als benannte Funktionen in `ablauf.ts`) und **vor** die Datenbank: Speicher
zuerst, Datenbank danach, und scheitert der Speicherschritt, wird die
Datenbank gar nicht angefasst.

`cover_key` bleibt unangetastet — Titelbilder haben bis heute kein
eigentümer-gebundenes Schema, und das ist ein eigenes Thema.

## 8. Tests

- **pgTAP:** die sechs Fälle aus §4.3
- **Jest, Logik:** Schlüsselbildung (Präfix, Länge, Endung), `avatarUrl()` mit
  `null` und mit Schlüssel, die Reihenfolge beim Speichern und beim Entfernen
  (inklusive: Schritt 3 scheitert → `avatar_key` bleibt trotzdem gesetzt)
- **Jest, Komponente:** `Avatar` ohne Schlüssel zeigt die Initiale, mit
  Schlüssel das Bild; `AvatarGroup` in beiden Fällen; die `cinema`-Variante
- **Jest, Screens:** Sheet öffnet sich, «Bild entfernen» erscheint nur mit
  vorhandenem Bild, abgelehnte Berechtigung zeigt eine Meldung
- **Deno:** `share-link/aufloesung.ts` reicht `avatar_key` durch;
  `konto-loeschen/ablauf.ts` mit dem neuen Schritt

Die Jest-Suite sieht keine echte Navigation und keinen echten Bildwähler —
`expo-image-picker` wird gemockt. Der Beweis, dass Auswahl und Zuschnitt auf
dem Gerät funktionieren, ist ein manueller Durchlauf, nicht ein grüner Test.

## 9. Nicht in diesem Schritt

- **Avatare an Kommentaren.** Dort steht heute nur der Name; Kreise
  einzuführen wäre ein eigener Entwurf.
- **Moderation oder Meldefunktion für Profilbilder.** Reisen sind geschlossene
  Gruppen mit Einladung, und Mitglieder lassen sich bereits entfernen.
- **Serverseitige Bildverarbeitung.** Das Telefon rechnet, wie bei den
  Momenten auch.
- **Ein eigentümer-gebundenes Schema für `cover_key`.** Verwandt, aber ein
  eigener Schritt.
- **Aufräumen verwaister Objekte.** Ein fehlgeschlagener Löschversuch
  hinterlässt ~50 KB. Ein Aufräum-Job lohnt erst, wenn das messbar wird.

## 10. Betriebsschritte

Keine. Der Bucket entsteht aus `config.toml` und der Migration, die URL-Formel
aus einer bereits gesetzten Variable. Für die Produktion genügt
`supabase db push` und ein Deployment von `konto-loeschen`.

`expo-image-picker` kommt als neue Abhängigkeit dazu und braucht wegen des
Config-Plugins einen neuen Build — im Expo Go geprüfte Berechtigungstexte
sagen nichts über den echten Build aus.
