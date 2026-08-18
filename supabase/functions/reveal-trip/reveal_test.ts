// Unit-Tests für die aus Deno.serve herausgelöste Entscheidungs- und
// Versandlogik von reveal-trip (reveal.ts). Laufen OHNE `supabase start` und
// OHNE Netz, Reaktion auf den Final-Review-Befund, dass diese Function
// bisher NULL automatisierte Tests hatte (push_test.ts deckt nur push.ts
// isoliert ab, nicht den Statuswechsel selbst).
//
// Ein Fake-Store hält den Zustand EINER Reise im Speicher und modelliert die
// CAS-Bedingung des echten Postgres-Updates (`.eq('status','active')`)
// exakt: `aktualisiereWennAktiv` setzt status/revealed_at nur, wenn status
// zum Zeitpunkt des Aufrufs noch 'active' ist, und liefert sonst `null`
// zurück (0 betroffene Zeilen), genau die Semantik, auf die sich
// `fuehreRevealAus` verlässt. Das macht ein ECHTES Zwei-Aufrufe-Rennen
// testbar, ohne Docker: zwei `fuehreRevealAus`-Aufrufe gegen denselben
// Fake-Store, mit `Promise.all` gestartet.
//
// Was ein Fake-Store NICHT beweisen kann: dass die ECHTE Postgres-Abfrage in
// index.ts' Adapter tatsächlich `.eq('status','active')` trägt, die CAS-
// Semantik ist hier bewusst vom Test vorgegeben, nicht von der Produktion
// abgeleitet. Das schliesst reveal_integration_test.ts (Docker-gated, echter
// Stack, echtes Rennen über echtes Postgres).

import { assertEquals, assertExists } from 'jsr:@std/assert';
import { fuehreRevealAus, versendeRevealPush, type RevealStore, type SendeFn, type TripZeile } from './reveal.ts';
import type { PushNachricht } from './push.ts';
import type { FehlerKontext, MeldeFn } from '../_shared/fehlermelder.ts';

const OWNER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MEMBER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const MEMBER2_ID = 'cccccccc-3333-4333-8333-333333333333';
const TRIP_ID = 'dddddddd-4444-4444-8444-444444444444';

// --- Fake-Store --------------------------------------------------------------

type FakeZustand = {
  trip: TripZeile;
  // user_id -> tokens dieser Person
  tokens: Map<string, string[]>;
};

// Baut einen Fake-Store über einem gemeinsamen Zustandsobjekt. Mehrere Calls
// von `fuehreRevealAus` gegen DENSELBEN Zustand simulieren echte
// Nebenläufigkeit (Rennen), gegen JE EINEN eigenen Zustand simulieren
// unabhängige Reisen.
function fakeStore(zustand: FakeZustand, aufrufe: { holeMitglieder: number; loescheTokens: Array<{ tokens: string[]; userIds: string[] }> }): RevealStore {
  return {
    async holeTrip(tripId) {
      if (tripId !== zustand.trip.id) return { data: null, error: null };
      // Kopie: der Aufrufer darf das zurückgegebene Objekt nicht mutieren
      // können und damit den Fake-Zustand verfälschen.
      return { data: { ...zustand.trip }, error: null };
    },
    async aktualisiereWennAktiv(tripId) {
      if (tripId !== zustand.trip.id) return { data: null, error: null };
      // Die CAS-Bedingung: nur wenn AKTUELL 'active', sonst 0 Zeilen (null).
      if (zustand.trip.status !== 'active') return { data: null, error: null };
      const revealedAt = new Date().toISOString();
      zustand.trip = { ...zustand.trip, status: 'revealed', revealed_at: revealedAt };
      return { data: { revealed_at: revealedAt }, error: null };
    },
    async holeRevealedAtNachlese(tripId) {
      if (tripId !== zustand.trip.id) return { data: null, error: null };
      return { data: { revealed_at: zustand.trip.revealed_at }, error: null };
    },
    async holeMitglieder(tripId) {
      aufrufe.holeMitglieder++;
      if (tripId !== zustand.trip.id) return { data: [], error: null };
      return { data: [...zustand.tokens.keys()].map((user_id) => ({ user_id })), error: null };
    },
    async holeTokens(userIds) {
      const zeilen: { token: string }[] = [];
      for (const userId of userIds) {
        for (const token of zustand.tokens.get(userId) ?? []) {
          zeilen.push({ token });
        }
      }
      return { data: zeilen, error: null };
    },
    async loescheTokens(tokens, userIds) {
      aufrufe.loescheTokens.push({ tokens, userIds });
      for (const userId of userIds) {
        const bisherige = zustand.tokens.get(userId);
        if (!bisherige) continue;
        zustand.tokens.set(userId, bisherige.filter((t) => !tokens.includes(t)));
      }
      return { error: null };
    },
  };
}

