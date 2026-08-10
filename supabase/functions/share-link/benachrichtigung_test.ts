// Unit-Tests für die Teilen-Benachrichtigung, ohne Stack, ohne Netz:
//   cd supabase/functions && deno test --allow-env share-link/
//
// Was hier wirklich auf dem Spiel steht, ist der EMPFÄNGERKREIS. Stünde er nur
// als `.neq(…)` in einer SQL-Abfrage, prüfte ihn kein Test, der ohne Docker
// läuft, und der Fehler wäre unsichtbar: eine Meldung zu wenig fällt niemandem
// auf, eine zu viel schickt der Owner-Person ein Echo ihrer eigenen Handlung.
//
// Vorbild: reveal-trip/reveal_test.ts, das denselben Kreis für den Reveal-Push
// prüft.

import { assertEquals } from 'jsr:@std/assert@1';
import {
  baueNachrichten,
  empfaengerKreis,
  texteFuer,
  versendeTeilenPush,
  type BenachrichtigungsStore,
} from './benachrichtigung.ts';
import type { PushNachricht } from '../reveal-trip/push.ts';

const MIRA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const LEA = '33333333-3333-4333-8333-333333333333';
const TRIP = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Lissabon' };

// ===========================================================================
// Der Empfängerkreis
// ===========================================================================

Deno.test('die ausloesende Person bekommt kein Echo ihrer eigenen Handlung', () => {
  const kreis = empfaengerKreis(
    [{ user_id: MIRA }, { user_id: BEN }, { user_id: LEA }],
    MIRA,
  );
  assertEquals(kreis, [BEN, LEA]);
});

Deno.test('eine Reise, in der nur die ausloesende Person ist, schickt gar nichts', () => {
  assertEquals(empfaengerKreis([{ user_id: MIRA }], MIRA), []);
});

Deno.test('ist die ausloesende Person gar kein Mitglied, bleiben alle anderen uebrig', () => {
  // Kann heute nicht vorkommen (nur die Owner-Person teilt, und sie ist immer
  // Mitglied), steht hier trotzdem: die Funktion darf nicht stillschweigend
  // die Liste leeren, wenn die Annahme je faellt.
  assertEquals(empfaengerKreis([{ user_id: BEN }, { user_id: LEA }], MIRA), [BEN, LEA]);
});

// ===========================================================================
// Die Texte
// ===========================================================================

Deno.test('die Meldung nennt, wer geteilt hat, die Reise und was der Link zeigt', () => {
  const { title, body } = texteFuer('erstellt', 'Lissabon', 'Mira');
  assertEquals(title, 'Euer Recap ist geteilt');
  assertEquals(
    body,
    'Mira hat euren Recap von «Lissabon» geteilt. Wer den Link hat, sieht alle Momente samt ihren Orten.',
  );
});

// Die Orte sind der Grund, aus dem es diese Meldung ueberhaupt gibt: seit
// Phase 7 traegt der Link sie unbeschnitten. Ohne diesen Satz waere die
// Meldung eine Hoeflichkeit statt einer Auskunft.
Deno.test('die Meldung verschweigt die Orte nicht', () => {
  assertEquals(texteFuer('erstellt', 'Lissabon', 'Mira').body.includes('Orten'), true);
});

Deno.test('der Widerruf ist die Entwarnung, nicht dieselbe Meldung nochmal', () => {
  const { title, body } = texteFuer('widerrufen', 'Lissabon', 'Mira');
  assertEquals(title, 'Der geteilte Link gilt nicht mehr');
  assertEquals(body, 'Mira hat den Link zu «Lissabon» widerrufen. Der Recap ist wieder nur für euch.');
});

Deno.test('ohne Namen bleibt der Satz stehen, statt eine Luecke zu zeigen', () => {
  for (const ereignis of ['erstellt', 'widerrufen'] as const) {
    const { body } = texteFuer(ereignis, 'Lissabon', null);
    assertEquals(body.includes('undefined') || body.includes('null'), false);
    assertEquals(body.includes('«Lissabon»'), true);
  }
});

// DESIGN-LANGUAGE §6: keine Gedankenstriche in sichtbarem Text.
Deno.test('kein Gedankenstrich in irgendeinem der vier Texte', () => {
  for (const ereignis of ['erstellt', 'widerrufen'] as const) {
    for (const wer of ['Mira', null]) {
      const { title, body } = texteFuer(ereignis, 'Lissabon', wer);
      assertEquals(`${title} ${body}`.includes('—'), false);
    }
  }
});

