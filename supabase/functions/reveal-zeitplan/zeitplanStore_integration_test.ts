// Integrationstest für zeitplanStore.ts, genau die Abfragen, die kein
// Fake-Store beweisen kann, weil er ihre Bedingungen selbst vorgibt:
//   1. holeFaelligeReisen: end_date STRENG kleiner heute und status='active'
//      im echten Select (Spec §2: bis 23:59 des Enddatums bleibt die Reise
//      unterwegs).
//   2. holeErinnerungsReisen: end_date = heute UND Marker leer.
//   3. markiereErinnerung: die CAS-Bedingung `is('end_reminder_sent_at',
//      null)` im echten Update, zweiter Aufruf 0 Zeilen.
//
// Ausführen:
//   cd supabase/functions/reveal-zeitplan
//   npx deno test --allow-net --allow-run=supabase zeitplanStore_integration_test.ts

import { assert, assertEquals } from 'jsr:@std/assert';
import { erstelleAdminClient, erstelleZeitplanStore } from './zeitplanStore.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';

async function supabaseStatusEnv(): Promise<Record<string, string> | null> {
  try {
    const cmd = new Deno.Command('supabase', { args: ['status', '-o', 'env'], stdout: 'piped', stderr: 'null' });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return null;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';

// Erreichbarkeit direkt über die REST-API prüfen, diese Datei braucht keine
// servierte Edge Function, nur Postgres/PostgREST/Auth.
async function restErreichbar(): Promise<boolean> {
  if (!SERVICE_ROLE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?select=id&limit=1`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const stackBereit = Boolean(statusEnv && SERVICE_ROLE_KEY && (await restErreichbar()));

if (!stackBereit) {
  console.warn(
    'zeitplanStore_integration_test: übersprungen, braucht `supabase start`.',
  );
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function erwarteJson(res: Response, erwarteterStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, erwarteterStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

async function neueTrip(endDate: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      name: 'Integrationstest zeitplanStore',
      start_date: '2026-01-01',
      end_date: endDate,
      owner_id: LEA_ID,
      status: 'active',
    }),
  });
  const [trip] = (await erwarteJson(res, 201)) as Array<{ id: string }>;
  return trip.id;
}

async function loescheTrip(tripId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, { method: 'DELETE', headers: restHeaders() }).catch(
    () => null,
  );
}

Deno.test({
  name: 'holeFaelligeReisen: end_date streng kleiner heute, active only',
  ignore: !stackBereit,
  fn: async () => {
    const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await neueTrip('2026-01-02');
    try {
      const fael = await store.holeFaelligeReisen('2026-01-03');
      assert(fael.data !== null, String(fael.error));
      assert(fael.data.some((t) => t.id === tripId), 'Reise mit end_date < heute ist fällig');

      // Am Enddatum selbst (bis 23:59) noch NICHT fällig.
      const nochNicht = await store.holeFaelligeReisen('2026-01-02');
      assert(nochNicht.data !== null, String(nochNicht.error));
      assertEquals(nochNicht.data.some((t) => t.id === tripId), false);

      // Revealed zählt nicht als fällig.
      await store.aktualisiereWennAktiv(tripId);
      const revealed = await store.holeFaelligeReisen('2026-01-03');
      assert(revealed.data !== null, String(revealed.error));
      assertEquals(revealed.data.some((t) => t.id === tripId), false);
    } finally {
      await loescheTrip(tripId);
    }
  },
});

Deno.test({
  name: 'markiereErinnerung: CAS im echten Update, zweiter Aufruf 0 Zeilen',
  ignore: !stackBereit,
  fn: async () => {
    const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await neueTrip('2026-01-02');
    try {
      const erster = await store.markiereErinnerung(tripId);
      assert(erster.data !== null, String(erster.error));
      const zweiter = await store.markiereErinnerung(tripId);
      assertEquals(zweiter.data, null);
      assertEquals(zweiter.error, null);
    } finally {
      await loescheTrip(tripId);
    }
  },
});

Deno.test({
  name: 'holeErinnerungsReisen: end_date = heute und Marker leer',
  ignore: !stackBereit,
  fn: async () => {
    const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await neueTrip('2026-01-02');
    try {
      const faellig = await store.holeErinnerungsReisen('2026-01-02');
      assert(faellig.data !== null, String(faellig.error));
      assert(faellig.data.some((t) => t.id === tripId), 'Reise mit end_date = heute braucht die Erinnerung');

      const anderesDatum = await store.holeErinnerungsReisen('2026-01-01');
      assert(anderesDatum.data !== null, String(anderesDatum.error));
      assertEquals(anderesDatum.data.some((t) => t.id === tripId), false);

      await store.markiereErinnerung(tripId);
      const markiert = await store.holeErinnerungsReisen('2026-01-02');
      assert(markiert.data !== null, String(markiert.error));
      assertEquals(markiert.data.some((t) => t.id === tripId), false);
    } finally {
      await loescheTrip(tripId);
    }
  },
});
