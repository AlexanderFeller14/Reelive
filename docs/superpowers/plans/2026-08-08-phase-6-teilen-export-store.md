# Phase 6 — Teilen, Export & Store-Readiness: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Recap verlässt die Gruppe — über einen widerrufbaren Link und über die eigene
Galerie —, die Store-Pflichten sind erfüllt, und alles ist bis unmittelbar vor den ersten
Build-Knopfdruck vorbereitet.

**Architecture:** Der zweite öffentliche Leseweg (`share-link`/`aufloesen`) entsteht als Edge
Function mit Service-Role, deren Prüfkette — wie seit Phase 5 — als **reine, Docker-frei
testbare Funktion** neben dem Handler liegt. Der Web-Player nutzt denselben expo-router-Baum;
drei Plattform-Shims machen ihn überhaupt startfähig. Account-Löschung räumt Speicher **vor**
Datenbank.

**Tech Stack:** Expo SDK 57 / React Native 0.86, expo-router, TypeScript strict ·
`expo-media-library`, `expo-blur`, `@sentry/react-native` (neu) · Supabase Postgres + RLS,
Deno Edge Functions, `aws4fetch`

## Spec

`docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md` — bei jedem
Widerspruch zwischen Plan und Spec gilt die Spec, und der Widerspruch wird gemeldet.

## Global Constraints

- **`DESIGN-LANGUAGE.md` ist verbindlich.** Farben nur über Tokens aus
  `mobile/src/theme/tokens.ts`, Radius nur 12 / 24 / 999, Abstände nur 4 · 8 · 12 · 16 · 24 ·
  32 · 48, Screen-Ränder 24, höchstens ein Primär-Button pro Screen, Icons Lucide Outline
  Stroke 1.75. Medien-Screens in der Kino-Palette; UI auf Bildinhalt nur als translucente Pille.
- **Copy:** deutsch, Du-Form, sentence case. Vokabular: **Moment**, **Reise**, **Filmrolle**,
  **versiegelt**, **Recap**, **einsenden**. Fehler erklären Ursache und Lösung ohne Entschuldigung.
- **Momente sortieren IMMER nach `captured_at`** aufsteigend, `id` als zweites Kriterium.
- **Schema-Änderungen nur über Migrationen**; jede neue oder geänderte Policy bekommt pgTAP-Tests.
  Neue Tabellen und neue Spalten brauchen **ausdrückliche** Grants (`acl_baseline`).
- **Die Versiegelung ist serverseitig.** Kein Client-Code darf je die einzige Prüfung sein.
- **Kein `ignore: !stackBereit` für eine Zusicherung, die es sonst nirgends gibt.** Das war der
  schwerste Befund von Phase 5: ein übersprungener Test ist von einem bestandenen in keiner
  Zusammenfassung zu unterscheiden. Jede Sicherheitszusicherung braucht eine Docker-freie Deckung.
- TypeScript strict; `npx tsc --noEmit` sauber. Tests co-located in `__tests__/`.
  `@testing-library/react-native` v14 ist vollständig async.
- **Kein Lint-Lauf.**

## Zwei Lehren aus Phase 5, die hier bindend sind

1. **Wenn ein Review dieselbe Fehlerklasse zum zweiten Mal findet, ist der Einzelfix die falsche
   Antwort — dann gehört die Repräsentation geändert.** In Phase 5 wurde viermal derselbe
   Denkfehler an vier Stellen geflickt, bevor `pausiert: boolean` durch benannte Gründe ersetzt
   wurde.
2. **Wenn ein Mock den Mechanismus ersetzt, den der Test prüfen soll, prüft der Test nichts.**
   Zwei Tests waren grün, weil der Mock genau die Eigenschaft entfernt hatte, um die es ging.

## Hinweis an alle Implementer

Die Code-Ausschnitte in diesem Plan sind **sorgfältig gemeint, aber nicht bewiesen**. Behandle
sie als Skizze und leite aus dem Interface-Vertrag ab, was nötig ist. **Findest du einen
Widerspruch, melde ihn, statt ihn abzuschreiben.** Dasselbe gilt für Auslassungen: wenn dein
Task ein Versprechen aus Spec §4 berührt und der Brief es nicht erwähnt, sag es.