function neueFakeZustand(status: TripZeile['status'] = 'active'): FakeZustand {
  return {
    trip: {
      id: TRIP_ID,
      name: 'Lissabon',
      owner_id: OWNER_ID,
      status,
      revealed_at: status === 'revealed' ? '2026-08-01T10:00:00.000Z' : null,
    },
    tokens: new Map([
      [MEMBER_ID, ['tok-member']],
      [MEMBER2_ID, ['tok-member2']],
    ]),
  };
}

// sendeFn-Spy: zählt Aufrufe, sammelt die adressierten Tokens, liefert
// standardmässig "niemand tot".
function fakeSendeFn(tote: string[] = []): { fn: SendeFn; aufrufe: PushNachricht[][] } {
  const aufrufe: PushNachricht[][] = [];
  const fn: SendeFn = (nachrichten) => {
    aufrufe.push(nachrichten);
    return Promise.resolve(tote);
  };
  return { fn, aufrufe };
}

// Abschluss-Review Phase 6, Punkt 2: "ein Fehler-Melder, der keinen Aufrufer
// hat, ist wertlos", die folgenden Tests belegen nicht nur, dass
// `fuehreRevealAus` ein fünftes Argument annimmt, sondern DASS es an genau
// den drei DB-Fehlerpfaden aufgerufen wird (und an keinem anderen).
function fakeMelde(): { fn: MeldeFn; aufrufe: Array<{ fehler: unknown; kontext?: FehlerKontext }> } {
  const aufrufe: Array<{ fehler: unknown; kontext?: FehlerKontext }> = [];
  const fn: MeldeFn = (fehler, kontext) => {
    aufrufe.push({ fehler, kontext });
    return Promise.resolve();
  };
  return { fn, aufrufe };
}

// =============================================================================
// fuehreRevealAus, die sechs im Final-Review benannten Zusicherungen
// =============================================================================

// --- 1. Owner-Check: Nicht-Owner -> 403 -------------------------------------
Deno.test('fuehreRevealAus: ein Nicht-Owner bekommt 403 und löst keinen Statuswechsel/Push aus', async () => {
  const zustand = neueFakeZustand('active');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, MEMBER_ID);

  assertEquals(ergebnis, {
    status: 403,
    body: { fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' },
  });
  assertEquals(zustand.trip.status, 'active', 'der Status blieb unverändert');
  assertEquals(sendeAufrufe.length, 0, 'kein Push wurde ausgelöst');
  assertEquals(aufrufe.holeMitglieder, 0, 'versendeRevealPush wurde gar nicht erst aufgerufen');
});

// Re-Review-Fund: der Owner-Check muss VOR den Status-Zweigen stehen, nicht
// nur vor dem CAS-Update. Eine bereits revealte oder archivierte Reise hat
// je einen eigenen frühen Rückgabe-Zweig (Zeile 184/187), verschöbe man den
// Owner-Check hinter diese beiden, bekäme JEDE authentifizierte Person, die
// eine trip_id kennt, für eine revealte Reise 200 statt 403 und für eine
// archivierte 409 statt 403. Die beiden Tests oben/unten deckten das nicht:
// "ein Nicht-Owner bekommt 403" prüft nur gegen status='active', und auch
// reveal_integration_test.ts testet den Nicht-Owner nur dort. Diese beiden
// Fälle schliessen genau die Lücke, für die Befund 2 ursprünglich geschrieben
// wurde: kein Mitglied darf die Reise für alle öffnen, unabhängig vom Status.
Deno.test('fuehreRevealAus: ein Nicht-Owner bekommt 403, auch wenn die Reise bereits revealed ist', async () => {
  const zustand = neueFakeZustand('revealed');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, MEMBER_ID);

  assertEquals(ergebnis, {
    status: 403,
    body: { fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' },
  });
  assertEquals(sendeAufrufe.length, 0);
});

