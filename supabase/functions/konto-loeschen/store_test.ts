// Docker-freie Unit-Tests für den S3-Löschweg aus store.ts — Reaktion auf den
// Abschluss-Review-Befund (Punkt 1): `loescheObjekte` lief bis dahin über die
// Supabase-Storage-API, die einzige Stelle im Repo, die nicht über
// `S3_ENDPOINT` signiert. Diese Datei ersetzt keinen Integrationstest — die
// Behauptung "Objekte sind nach der Löschung WIRKLICH weg" kann nur ein Test
// gegen den echten Stack beweisen (konto_loeschen_integration_test.ts, über
// die Storage-REST-API, unabhängig vom S3-Pfad hier). Was hier ohne Docker
// geprüft wird, ist die reine Logik darüber: Blockung, Kurzschluss bei einem
// echten Fehler — UND, das ist die eigentliche Falle aus dem Review-Befund,
// dass eine „erfolgreiche" Antwort für einen bereits fehlenden Schlüssel
// NICHT mit einem Beweis verwechselt wird, dass er vorher existierte.

import { assert, assertEquals } from 'jsr:@std/assert';
import { erstelleS3Loescher, type LoeschErgebnisEins, loescheObjekteBlockweise } from './store.ts';

// --- loescheObjekteBlockweise: reine Logik, fake loescheEins ---------------

function immerOk(): (schluessel: string) => Promise<LoeschErgebnisEins> {
  return (_schluessel: string) => Promise.resolve({ ok: true, status: 204 });
}

Deno.test('loescheObjekteBlockweise: leere Liste löst keinen Aufruf aus', async () => {
  let aufrufe = 0;
  const loescheEins = (_s: string) => {
    aufrufe++;
    return Promise.resolve({ ok: true, status: 204 });
  };
  const ergebnis = await loescheObjekteBlockweise([], loescheEins);
  assertEquals(ergebnis, { fehler: null });
  assertEquals(aufrufe, 0);
});

Deno.test('loescheObjekteBlockweise: jeder Schlüssel bekommt genau einen Aufruf', async () => {
  const gesehen: string[] = [];
  const loescheEins = (s: string) => {
    gesehen.push(s);
    return Promise.resolve({ ok: true, status: 204 });
  };
  const schluessel = Array.from({ length: 5 }, (_, i) => `trips/t/${i}/medium.jpg`);
  const ergebnis = await loescheObjekteBlockweise(schluessel, loescheEins);
  assertEquals(ergebnis, { fehler: null });
  assertEquals(gesehen.sort(), [...schluessel].sort());
});

Deno.test('loescheObjekteBlockweise: mehr Schlüssel als die Blockgrösse laufen in mehreren Blöcken durch', async () => {
  const bloecke: number[] = [];
  let inFlug = 0;
  let maxGleichzeitig = 0;
  const loescheEins = async (_s: string) => {
    inFlug++;
    maxGleichzeitig = Math.max(maxGleichzeitig, inFlug);
    await Promise.resolve();
    inFlug--;
    return { ok: true, status: 204 };
  };
  const schluessel = Array.from({ length: 12 }, (_, i) => `k-${i}`);
  await loescheObjekteBlockweise(schluessel, loescheEins, 5);
  // 12 Schlüssel, Blockgrösse 5 → drei Blöcke (5/5/2). Innerhalb eines
  // Blocks läuft es parallel (Promise.all), zwischen Blöcken nacheinander —
  // die maximale Parallelität darf die Blockgrösse nie überschreiten.
  assert(maxGleichzeitig <= 5, `maxGleichzeitig war ${maxGleichzeitig}`);
  void bloecke;
});

Deno.test('loescheObjekteBlockweise: ein einzelner Fehlschlag im Block bricht sofort ab, mit dem Fehler als Ursache', async () => {
  const versucht: string[] = [];
  const loescheEins = (s: string) => {
    versucht.push(s);
    if (s === 'k-1') return Promise.resolve({ ok: false, status: 403, fehler: new Error('Zugriff verweigert') });
    return Promise.resolve({ ok: true, status: 204 });
  };
  const ergebnis = await loescheObjekteBlockweise(['k-0', 'k-1', 'k-2'], loescheEins, 10);
  assert(ergebnis.fehler instanceof Error);
  assertEquals((ergebnis.fehler as Error).message, 'Zugriff verweigert');
  // Alle drei liegen im selben Block (Blockgrösse 10) und laufen parallel —
  // alle drei werden versucht, bevor der Fehler ausgewertet wird.
  assertEquals(versucht.sort(), ['k-0', 'k-1', 'k-2']);
});

Deno.test('loescheObjekteBlockweise: ein Fehlschlag im ERSTEN Block verhindert den zweiten Block', async () => {
  const versucht: string[] = [];
  const loescheEins = (s: string) => {
    versucht.push(s);
    return Promise.resolve({ ok: false, status: 500 });
  };
  const schluessel = ['a', 'b', 'c', 'd'];
  const ergebnis = await loescheObjekteBlockweise(schluessel, loescheEins, 2);
  assert(ergebnis.fehler !== null);
  // Block 1 ist ['a', 'b'] — Block 2 ('c', 'd') darf gar nicht erst anlaufen.
  assertEquals(versucht, ['a', 'b']);
});