**Committen:** immer `git commit -- <pfad…>` mit expliziten Pfaden, danach `git show --stat HEAD`
prüfen. In Phase 5 ist zweimal fremde Arbeit in einen Commit gerutscht.

## Ist-Zustand (nachgewiesen)

- `share_links (token text pk default hex(16 bytes), trip_id, expires_at, revoked bool, created_at)`
  existiert seit Phase 1, Policy `share_links_all_owner` (`for all`, Owner, `with check` verlangt
  `status='revealed'`), Grants für `authenticated` und `service_role`. **Nirgends benutzt.**
- `reports (id, post_id, reporter_id, reason 1–500, created_at)`, Policies `reports_insert`
  (über `can_see_post`) und `reports_select_owner`. Grants: nur `select, insert`. **Keine UI.**
- `posts_delete_after_reveal` erlaubt dem Owner bereits das Löschen jedes Moments — im Client
  gibt es dafür keine Stelle (`.from('posts').delete(` kommt in `mobile/src` nicht vor).
- **Die einzige `on delete restrict`-Beziehung im Schema** ist `trips.owner_id → profiles.id`
  (`20260803090600_role_hardening.sql:87-89`). Alles andere kaskadiert.
- Das Root-Layout zieht beim Start `expo-sqlite` (über `uploadWorker` → `queueDb`),
  `expo-secure-store` (über `AuthProvider` → `supabase` → `secureSessionStorage`) und
  `expo-notifications` (über `pushApi`). **Ein Web-Bundle startet damit nicht.**
- `react-native-web` ist installiert, `app.json` hat einen `web`-Block (`output: "static"`),
  es gibt ein `web`-Skript. **Ein Web-Lauf ist nie dokumentiert worden.**
- `expo-media-library`, `expo-blur`, Sentry: **nicht installiert.** Kein `eas.json`, kein
  `extra.eas.projectId`, kein `ios.bundleIdentifier`, kein `android.package`, keine CI.
- Deep Linking: nur `"scheme": "reelive"`. `isPublicArea()` in
  `mobile/src/features/auth/guard.ts:17-19` kennt genau `'join'`.
- Zwei Edge Functions: `media-urls` (mit `lesenZugriff.ts` als reiner Prüfkette) und
  `reveal-trip` (mit `reveal.ts` als reiner Logik und `revealStore.ts` als Adapter). **Beide
  sind die Vorlage für alles Neue in dieser Phase.**

## File Structure

**Server**

| Datei | Verantwortung |
|---|---|
| `supabase/migrations/20260808120000_reports_erledigt.sql` | `reports.erledigt_am` + Grant nur darauf, nur für die Owner-Person |
| `supabase/functions/share-link/index.ts` | Handler: `erstellen`, `widerrufen`, `aufloesen` |
| `supabase/functions/share-link/aufloesung.ts` | **rein**: aus Token-Zeile + Reise-Zeile ein Urteil |
| `supabase/functions/share-link/store.ts` | Adapter auf Postgres/S3 |
| `supabase/functions/konto-loeschen/index.ts` | Handler |
| `supabase/functions/konto-loeschen/ablauf.ts` | **rein**: die Reihenfolge und ihre Abbruchbedingungen |
| `supabase/tests/15_share_links_test.sql`, `16_reports_test.sql` | Policies und Grants |

**App**

| Datei | Verantwortung |
|---|---|
| `mobile/src/features/moments/queueDb.web.ts` | leere In-Memory-Fassung |
| `mobile/src/lib/secureSessionStorage.web.ts` | speichert nichts, liest nichts |
| `mobile/src/features/push/pushApi.web.ts` | `'nicht-unterstuetzt'` |
| `mobile/src/features/teilen/shareApi.ts` | Link erstellen, widerrufen, auflösen |
| `mobile/src/app/teilen/[token].tsx` | öffentlicher Web-Player |
| `mobile/src/features/recap/exportApi.ts` | Galerie-Export |
| `mobile/src/features/recap/meldenApi.ts` | melden, Meldungen lesen, erledigen |
| `mobile/src/features/konto/kontoApi.ts` | Löschzahlen ermitteln, Löschung auslösen |
| `mobile/src/lib/fehlermelder.ts` | Sentry, No-Op ohne DSN |
| `mobile/app.json`, `eas.json`, `docs/datenschutz-entwurf.md` | Store-Vorbereitung |

---

### Task 1: Migration `reports.erledigt_am` und pgTAP für Teilen und Melden