Deno.test('fuehreRevealAus: ein Nicht-Owner bekommt 403, auch wenn die Reise bereits archiviert ist', async () => {
  const zustand = neueFakeZustand('archived');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, MEMBER_ID);

  assertEquals(ergebnis, {
    status: 403,
    body: { fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' },
  });
  assertEquals(sendeAufrufe.length, 0);
});

// --- Reise nicht gefunden ----------------------------------------------------
Deno.test('fuehreRevealAus: eine unbekannte trip_id liefert 404', async () => {
  const zustand = neueFakeZustand('active');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const { fn: sendeFn } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, 'unbekannte-trip-id', OWNER_ID);

  assertEquals(ergebnis, { status: 404, body: { fehler: 'Reise nicht gefunden.' } });
});

// --- 2. Idempotent: sequenzieller zweiter Aufruf ----------------------------
Deno.test('fuehreRevealAus: eine bereits revealed Reise liefert denselben revealed_at ohne erneutes Update/Push', async () => {
  const zustand = neueFakeZustand('revealed');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID);

  assertEquals(ergebnis, { status: 200, body: { ok: true, revealed_at: zustand.trip.revealed_at } });
  assertEquals(sendeAufrufe.length, 0, 'ein sequenzieller zweiter Aufruf löst keinen erneuten Push aus');
  assertEquals(aufrufe.holeMitglieder, 0);
});

// --- 3. Archiv-Konflikt ------------------------------------------------------
Deno.test('fuehreRevealAus: eine archivierte Reise liefert 409 und löst keinen Push aus', async () => {
  const zustand = neueFakeZustand('archived');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID);

  assertEquals(ergebnis, { status: 409, body: { fehler: 'Diese Reise ist schon archiviert.' } });
  assertEquals(sendeAufrufe.length, 0);
  assertEquals(aufrufe.holeMitglieder, 0);
});

// --- Gewinner-Zweig: aktive Reise, Owner ------------------------------------
Deno.test('fuehreRevealAus: eine aktive Reise wird revealed und der Push genau einmal an die richtigen Empfänger geschickt', async () => {
  const zustand = neueFakeZustand('active');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID);

  assertEquals(ergebnis.status, 200);
  assertEquals((ergebnis.body as { ok: boolean }).ok, true);
  assertExists((ergebnis.body as { revealed_at: string }).revealed_at);
  assertEquals(zustand.trip.status, 'revealed');
  assertEquals(sendeAufrufe.length, 1, 'genau ein Push-Versand');
  assertEquals(
    sendeAufrufe[0].map((n) => n.to).sort(),
    ['tok-member', 'tok-member2'],
    'beide Mitglieder (nicht der Owner selbst, der hat keinen Token hier) bekommen die Nachricht',
  );
});

// --- 4. Doppelversand: echtes Zwei-Aufrufe-Rennen ----------------------------
// Der eigentliche Regressionsfall aus f26437a: zwei Aufrufe sehen BEIDE
// status==='active', bevor einer den anderen überholt. Mit `Promise.all`
// gestartet, damit beide `holeTrip` VOR dem ersten `aktualisiereWennAktiv`
// abschliessen, echte Nebenläufigkeit, kein sequenzieller Ablauf.
Deno.test('fuehreRevealAus: zwei nebenläufige Aufrufe liefern denselben revealed_at und lösen den Push nur EINMAL aus', async () => {
  const zustand = neueFakeZustand('active');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  const [ergebnisA, ergebnisB] = await Promise.all([
    fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID),
    fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID),
  ]);

  assertEquals(ergebnisA.status, 200);
  assertEquals(ergebnisB.status, 200);
  assertEquals(
    (ergebnisA.body as { revealed_at: string }).revealed_at,
    (ergebnisB.body as { revealed_at: string }).revealed_at,
    'beide Antworten tragen denselben Zeitstempel, nur EIN Update hat wirklich geschrieben',
  );
  assertEquals(sendeAufrufe.length, 1, 'der Push wurde nur vom Gewinner-Zweig ausgelöst, nicht vom Verlierer');
});

