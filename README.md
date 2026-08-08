# Reelive

Gemeinsames Reisetagebuch: privates Reiseprojekt, Freunde einladen, spontane
Foto-/Videomomente einsenden — versiegelt bis zum Reveal. Nach der Reise ein
chronologischer Recap aus allen Perspektiven.

Design-Spec: docs/superpowers/specs/2026-08-03-reelive-design.md
Roadmap: docs/superpowers/plans/2026-08-03-reelive-v1-roadmap.md

## Entwicklung (Backend)

Voraussetzungen: Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`)

```bash
supabase start        # lokale Instanz (API :54321, DB :54322, Studio :54323)
supabase db reset     # Migrationen neu einspielen
supabase test db      # pgTAP-Tests (RLS-Policies!) ausführen
```

Regel: Schema-Änderungen NUR über Migrationen in `supabase/migrations/`.
Jede RLS-Policy braucht Tests in `supabase/tests/`.

## Testdaten

`supabase/seed.sql` legt Konten, drei Reisen und 30 Momente an — aber **keine
Dateien**: der Seed schreibt Zeilen, er lädt nichts hoch. Und `supabase db reset`
leert den Medien-Bucket gleich mit. Ohne den zweiten Halbschritt zeigen Übersicht,
Player und Karte deshalb leere Kacheln, und jede Lese-URL antwortet mit 404.

```bash
npx supabase db reset                     # Zeilen
node scripts/testmedien-hochladen.mjs     # Dateien dazu (braucht ffmpeg)
```

Das Skript erzeugt je Moment eine eigene Farbfläche mit Ort und Uhrzeit darauf —
kein Foto, aber genug für alles, was lokal zu prüfen ist, und auf einem Screenshot
ist sofort zu sehen, welcher Moment gerade gezeigt wird. Videos werden als echte
mp4 erzeugt und spielen auf dem Gerät ab. Mehrfaches Ausführen ist harmlos.

**Nach jedem `db reset` beides ausführen.** Das gilt auch für den Share-Token: er
liegt in `share_links` und ist nach dem Reset ein anderer.

## Entwicklung (Upload-Pfad)

Die Edge Function `media-urls` (`supabase/functions/media-urls`) stellt kurzlebige
signierte S3-URLs aus — der einzige Ort im System, der die S3-Zugangsdaten kennt. Sie
läuft nicht automatisch mit `supabase start` und braucht eine eigene Umgebung:

```bash
cp supabase/functions/.env.example supabase/functions/.env
# Werte eintragen — siehe die Kommentare in der Datei:
#   S3_REGION/S3_ACCESS_KEY/S3_SECRET_KEY direkt aus `supabase status`
#   (Felder S3_PROTOCOL_REGION / S3_PROTOCOL_ACCESS_KEY_ID / S3_PROTOCOL_ACCESS_KEY_SECRET)
#   S3_ENDPOINT mit der LAN-IP des Rechners statt 127.0.0.1 (ifconfig | grep "inet ")
supabase functions serve media-urls --env-file supabase/functions/.env
```

Ohne gültige Umgebung antwortet jeder `sign`-Aufruf mit „Server nicht konfiguriert.“
**`S3_ENDPOINT` mit `127.0.0.1` ist der gefährlichere Fehler:** `sign` und der `PUT`-Upload
sehen dann trotzdem normal aus (die Function selbst braucht dafür kein Netzwerk), aber
`confirm`s HEAD-Check läuft im Docker-Container der Function — dort zeigt `127.0.0.1` auf
den Container selbst, nicht auf Kong/Storage. Der Post bleibt für immer `pending`, der
Queue-Job wiederholt endlos, ohne dass ein Test das bemerkt. Details dazu stehen in
`supabase/functions/.env.example`.

## Entwicklung (App)

Voraussetzungen: Node ≥ 20, Expo Go auf dem Gerät (App Store / Play Store)

```bash
cd mobile
cp .env.example .env   # URL + Anon-Key eintragen (siehe supabase status)
npm install
npx expo start         # QR-Code für Expo Go; i = iOS-Simulator, a = Android-Emulator
npm test               # Jest
```

Login lokal: Testnummern `+41 79 000 00 01` / `…02`, Code jeweils `123456`
(supabase/config.toml → [auth.sms.test_otp]).

## Vor dem ersten Build

Alles bis hier läuft ohne fremde Konten. Ein echter Build (Dev-Build, TestFlight/Internal
Testing, Store-Einreichung) hängt an Konten und Zugangsdaten, die nur der Auftraggeber hat —
diese Reihenfolge einhalten, jeder Schritt setzt den vorigen voraus:

1. **Expo-Konto** anlegen (expo.dev), dann im Ordner `mobile/`: `npx eas login` und
   `npx eas init` — letzteres trägt `extra.eas.projectId` in `mobile/app.json` ein (fehlt
   heute bewusst: eine erfundene Projekt-ID wäre falsch und liesse sich nicht durch einen
   Kommentar entschärfen).
2. **Apple Developer Program** (99 $/Jahr) und **Google Play Console** (25 $ einmalig)
   einrichten. Erst danach lassen sich die Platzhalter in `mobile/app.json` ersetzen:
   - `ios.bundleIdentifier` / `android.package` stehen aktuell auf `com.reelive.app` —
     ein Platzhalter, **kein** reservierter Wert. Sobald der Auftraggeber die endgültige
     Kennung entschieden hat (typischerweise an die eigene Domain angelehnt), hier ersetzen.
     **Wichtig:** beide Werte sind nach der ersten Store-Einreichung praktisch unveränderlich
     — vor dem ersten echten Build entscheiden, nicht danach.
   - Berechtigungstexte für Kamera, Mikrofon, Ort und Fotobibliothek stehen bereits in den
     `plugins`-Einträgen (`expo-camera`, `expo-location`, `expo-media-library`). Für
     **Benachrichtigungen** gibt es bewusst keinen weiteren Eintrag: Weder iOS noch Android
     kennen für die Push-Berechtigung einen mit Camera/Location/Fotos vergleichbaren
     konfigurierbaren Text — das System zeigt dort einen festen eigenen Dialog. `expo-notifications`
     bleibt darum ohne Konfigurationsobjekt in den `plugins`.
   - **`ios.associatedDomains` / `android.intentFilters`** (Universal Links / App Links, damit
     ein geteilter `/teilen/<token>`-Link die App statt des Browsers öffnet) stehen **nicht**
     in `mobile/app.json` — die Datei ist reines JSON ohne Kommentare, ein inaktiver Platzhalter
     wäre entweder unsichtbar (auskommentiert = in JSON gar nicht ausdrückbar) oder aktiv
     falsch (eine erfundene Domain erzeugt bereits beim Build eine echte, nur eben nutzlose
     Capability). Die Vorlage lebt deshalb hier, zum Eintragen sobald eine Domain feststeht:

     ```json
     // mobile/app.json → expo.ios
     "associatedDomains": ["applinks:DEINE-DOMAIN.tld"]

     // mobile/app.json → expo.android
     "intentFilters": [
       {
         "action": "VIEW",
         "autoVerify": true,
         "data": [{ "scheme": "https", "host": "DEINE-DOMAIN.tld", "pathPrefix": "/teilen" }],
         "category": ["BROWSABLE", "DEFAULT"]
       }
     ]
     ```

     Zusätzlich verlangt iOS unter `https://DEINE-DOMAIN.tld/.well-known/apple-app-site-association`
     und Android unter `https://DEINE-DOMAIN.tld/.well-known/assetlinks.json` je eine von der
     Domain selbst ausgelieferte Datei — Teil des Domain-Setups, nicht dieses Repos.
