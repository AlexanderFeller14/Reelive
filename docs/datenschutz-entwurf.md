# Datenschutzerklärung — Entwurf

**Status: ENTWURF, nicht rechtsverbindlich.** Diese Datei ist eine Vorlage, keine
veröffentlichungsfertige Erklärung. Bevor sie live geht:

1. Die mit **`TODO(Auftraggeber)`** markierten Stellen ausfüllen — die kann nur der
   Auftraggeber beantworten (wer haftet, unter welcher Adresse ist die Erklärung erreichbar).
2. Von einer Fachperson (Datenschutz-/Rechtsberatung) prüfen lassen, insbesondere die
   Einordnung nach DSGVO/CH-DSG und die Formulierung der Betroffenenrechte.
3. Erst danach unter einer festen URL veröffentlichen und diese URL in den Store-Einträgen
   (App Store Connect, Google Play Console) hinterlegen.

Alles unten beruht auf einem Durchgang durch den tatsächlichen Code (Migrationen unter
`supabase/migrations/`, Edge Functions unter `supabase/functions/`, Client-Code unter
`mobile/src/`) am 2026-08-08 — nicht aus dem Gedächtnis geschrieben. Ändert sich, was die App
erhebt, muss diese Datei mitgezogen werden; sie ist keine einmalige Übung.

---

## 1. Verantwortlicher

**TODO(Auftraggeber):** Name, Adresse, ggf. Handelsregister-Eintrag der Person/Organisation,
die für die Datenverarbeitung verantwortlich ist.

## 2. Kontakt für Datenschutzanfragen

**TODO(Auftraggeber):** E-Mail-Adresse (und optional Postadresse) für Auskunfts-, Lösch- und
sonstige Anfragen nach Art. 15 ff. DSGVO / Art. 25 ff. CH-DSG.

## 3. Was Reelive erhebt

Reelive ist ein gemeinsames Reisetagebuch für geschlossene Gruppen — es gibt kein offenes
Nutzerverzeichnis, keine Suche, kein öffentliches Profil ausser dem, was ein bewusst geteilter
Recap-Link zeigt (siehe §3.6).

### 3.1 Telefonnummer

Anmeldung läuft ausschliesslich per SMS-Einmalcode (Supabase Auth,
`supabase.auth.signInWithOtp`/`verifyOtp`). Die Telefonnummer wird von Supabase Auth verwaltet
(Tabelle `auth.users`, nicht Teil des von uns kontrollierten `public`-Schemas) und für den
Versand des Codes an einen SMS-Anbieter weitergereicht (welcher Anbieter, hängt von der
Supabase-Projektkonfiguration ab — **TODO(Auftraggeber)**, sobald ein echtes Projekt existiert).

### 3.2 Profil

Beim ersten Anmelden: ein selbstgewählter **Benutzername** (3–20 Zeichen, `a-z0-9_`) und ein
**Anzeigename** (1–40 Zeichen), gespeichert in `public.profiles`. Beide sind für alle
Mitglieder einer gemeinsamen Reise sichtbar (Autorenname unter jedem Moment, Mitgliederliste).

Das Schema sieht ein Profilbild vor (`profiles.avatar_key`) — **aktuell schreibt kein Teil der
App diese Spalte**, es gibt noch keinen Upload-Weg dafür. Sobald einer entsteht, gehört diese
Erklärung entsprechend erweitert.

### 3.3 Momente — Fotos/Videos samt Ort und Zeit

Jeder eingesendete Moment (`public.posts`) speichert:

- das **Foto oder Video** selbst (im Objektspeicher, siehe §5) plus ein automatisch erzeugtes
  Vorschaubild,
- **Aufnahmezeitpunkt und Zeitzone des Geräts** (`captured_at`, `captured_tz`) — die App
  sortiert den Recap ausdrücklich nach dieser Gerätezeit, nie nach der Ankunftszeit auf dem
  Server,
- **Ort** (`lat`, `lng`, `place_name`), **nur** wenn beim Aufnehmen die Standortberechtigung
  erteilt wurde — ohne Berechtigung wird der Moment ohne Ort eingesendet, nie blockiert
  (`mobile/src/features/moments/ortUndZeit.ts`),