// --- fehlschlagender Push -> trotzdem 200 -----------------------------------
Deno.test('fuehreRevealAus: ein werfender Push-Versand lässt den Statuswechsel bestehen und die Antwort bleibt 200', async () => {
  const zustand = neueFakeZustand('active');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const werfendeSendeFn: SendeFn = () => {
    throw new Error('Expo nicht erreichbar');
  };

  const ergebnis = await fuehreRevealAus(store, werfendeSendeFn, TRIP_ID, OWNER_ID);

  assertEquals(ergebnis.status, 200);
  assertEquals((ergebnis.body as { ok: boolean }).ok, true);
  assertExists((ergebnis.body as { revealed_at: string }).revealed_at);
  assertEquals(zustand.trip.status, 'revealed', 'der Statuswechsel bleibt die Wahrheit, unabhängig vom Push-Ausgang');
});

Deno.test('fuehreRevealAus: eine ablehnende Promise aus dem Push-Versand lässt den Statuswechsel ebenfalls bestehen', async () => {
  const zustand = neueFakeZustand('active');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const ablehnendeSendeFn: SendeFn = () => Promise.reject(new Error('Netzwerk weg'));

  const ergebnis = await fuehreRevealAus(store, ablehnendeSendeFn, TRIP_ID, OWNER_ID);

  assertEquals(ergebnis.status, 200);
  assertEquals(zustand.trip.status, 'revealed');
});

// --- Fehlerpfade: Select/Update/Nachlesen scheitern -------------------------
Deno.test('fuehreRevealAus: ein Fehler beim Laden der Trip-Zeile liefert 500', async () => {
  const store: RevealStore = {
    holeTrip: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
    aktualisiereWennAktiv: () => Promise.resolve({ data: null, error: null }),
    holeRevealedAtNachlese: () => Promise.resolve({ data: null, error: null }),
    holeMitglieder: () => Promise.resolve({ data: [], error: null }),
    holeTokens: () => Promise.resolve({ data: [], error: null }),
    loescheTokens: () => Promise.resolve({ error: null }),
  };
  const { fn: sendeFn } = fakeSendeFn();
  const { fn: melde, aufrufe: meldeAufrufe } = fakeMelde();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID, melde);
  assertEquals(ergebnis, { status: 500, body: { fehler: 'Reise konnte nicht geladen werden.' } });
  assertEquals(meldeAufrufe.length, 1);
  assertEquals((meldeAufrufe[0].fehler as Error).message, 'DB weg');
  assertEquals(meldeAufrufe[0].kontext, { trip_id: TRIP_ID });
});

Deno.test('fuehreRevealAus: ein Fehler beim CAS-Update liefert 500', async () => {
  const zustand = neueFakeZustand('active');
  const store: RevealStore = {
    ...fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] }),
    aktualisiereWennAktiv: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
  };
  const { fn: sendeFn } = fakeSendeFn();
  const { fn: melde, aufrufe: meldeAufrufe } = fakeMelde();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID, melde);
  assertEquals(ergebnis, { status: 500, body: { fehler: 'Reise konnte nicht abgeschlossen werden.' } });
  assertEquals(meldeAufrufe.length, 1);
  assertEquals(meldeAufrufe[0].kontext, { trip_id: TRIP_ID, user_id: OWNER_ID });
});

