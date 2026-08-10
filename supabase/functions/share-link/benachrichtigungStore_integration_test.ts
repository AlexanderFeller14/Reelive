// Integrationstest für die vier Store-Wege der Teilen-Benachrichtigung, also
// genau den Teil, den `benachrichtigung_test.ts` NICHT beweisen kann: dort
// gibt ein Fake-Store die Antworten vor, hier kommen sie aus echtem Postgres.
//
// Geprüft wird, was ein Fake-Store per Definition nicht zeigt:
//   1. `holeMitglieder` liefert die Mitglieder GENAU dieser Reise, nicht die
//      einer anderen (die `.eq('trip_id', …)`-Klausel).
//   2. `holeTokens` liefert nur die Tokens der übergebenen Personen.
//   3. `loescheTokens` trägt `.in('user_id', userIds)` ZUSÄTZLICH zu
//      `.in('token', tokens)`: ein Token ausserhalb des angeschriebenen
//      Kreises bleibt unangetastet, selbst wenn sein Wert in `tokens` steht.
//      Dieselbe Zusicherung und derselbe Grund wie in
//      reveal-trip/revealStore_integration_test.ts, und derselbe Grund, aus
//      dem sie dort einen eigenen Test hat: eine positionsbasierte
//      Ticket-Zuordnung darf im Fehlerfall nicht die halbe Tabelle räumen.
//   4. `holeAnzeigename` liefert den Namen der richtigen Person.
//
// Bewusst OHNE HTTP und ohne Expo: der Store wird direkt aufgerufen, es
// braucht nur ein laufendes `supabase start`, keinen `functions serve`.
//
// Ohne Stack überspringt sich der Test mit einer Log-Zeile, statt einen
// Rechner ohne Docker rot zu färben.
//
// Ausführen:
//   cd supabase/functions
//   deno test --allow-net --allow-run=supabase share-link/benachrichtigungStore_integration_test.ts

import { assertEquals } from 'jsr:@std/assert@1';
import { erstelleAdminClient, erstelleShareStore } from './store.ts';

// Aus supabase/seed.sql.
const LEA = '11111111-1111-4111-8111-111111111111';
const MIRA = '33333333-3333-4333-8333-333333333333';
const JONAS = '44444444-4444-4444-8444-444444444444';
// Sofia ist in Norwegen und Sardinien, aber NICHT in Lissabon. Genau deshalb
// ist sie die brauchbare Gegenprobe: die drei anderen sind in beiden Reisen,
// an ihnen waere eine fehlende trip_id-Klausel nicht zu erkennen.
const SOFIA = '55555555-5555-4555-8555-555555555555';
const LISSABON = 'aaaaaaaa-0000-4000-8000-000000000002';
const NORWEGEN = 'aaaaaaaa-0000-4000-8000-000000000001';