**Files:** Create `supabase/migrations/20260808120000_reports_erledigt.sql`,
`supabase/tests/15_share_links_test.sql`, `supabase/tests/16_reports_test.sql`

**Kontext:** «Meldung verwerfen» braucht ein Update-Recht, das es heute nicht gibt — `reports`
hat für `authenticated` nur `select, insert`. Eine gelöschte Meldung wäre für eine spätere
Rechenschaft wertlos, darum eine Spalte statt eines Delete.

- [ ] **Step 1: Migration**

`alter table public.reports add column erledigt_am timestamptz;` plus eine Update-Policy, die
**nur** der Owner-Person der zugehörigen Reise das Setzen erlaubt, und ein
`grant update (erledigt_am) on public.reports to authenticated;` — **nur diese Spalte.**
Kommentar: warum eine Spalte und kein Delete.

- [ ] **Step 2: pgTAP `share_links`**

Belegt: Owner darf für eine `revealed` Reise anlegen; für eine `active` Reise **nicht**;
ein Mitglied ohne Owner-Rolle darf nicht anlegen und sieht fremde Zeilen nicht; `anon` kommt
gar nicht heran; ein Update auf `revoked` durch die Owner-Person gelingt.

- [ ] **Step 3: pgTAP `reports`**

Belegt: Mitglied kann melden (nur im eigenen Namen, nur was `can_see_post` erlaubt); vor dem
Reveal geht es nicht; nur die Owner-Person liest; nur die Owner-Person setzt `erledigt_am`;
**eine andere Spalte lässt sich auch von der Owner-Person nicht ändern** (Spalten-Grant).

- [ ] **Step 4: `supabase db reset && supabase test db`, Commit**

---

### Task 2: Edge Function `share-link`

**Files:** Create `supabase/functions/share-link/{index.ts,aufloesung.ts,store.ts,deno.json}`,
`aufloesung_test.ts`, `share_link_integration_test.ts`; Modify `supabase/config.toml`

**Interfaces:**
- `POST /functions/v1/share-link`, Body `{ aktion: 'erstellen'|'widerrufen'|'aufloesen', … }`
- `erstellen` (JWT): `{ trip_id, gueltig_tage?: number|null }` → `{ token, url }`
- `widerrufen` (JWT): `{ token }` → `{ ok: true }`
- `aufloesen` (**ohne JWT**): `{ token }` → `{ reise: {name,start_date,end_date}, medien: [{post_id, autor_name, type, captured_at, captured_tz, place_name, caption, duration_s, medium_url, thumb_url|null}], gueltig_bis }`
- Fehler wie überall: `{ fehler: "<deutscher Klartext>" }`

**Kontext:** Das ist der **zweite** Leseweg auf Medien und der erste ohne jede Anmeldung.
Vorlage in Aufbau, Fehlerformat und Trennung rein/Adapter: `supabase/functions/media-urls/`
(besonders `lesenZugriff.ts`) und `supabase/functions/reveal-trip/` (`reveal.ts`/`revealStore.ts`).

- [ ] **Step 1: `aufloesung.ts` — die reine Prüfkette, zuerst mit Tests**

`beurteileToken(zeile, reise, jetzt)` → `{ erlaubt: true } | { erlaubt: false, status, fehler }`.
Reihenfolge: Token unbekannt → `revoked` → abgelaufen → Reise nicht `revealed`/`archived`.

**Die vier Ablehnungen müssen denselben Text und denselben Status tragen.** Sonst wird die
Function zum Orakel, an dem sich gültige Token von ungültigen unterscheiden lassen. Ein Test
nagelt das fest: alle vier Fälle liefern **byte-gleich** dasselbe.

- [ ] **Step 2: `store.ts` — Adapter**

Token-Zeile lesen, Reise lesen, Momente mit `upload_status='uploaded'` lesen (nach
`captured_at`, dann `id`, **mit Blätterung wie in `media-urls`** — `max_rows` ist 1000),
Autorennamen mitholen, Zeile anlegen, `revoked` setzen.

- [ ] **Step 3: `index.ts` — Handler**

