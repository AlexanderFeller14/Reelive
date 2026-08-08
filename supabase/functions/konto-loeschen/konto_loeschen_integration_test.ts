// Integrationstest für konto-loeschen — die zweite Schicht unter
// ablauf_test.ts, nie die einzige.
//
// Was hier und NUR hier belegt werden kann:
//   1. Dass die Kaskaden wirklich alles räumen. Der Test zählt nach dem
//      Löschen JEDE der neun Tabellen in `public` einzeln durch, statt sich
//      auf die Fremdschlüssel-Deklarationen zu verlassen.
//   2. Dass `trips.owner_id → profiles` als on-delete-restrict tatsächlich
//      beisst: ein direkter deleteUser ohne vorherige Reise-Löschung scheitert.
//      Ohne diesen Nachweis wäre die ganze Reihenfolge Spekulation.
//   3. Dass die Objekte im Bucket weg sind — auch die von FREMDEN Autoren in
//      einer eigenen Reise, und auch die eigenen in einer FREMDEN Reise.
//   4. Dass die fremde Reise selbst überlebt und ihr invite_code NICHT
//      rotiert — der Grund, warum `verlasseFremdeReisen` mit dem JWT der
//      Person läuft und nicht mit Service-Role.
//   5. Dass `zahlen` die Wahrheit sagt.
//   6. Dass ein zweiter Aufruf mit demselben (jetzt toten) JWT nichts mehr
//      ausrichtet.
//
// Ausführen (Terminal 1 offen lassen):
//   supabase functions serve --env-file supabase/functions/.env
// dann in Terminal 2:
//   cd supabase/functions/konto-loeschen
//   npx deno test --allow-net --allow-run=supabase konto_loeschen_integration_test.ts
//
// Ohne laufenden Stack überspringt sich der Test mit einer Log-Zeile. Das ist
// vertretbar, WEIL die Kernzusicherung (W7: scheitert der Speicherschritt,
// bleibt die Datenbank unberührt) in ablauf_test.ts steht und dort immer
// läuft.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { erwarteteSchluessel } from '../media-urls/keys.ts';

const BUCKET = 'media';
// Fremde Person mit einer eigenen Reise, in die unser Testkonto eingeladen
// wird. Aus seed.sql, damit der Test keine zweite Wegwerf-Identität braucht.
const MIRA_ID = '33333333-3333-4333-8333-333333333333';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}
async function mintJwt(secret: string, userId: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: 'authenticated', exp: now + 3600, iat: now, sub: userId, role: 'authenticated' };
  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

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

function envOderNull(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

async function functionErreichbar(url: string, anonKey: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    const daten = await res.json().catch(() => null);
    return Boolean(daten && typeof daten === 'object' && 'fehler' in daten);
  } catch {
    return false;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = statusEnv?.ANON_KEY ?? '';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';
const JWT_SECRET = statusEnv?.JWT_SECRET ?? '';
const FUNCTION_URL = envOderNull('KONTO_LOESCHEN_URL') ?? `${SUPABASE_URL}/functions/v1/konto-loeschen`;

const stackBereit = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET && (await functionErreichbar(FUNCTION_URL, ANON_KEY)),
);

if (!stackBereit) {
  console.warn(
    'konto_loeschen_integration_test: übersprungen — braucht `supabase start` UND ' +
      '`supabase functions serve --env-file supabase/functions/.env` in einem zweiten Terminal. ' +
      'Die Kernzusicherung W7 läuft ohne Stack in ablauf_test.ts.',
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

async function rest(pfad: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
    headers: restHeaders(),
    ...init,
  });
  const text = await res.text();
  assert(res.ok, `${pfad}: HTTP ${res.status} ${text}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

// Zählt Zeilen über den Content-Range-Header — funktioniert für jede Tabelle,
// ohne dass der Test ihre Spalten kennen muss.
async function zaehle(pfad: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}&select=*`, {
    headers: restHeaders({ Prefer: 'count=exact', Range: '0-0' }),
  });
  const text = await res.text();
  assert(res.ok, `${pfad}: HTTP ${res.status} ${text}`);
  const bereich = res.headers.get('content-range') ?? '';
  const gesamt = bereich.split('/')[1];
  return Number(gesamt);
}

async function objektExistiert(key: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await res.body?.cancel();
  return res.status === 200;
}

async function legeObjektAb(key: string, inhalt: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'image/jpeg',
    },
    body: inhalt,
  });
  assertEquals(res.status, 200, await res.text());
}

