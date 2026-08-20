# Supabase-Betrieb

## Auto-Reveal einrichten (einmal pro Umgebung)

Der Auto-Reveal (Spec `docs/superpowers/specs/2026-08-18-auto-reveal-design.md`)
braucht pro Umgebung zwei Vault-Secrets und eine Function-Umgebungsvariable.
Ohne sie loggt der Cron-Wrapper eine Warnung und tut nichts.

Secret erzeugen (ein Wert, er wird an zwei Stellen hinterlegt):

```bash
openssl rand -hex 32
```

### Lokal

1. Vault-Secrets anlegen (`supabase start` muss laufen; `host.docker.internal`
   ist die Sicht des Postgres-Containers auf den Host, auf dem Kong Port
   54321 bedient):

   ```bash
   psql "$(supabase status -o env | grep DB_URL | cut -d'"' -f2)" \
     -c "select vault.create_secret('http://host.docker.internal:54321', 'project_url');" \
     -c "select vault.create_secret('HIER-DAS-SECRET', 'cron_secret');"
   ```

2. In `supabase/functions/.env` dieselbe Zeile wie in `.env.example`
   eintragen: `CRON_SECRET=HIER-DAS-SECRET`.

3. Functions neu starten (`supabase functions serve`), damit die Variable
   ankommt.

### Hosted (EU-Projekt)

1. Vault-Secrets im Dashboard (Project Settings, Vault) oder per SQL anlegen:
   `project_url` = `https://<projekt-ref>.supabase.co`, `cron_secret` =
   das erzeugte Secret.
2. Function-Secret setzen: `supabase secrets set CRON_SECRET=<secret>`.
3. Deploy OHNE JWT-Pflicht (config.toml gilt nur lokal):
   `supabase functions deploy reveal-schedule --no-verify-jwt`.
4. Nach dem Ausrollen prüfen: `select jobname, schedule from cron.job;`
   muss `reveal-schedule-reveal` (`10 23 * * *`), `reveal-schedule-reminder`
   (`30 7 * * *`) und `reveal-schedule-trip-start` (`0 8 * * *`) zeigen.
   Achtung: der erste Reveal-Lauf deckt auch alte aktive Reisen mit
   vergangenem Enddatum auf (Spec §2, abgenommen). Der erste Trip-Start-Lauf
   holt dagegen NICHT nach: nur Reisen mit `start_date = heute` lösen den
   Push aus, laufende Alt-Reisen bekommen nichts.

## Zeiten

Zeitreferenz ist fest Europe/Zurich (Spec §3). Die UTC-Cron-Zeiten liegen
ganzjährig nach Zürcher Mitternacht (Reveal) bzw. am Zürcher Morgen
(Erinnerung, Beginn-Push); «heute» berechnet der SQL-Wrapper mit der DB-Uhr.
08:00 UTC ist 10:00 Sommer- bzw. 09:00 Winterzeit in Zürich.

Der `net.http_post`-Aufruf ist fire-and-forget, die Antwort der Function
landet höchstens in `net._http_response`; ein verpasster oder abgebrochener
Lauf heilt sich am Folgetag selbst, weil der Reveal `end_date < heute`
abfragt statt nur den Vortag.