Deno.test('fuehreRevealAus: ein Fehler beim Nachlesen im Verlierer-Zweig liefert 500', async () => {
  const zustand = neueFakeZustand('active');
  // status ist bereits 'revealed', aber NICHT über den Fake-Store gesetzt,
  // simuliert exakt "ein anderer Aufruf hat gewonnen": aktualisiereWennAktiv
  // liefert null (0 Zeilen), das Nachlesen scheitert.
  zustand.trip.status = 'revealed';
  const store: RevealStore = {
    ...fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] }),
    holeTrip: () => Promise.resolve({ data: { ...zustand.trip, status: 'active' }, error: null }),
    aktualisiereWennAktiv: () => Promise.resolve({ data: null, error: null }),
    holeRevealedAtNachlese: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
  };
  const { fn: sendeFn } = fakeSendeFn();
  const { fn: melde, aufrufe: meldeAufrufe } = fakeMelde();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID, melde);
  assertEquals(ergebnis, { status: 500, body: { fehler: 'Reise konnte nicht abgeschlossen werden.' } });
  assertEquals(meldeAufrufe.length, 1);
  assertEquals(meldeAufrufe[0].kontext, { trip_id: TRIP_ID });
});

Deno.test('fuehreRevealAus: ohne übergebenen Melder bleibt alles wie zuvor (Default ist ein No-Op)', async () => {
  const store: RevealStore = {
    holeTrip: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
    aktualisiereWennAktiv: () => Promise.resolve({ data: null, error: null }),
    holeRevealedAtNachlese: () => Promise.resolve({ data: null, error: null }),
    holeMitglieder: () => Promise.resolve({ data: [], error: null }),
    holeTokens: () => Promise.resolve({ data: [], error: null }),
    loescheTokens: () => Promise.resolve({ error: null }),
  };
  const { fn: sendeFn } = fakeSendeFn();
  // Kein fünftes Argument, muss weiterhin kompilieren und funktionieren.
  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID);
  assertEquals(ergebnis, { status: 500, body: { fehler: 'Reise konnte nicht geladen werden.' } });
});

Deno.test('fuehreRevealAus: ein erfolgreicher Reveal ruft den Melder NICHT auf', async () => {
  const zustand = neueFakeZustand('active');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const { fn: sendeFn } = fakeSendeFn();
  const { fn: melde, aufrufe: meldeAufrufe } = fakeMelde();

  const ergebnis = await fuehreRevealAus(store, sendeFn, TRIP_ID, OWNER_ID, melde);
  assertEquals(ergebnis.status, 200);
  assertEquals(meldeAufrufe.length, 0);
});

Deno.test('fuehreRevealAus: ein scheiternder Push-Versand ruft den Melder NICHT auf (bewusst tolerierter Ausgang)', async () => {
  const zustand = neueFakeZustand('active');
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const werfendeSendeFn: SendeFn = () => {
    throw new Error('Netzwerk weg');
  };
  const { fn: melde, aufrufe: meldeAufrufe } = fakeMelde();

  const ergebnis = await fuehreRevealAus(store, werfendeSendeFn, TRIP_ID, OWNER_ID, melde);
  assertEquals(ergebnis.status, 200);
  assertEquals(meldeAufrufe.length, 0);
});

// =============================================================================
// versendeRevealPush, 5. Ausschluss der auslösenden Person, 6. Scoping der
// Token-Löschung
// =============================================================================

const TRIP: TripZeile = {
  id: TRIP_ID,
  name: 'Lissabon',
  owner_id: OWNER_ID,
  status: 'revealed',
  revealed_at: '2026-08-01T10:00:00.000Z',
};

// --- 5. `.neq('user_id', ausloesendeId)`, die Owner-Person bekommt ihren
// eigenen Reveal nicht gepusht -------------------------------------------
Deno.test('versendeRevealPush: die auslösende Person wird aus den Empfängern ausgeschlossen, auch wenn sie einen eigenen Token hat', async () => {
  const zustand = neueFakeZustand('revealed');
  zustand.tokens.set(OWNER_ID, ['tok-owner']);
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  await versendeRevealPush(store, sendeFn, TRIP, OWNER_ID);

  assertEquals(sendeAufrufe.length, 1);
  const adressierteTokens = sendeAufrufe[0].map((n) => n.to);
  assertEquals(adressierteTokens.includes('tok-owner'), false, 'der Token der auslösenden Person fehlt');
  assertEquals(adressierteTokens.sort(), ['tok-member', 'tok-member2']);
});

