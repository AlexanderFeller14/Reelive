# Reelive Phase 3 — Trips & Invites: Design-Spezifikation

**Datum:** 2026-08-06
**Status:** Abgenommen (Brainstorming-Session)
**Basis:** [Produkt-Spec](2026-08-03-reelive-design.md) · [Roadmap](../plans/2026-08-03-reelive-v1-roadmap.md) · `DESIGN-LANGUAGE.md` (verbindlich für alle UI)

## 1. Ziel & Deliverable

Reisen entstehen in der App, und Freunde kommen über einen Link dazu. Damit wird aus
dem eingeloggten Einzelnutzer von Phase 2 eine Gruppe, die ab Phase 4 gemeinsam
Momente einsenden kann.

**Deliverable (Roadmap):** Zwei echte Accounts teilen sich eine Reise über einen
Invite-Link.

## 2. Rahmenentscheide (in der Session getroffen)

| Entscheid | Wahl | Begründung |
|---|---|---|
| Beitritts-Mechanik | **Postgres-Funktionen mit `security definer`** statt Edge Function | Fällt in die bestehende pgTAP-Suite statt einen zweiten Teststrang zu brauchen; atomar in einer Transaktion; keine zweite Laufzeit. Die erste Edge Function kommt in Phase 4 mit echtem Bedarf (R2-Secrets). Abweichung von Produkt-Spec §4 — siehe §9 |
| Invite-Link | **Custom Scheme über `expo-linking`**, Universal Links später | Keine Domain vorhanden. `Linking.createURL()` erzeugt in Expo Go `exp://…/--/join/<code>` und im Dev-/Release-Build `reelive://join/<code>` — derselbe Code, kein Umbau |
| Build-Ansatz | **Expo Go bleibt** | QR-Codes werden nur *erzeugt* (reines JS auf dem vorhandenen `react-native-svg`), nicht gescannt. Der Dev-Build wird erst durch die Kamera in Phase 4 erzwungen |
| Cover-Bilder | **Kein Upload in Phase 3** | R2-Anbindung entsteht in Phase 4; ein halber Upload-Pfad würde dort neu gebaut. Karten zeigen eine ruhige `bg-1`-Fläche |
| Reise-Detailscreen | **Mit Mitgliedern, Zähler steht auf 0** | Der Screen ist der Anker für die Mitgliederverwaltung. Phase 4 füllt den Zähler, ohne das Layout umzubauen |
| Status `archived` | **Jetzt lesbar machen** | Die Lese-Policy erlaubt bisher nur `revealed`, wodurch archivierte Reisen für niemanden mehr sichtbar sind (mit Testdaten verifiziert). Solange keine Produktivdaten existieren, sind es zehn Zeilen |

## 3. Datenbank

Eine Migration `supabase/migrations/<ts>_invites.sql`. Kein Schema-Umbau — Tabellen,
`invite_code` und der Owner-Trigger stehen seit Phase 1.

**`peek_invite(p_code text)`** — `security definer`, `stable`, `set search_path = public`.
Liefert für einen gültigen Code genau eine Zeile: `trip_id`, `name`, `start_date`,
`end_date`, `status`, `member_count`, `owner_display_name`. Bei unbekanntem Code null
Zeilen — kein Fehler, keine Unterscheidung zwischen «gibt es nicht» und «kein Zugriff».
Gibt **nie** `invite_code` zurück. Ausführbar auch für `anon`: der Beitritts-Screen soll
zeigen, worauf man sich einlässt, bevor man sich anmeldet. Wer den Code hat, dürfte
ohnehin beitreten — die Vorschau gibt also nichts preis, was der Link nicht schon gibt.

**`redeem_invite(p_code text)`** — `security definer`, `volatile`, `set search_path = public`.
Nur für `authenticated`. Gibt einen Record `(status text, trip_id uuid)` zurück statt
Exceptions zu werfen, weil alle Fälle hier erwartbar sind und `supabase-js` Postgres-
Fehler nur mühsam auflösbar macht:

| `status` | Bedingung | Verhalten der App |
|---|---|---|
| `joined` | Code gültig, Reise `active`, noch kein Mitglied | Weiter in die Reise |
| `already_member` | Bereits Mitglied | Ebenfalls weiter in die Reise (ein doppelt getippter Link ist kein Defekt) |
| `not_found` | Code unbekannt | Fehlermeldung |
| `not_active` | Reise ist `revealed` oder `archived` | Fehlermeldung mit Hinweis auf den Recap-Link |

Beitritt also nur, solange die Reise läuft. Nach dem Reveal führt der Weg über den
Share-Link aus Phase 6 — sonst könnte man sich nachträglich in einen fertigen Recap
einladen lassen.

**`my_post_counts()`** — `security definer`, `stable`. Liefert `(trip_id, count)` für
alle Reisen, in denen die aufrufende Person Mitglied ist, und zählt dabei nur die
**eigenen** Momente. Phase 1 hat `my_post_count(trip_id)` für genau eine Reise; die
Liste würde damit pro Karte einen Roundtrip brauchen. Die Batch-Variante hält die
gleiche Regel ein — niemand erfährt etwas über fremde Momente — und lädt die ganze
Liste in einem Aufruf. In Phase 3 stehen alle Werte auf 0.

**Korrektur `posts_select_revealed_members`:** Bedingung von `status = 'revealed'` auf
`status in ('revealed', 'archived')` erweitern. «Archiviert» heisst weggelegt, nicht
zugesperrt.

**Rechte:** `execute` auf `peek_invite` für `anon` und `authenticated`, auf
`redeem_invite` nur für `authenticated`, jeweils nach `revoke execute … from public`.

**Enumeration:** `invite_code` ist `encode(gen_random_bytes(6),'hex')` = 2⁴⁸
Möglichkeiten. Kein Rate-Limit in V1; als offener Punkt vermerkt.

## 4. App-Struktur

```
mobile/src/app/
  (tabs)/reise/
    _layout.tsx          # Stack im Tab — die Tab-Bar bleibt sichtbar
    index.tsx            # «Meine Reisen»
    neu.tsx              # Reise erstellen
    [id]/index.tsx       # Reise-Detail
    [id]/bearbeiten.tsx  # Name und Zeitraum ändern (nur Owner)
    [id]/einladen.tsx    # QR-Code + Link teilen
  join/[code].tsx        # Beitritt (ausserhalb der Tabs, auch ohne Session erreichbar)
mobile/src/features/trips/
  tripsApi.ts            # alle Supabase-Aufrufe; Screens kennen kein supabase-Objekt
  tripDay.ts             # Reisetag («Tag 4 von 10»), Gruppierung aktiv/Recap
  inviteLink.ts          # Link erzeugen, Code aus URL lesen, pendingInvite
```

**Screens** (Copy und Gestaltung strikt nach `DESIGN-LANGUAGE.md`):

- **Meine Reisen:** zwei Gruppen — laufende Reisen und Recaps. Randlose Karten mit
  Cover-Fläche 3:2, Titel, Zeitraum, überlappenden Avataren und Momente-Chip; auf
  laufenden Reisen die Versiegelt-Pille. FAB «Neue Reise». Empty State lädt zum
  Handeln ein und nennt beide Wege (erstellen oder per Link beitreten).
- **Neue Reise:** Name, Beginn, Ende. Nach dem Anlegen direkt weiter zum Einladen —
  der Owner-Trigger macht die Mitgliedschaft von selbst. **Bearbeiten** nutzt dasselbe
  Formular mit vorbelegten Werten; Phase 1 erlaubt Clients ohnehin nur `name`,
  `cover_key`, `start_date` und `end_date` zu ändern.
- **Einladen:** QR-Code gross, darunter «Link teilen» über das System-Share-Sheet,
  dazu der Hinweis, dass man jederzeit dazukommen kann.