- eine optionale, selbst verfasste **Bildunterschrift** (bis 120 Zeichen).

### 3.4 Interaktionen innerhalb einer Reise

- **Reaktionen** (`public.reactions`): ein Emoji pro Person und Moment.
- **Kommentare** (`public.comments`): Freitext bis 500 Zeichen, an eine Person und einen
  Moment gebunden.
- **Meldungen** (`public.reports`): meldet jemand einen Moment (Moderations-Funktion), wird
  Grund (1–500 Zeichen), meldende Person und Zeitpunkt gespeichert — sichtbar **nur** für die
  Person, die die Reise angelegt hat.

### 3.5 Push-Benachrichtigungen

Mit Erlaubnis registriert die App ein **Expo-Push-Token** je Geräteinstallation
(`public.push_tokens`: Token, Plattform `ios`/`android`, Zeitpunkt) — genutzt für genau eine
Benachrichtigung: "Euer Recap von «…» ist bereit!", sobald eine Reise abgeschlossen wird. Der
Versand läuft über Expos Push-Dienst (siehe §5).

### 3.6 Geteilte Recap-Links

Die Person, die eine Reise angelegt hat, kann für eine abgeschlossene Reise einen **Link**
erzeugen (`public.share_links`: zufälliger Token, optionales Ablaufdatum, Widerrufs-Status).
**Wer diesen Link hat, sieht — ohne eigenes Konto und ohne Anmeldung — den gesamten Recap:**
alle Fotos/Videos, Autorennamen, Zeitpunkt, Ort und Bildunterschrift jedes Moments. Reaktionen,
Kommentare, die Mitgliederliste und der Einladungscode der Reise werden **nicht** mitgegeben.
Der Link lässt sich jederzeit widerrufen (`mobile/src/features/teilen/`).

### 3.7 Was Reelive NICHT tut

- Kein Tracking, keine Analytics, keine Werbe-ID, kein Fingerprinting.
- Kein Zugriff auf die Fotobibliothek ausser für zwei bewusste, von der Person ausgelöste
  Aktionen: die Aufnahme selbst (Kamera) und "In Galerie sichern" (Export **aus** dem Recap
  **in** die eigene Galerie, niemals umgekehrt).
- Kein Standort-Tracking im Hintergrund — der Ort wird ausschliesslich im Moment der Aufnahme
  einmalig abgefragt.
- Kein Verkauf und keine Weitergabe von Daten zu Werbezwecken.
- Solange `EXPO_PUBLIC_SENTRY_DSN` nicht gesetzt ist (siehe §5), verlässt im Fehlerfall nichts
  zusätzlich das Gerät — die Fehler-Meldung ist dann ein vollständiger No-Op
  (`mobile/src/lib/fehlermelder.ts`).

## 4. Zweck der Verarbeitung

Ausschliesslich der Betrieb der App: Anmeldung, Zuordnung von Momenten zu Reisen und Personen,
Anzeige des gemeinsamen Recaps, Benachrichtigung über dessen Fertigstellung, Moderation
gemeldeter Inhalte. Keine Zweitverwertung.

## 5. Wer die Daten technisch verarbeitet (Auftragsverarbeiter)

> **Ohne unterzeichnete Auftragsverarbeitungsverträge (AVV/DPA) mit den unten genannten
> Anbietern ist dieser Abschnitt eine Absichtserklärung, keine Tatsache.** Er beschreibt den
> Stand der Technik im Code, nicht eine geprüfte Rechtslage. **TODO(Auftraggeber):** AVV mit
> jedem Anbieter abschliessen (bzw. deren Standardvertrag akzeptieren), bevor diese Erklärung
> veröffentlicht wird.

- **Supabase** (Datenbank, Authentifizierung, Objektspeicher in der lokalen Entwicklung) —
  Hosting-Region laut Projektvorgabe **EU (Frankfurt)**. Trägt Profile, Reisen, Momente-Metadaten,
  Reaktionen, Kommentare, Meldungen, Push-Tokens.
- **Cloudflare R2** (Objektspeicher für Fotos/Videos in **Produktion** — in der lokalen
  Entwicklung übernimmt das der in Supabase eingebaute S3-kompatible Speicher, siehe
  `supabase/functions/.env.example`). **Noch nicht im Einsatz**, solange kein Produktions-Bucket
  eingerichtet ist.