async function supabaseStatusEnv(): Promise<Record<string, string> | null> {
  try {
    const cmd = new Deno.Command('supabase', {
      args: ['status', '-o', 'env'],
      stdout: 'piped',
      stderr: 'null',
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return null;
    const env: Record<string, string> = {};
    for (const zeile of new TextDecoder().decode(stdout).split('\n')) {
      const treffer = zeile.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (treffer) env[treffer[1]] = treffer[2];
    }
    return env;
  } catch {
    return null;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';

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
    'benachrichtigungStore_integration_test: übersprungen, braucht `supabase start`. Details im Datei-Header.',
  );
}

function store() {
  return erstelleShareStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
}

// Die Testtokens tragen ein eigenes Präfix und werden vor UND nach jedem Test
// geräumt: ein abgebrochener Lauf soll den nächsten nicht verfälschen.
const PRAEFIX = 'IntegrationstestToken';

async function raeumeTokens(): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=like.${PRAEFIX}*`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
}

async function legeToken(userId: string, token: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, token, platform: 'ios' }),
  });
  if (!res.ok) throw new Error(`push_tokens-Insert: ${res.status} ${await res.text()}`);
}

Deno.test({
  name: 'holeMitglieder liefert die Mitglieder GENAU dieser Reise',
  ignore: !stackBereit,
  async fn() {
    const { data, error } = await store().holeMitglieder(LISSABON);
    assertEquals(error, null);
    const ids = (data ?? []).map((m) => m.user_id).sort();
    assertEquals(ids, [LEA, MIRA, JONAS].sort());

    // Die Gegenprobe, und sie hängt an Sofia: sie ist in Norwegen, aber nicht
    // in Lissabon. Ohne trip_id-Klausel stünde sie oben mit in der Liste.
    assertEquals(ids.includes(SOFIA), false);
    const andere = await store().holeMitglieder(NORWEGEN);
    assertEquals(andere.error, null);
    assertEquals((andere.data ?? []).map((m) => m.user_id).includes(SOFIA), true);
  },
});

Deno.test({
  name: 'holeTokens liefert nur die Tokens der uebergebenen Personen',
  ignore: !stackBereit,
  async fn() {
    await raeumeTokens();
    try {
      await legeToken(MIRA, `${PRAEFIX}[mira]`);
      await legeToken(JONAS, `${PRAEFIX}[jonas]`);
      await legeToken(LEA, `${PRAEFIX}[lea]`);

      const { data, error } = await store().holeTokens([MIRA, JONAS]);
      assertEquals(error, null);
      const tokens = (data ?? []).map((t) => t.token).sort();
      assertEquals(tokens, [`${PRAEFIX}[jonas]`, `${PRAEFIX}[mira]`]);
    } finally {
      await raeumeTokens();
    }
  },
});

// Der wichtigste Test dieser Datei. Die Ticket-zu-Token-Zuordnung in push.ts
// ist rein positionsbasiert; käme von Expo je ein versetzter Block zurück,
// stünde in `tokens` ein Wert, der einer ganz anderen Person gehört. Die
// zweite Einschränkung begrenzt den Schaden auf den angeschriebenen Kreis.
Deno.test({
  name: 'loescheTokens raeumt NUR innerhalb des angeschriebenen Kreises',
  ignore: !stackBereit,
  async fn() {
    await raeumeTokens();
    try {
      await legeToken(MIRA, `${PRAEFIX}[mira]`);
      await legeToken(LEA, `${PRAEFIX}[lea]`);

      // Beide Tokens als «tot» gemeldet, aber angeschrieben war nur Mira.
      const { error } = await store().loescheTokens(
        [`${PRAEFIX}[mira]`, `${PRAEFIX}[lea]`],
        [MIRA],
      );
      assertEquals(error, null);

      const uebrig = await store().holeTokens([MIRA, LEA]);
      assertEquals((uebrig.data ?? []).map((t) => t.token), [`${PRAEFIX}[lea]`]);
    } finally {
      await raeumeTokens();
    }
  },
});

Deno.test({
  name: 'holeAnzeigename liefert den Namen der richtigen Person',
  ignore: !stackBereit,
  async fn() {
    const mira = await store().holeAnzeigename(MIRA);
    assertEquals(mira.error, null);
    assertEquals(typeof mira.data, 'string');

    const lea = await store().holeAnzeigename(LEA);
    assertEquals(lea.error, null);
    // Zwei verschiedene Personen, zwei verschiedene Namen: ohne diese
    // Gegenprobe wäre auch eine Abfrage ohne id-Filter grün.
    assertEquals(mira.data === lea.data, false);
  },
});

// Eine Person, die es nicht gibt, hat keinen Namen, und das ist KEIN Fehler:
// `versendeTeilenPush` schickt die Meldung dann ohne Namen, statt sie zu
// unterlassen.
Deno.test({
  name: 'ein unbekanntes Konto liefert null statt eines Fehlers',
  ignore: !stackBereit,
  async fn() {
    const { data, error } = await store().holeAnzeigename('00000000-0000-4000-8000-000000000000');
    assertEquals(error, null);
    assertEquals(data, null);
  },
});
