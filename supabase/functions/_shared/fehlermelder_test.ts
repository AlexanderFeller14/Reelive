// Docker-frei, wie ablauf_test.ts/verwaltung_test.ts/reveal_test.ts: reine
// Logik plus injizierte `fetchImpl`, kein echtes Netz, kein `supabase start`
// nötig. Deckt genau die beiden Zusicherungen aus dem Kopfkommentar von
// fehlermelder.ts: (1) ohne DSN passiert nichts, (2) mit DSN wird korrekt und
// NUR mit den erlaubten Feldern gemeldet — nie das rohe Fehlerobjekt, nie
// mehr als die übergebenen Primitive.

import { assert, assertEquals, assertExists } from 'jsr:@std/assert';
import { erstelleFehlermelder } from './fehlermelder.ts';

const GUELTIGE_DSN = 'https://public-key-abc@o123.ingest.example.com/456';

function fakeFetchFabrik() {
  const aufrufe: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    aufrufe.push({ url: String(input), init: init ?? {} });
    return new Response('{"id":"abc"}', { status: 200 });
  };
  return { aufrufe, fetchImpl };
}

// --- Ohne DSN: vollständiger No-Op ------------------------------------------

Deno.test('erstelleFehlermelder: ohne DSN wird fetchImpl nie aufgerufen', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder('', 'test-funktion', fetchImpl);
  await melde(new Error('sollte nie ankommen'));
  assertEquals(aufrufe.length, 0);
});

Deno.test('erstelleFehlermelder: eine kaputte, aber gesetzte DSN wird zum stillen No-Op (kein Throw)', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder('nicht-eine-url', 'test-funktion', fetchImpl);
  await melde(new Error('x'));
  assertEquals(aufrufe.length, 0);
});

Deno.test('erstelleFehlermelder: eine DSN ohne Public Key wird zum stillen No-Op', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder('https://o123.ingest.example.com/456', 'test-funktion', fetchImpl);
  await melde(new Error('x'));
  assertEquals(aufrufe.length, 0);
});

// --- Mit DSN: korrekte Anfrage -----------------------------------------------

Deno.test('erstelleFehlermelder: mit DSN wird genau einmal an die Store-API gepostet', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'konto-loeschen', fetchImpl);
  await melde(new Error('Löschung abgebrochen'), { user_id: 'u-1', schritt: 'speicher' });

  assertEquals(aufrufe.length, 1);
  assertEquals(aufrufe[0].url, 'https://o123.ingest.example.com/api/456/store/');
  const headers = new Headers(aufrufe[0].init.headers);
  assertEquals(headers.get('content-type'), 'application/json');
  const auth = headers.get('X-Sentry-Auth') ?? '';
  assert(auth.includes('sentry_key=public-key-abc'), auth);
  assert(auth.includes('sentry_version=7'), auth);

  const body = JSON.parse(String(aufrufe[0].init.body));
  assertEquals(body.message.message, 'Löschung abgebrochen');
  assertEquals(body.tags, { funktion: 'konto-loeschen' });
  assertEquals(body.extra, { user_id: 'u-1', schritt: 'speicher' });
  assertExists(body.event_id);
  // 32 Hex-Zeichen, keine Bindestriche — Sentrys Store-API verlangt genau
  // diese Form.
  assertEquals(body.event_id.length, 32);
  assert(!body.event_id.includes('-'));
});

Deno.test('erstelleFehlermelder: ein Pfad-Präfix in der DSN (Self-Hosted) bleibt vor /api/ erhalten', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder(
    'https://key@sentry.example.com/praefix/789',
    'share-link',
    fetchImpl,
  );
  await melde(new Error('x'));
  assertEquals(aufrufe[0].url, 'https://sentry.example.com/praefix/api/789/store/');
});

Deno.test('erstelleFehlermelder: ohne kontext bleibt extra leer, aber der Aufruf klappt trotzdem', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'media-urls', fetchImpl);
  await melde(new Error('x'));
  const body = JSON.parse(String(aufrufe[0].init.body));
  assertEquals(body.extra, undefined);
});

// --- Die Privacy-Regel: nie das rohe Fehlerobjekt, nur .message ------------

Deno.test('erstelleFehlermelder: ein Postgres-artiges Fehlerobjekt gibt NUR .message weiter, keine anderen Felder', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'media-urls', fetchImpl);
  const pgFehler = {
    message: 'duplicate key value violates unique constraint',
    detail: 'Key (id)=(11111111-1111-4111-8111-111111111111) already exists.',
    hint: 'geheimer interner Hinweis',
    code: '23505',
  };
  await melde(pgFehler);
  const body = JSON.parse(String(aufrufe[0].init.body));
  assertEquals(body.message.message, 'duplicate key value violates unique constraint');
  const roh = String(aufrufe[0].init.body);
  assert(!roh.includes('geheimer interner Hinweis'));
  assert(!roh.includes('23505'));
  assert(!roh.includes('already exists'));
});

Deno.test('erstelleFehlermelder: ein Fehlerobjekt ganz ohne message wird über String() dargestellt', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'media-urls', fetchImpl);
  await melde('nur ein String');
  const body = JSON.parse(String(aufrufe[0].init.body));
  assertEquals(body.message.message, 'nur ein String');
});

// --- Nie ein Throw, egal was passiert ---------------------------------------

Deno.test('erstelleFehlermelder: ein Netzfehler in fetchImpl wird verschluckt, melde() wirft nicht', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError('Netzwerk nicht erreichbar');
  };
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'reveal-trip', fetchImpl);
  await melde(new Error('x'));
  // Kein Assert nötig ausser: die Zeile oben ist überhaupt zurückgekehrt.
});

Deno.test('erstelleFehlermelder: eine 500-Antwort von Sentry selbst wird nicht als Absturz behandelt', async () => {
  const fetchImpl: typeof fetch = async () => new Response('kaputt', { status: 500 });
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'reveal-trip', fetchImpl);
  await melde(new Error('x'));
});

Deno.test('erstelleFehlermelder: schickt ein AbortSignal mit, damit ein hängendes Sentry die Antwort nicht aufhält', async () => {
  const { aufrufe, fetchImpl } = fakeFetchFabrik();
  const melde = erstelleFehlermelder(GUELTIGE_DSN, 'media-urls', fetchImpl);
  await melde(new Error('x'));
  assert(aufrufe[0].init.signal instanceof AbortSignal);
});