Deno.test('versendeRevealPush: bleiben nach Ausschluss der auslösenden Person keine Empfänger übrig, wird gar nicht erst gesendet', async () => {
  const zustand: FakeZustand = {
    trip: { ...TRIP },
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
  };
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  await versendeRevealPush(store, sendeFn, TRIP, OWNER_ID);

  assertEquals(sendeAufrufe.length, 0, 'kein Empfänger übrig, also kein Aufruf an Expo');
});

// --- 6. `.in('user_id', empfaengerIds)` bei der Token-Löschung, die
// Orchestrierung reicht die Empfänger-Einschränkung an den Store weiter ---
Deno.test('versendeRevealPush: die Token-Löschung wird auf genau die angeschriebenen Empfänger eingeschränkt', async () => {
  const zustand = neueFakeZustand('revealed');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn } = fakeSendeFn(['tok-member']); // Expo meldet MEMBER_ID als abgemeldet

  await versendeRevealPush(store, sendeFn, TRIP, OWNER_ID);

  assertEquals(aufrufe.loescheTokens.length, 1);
  assertEquals(aufrufe.loescheTokens[0], {
    tokens: ['tok-member'],
    userIds: [MEMBER_ID, MEMBER2_ID],
  });
});

Deno.test('versendeRevealPush: meldet Expo niemanden als abgemeldet, wird gar nicht erst gelöscht', async () => {
  const zustand = neueFakeZustand('revealed');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const { fn: sendeFn } = fakeSendeFn([]);

  await versendeRevealPush(store, sendeFn, TRIP, OWNER_ID);

  assertEquals(aufrufe.loescheTokens.length, 0);
});

Deno.test('versendeRevealPush: ein Fehler beim Laden der Mitglieder bricht ohne Push ab', async () => {
  const store: RevealStore = {
    holeTrip: () => Promise.resolve({ data: null, error: null }),
    aktualisiereWennAktiv: () => Promise.resolve({ data: null, error: null }),
    holeRevealedAtNachlese: () => Promise.resolve({ data: null, error: null }),
    holeMitglieder: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
    holeTokens: () => Promise.resolve({ data: [], error: null }),
    loescheTokens: () => Promise.resolve({ error: null }),
  };
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  await versendeRevealPush(store, sendeFn, TRIP, OWNER_ID);

  assertEquals(sendeAufrufe.length, 0);
});

Deno.test('versendeRevealPush: keine Push-Tokens unter den Empfängern -> kein Sende-Aufruf', async () => {
  const zustand: FakeZustand = {
    trip: { ...TRIP },
    tokens: new Map([[MEMBER_ID, []]]), // Mitglied existiert, hat aber keinen Token
  };
  const store = fakeStore(zustand, { holeMitglieder: 0, loescheTokens: [] });
  const { fn: sendeFn, aufrufe: sendeAufrufe } = fakeSendeFn();

  await versendeRevealPush(store, sendeFn, TRIP, OWNER_ID);

  assertEquals(sendeAufrufe.length, 0);
});

// Auto-Reveal (Spec 2026-08-18): der Kalender löst aus, keine Person. Bei
// ausloesendeId null darf NIEMAND aus den Empfängern gefiltert werden, auch
// die Owner-Person nicht.
Deno.test('versendeRevealPush: ausloesendeId null schreibt alle Mitglieder an', async () => {
  const zustand = neueFakeZustand('active');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const gesendet: PushNachricht[] = [];
  const sendeFake: SendeFn = async (nachrichten) => {
    gesendet.push(...nachrichten);
    return [];
  };

  await versendeRevealPush(store, sendeFake, zustand.trip, null);

  const empfaenger = gesendet.map((n) => n.to).sort();
  const alleTokens = [...zustand.tokens.values()].flat().sort();
  assertEquals(empfaenger, alleTokens);
});