- **Expo** (`exp.host`) — Zustellung der Push-Benachrichtigung; erhält den Push-Token sowie
  Titel/Text der Nachricht (der Reisename, siehe §3.5).
- **Sentry** — **nur, wenn `EXPO_PUBLIC_SENTRY_DSN` gesetzt ist** (siehe
  `mobile/src/lib/fehlermelder.ts`, `mobile/.env.example`). Ohne DSN erhält Sentry nichts, gar
  keine Verbindung wird aufgebaut. Sobald ein DSN gesetzt wird, erhält Sentry Absturz-/Fehler-
  informationen samt technischem Kontext (Gerätetyp, App-Version, Stack-Trace) — **kein**
  Moment-Inhalt, keine Telefonnummer, kein Nachrichtentext, es sei denn, ein künftiger Aufrufer
  von `meldeFehler(fehler, kontext)` übergibt das versehentlich als `kontext`.
- **SMS-Anbieter** für den Versand des Einmalcodes (Supabase Auth verwaltet das, konkreter
  Anbieter hängt vom Projekt ab, siehe §3.1).

Der Betrieb von Servern in der EU (Supabase Frankfurt) spricht für eine DSGVO-konforme
Auftragsverarbeitung; Cloudflare/Expo/Sentry sind global tätige US-Anbieter — eine
Übermittlung in Drittländer ist damit nicht ausgeschlossen und muss von der Rechtsberatung
bewertet werden (Standardvertragsklauseln o.ä.).

## 6. Speicherdauer und Löschung

Daten bleiben gespeichert, solange das Konto besteht. **Konto löschen** (im Profil-Screen der
App, `mobile/src/features/konto/`) löst die Edge Function `konto-loeschen` aus:

- Zuerst werden alle zugehörigen **Objekte im Speicher** entfernt (eigene Momente überall,
  alle Momente in selbst angelegten Reisen), erst danach die Datenbankzeilen — misslingt der
  Speicherschritt, wird an der Datenbank **nichts** verändert (kein halb gelöschtes Konto).
- Legt die Person eigene Reisen an, werden diese **mitsamt allen Momenten aller
  Mitreisenden** gelöscht — die App zeigt vor der Bestätigung die genauen Zahlen ("3 Reisen mit
  insgesamt 128 Momenten von 5 Personen …").
- Der Auth-Nutzer wird über Supabase Admin gelöscht; alle verbleibenden Zeilen (Profil,
  Mitgliedschaften, Reaktionen, Kommentare, Meldungen, Push-Tokens) hängen per
  Fremdschlüssel-Kaskade daran und verschwinden mit.
- Ist eine Person nur Mitglied fremder Reisen, verlässt sie diese vor der Löschung — ihre
  eigenen Momente darin werden mitgelöscht, die Reise selbst bleibt für die übrigen Mitglieder
  bestehen.

Eine Löschung ist **endgültig und nicht widerrufbar**.

## 7. Rechte der betroffenen Person

**TODO(Auftraggeber/Rechtsberatung):** vollständige, rechtssichere Formulierung der Rechte auf
Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie das
Beschwerderecht bei einer Aufsichtsbehörde. In der App bereits umgesetzt: Löschung des eigenen
Kontos samt Daten (§6) und Widerruf eines geteilten Links (§3.6) sind jederzeit selbst möglich,
ohne Anfrage an den Verantwortlichen.

## 8. Minderjährige

**TODO(Auftraggeber):** Mindestalter festlegen und hier dokumentieren, falls die App nicht für
alle Altersgruppen vorgesehen ist.

## 9. Änderungen dieser Erklärung

**TODO(Auftraggeber):** Prozess für Änderungen und deren Kommunikation an bestehende Nutzer
festlegen.

## 10. Wo diese Erklärung erreichbar ist

**TODO(Auftraggeber):** feste, öffentlich erreichbare URL unter der eigenen Domain (siehe
`ios.associatedDomains`/`android.intentFilters`-Vorlage in `mobile/app.json`) — Pflichtangabe
in App Store Connect und Google Play Console.
