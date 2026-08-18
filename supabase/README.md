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
     -c "select vault.create_secret('http://host.docker.internal:54321', 'projekt_url');" \
     -c "select vault.create_secret('HIER-DAS-SECRET', 'cron_geheimnis');"
   ```

2. In `supabase/functions/.env` dieselbe Zeile wie in `.env.example`
   eintragen: `CRON_GEHEIMNIS=HIER-DAS-SECRET`.

3. Functions neu starten (`supabase functions serve`), damit die Variable
   ankommt.

### Hosted (EU-Projekt)

1. Vault-Secrets im Dashboard (Project Settings, Vault) oder per SQL anlegen:
   `projekt_url` = `https://<projekt-ref>.supabase.co`, `cron_geheimnis` =
   das erzeugte Secret.
2. Function-Secret setzen: `supabase secrets set CRON_GEHEIMNIS=<secret>`.
3. Deploy OHNE JWT-Pflicht (config.toml gilt nur lokal):
   `supabase functions deploy reveal-zeitplan --no-verify-jwt`.
4. Nach dem Ausrollen prüfen: `select jobname, schedule from cron.job;`
   muss `reveal-zeitplan-reveal` (`10 23 * * *`) und
   `reveal-zeitplan-erinnerung` (`30 7 * * *`) zeigen. Achtung: der erste
   Reveal-Lauf deckt auch alte aktive Reisen mit vergangenem Enddatum auf
   (Spec §2, abgenommen).

## Zeiten

Zeitreferenz ist fest Europe/Zurich (Spec §3). Die UTC-Cron-Zeiten liegen
ganzjährig nach Zürcher Mitternacht (Reveal) bzw. am Zürcher Morgen
(Erinnerung); «heute» berechnet der SQL-Wrapper mit der DB-Uhr.

Der `net.http_post`-Aufruf ist fire-and-forget, die Antwort der Function
landet höchstens in `net._http_response`; ein verpasster oder abgebrochener
Lauf heilt sich am Folgetag selbst, weil der Reveal `end_date < heute`
abfragt statt nur den Vortag.