`erstellen`/`widerrufen` prüfen JWT und Owner-Rolle selbst (Service-Role umgeht die Policy).
`erstellen` verlangt zusätzlich `status='revealed'`.
`aufloesen` liest **kein** JWT und leitet die Schlüssel **selbst** her (`erwarteteSchluessel`
aus `media-urls/keys.ts` — importier sie, kopier sie nicht), Gültigkeit **3600 Sekunden**.

**Was `aufloesen` nicht zurückgeben darf:** Reaktionen, Kommentare, Mitglieder, `invite_code`,
`author_id`. Ein Test prüft die Antwortform auf Abwesenheit dieser Felder.

- [ ] **Step 4: Integrationstest gegen den laufenden Stack**

Gültiger Token → 200 mit URLs, GET darauf → 200. Widerrufen → dieselbe Antwort wie ein
unbekannter Token. Abgelaufen → dito. Link auf eine `active` Reise lässt sich gar nicht anlegen.

- [ ] **Step 5: `[functions.share-link]` in `config.toml`**

**`verify_jwt = false`** — die Auflösung muss ohne Anmeldung gehen. Das heisst: `erstellen` und
`widerrufen` prüfen das JWT **selbst**, und der Kommentar hält fest, warum das hier anders ist
als bei den beiden anderen Functions.

- [ ] **Step 6: `deno check`, Tests, Commit**

---

### Task 3: Edge Function `konto-loeschen`

**Files:** Create `supabase/functions/konto-loeschen/{index.ts,ablauf.ts,deno.json}`,
`ablauf_test.ts`, `konto_loeschen_integration_test.ts`; Modify `supabase/config.toml`

**Interfaces:** `POST`, Body `{}` (die Identität kommt aus dem JWT — **nie** aus dem Body).
Antwort `{ ok: true }` oder `{ fehler }`. Dazu eine Aktion `zahlen`, die zurückgibt, was der
Dialog anzeigen muss: `{ eigene_reisen, momente_in_eigenen_reisen, betroffene_personen, eigene_momente_anderswo }`.

**Kontext:** `trips.owner_id → profiles.id` ist die **einzige** `on delete restrict`-Beziehung
im Schema. Ohne Auflösung schlägt jede Löschung fehl.

- [ ] **Step 1: `ablauf.ts` — die Reihenfolge als reine Funktion, zuerst mit Tests**

Sie bekommt die zu löschenden Schlüssel und zwei injizierte Schritte (Objekte löschen,
Datenbank löschen) und stellt sicher: **Speicher zuerst, Datenbank danach**, und bei einem
Fehlschlag im Speicher wird die Datenbank **gar nicht** angefasst.

Ein Objekt ohne Datenbankzeile ist Müll; eine Datenbankzeile ohne Objekt ist ein kaputter
Recap. Ein Test setzt den Speicherschritt auf Fehlschlag und prüft, dass der Datenbankschritt
**nie** gerufen wurde.

- [ ] **Step 2: `index.ts`**

Ermitteln → Objekte löschen → eigene Reisen löschen → Auth-Nutzer löschen
(`supabaseAdmin.auth.admin.deleteUser`). Die Kaskaden räumen den Rest; der Kommentar zählt auf,
worauf sich das stützt.

- [ ] **Step 3: Integrationstest**

Ein Konto mit einer eigenen Reise, einem fremden Moment und einem Push-Token anlegen, löschen,
und danach belegen: keine Zeile in `profiles`, `trips`, `posts`, `trip_members`, `reactions`,
`comments`, `reports`, `push_tokens`, und kein Objekt mehr im Bucket.

- [ ] **Step 4: `config.toml`, `deno check`, Tests, Commit**

---

### Task 4: Die App wird web-fähig

**Files:** Create `mobile/src/features/moments/queueDb.web.ts`,
`mobile/src/lib/secureSessionStorage.web.ts`, `mobile/src/features/push/pushApi.web.ts`
samt Tests; Modify `mobile/src/features/auth/guard.ts`

**Kontext:** Heute startet ein Web-Bundle nicht, weil das Root-Layout drei native Module beim
Start zieht. Metro löst `*.web.ts` auf Web automatisch vorrangig auf — die Aufrufer bleiben
unverändert.

- [ ] **Step 1: Die drei Web-Fassungen**

`queueDb.web.ts` erfüllt dieselbe Schnittstelle und bleibt leer (kein Job, keine Tabelle).
`pushApi.web.ts` gibt `'nicht-unterstuetzt'` zurück und wirft nie.
`secureSessionStorage.web.ts` **speichert nichts und liest nichts** — im Web soll es gar keine
Session geben (Versprechen W5). Das ist kein Mangel; schreib den Grund als Kommentar hin.

