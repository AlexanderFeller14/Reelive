// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-zeitplan, das zeitgesteuerte Gegenstück zu reveal-trip: aufgerufen
// von pg_cron über rufe_reveal_zeitplan (Migration 20260818100000), nie von
// der App. Statt eines JWT trägt der Aufruf das Cron-Secret im Header
// x-cron-geheimnis; die komplette Zulassungsprüfung ist als reine Funktion
// in zeitplan.ts testbar (pruefeZeitplanAnfrage). Dieser Handler übersetzt
// nur HTTP: Methode, Konfiguration, Body-Parsing, Dispatch nach Aufgabe.
import { sende } from '../reveal-trip/push.ts';
import { erstelleFehlermelder } from '../_shared/fehlermelder.ts';
import { fuehreAutoRevealAus, fuehreErinnerungAus, pruefeZeitplanAnfrage } from './zeitplan.ts';
import { erstelleAdminClient, erstelleZeitplanStore } from './zeitplanStore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_GEHEIMNIS = Deno.env.get('CRON_GEHEIMNIS') ?? '';

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const melde = erstelleFehlermelder(SENTRY_DSN, 'reveal-zeitplan');

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fehler(nachricht: string, status: number): Response {
  return json({ fehler: nachricht }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('reveal-zeitplan: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await melde(new Error('reveal-zeitplan: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return fehler('Server nicht konfiguriert.', 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fehler('Ungültige Anfrage.', 400);
  }

  const zulassung = pruefeZeitplanAnfrage(req.headers.get('x-cron-geheimnis'), CRON_GEHEIMNIS, body);
  if (!zulassung.ok) {
    if (zulassung.status === 500) {
      console.error('reveal-zeitplan: CRON_GEHEIMNIS fehlt.');
      await melde(new Error('reveal-zeitplan: CRON_GEHEIMNIS fehlt.'));
    }
    return fehler(zulassung.fehler, zulassung.status);
  }

  const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
  const { aufgabe, heute } = zulassung.anfrage;
  const ergebnis = aufgabe === 'reveal'
    ? await fuehreAutoRevealAus(store, sende, heute, melde)
    : await fuehreErinnerungAus(store, sende, heute, melde);
  return json(ergebnis.body, ergebnis.status);
});