Deno.test('loescheObjekteBlockweise: ein Fehlschlag OHNE eigenes Fehlerobjekt bekommt eine Ersatzmeldung mit HTTP-Status', async () => {
  const loescheEins = (_s: string) => Promise.resolve({ ok: false, status: 403 });
  const ergebnis = await loescheObjekteBlockweise(['x'], loescheEins);
  assert(ergebnis.fehler instanceof Error);
  assert((ergebnis.fehler as Error).message.includes('403'));
});

// --- erstelleS3Loescher: die reale Signierung, mit injiziertem fetchImpl ---
// Kein echtes Netz, keine echte SigV4-Prüfung (die übernimmt der
// Integrationstest gegen den laufenden Storage-Dienst) — hier wird nur
// geprüft, DASS eine DELETE-Anfrage an den richtigen Pfad geht, mit welcher
// Methode, und dass die Antwort korrekt in {ok, status} übersetzt wird.

function fakeAws(): { sign: (url: string, init: RequestInit & { aws?: unknown }) => Promise<Request> } {
  return {
    sign: (url: string, init: RequestInit & { aws?: unknown }) =>
      Promise.resolve(new Request(url, { method: init.method })),
  };
}

Deno.test('erstelleS3Loescher: signiert eine DELETE-Anfrage auf endpoint/bucket/schluessel', async () => {
  const gesehen: { url: string; method: string }[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const req = input as Request;
    gesehen.push({ url: req.url, method: req.method });
    return new Response(null, { status: 204 });
  };
  // deno-lint-ignore no-explicit-any
  const loescheEins = erstelleS3Loescher(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const ergebnis = await loescheEins('trips/t-1/p-1/medium.jpg');
  assertEquals(ergebnis, { ok: true, status: 204 });
  assertEquals(gesehen.length, 1);
  assertEquals(gesehen[0].method, 'DELETE');
  assertEquals(gesehen[0].url, 'https://s3.example.com/media/trips/t-1/p-1/medium.jpg');
});

// Die eigentliche Falle aus dem Review-Befund: "weniger zurückbekommen als
// angefragt" (hier: ein Erfolgsstatus für einen längst fehlenden Schlüssel)
// darf NICHT als Fehlschlag gelten — S3-kompatible Object-Storages
// beantworten DELETE auf einen nicht (mehr) existierenden Schlüssel genauso
// wie auf einen existierenden.
Deno.test('erstelleS3Loescher: ein 204 auf einen (schon) fehlenden Schlüssel ist KEIN Fehler', async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });
  // deno-lint-ignore no-explicit-any
  const loescheEins = erstelleS3Loescher(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const ergebnis = await loescheEins('trips/t-1/schon-weg.jpg');
  assertEquals(ergebnis.ok, true);
});

Deno.test('erstelleS3Loescher: ein echter Fehlerstatus (z.B. 403) wird als Fehlschlag gemeldet', async () => {
  const fetchImpl: typeof fetch = async () => new Response('Forbidden', { status: 403 });
  // deno-lint-ignore no-explicit-any
  const loescheEins = erstelleS3Loescher(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const ergebnis = await loescheEins('trips/t-1/p-1/medium.jpg');
  assertEquals(ergebnis.ok, false);
  assertEquals(ergebnis.status, 403);
});

Deno.test('erstelleS3Loescher: ein Netzfehler wirft nicht, sondern liefert {ok:false, fehler}', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError('Netzwerk nicht erreichbar');
  };
  // deno-lint-ignore no-explicit-any
  const loescheEins = erstelleS3Loescher(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const ergebnis = await loescheEins('k');
  assertEquals(ergebnis.ok, false);
  assert(ergebnis.fehler instanceof TypeError);
});

// --- Die zwei Schichten zusammen: loescheObjekteBlockweise + erstelleS3Loescher

Deno.test('loescheObjekteBlockweise + erstelleS3Loescher: ein zweiter Löschversuch auf bereits Gelöschtes bleibt fehlerfrei', async () => {
  const geloescht = new Set<string>();
  const fetchImpl: typeof fetch = async (input) => {
    const req = input as Request;
    // Simuliert echtes S3-Verhalten: die erste Löschung entfernt das
    // Objekt wirklich, jede weitere Anfrage auf denselben Schlüssel bleibt
    // trotzdem ein Erfolg (204) — kein 404, wie im Kopfkommentar von
    // erstelleS3Loescher beschrieben.
    geloescht.add(req.url);
    return new Response(null, { status: 204 });
  };
  // deno-lint-ignore no-explicit-any
  const loescheEins = erstelleS3Loescher(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const schluessel = ['trips/t/1/medium.jpg', 'trips/t/1/thumb.jpg'];

  const erster = await loescheObjekteBlockweise(schluessel, loescheEins);
  assertEquals(erster, { fehler: null });
  assertEquals(geloescht.size, 2);

  // Zweiter Versuch auf DIESELBEN (jetzt schon gelöschten) Schlüssel — muss
  // ebenfalls fehlerfrei durchlaufen (Idempotenz, worauf ablauf.ts sich
  // stützt, wenn ein zweiter Anlauf nach einem Teilabbruch startet).
  const zweiter = await loescheObjekteBlockweise(schluessel, loescheEins);
  assertEquals(zweiter, { fehler: null });
});