- [ ] **Step 2: `teilen` wird öffentlich**

`isPublicArea()` kennt bisher nur `'join'`. `'teilen'` kommt dazu. Der Test dafür existiert
schon in `guard`-Tests — erweitere ihn, statt einen zweiten zu bauen.

- [ ] **Step 3: Tests**

Der wichtigste: **die Web-Fassung des Sitzungsspeichers behält nichts** — schreiben, lesen,
und es kommt `null` zurück. Dazu: `queueDb.web` liefert eine leere Liste statt zu werfen,
`pushApi.web` wirft nie.

- [ ] **Step 4: `npx expo export --platform web` läuft durch**

Das ist der eigentliche Nachweis. Scheitert es an einem weiteren Modul, **melde es** — es
gehört dann in dieselbe Liste, nicht in einen Notbehelf.

- [ ] **Step 5: `npm test`, `tsc`, Commit**

---

### Task 5: Der öffentliche Web-Player

**Files:** Create `mobile/src/app/teilen/[token].tsx`, `mobile/src/features/teilen/shareApi.ts`
samt Tests

**Interfaces:** `export async function loeseTokenAuf(token: string): Promise<Gelesen<GeteilterRecap>>`

**Kontext:** Er zeigt dieselbe Story wie der Recap-Player — Kino-Palette, Fortschrittsbalken,
Tages-Trenner, Autor, Zeit, Ort, Caption. **Ohne** Emoji-Leiste, **ohne** Kommentare, **ohne**
Melden, **ohne** Login. Unten dezent der Reelive-Wortzug und «Hol dir die App».

**Wiederverwendung, nicht Kopie:** `Fortschrittsbalken`, `playerLogic`, `tage.ts` sind fertig
und gereviewt. Wenn der Player-Screen sich nicht sinnvoll teilen lässt, sag es mir mit
Begründung, statt 600 Zeilen zu kopieren.

- [ ] **Step 1: `shareApi.ts` mit Tests** — Aufrufweg wie `recapApi.ts`/`urlVorrat.ts`.
- [ ] **Step 2: Der Screen**, ohne jede schreibende Komponente.
- [ ] **Step 3: Ungültiger Token** — eine freundliche Seite, die nicht verrät, ob es den Token
  je gab: «Dieser Link funktioniert nicht mehr.»
- [ ] **Step 4: Tests** — dass kein schreibender Aufruf existiert, ist die Kernzusicherung
  (W4). Überleg dir, wie du das prüfst, statt es zu behaupten.
- [ ] **Step 5: `npm test`, `tsc`, Commit**

---

### Task 6: Teilen in der App

**Files:** Modify `mobile/src/app/(tabs)/recap/[id]/uebersicht.tsx`; Create Sheet-Inhalt und Tests

- [ ] **Step 1:** «Recap teilen» nur für die Owner-Person, nur bei `revealed`.
- [ ] **Step 2:** Sheet (`components/Sheet.tsx`, `kino`-Variante) mit Link, Kopieren,
  System-Teilen (`Share` aus React Native), Ablauf-Auswahl (7 Tage / 30 Tage / unbegrenzt).
- [ ] **Step 3:** Existiert schon ein Link, wird er gezeigt statt ein zweiter erzeugt, mit
  «Link deaktivieren».
- [ ] **Step 4: Tests, Commit**

---

### Task 7: Export in die Galerie

**Files:** Create `mobile/src/features/recap/exportApi.ts` samt Tests;
Modify `mobile/src/app/(tabs)/recap/[id]/player.tsx`, `uebersicht.tsx`, `mobile/app.json`,
`mobile/package.json`

- [ ] **Step 1:** `npx expo install expo-media-library`. **Scheitert die Installation oder
  fehlt ein Config-Plugin, melde BLOCKED** — genau daran ist in Phase 4 `vision-camera`
  gescheitert, und der damalige Umsetzer hat richtig gehandelt.
- [ ] **Step 2:** `exportApi.ts` — einen Moment sichern, alle sichern. Ohne Berechtigung ein
  erklärender Hinweis mit Weg in die Einstellungen, **nie** ein stiller Fehlschlag.