- **Reise-Detail:** Cover-Fläche, Reisetag-Anzeige, eigener Momente-Zähler (0 bis
  Phase 4), Mitgliederliste mit Avataren und Rolle. Owner kann einladen, bearbeiten
  und Mitglieder entfernen; Mitglieder können verlassen. Der Owner sieht kein
  «Verlassen», sondern «Reise löschen» mit Bestätigung.
- **Beitritt:** zeigt aus `peek_invite` Name, Zeitraum, Mitgliederzahl und wer
  einlädt («Lea nimmt dich mit»), dazu «Reise beitreten».

## 5. Datenfluss & Deep Links

`tripsApi.ts` kapselt: Reisen laden (mit Mitgliederzahl und eigenem Momente-Zähler aus
`my_post_counts`), Reise anlegen, Reise bearbeiten, Mitglieder laden, Mitglied
entfernen, verlassen, löschen, `peek_invite`, `redeem_invite`.

Der Deep-Link-Handler hängt am bestehenden Guard aus Phase 2. Trifft ein
`…/join/<code>` ohne Session ein, wird der Code über `expo-linking` ausgelesen, in
AsyncStorage abgelegt und nach dem Login eingelöst — beim SMS-OTP verlässt man die App,
um den Code abzulesen, deshalb reicht ein reiner Modul-State nicht. Nach dem Einlösen
wird der gemerkte Code in jedem Fall verworfen, auch im Fehlerfall.

## 6. Fehlerbehandlung

Copy nach Design-Language §6 — Ursache und Lösung, ohne Entschuldigung:

- Unbekannter Code → «Diesen Einladungslink gibt es nicht mehr.»
- Reise nicht mehr aktiv → «Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.»
- Enddatum vor Beginn → Inline-Fehler am Feld.
- Letztes Mitglied entfernt/verlassen → unkritisch, der Owner bleibt immer.
- Offline → «Du bist offline. Verbinde dich und probier es nochmal.»
- Reise löschen und Mitglied entfernen fragen vorher nach (Haptik `warning`).

## 7. Testing

- **pgTAP** (neue Datei `supabase/tests/09_invites_test.sql`): `peek_invite` gültig und
  unbekannt, kein `invite_code` in der Rückgabe; `redeem_invite` für alle vier
  Status-Werte; `anon` darf `redeem_invite` nicht ausführen; archivierte Reisen sind
  für Mitglieder lesbar und für Fremde weiterhin nicht; `my_post_counts` zählt nur
  eigene Momente und nur eigene Reisen.
- **Jest:** Zeitraum-Validierung, Reisetag-Berechnung inklusive Zeitzonen-Grenzfall,
  Gruppierung aktiv/Recap, Code-Extraktion aus beiden Link-Formen (`exp://` und
  `reelive://`), pendingInvite-Zyklus.
- **RTL:** Liste mit und ohne Reisen, Erstellen-Formular mit Fehlerfall,
  Beitritts-Screen in allen vier Status.
- **Manuell:** zwei Konten (`+41 79 000 00 01` und `…02`), Link vom einen zum anderen,
  Beitritt, Mitglied entfernen, verlassen.

## 8. Bewusst nicht in Phase 3

Cover-Upload, «Reise abschliessen» und Reveal (Phase 5), Push, Universal Links und
Store-Fallback (Phase 6), QR-Scanner in der App, Kamera und Momente (Phase 4),
Rate-Limit auf Invite-Codes, Reise-Archivierung durch den Owner.

## 9. Abweichung von der Produkt-Spec

Produkt-Spec §4 nennt eine Edge Function `redeem-invite`. Phase 3 setzt stattdessen
zwei Postgres-Funktionen mit `security definer` ein (Begründung in §2). Das
Sicherheitsziel der Produkt-Spec — «kapseln, was der Client nicht entscheiden darf» —
bleibt erfüllt: Der Client kann weder `trip_members` beschreiben noch `invite_code`
lesen. Die Produkt-Spec wird nicht geändert; diese Spezifikation ist die jüngere
Entscheidung für Phase 3.