Deno.test('jede Nachricht traegt dieselben Texte und die trip_id fuer den Sprung', () => {
  const nachrichten = baueNachrichten(
    [{ token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' }],
    'erstellt',
    TRIP,
    'Mira',
  );
  assertEquals(nachrichten.length, 2);
  assertEquals(nachrichten.map((n) => n.to), ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
  assertEquals(new Set(nachrichten.map((n) => n.body)).size, 1);
  assertEquals(nachrichten[0].data, { trip_id: TRIP.id, ereignis: 'erstellt' });
});

// ===========================================================================
// Der Versand als Ganzes
// ===========================================================================

type StoreAufrufe = {
  mitglieder: string[];
  tokenAbfragen: string[][];
  geloescht: { tokens: string[]; userIds: string[] }[];
  namenAbfragen: string[];
};

function fakeStore(
  ueber: Partial<{
    mitglieder: { user_id: string }[];
    tokens: { token: string }[];
    name: string | null;
    mitgliederFehler: unknown;
    tokenFehler: unknown;
    nameFehler: unknown;
  }> = {},
): { store: BenachrichtigungsStore; aufrufe: StoreAufrufe } {
  const aufrufe: StoreAufrufe = {
    mitglieder: [],
    tokenAbfragen: [],
    geloescht: [],
    namenAbfragen: [],
  };
  const store: BenachrichtigungsStore = {
    async holeMitglieder(tripId) {
      aufrufe.mitglieder.push(tripId);
      return { data: ueber.mitglieder ?? [{ user_id: MIRA }, { user_id: BEN }], error: ueber.mitgliederFehler ?? null };
    },
    async holeTokens(userIds) {
      aufrufe.tokenAbfragen.push(userIds);
      return { data: ueber.tokens ?? [{ token: 'ExponentPushToken[b]' }], error: ueber.tokenFehler ?? null };
    },
    async loescheTokens(tokens, userIds) {
      aufrufe.geloescht.push({ tokens, userIds });
      return { error: null };
    },
    async holeAnzeigename(userId) {
      aufrufe.namenAbfragen.push(userId);
      return { data: ueber.name === undefined ? 'Mira' : ueber.name, error: ueber.nameFehler ?? null };
    },
  };
  return { store, aufrufe };
}

Deno.test('der Versand geht an die Tokens der anderen, mit dem fertigen Text', async () => {
  const { store, aufrufe } = fakeStore();
  const gesendet: PushNachricht[][] = [];
  await versendeTeilenPush(store, async (n) => { gesendet.push(n); return []; }, TRIP, MIRA, 'erstellt');

  assertEquals(aufrufe.mitglieder, [TRIP.id]);
  assertEquals(aufrufe.tokenAbfragen, [[BEN]]);
  assertEquals(gesendet.length, 1);
  assertEquals(gesendet[0][0].to, 'ExponentPushToken[b]');
  assertEquals(gesendet[0][0].title, 'Euer Recap ist geteilt');
});

Deno.test('ohne andere Mitglieder wird nicht einmal nach Tokens gefragt', async () => {
  const { store, aufrufe } = fakeStore({ mitglieder: [{ user_id: MIRA }] });
  let gesendet = 0;
  await versendeTeilenPush(store, async () => { gesendet++; return []; }, TRIP, MIRA, 'erstellt');
  assertEquals(aufrufe.tokenAbfragen, []);
  assertEquals(gesendet, 0);
});

Deno.test('ohne Tokens wird nicht gesendet, und der Name gar nicht erst geholt', async () => {
  const { store, aufrufe } = fakeStore({ tokens: [] });
  let gesendet = 0;
  await versendeTeilenPush(store, async () => { gesendet++; return []; }, TRIP, MIRA, 'erstellt');
  assertEquals(gesendet, 0);
  assertEquals(aufrufe.namenAbfragen, []);
});

// Ein Fehler beim Namen kostet den Namen, nicht die Meldung. Die Auskunft
// «euer Recap ist geteilt» ist das Wichtige, wer geteilt hat, ist die Zugabe.
Deno.test('scheitert die Namensabfrage, geht die Meldung trotzdem raus', async () => {
  const { store } = fakeStore({ nameFehler: new Error('kaputt'), name: null });
  const gesendet: PushNachricht[][] = [];
  await versendeTeilenPush(store, async (n) => { gesendet.push(n); return []; }, TRIP, MIRA, 'erstellt');
  assertEquals(gesendet.length, 1);
  assertEquals(gesendet[0][0].body.includes('«Lissabon»'), true);
});

Deno.test('ein Fehler beim Lesen der Mitglieder bricht nichts ab, er sendet nur nichts', async () => {
  const { store } = fakeStore({ mitgliederFehler: new Error('kaputt') });
  let gesendet = 0;
  await versendeTeilenPush(store, async () => { gesendet++; return []; }, TRIP, MIRA, 'erstellt');
  assertEquals(gesendet, 0);
});

// Der Grund, aus dem `loescheTokens` zwei Parameter hat: die
// Ticket-zu-Token-Zuordnung in push.ts ist positionsbasiert. Ein faelschlich
// als abgemeldet gelesenes Token darf nie ausserhalb des angeschriebenen
// Kreises loeschen.
Deno.test('abgemeldete Tokens werden nur innerhalb des angeschriebenen Kreises geloescht', async () => {
  const { store, aufrufe } = fakeStore({
    mitglieder: [{ user_id: MIRA }, { user_id: BEN }, { user_id: LEA }],
    tokens: [{ token: 'tot' }, { token: 'lebt' }],
  });
  await versendeTeilenPush(store, async () => ['tot'], TRIP, MIRA, 'widerrufen');
  assertEquals(aufrufe.geloescht, [{ tokens: ['tot'], userIds: [BEN, LEA] }]);
});

Deno.test('meldet Expo nichts Totes, wird auch nichts geloescht', async () => {
  const { store, aufrufe } = fakeStore();
  await versendeTeilenPush(store, async () => [], TRIP, MIRA, 'erstellt');
  assertEquals(aufrufe.geloescht, []);
});