- [ ] **Step 3:** Gesichert wird das **Medium in voller Auflösung**, nicht das Thumbnail.
- [ ] **Step 4:** «Alle sichern» mit Fortschritt («7 von 23»), abbrechbar, am Ende eine
  ehrliche Bilanz, wenn etwas fehlgeschlagen ist.
- [ ] **Step 5: Tests** — inklusive verweigerter Berechtigung und teilweisem Fehlschlag.
- [ ] **Step 6: `npm test`, `tsc`, Commit**

---

### Task 8: Melden und Moderation

**Files:** Create `mobile/src/features/recap/meldenApi.ts` samt Tests;
Modify `player.tsx`, `mobile/src/app/(tabs)/reise/[id]/index.tsx`

- [ ] **Step 1:** `meldenApi.ts` — melden (Grund 1–500, **vor** dem Absenden geprüft),
  Meldungen einer Reise lesen, `erledigt_am` setzen, einen Moment entfernen.
- [ ] **Step 2:** Langes Tippen im Player → Sheet «Diesen Moment melden». Der Moment bleibt
  danach sichtbar — Melden ist kein Verstecken.
- [ ] **Step 3:** Reise-Detail für die Owner-Person: «2 gemeldete Momente» → Liste mit
  Vorschaubild, Grund, Zeitpunkt; je Meldung «Moment entfernen» und «Meldung verwerfen».
- [ ] **Step 4: Tests, Commit**

---

### Task 9: Account-Löschung in der App

**Files:** Create `mobile/src/features/konto/kontoApi.ts` samt Tests;
Modify `mobile/src/app/(tabs)/profil.tsx`

- [ ] **Step 1:** `kontoApi.ts` — Zahlen holen, Löschung auslösen.
- [ ] **Step 2:** Im Profil, unter allem anderen, in `danger`: «Konto löschen».
- [ ] **Step 3: Der Dialog muss die Wahrheit sagen.** Er nennt die Zahlen («3 Reisen mit
  insgesamt 128 Momenten von 5 Personen») und verlangt eine bewusste Bestätigung. Wer eigene
  Reisen hat, löscht sie mit — samt der Momente **aller** Mitglieder.
- [ ] **Step 4:** Nach Erfolg: abmelden und zurück auf den Welcome-Screen.
- [ ] **Step 5: Tests** — insbesondere, dass der Dialog ohne geladene Zahlen nicht bestätigbar ist.
- [ ] **Step 6: `npm test`, `tsc`, Commit**

---

### Task 10: Sentry und der fehlende Blur

**Files:** Create `mobile/src/lib/fehlermelder.ts` samt Tests; Modify `mobile/src/app/_layout.tsx`,
`mobile/package.json`, `mobile/.env.example`, alle Dateien mit translucenten Pillen

- [ ] **Step 1:** `@sentry/react-native` installieren, `fehlermelder.ts` mit `initFehlermelder()`
  und `meldeFehler(fehler, kontext)`. **Ohne `EXPO_PUBLIC_SENTRY_DSN` ein vollständiger No-Op** —
  kein Init, kein Netz, keine Warnung. Versprechen W10.
- [ ] **Step 2:** Im Root-Layout initialisieren, ohne den Start zu blockieren.
- [ ] **Step 3:** `expo-blur` installieren und die translucenten Pillen §1-konform machen
  («`rgba(19,17,16,0.55)` + Blur 10»). Betroffen sind alle Pillen in `aufnehmen/`, `recap/` und
  `Fortschrittsbalken`. **Such sie, statt dich auf diese Liste zu verlassen** — sie ist aus dem
  Gedächtnis geschrieben.
- [ ] **Step 4: Tests** — ohne DSN passiert nichts, mit DSN wird genau einmal initialisiert.
- [ ] **Step 5: `npm test`, `tsc`, Commit**

---

### Task 11: Store-Vorbereitung

**Files:** Modify `mobile/app.json`, `README.md`; Create `mobile/eas.json`,
`docs/datenschutz-entwurf.md`

**Kontext:** Nichts davon ist ohne fremde Konten ausführbar. Was hier entsteht, ist eine
**Vorlage mit Kommentaren, die genau sagt, was einzutragen ist** — dasselbe Muster wie
`supabase/functions/.env.example`, das sich in Phase 4 bewährt hat.