// Ein frisches Wegwerf-Konto: auth.users + profiles. Wegwerf, weil der Test es
// am Ende wirklich löscht — ein seed.sql-Konto zu verbrennen würde jeden
// weiteren Lauf und jede manuelle Prüfung im Simulator kaputtmachen.
async function legeKontoAn(nummer: string): Promise<{ id: string; jwt: string }> {
  const id = crypto.randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify({
      id,
      email: `loeschtest-${nummer}-${id.slice(0, 8)}@test.local`,
      password: 'loeschtest-passwort',
      email_confirm: true,
    }),
  });
  const nutzer = (await erwarteJson(res, 200)) as { id: string };
  await rest('profiles', {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      id: nutzer.id,
      username: `loeschtest${nummer}${nutzer.id.slice(0, 6).replace(/-/g, '')}`.toLowerCase().slice(0, 20),
      display_name: `Löschtest ${nummer}`,
    }),
  });
  return { id: nutzer.id, jwt: await mintJwt(JWT_SECRET, nutzer.id) };
}

async function legePostAn(zeile: Record<string, unknown>): Promise<void> {
  await rest('posts', {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(zeile),
  });
}

Deno.test({
  name: 'konto-loeschen räumt Zeilen und Objekte — und lässt fremde Reisen unangetastet',
  ignore: !stackBereit,
  async fn() {
    const konto = await legeKontoAn('a');
    // Ein zweites Konto, das Mitglied in der Reise des ersten ist: Sein
    // Moment liegt in einer FREMDEN (nämlich unserer) Reise und muss beim
    // Löschen mitgehen — samt Objekten. Genau der Fall aus Spec §3
    // («Werden mitgelöscht, samt Medien aller Mitglieder»).
    const mitreisend = await legeKontoAn('b');

    const objekte: string[] = [];
    let eigeneTripId: string | null = null;
    let fremdeTripId: string | null = null;

    try {
      // --- Eigene Reise mit zwei Momenten (einer davon von jemand anderem) --
      const [eigen] = (await rest('trips', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          name: 'Eigene Reise des Löschkontos',
          start_date: '2026-01-01',
          end_date: '2026-01-02',
          owner_id: konto.id,
        }),
      })) as Array<{ id: string }>;
      eigeneTripId = eigen.id;
      await rest('trip_members', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ trip_id: eigeneTripId, user_id: mitreisend.id }),
      });

      const eigenerPost = crypto.randomUUID();
      const fremderPostInEigenerReise = crypto.randomUUID();
      for (const [postId, autor] of [[eigenerPost, konto.id], [fremderPostInEigenerReise, mitreisend.id]]) {
        const s = erwarteteSchluessel(eigeneTripId, postId, 'photo', 'jpg');
        await legePostAn({
          id: postId,
          trip_id: eigeneTripId,
          author_id: autor,
          type: 'photo',
          storage_key: s.storage_key,
          thumb_key: s.thumb_key,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T08:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        });
        await legeObjektAb(s.storage_key, `medium-${postId}`);
        await legeObjektAb(s.thumb_key, `thumb-${postId}`);
        objekte.push(s.storage_key, s.thumb_key);
      }

      // --- Fremde Reise (Mira), in der das Konto nur Mitglied ist ----------
      const [fremd] = (await rest('trips', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          name: 'Fremde Reise, in der das Löschkonto nur mitfährt',
          start_date: '2026-02-01',
          end_date: '2026-02-02',
          owner_id: MIRA_ID,
        }),
      })) as Array<{ id: string; invite_code: string }>;
      fremdeTripId = fremd.id;
      const inviteVorher = fremd.invite_code;
      await rest('trip_members', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ trip_id: fremdeTripId, user_id: konto.id }),
      });

      const eigenerPostAnderswo = crypto.randomUUID();
      const sAnderswo = erwarteteSchluessel(fremdeTripId, eigenerPostAnderswo, 'video', 'mov');
      await legePostAn({
        id: eigenerPostAnderswo,
        trip_id: fremdeTripId,
        author_id: konto.id,
        type: 'video',
        media_ext: 'mov',
        duration_s: 12,
        storage_key: sAnderswo.storage_key,
        thumb_key: sAnderswo.thumb_key,
        upload_status: 'uploaded',
        captured_at: '2026-02-01T08:00:00+01:00',
        captured_tz: 'Europe/Zurich',
      });
      await legeObjektAb(sAnderswo.storage_key, 'medium-anderswo');
      await legeObjektAb(sAnderswo.thumb_key, 'thumb-anderswo');
      objekte.push(sAnderswo.storage_key, sAnderswo.thumb_key);

      // Ein Moment von Mira in ihrer eigenen Reise — er muss ALLES überleben.
      const miraPost = crypto.randomUUID();
      const sMira = erwarteteSchluessel(fremdeTripId, miraPost, 'photo', 'jpg');
      await legePostAn({
        id: miraPost,
        trip_id: fremdeTripId,
        author_id: MIRA_ID,
        type: 'photo',
        storage_key: sMira.storage_key,
        thumb_key: sMira.thumb_key,
        upload_status: 'uploaded',
        captured_at: '2026-02-01T09:00:00+01:00',
        captured_tz: 'Europe/Zurich',
      });
      await legeObjektAb(sMira.storage_key, 'medium-mira');
      objekte.push(sMira.storage_key);

      // --- Push-Token, Reaktion, Kommentar, Meldung ------------------------
      await rest('push_tokens', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ user_id: konto.id, token: `ExponentPushToken[${konto.id.slice(0, 12)}]`, platform: 'ios' }),
      });
      // Reveal beider Reisen, damit Reaktion/Kommentar/Meldung überhaupt
      // erlaubt wären (hier per Service-Role gesetzt, wie in den anderen
      // Integrationstests).
      for (const id of [eigeneTripId, fremdeTripId]) {
        await rest(`trips?id=eq.${id}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
        });
      }
      await rest('reactions', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ post_id: miraPost, user_id: konto.id, emoji: '🔥' }),
      });
      await rest('comments', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ post_id: miraPost, user_id: konto.id, text: 'Schönes Bild' }),
      });
      await rest('reports', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ post_id: miraPost, reporter_id: konto.id, reason: 'Testmeldung' }),
      });
      // Ein Share-Link auf die eigene (jetzt revealed) Reise — er muss über
      // share_links.trip_id → trips kaskadieren.
      await rest('share_links', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ trip_id: eigeneTripId }),
      });

      // --- zahlen: sagt der Dialog die Wahrheit? --------------------------
      const zahlenRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${konto.jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ aktion: 'zahlen' }),
      });
      assertEquals(await erwarteJson(zahlenRes, 200), {
        eigene_reisen: 1,
        // BEIDE Momente der eigenen Reise, auch der fremde — er geht mit.
        momente_in_eigenen_reisen: 2,
        // Nur das mitreisende Konto; die Person selbst zählt nicht mit.
        betroffene_personen: 1,
        eigene_momente_anderswo: 1,
      });

      // --- Der Nachweis, dass die Reihenfolge nötig ist -------------------
      // Ein deleteUser OHNE vorherige Reise-Löschung muss scheitern, sonst
      // wäre die ganze Reihenfolge Spekulation. 23503 = foreign_key_violation
      // aus trips_owner_id_fkey (on delete restrict).
      const direkt = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${konto.id}`, {
        method: 'DELETE',
        headers: restHeaders(),
      });
      const direktText = await direkt.text();
      assert(
        direkt.status >= 400,
        `deleteUser ohne vorherige Reise-Löschung wurde mit ${direkt.status} angenommen: ${direktText}`,
      );

      // --- Löschen --------------------------------------------------------
      const loeschRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${konto.jwt}`, 'content-type': 'application/json' },
        body: '{}',
      });
      assertEquals(await erwarteJson(loeschRes, 200), { ok: true });

      // --- Neun Tabellen, einzeln durchgezählt ----------------------------
      // Nicht «die Kaskaden werden schon greifen», sondern Zeile für Zeile.
      assertEquals(await zaehle(`profiles?id=eq.${konto.id}`), 0, 'profiles');
      assertEquals(await zaehle(`trips?owner_id=eq.${konto.id}`), 0, 'trips');
      assertEquals(await zaehle(`trips?id=eq.${eigeneTripId}`), 0, 'trips (die eigene Reise)');
      assertEquals(await zaehle(`trip_members?user_id=eq.${konto.id}`), 0, 'trip_members');
      assertEquals(await zaehle(`posts?author_id=eq.${konto.id}`), 0, 'posts (eigene, überall)');
      assertEquals(await zaehle(`posts?trip_id=eq.${eigeneTripId}`), 0, 'posts (in der eigenen Reise)');
      assertEquals(await zaehle(`reactions?user_id=eq.${konto.id}`), 0, 'reactions');
      assertEquals(await zaehle(`comments?user_id=eq.${konto.id}`), 0, 'comments');
      assertEquals(await zaehle(`reports?reporter_id=eq.${konto.id}`), 0, 'reports');
      assertEquals(await zaehle(`push_tokens?user_id=eq.${konto.id}`), 0, 'push_tokens');
      assertEquals(await zaehle(`share_links?trip_id=eq.${eigeneTripId}`), 0, 'share_links');
      // Und der Auth-Nutzer selbst.
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${konto.id}`, { headers: restHeaders() });
      await authRes.body?.cancel();
      assertEquals(authRes.status, 404, 'auth.users');

      // --- Kein Objekt bleibt liegen --------------------------------------
      const sEigen = erwarteteSchluessel(eigeneTripId, eigenerPost, 'photo', 'jpg');
      const sFremdInEigen = erwarteteSchluessel(eigeneTripId, fremderPostInEigenerReise, 'photo', 'jpg');
      for (const key of [
        sEigen.storage_key,
        sEigen.thumb_key,
        // Der Moment eines ANDEREN in unserer Reise — seine Objekte gehen mit,
        // sonst blieben sie ohne jede Datenbankzeile im Speicher zurück.
        sFremdInEigen.storage_key,
        sFremdInEigen.thumb_key,
        // Der eigene Moment in der FREMDEN Reise: die Reise bleibt, das
        // Objekt geht.
        sAnderswo.storage_key,
        sAnderswo.thumb_key,
      ]) {
        assertFalse(await objektExistiert(key), `Objekt blieb liegen: ${key}`);
      }

      // --- Was überleben muss ---------------------------------------------
      assertEquals(await zaehle(`trips?id=eq.${fremdeTripId}`), 1, 'die fremde Reise überlebt');
      assertEquals(await zaehle(`posts?id=eq.${miraPost}`), 1, 'Miras Moment überlebt');
      assert(await objektExistiert(sMira.storage_key), 'Miras Objekt blieb erhalten');
      assertEquals(await zaehle(`profiles?id=eq.${mitreisend.id}`), 1, 'das mitreisende Konto überlebt');

      // Der invite_code der fremden Reise darf NICHT rotiert sein. Sonst
      // reisst eine Kontolöschung allen anderen Eingeladenen ihren Link weg —
      // genau der Schaden, gegen den 20260807090000 geschrieben wurde. Möglich
      // nur, weil verlasseFremdeReisen mit dem JWT der Person läuft und nicht
      // mit Service-Role.
      const [fremdNachher] = (await rest(
        `trips?id=eq.${fremdeTripId}&select=invite_code`,
      )) as Array<{ invite_code: string }>;
      assertEquals(
        fremdNachher.invite_code,
        inviteVorher,
        'der Einladungscode der fremden Reise wurde durch die Kontolöschung rotiert',
      );

      // --- Ein zweiter Aufruf richtet nichts mehr aus ----------------------
      // Das JWT ist noch gültig signiert, aber der Nutzer existiert nicht mehr:
      // getUser scheitert, die Function antwortet 401. Für die App heisst das:
      // «nicht mehr angemeldet» nach einer Löschung ist der Erfolgsfall.
      const nochmal = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${konto.jwt}`, 'content-type': 'application/json' },
        body: '{}',
      });
      assertEquals(await erwarteJson(nochmal, 401), { fehler: 'Nicht angemeldet.' });
    } finally {
      for (const key of objekte) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        }).catch(() => null);
      }
      for (const id of [eigeneTripId, fremdeTripId]) {
        if (id === null) continue;
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
          method: 'DELETE',
          headers: restHeaders(),
        }).catch(() => null);
      }
      for (const id of [konto.id, mitreisend.id]) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: restHeaders(),
        }).catch(() => null);
      }
    }
  },
});

Deno.test({
  name: 'konto-loeschen: ohne Anmeldung und mit blossem Anon-Key geht gar nichts',
  ignore: !stackBereit,
  async fn() {
    const ohne = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
      body: '{}',
    });
    assertEquals(await erwarteJson(ohne, 401), { fehler: 'Nicht angemeldet.' });

    // Der Anon-Key ist ein gültiges, korrekt signiertes JWT — aber keine
    // Person. Er kommt durch das Gateway und muss am eigenen Check scheitern.
    const anon = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assertEquals(await erwarteJson(anon, 401), { fehler: 'Nicht angemeldet.' });

    const falscheAktion = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${await mintJwt(JWT_SECRET, MIRA_ID)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ aktion: 'alles_loeschen' }),
    });
    assertEquals(await erwarteJson(falscheAktion, 400), { fehler: 'Unbekannte Aktion.' });
  },
});

Deno.test({
  name: 'konto-loeschen: ein Konto ohne eigene Reisen und ohne Momente löscht sich sauber',
  ignore: !stackBereit,
  async fn() {
    // Der Grenzfall, an dem `in.()`-Filter mit leerer Liste einen
    // PostgREST-Syntaxfehler auslösen würden — und an dem eine Löschung
    // trotzdem funktionieren muss.
    const konto = await legeKontoAn('c');
    const zahlenRes = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${konto.jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ aktion: 'zahlen' }),
    });
    assertEquals(await erwarteJson(zahlenRes, 200), {
      eigene_reisen: 0,
      momente_in_eigenen_reisen: 0,
      betroffene_personen: 0,
      eigene_momente_anderswo: 0,
    });

    const loeschRes = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${konto.jwt}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assertEquals(await erwarteJson(loeschRes, 200), { ok: true });
    assertEquals(await zaehle(`profiles?id=eq.${konto.id}`), 0, 'profiles');
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${konto.id}`, { headers: restHeaders() });
    await authRes.body?.cancel();
    assertEquals(authRes.status, 404, 'auth.users');
  },
});
