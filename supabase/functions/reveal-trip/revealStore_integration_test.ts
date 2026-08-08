// Integrationstest für revealStore.ts — genau die zwei Abfragen, die kein
// Fake-Store in reveal_test.ts beweisen kann, weil er die CAS-Semantik selbst
// vorgibt statt sie von echtem Postgres abzuleiten:
//   1. aktualisiereWennAktiv trägt `.eq('status','active')` im echten Update
//      — zwei WIRKLICH parallele Aufrufe dürfen nur einen Gewinner erzeugen
//      (Final-Review-Mutation 2: diese Klausel gestrichen liesse ein
//      Wettrennen beide Aufrufe committen, mit unterschiedlichen
//      Zeitstempeln).
//   2. loescheTokens trägt `.in('user_id', userIds)` zusätzlich zu
//      `.in('token', tokens)` — ein Token, das nicht zum angeschriebenen
//      Empfängerkreis gehört, bleibt unangetastet, selbst wenn sein Wert in
//      `tokens` steht (Final-Review-Mutation 6).
//
// Bewusst OHNE Umweg über HTTP oder Expo: `erstelleRevealStore` wird direkt
// aufgerufen, kein `Deno.serve`, kein `functions serve`-Prozess nötig — nur
// ein laufendes `supabase start` (Postgres + PostgREST + Auth). Das macht den
// Test schneller und robuster als ein Aufruf über die echte Function, ohne
// die beiden Abfragen selbst schwächer zu prüfen: es sind exakt dieselben
// Store-Methoden, die index.ts über reveal.ts aufruft.
//
// Ohne laufenden Stack überspringt sich der Test mit einer Log-Zeile, statt
// einen Rechner ohne Docker rot zu färben (Muster wie lesen_test.ts /
// confirm_integration_test.ts in ../media-urls).
//
// Ausführen:
//   cd supabase/functions/reveal-trip
//   npx deno test --allow-net --allow-run=supabase revealStore_integration_test.ts

import { assert, assertEquals } from 'jsr:@std/assert';
import { erstelleAdminClient, erstelleRevealStore } from './revealStore.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';
const MIRA_ID = '33333333-3333-4333-8333-333333333333';
const JONAS_ID = '44444444-4444-4444-8444-444444444444';

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

// Erreichbarkeit direkt über die REST-API prüfen — diese Datei braucht keine
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
    'revealStore_integration_test: übersprungen — braucht `supabase start`. Details im Datei-Header.',
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

async function neueTrip(status: 'active' | 'revealed' | 'archived' = 'active'): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      name: 'Integrationstest revealStore',
      start_date: '2026-01-01',
      end_date: '2026-01-02',
      owner_id: LEA_ID,
      status,
      ...(status !== 'active' ? { revealed_at: '2026-01-03T00:00:00Z' } : {}),
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

// --- 1. CAS-Rennen: zwei wirklich parallele Aufrufe, nur ein Gewinner ------
Deno.test({
  name: 'aktualisiereWennAktiv: zwei parallele Aufrufe committen nur einmal (CAS-Bedingung im echten Update)',
  ignore: !stackBereit,
  async fn() {
    const tripId = await neueTrip('active');
    try {
      const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const store = erstelleRevealStore(supabaseAdmin);

      // Mehrere parallele Aufrufe statt nur zwei: erhöht die Chance, das
      // Zeitfenster tatsächlich zu treffen, in dem beide (oder mehr) den
      // Ausgangszustand 'active' sehen, bevor der erste committet.
      const ERGEBNISSE = await Promise.all(
        Array.from({ length: 6 }, () => store.aktualisiereWennAktiv(tripId)),
      );

      const gewinner = ERGEBNISSE.filter((e) => e.data !== null);
      const verlierer = ERGEBNISSE.filter((e) => e.data === null && e.error === null);

      assertEquals(gewinner.length, 1, `genau ein Aufruf darf gewinnen, tatsächlich: ${gewinner.length}`);
      assertEquals(
        verlierer.length,
        5,
        `die übrigen fünf müssen 0 Zeilen (data:null, kein Fehler) sehen, tatsächlich: ${verlierer.length}`,
      );

      // Der committete Zustand stimmt mit dem Gewinner überein — kein
      // zweiter, späterer Schreibvorgang hat ihn überschrieben.
      const { data: nachher } = await store.holeRevealedAtNachlese(tripId);
      assertEquals(nachher?.revealed_at, gewinner[0].data?.revealed_at);
    } finally {
      await loescheTrip(tripId);
    }
  },
});