- [ ] **Step 1: `app.json`** — `ios.bundleIdentifier`, `android.package`, Berechtigungstexte
  für Fotobibliothek und Benachrichtigungen, `ios.associatedDomains` und
  `android.intentFilters` als **auskommentierte** Vorlage für die spätere Domain.
- [ ] **Step 2: `eas.json`** — Profile `development`, `preview`, `production`. Jedes mit einem
  Kommentar, was fehlt und wo es herkommt.
- [ ] **Step 3: `docs/datenschutz-entwurf.md`** — beschreibt **wahrheitsgemäss**, was die App
  erhebt (Telefonnummer, Profil, Momente samt Ort und Zeit, Push-Token) und was sie nicht tut.
  Die Felder, die nur der Auftraggeber ausfüllen kann (Verantwortlicher, Kontakt, Domain),
  werden als solche markiert. **Auch die Stelle markieren, an der Supabase und Cloudflare als
  Auftragsverarbeiter genannt werden — ohne echte Verträge ist das eine Absichtserklärung.**
- [ ] **Step 4: README** — ein Abschnitt «Vor dem ersten Build», der die Reihenfolge nennt:
  Expo-Konto, Apple/Google, `eas.json` füllen, R2-Zugangsdaten in die Function-Umgebung,
  Sentry-DSN.
- [ ] **Step 5: Commit**

---

### Task 12: Verifikation

**Files:** keine — dieser Task prüft nur.

- [ ] **Step 1:** `supabase db reset && supabase test db`, `npm test`, `npx tsc --noEmit`,
  `deno check` und alle Deno-Suiten.
- [ ] **Step 2: Der Share-Link, serverseitig durchgespielt** — anlegen, auflösen, GET auf eine
  URL, widerrufen, erneut auflösen (muss dieselbe Antwort geben wie ein unbekannter Token),
  Anlegen auf einer `active` Reise (muss scheitern).
- [ ] **Step 3: Die Account-Löschung durchgespielt** — Testkonto anlegen, löschen, danach
  belegen, dass in **keiner** Tabelle und **keinem** Bucket etwas übrig ist.
- [ ] **Step 4: `npx expo export --platform web`** und die entstandene Seite im Browser öffnen.
- [ ] **Step 5: Ergebnis festhalten.** Was nur mit Gerät prüfbar ist, kommt auf die Liste in
  §10 der Spec, statt als erledigt zu gelten.

---

## Abdeckung der Versprechen (Spec §4)

| Versprechen | Task | **Datei, die es hält** |
|---|---|---|
| W1 — ein Link zeigt nur seine Reise | 2 | `share-link/aufloesung_test.ts`, `share_link_integration_test.ts` |
| W2 — widerrufen/abgelaufen zeigt nichts | 2 | `aufloesung_test.ts` (alle vier Ablehnungen byte-gleich) |
| W3 — kein Link auf eine versiegelte Reise | 1, 2 | `15_share_links_test.sql`, `aufloesung_test.ts` |
| W4 — der Web-Player kann nichts schreiben | 4, 5 | `secureSessionStorage.web.test.ts`, `teilen/__tests__/` |
| W5 — kein Konto nötig, kein Konto möglich | 4 | `guard`-Test, `secureSessionStorage.web.test.ts` |
| W6 — nichts bleibt übrig | 3 | `konto_loeschen_integration_test.ts` |
| W7 — kein halber Zustand | 3 | `ablauf_test.ts` (Speicherfehler → DB-Schritt nie gerufen) |
| W8 — Meldung erreicht die Owner-Person | 1, 8 | `16_reports_test.sql`, `meldenApi`-Tests |
| W9 — der Export schreibt, was man sieht | 7 | `exportApi`-Tests inkl. verweigerter Berechtigung |
| W10 — ohne DSN keine Änderung | 10 | `fehlermelder`-Tests |

## Offene Punkte nach Phase 6

Alles aus Spec §2 (fremde Konten), die Geräteverifikation aus Phase 4 und 5, das Übertragen
einer Reise statt Löschen, Ratenbegrenzung des öffentlichen Endpunkts, ein Moderations-Backend
jenseits der Owner-Ansicht, `ignore: !stackBereit` in `revealStore_integration_test.ts`,
die Startindex-Übergabe per `post_id` statt Index, und die nicht-UUID-`trip_id` (500 statt 400
an drei Stellen).