3. **`mobile/eas.json` füllen** — die drei Profile (`development`, `preview`, `production`)
   stehen mit den Standard-Feldern für EAS Build bereits da, aber ohne Zugangsdaten:
   - `development` baut mit `developmentClient: true` — dafür muss zuerst
     `npx expo install expo-dev-client` laufen (heute nicht installiert, die App läuft bislang
     ausschliesslich in Expo Go, siehe `mobile/AGENTS.md`-Vorgeschichte). Ohne dieses Paket
     bricht `eas build --profile development` mit einer klaren Fehlermeldung ab.
   - `submit.production` ist bewusst leer (`{}`) statt mit erfundenen Werten gefüllt: `eas
     submit` verlangt `ios.appleId`, `ios.ascAppId`, `ios.appleTeamId` (aus App Store Connect)
     bzw. `android.serviceAccountKeyPath` (JSON-Schlüssel eines Play-Console-Dienstkontos,
     **nie** eingecheckt) — beide entstehen erst mit den Konten aus Schritt 2 und lassen sich
     danach entweder hier eintragen oder interaktiv beim ersten `eas submit` angeben.
4. **R2-Zugangsdaten in die Function-Umgebung.** Der Code spricht seit Phase 4 S3-kompatibel —
   seit dem Abschluss-Review von Phase 6 gilt das für **alle drei** speicherberührenden
   Functions (`media-urls`, `share-link` **und** `konto-loeschen`; zuvor löschte Letztere
   noch über die Supabase-Storage-API statt über S3, siehe `konto-loeschen/store.ts`). Für
   ein echtes Deployment wechseln darum wirklich nur Endpoint und Zugangsdaten. Ein
   Cloudflare-R2-Bucket anlegen, dann `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY`/
   `S3_SECRET_KEY`/`S3_BUCKET` **nicht** in `supabase/functions/.env` (nur lokal, Docker),
   sondern über `supabase secrets set` für das deployte Projekt setzen — siehe die
   ausführlichen Kommentare in `supabase/functions/.env.example` für die Bedeutung jedes Werts.