Deno.test({
  name: 'aktualisiereWennAktiv: eine bereits revealed Reise liefert data:null (CAS greift nicht mehr)',
  ignore: !stackBereit,
  async fn() {
    const tripId = await neueTrip('revealed');
    try {
      const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const store = erstelleRevealStore(supabaseAdmin);

      const { data, error } = await store.aktualisiereWennAktiv(tripId);
      assertEquals(data, null);
      assertEquals(error, null);
    } finally {
      await loescheTrip(tripId);
    }
  },
});

// --- 2. Empfänger-Einschränkung bei der Token-Löschung ----------------------
Deno.test({
  name: 'loescheTokens: ein Token ausserhalb der userIds-Einschränkung bleibt unangetastet, selbst wenn sein Wert in tokens steht',
  ignore: !stackBereit,
  async fn() {
    const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const store = erstelleRevealStore(supabaseAdmin);

    const TOKEN_MIRA = `tok-integration-mira-${crypto.randomUUID()}`;
    const TOKEN_JONAS = `tok-integration-jonas-${crypto.randomUUID()}`;

    await erwarteJson(
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify([
          { token: TOKEN_MIRA, user_id: MIRA_ID, platform: 'ios' },
          { token: TOKEN_JONAS, user_id: JONAS_ID, platform: 'android' },
        ]),
      }),
      201,
    );

    try {
      // tokens enthält BEIDE Werte, userIds beschränkt aber auf Mira allein —
      // genau die Situation aus Mutation 6: Jonas' Token darf nicht fallen,
      // auch wenn sein Wert (fälschlich oder durch eine versetzte
      // Expo-Antwort) mit in `tokens` gelandet wäre.
      const { error } = await store.loescheTokens([TOKEN_MIRA, TOKEN_JONAS], [MIRA_ID]);
      assertEquals(error, null);

      const nachher = (await erwarteJson(
        await fetch(
          `${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})&select=token,user_id`,
          { headers: restHeaders() },
        ),
        200,
      )) as Array<{ token: string; user_id: string }>;

      assertEquals(nachher.map((z) => z.token), [TOKEN_JONAS], 'nur Jonas’ Token überlebt — Miras wurde gelöscht');
      assert(
        !nachher.some((z) => z.token === TOKEN_MIRA),
        'Miras Token (innerhalb der userIds-Einschränkung) wurde tatsächlich gelöscht',
      );
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch(() => null);
    }
  },
});

Deno.test({
  name: 'loescheTokens: liegen beide Tokens innerhalb der userIds-Einschränkung, werden beide gelöscht',
  ignore: !stackBereit,
  async fn() {
    const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const store = erstelleRevealStore(supabaseAdmin);

    const TOKEN_MIRA = `tok-integration-mira-${crypto.randomUUID()}`;
    const TOKEN_JONAS = `tok-integration-jonas-${crypto.randomUUID()}`;

    await erwarteJson(
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify([
          { token: TOKEN_MIRA, user_id: MIRA_ID, platform: 'ios' },
          { token: TOKEN_JONAS, user_id: JONAS_ID, platform: 'android' },
        ]),
      }),
      201,
    );

    try {
      const { error } = await store.loescheTokens([TOKEN_MIRA, TOKEN_JONAS], [MIRA_ID, JONAS_ID]);
      assertEquals(error, null);

      const nachher = (await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})&select=token`, {
          headers: restHeaders(),
        }),
        200,
      )) as Array<{ token: string }>;
      assertEquals(nachher, []);
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch(() => null);
    }
  },
});