5. **Sentry-DSN.** Ein Sentry-Projekt anlegen, DSN aus dessen Einstellungen kopieren, als
   `EXPO_PUBLIC_SENTRY_DSN` in `mobile/.env` (bzw. die EAS-Build-Umgebung) eintragen — siehe
   Kommentar in `mobile/.env.example`. Ohne diese Variable bleibt `initFehlermelder()` ein
   vollständiger No-Op (`mobile/src/lib/fehlermelder.ts`), das ist der aktuelle, gewollte
   Zustand. Für den natives Source-Map-Upload beim Build erwartet das in `mobile/app.json`
   bereits eingetragene `@sentry/react-native`-Plugin ausserdem `SENTRY_ORG`/`SENTRY_PROJECT`/
   `SENTRY_AUTH_TOKEN` als Umgebungsvariablen (fehlen sie, warnt `expo export`/`expo start`
   nur beim Build — die App selbst bleibt davon unberührt).

**`mobile/.env` ist für EAS Build unsichtbar — nicht nur für den Sentry-DSN oben.** Alle
`EXPO_PUBLIC_*`-Variablen werden zur **Build-Zeit** in den JS-Bundle einkompiliert
(Metro/`babel-preset-expo`); ein EAS-Cloud-Build liest dafür nie `mobile/.env` (gitignored,
landet nie auf dem Build-Server), sondern ausschliesslich die EAS-Umgebungsvariablen des
Profils. Ohne `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` wirft
`mobile/src/lib/supabase.ts` schon beim Modul-Laden — der erste `eas build --profile
production` liefert dann eine App, die sofort mit «Supabase-Konfiguration fehlt» abstürzt.
Build-kritisch sind: die beiden Supabase-Variablen (Absturz ohne sie),
`EXPO_PUBLIC_TEILEN_BASIS_URL` (ohne sie zeigt "Recap teilen" für einen bestehenden Link nur
eine Konfigurationsmeldung statt des Links) sowie `EXPO_PUBLIC_AUTH_APPLE`/
`EXPO_PUBLIC_AUTH_GOOGLE` (fehlen sie, bleiben die Login-Buttons wie gewollt ausgeblendet —
ungefährlich, aber besser explizit gesetzt als dem impliziten `undefined`-Fallback überlassen).

Die drei Profile in `eas.json` tragen deshalb ein `"environment"`-Feld
(`development`/`preview`/`production`), das einen Build an die gleichnamige EAS-Umgebung
bindet. Die Werte selbst gehören **nicht** als Klartext in `eas.json` (gleiche Haltung wie bei
`projectId`/`bundleIdentifier` oben — ein erfundener Wert wäre falsch): sie werden einmalig je
Umgebung angelegt, entweder im Expo-Dashboard (Project → Environment Variables) oder per CLI:

```bash
npx eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<projekt>.supabase.co
```

— wiederholt für die übrigen vier Variablen oben, und für `preview` entsprechend (dieses
Profil bündelt die JS ebenso zur Build-Zeit, `distribution: internal`, kein Dev-Client). Das
`development`-Profil braucht das in der Praxis nicht: es baut mit `developmentClient: true`
und lädt JS zur Laufzeit über Metro (`npx expo start`), das lokale `mobile/.env` liest — das
`environment`-Feld steht trotzdem auch dort, für den Tag, an dem sich das ändert.

**Zwei Umgebungsvariablen aus Phase 6 müssen von Hand synchron gehalten werden** — es gibt
keine automatische Ableitung der einen aus der anderen:

| Variable | Wo | Wofür |
|---|---|---|
| `TEILEN_BASIS_URL` | `supabase/functions/.env` (serverseitig, Function `share-link`) | Baut die fertige Teilen-URL bei `aktion: 'erstellen'` |
| `EXPO_PUBLIC_TEILEN_BASIS_URL` | `mobile/.env` (clientseitig) | Zeigt den Link eines bereits bestehenden Teilen-Links erneut an, ohne ihn neu zu erzeugen |

Beide müssen auf dieselbe Basis-URL zeigen (siehe Kommentare in den jeweiligen `.env.example`).
Weichen sie voneinander ab, zeigt "Recap teilen" für einen bestehenden Link eine andere
Adresse, als die Function beim Erstellen ausgegeben hat — kein Sicherheitsproblem (der Token
im Link ist die eigentliche Berechtigung), aber ein verwirrender Anzeigefehler.

**Datenschutz:** `docs/datenschutz-entwurf.md` ist ein Entwurf, keine veröffentlichungsfertige
Erklärung — vor der ersten Einreichung ausfüllen, prüfen lassen und unter einer festen URL
veröffentlichen (Pflichtfeld in App Store Connect und Google Play Console).
