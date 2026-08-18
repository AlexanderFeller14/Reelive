// Unit-Tests für die Entscheidungslogik von reveal-zeitplan (zeitplan.ts),
// ohne Stack und ohne Netz, Stil wie ../reveal-trip/reveal_test.ts.
import { assertEquals } from 'jsr:@std/assert';
import {
  fuehreAutoRevealAus,
  fuehreErinnerungAus,
  pruefeZeitplanAnfrage,
  type ZeitplanStore,
} from './zeitplan.ts';
import type { SendeFn, TripZeile } from '../reveal-trip/reveal.ts';
import type { PushNachricht } from '../reveal-trip/push.ts';

const OWNER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MEMBER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

type FakeReise = TripZeile & { end_date: string; end_reminder_sent_at: string | null };

type FakeZustand = {
  reisen: FakeReise[];
  // user_id -> Tokens; gilt für ALLE Reisen des Zustands (reicht für die Tests).
  tokens: Map<string, string[]>;
  mitglieder: string[];
};

// kaputteUpdates: trip_ids, deren CAS-Update mit einem Fehler antwortet,
// für den Test «ein Fehler stoppt die Schleife nicht».
function fakeStore(zustand: FakeZustand, kaputteUpdates: string[] = []): ZeitplanStore {
  const zeile = ({ id, name, owner_id, status, revealed_at }: FakeReise): TripZeile =>
    ({ id, name, owner_id, status, revealed_at });
  return {
    async holeFaelligeReisen(heute) {
      return {
        data: zustand.reisen.filter((r) => r.status === 'active' && r.end_date < heute).map(zeile),
        error: null,
      };
    },
    async holeErinnerungsReisen(heute) {
      return {
        data: zustand.reisen
          .filter((r) => r.status === 'active' && r.end_date === heute && r.end_reminder_sent_at === null)
          .map(zeile),
        error: null,
      };
    },
    async markiereErinnerung(tripId) {
      const reise = zustand.reisen.find((r) => r.id === tripId);
      if (!reise || reise.end_reminder_sent_at !== null) return { data: null, error: null };
      reise.end_reminder_sent_at = new Date().toISOString();
      return { data: { end_reminder_sent_at: reise.end_reminder_sent_at }, error: null };
    },
    async holeTrip(tripId) {
      const reise = zustand.reisen.find((r) => r.id === tripId);
      return { data: reise ? { ...zeile(reise) } : null, error: null };
    },
    async aktualisiereWennAktiv(tripId) {
      if (kaputteUpdates.includes(tripId)) return { data: null, error: new Error('kaputt') };
      const reise = zustand.reisen.find((r) => r.id === tripId);
      if (!reise || reise.status !== 'active') return { data: null, error: null };
      reise.status = 'revealed';
      reise.revealed_at = new Date().toISOString();
      return { data: { revealed_at: reise.revealed_at }, error: null };
    },
    async holeRevealedAtNachlese(tripId) {
      const reise = zustand.reisen.find((r) => r.id === tripId);
      return { data: reise ? { revealed_at: reise.revealed_at } : null, error: null };
    },
    async holeMitglieder() {
      return { data: zustand.mitglieder.map((user_id) => ({ user_id })), error: null };
    },
    async holeTokens(userIds) {
      const zeilen: { token: string }[] = [];
      for (const userId of userIds) {
        for (const token of zustand.tokens.get(userId) ?? []) zeilen.push({ token });
      }
      return { data: zeilen, error: null };
    },
    async loescheTokens() {
      return { error: null };
    },
  };
}

function reise(id: string, end_date: string, status: TripZeile['status'] = 'active'): FakeReise {
  return {
    id,
    name: `Reise ${id}`,
    owner_id: OWNER_ID,
    status,
    revealed_at: status === 'revealed' ? '2026-08-01T10:00:00.000Z' : null,
    end_date,
    end_reminder_sent_at: null,
  };
}

function sammelnd(): { gesendet: PushNachricht[]; sendeFn: SendeFn } {
  const gesendet: PushNachricht[] = [];
  const sendeFn: SendeFn = async (nachrichten) => {
    gesendet.push(...nachrichten);
    return [];
  };
  return { gesendet, sendeFn };
}

// --- pruefeZeitplanAnfrage ---------------------------------------------------

Deno.test('pruefeZeitplanAnfrage: korrektes Secret und Body ergeben die Anfrage', () => {
  const ergebnis = pruefeZeitplanAnfrage('s3cret', 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(ergebnis, { ok: true, anfrage: { aufgabe: 'reveal', heute: '2026-08-18' } });
});

Deno.test('pruefeZeitplanAnfrage: falsches oder fehlendes Secret ergibt 401', () => {
  const falsch = pruefeZeitplanAnfrage('anders', 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(falsch.ok, false);
  if (!falsch.ok) assertEquals(falsch.status, 401);
  const fehlt = pruefeZeitplanAnfrage(null, 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(fehlt.ok, false);
  if (!fehlt.ok) assertEquals(fehlt.status, 401);
});

Deno.test('pruefeZeitplanAnfrage: unkonfiguriertes Secret ergibt 500, nie 200', () => {
  const ergebnis = pruefeZeitplanAnfrage('', '', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(ergebnis.ok, false);
  if (!ergebnis.ok) assertEquals(ergebnis.status, 500);
});

Deno.test('pruefeZeitplanAnfrage: unbekannte Aufgabe oder kaputtes heute ergeben 400', () => {
  const aufgabe = pruefeZeitplanAnfrage('s3cret', 's3cret', { aufgabe: 'putzen', heute: '2026-08-18' });
  assertEquals(aufgabe.ok, false);
  if (!aufgabe.ok) assertEquals(aufgabe.status, 400);
  const heute = pruefeZeitplanAnfrage('s3cret', 's3cret', { aufgabe: 'reveal', heute: '18.08.2026' });
  assertEquals(heute.ok, false);
  if (!heute.ok) assertEquals(heute.status, 400);
});

// --- fuehreAutoRevealAus -----------------------------------------------------

Deno.test('fuehreAutoRevealAus: fällige Reise wird revealed, Push an alle inklusive Owner', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    mitglieder: [OWNER_ID, MEMBER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(ergebnis.status, 200);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen[0].status, 'revealed');
  assertEquals(gesendet.map((n) => n.to).sort(), ['tok-member', 'tok-owner']);
});

Deno.test('fuehreAutoRevealAus: nichts fällig heisst verarbeitet 0 und kein Push', async () => {
  const zustand: FakeZustand = {
    // end_date == heute ist NICHT fällig: bis 23:59 des Enddatums bleibt die
    // Reise unterwegs (Spec §2).
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
  assertEquals(zustand.reisen[0].status, 'active');
  assertEquals(gesendet.length, 0);
});

Deno.test('fuehreAutoRevealAus: verlorenes CAS heisst kein zweiter Push', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const store = fakeStore(zustand);
  // Das Rennen: die Auswahl sieht die Reise noch als active, dann schliesst
  // jemand manuell ab, das CAS-Update dieses Laufs trifft 0 Zeilen. Der
  // manuelle Abschluss passiert hier ZWISCHEN Auswahl und Rückgabe.
  const echteAuswahl = store.holeFaelligeReisen.bind(store);
  store.holeFaelligeReisen = async (heute) => {
    const auswahl = await echteAuswahl(heute);
    await store.aktualisiereWennAktiv('t1');
    return auswahl;
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(store, sendeFn, '2026-08-18');

  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
  assertEquals(gesendet.length, 0);
});

Deno.test('fuehreAutoRevealAus: ein Fehler bei Reise eins stoppt Reise zwei nicht', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17'), reise('t2', '2026-08-16')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const gemeldet: unknown[] = [];
  const { sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(
    fakeStore(zustand, ['t1']),
    sendeFn,
    '2026-08-18',
    async (fehler) => {
      gemeldet.push(fehler);
    },
  );

  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen.find((r) => r.id === 't2')?.status, 'revealed');
  assertEquals(gemeldet.length, 1);
});

Deno.test('fuehreAutoRevealAus: scheiternder Push wird gemeldet, der Reveal bleibt bestehen', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const gemeldet: unknown[] = [];
  const werfendeSendeFn: SendeFn = async () => {
    throw new Error('Push kaputt');
  };

  const ergebnis = await fuehreAutoRevealAus(fakeStore(zustand), werfendeSendeFn, '2026-08-18', async (fehler) => {
    gemeldet.push(fehler);
  });

  assertEquals(ergebnis.status, 200);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen[0].status, 'revealed');
  assertEquals(gemeldet.length, 1);
});

Deno.test('fuehreAutoRevealAus: scheiternde Auswahl ergibt 500 und eine Meldung', async () => {
  const store = fakeStore({ reisen: [], tokens: new Map(), mitglieder: [] });
  store.holeFaelligeReisen = async () => ({ data: null, error: new Error('kaputt') });
  const gemeldet: unknown[] = [];
  const { sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(store, sendeFn, '2026-08-18', async (fehler) => {
    gemeldet.push(fehler);
  });

  assertEquals(ergebnis.status, 500);
  assertEquals(gemeldet.length, 1);
});

// --- fuehreErinnerungAus -----------------------------------------------------

Deno.test('fuehreErinnerungAus: Owner bekommt die Erinnerung, Mitglieder nicht', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    mitglieder: [OWNER_ID, MEMBER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(ergebnis.status, 200);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(gesendet.map((n) => n.to), ['tok-owner']);
  assertEquals(gesendet[0].title, 'Heute ist der letzte Tag eurer Reise «Reise t1». Um Mitternacht wird euer Recap aufgedeckt.');
  assertEquals(gesendet[0].data, { trip_id: 't1' });
});

Deno.test('fuehreErinnerungAus: ein zweiter Lauf schickt nichts mehr', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const store = fakeStore(zustand);
  const erste = sammelnd();
  await fuehreErinnerungAus(store, erste.sendeFn, '2026-08-18');
  const zweite = sammelnd();

  const ergebnis = await fuehreErinnerungAus(store, zweite.sendeFn, '2026-08-18');

  assertEquals(erste.gesendet.length, 1);
  assertEquals(zweite.gesendet.length, 0);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
});

Deno.test('fuehreErinnerungAus: verlorenes Marker-CAS heisst kein Push', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const store = fakeStore(zustand);
  // Ein paralleler Lauf hat den Marker gerade gesetzt, die Auswahl dieses
  // Laufs war aber schon gelesen: markiereErinnerung liefert dann null.
  const echteAuswahl = store.holeErinnerungsReisen.bind(store);
  store.holeErinnerungsReisen = async (heute) => {
    const auswahl = await echteAuswahl(heute);
    await store.markiereErinnerung('t1');
    return auswahl;
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(store, sendeFn, '2026-08-18');

  assertEquals(gesendet.length, 0);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
});

Deno.test('fuehreErinnerungAus: Owner ohne Token zählt trotzdem als verarbeitet', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map(),
    mitglieder: [OWNER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(gesendet.length, 0);
  // Der Marker ist gesetzt (die Erinnerung IST behandelt), nur zustellen
  // liess sich nichts.
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen[0].end_reminder_sent_at !== null, true);
});

Deno.test('fuehreErinnerungAus: tote Tokens werden im Owner-Kreis aufgeräumt', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-tot']]]),
    mitglieder: [OWNER_ID],
  };
  const geloescht: Array<{ tokens: string[]; userIds: string[] }> = [];
  const store = fakeStore(zustand);
  store.loescheTokens = async (tokens, userIds) => {
    geloescht.push({ tokens, userIds });
    return { error: null };
  };
  const sendeFn: SendeFn = async () => ['tok-tot'];

  await fuehreErinnerungAus(store, sendeFn, '2026-08-18');

  assertEquals(geloescht, [{ tokens: ['tok-tot'], userIds: [OWNER_ID] }]);
});

Deno.test('fuehreErinnerungAus: scheiternde Auswahl ergibt 500 und eine Meldung', async () => {
  const store = fakeStore({ reisen: [], tokens: new Map(), mitglieder: [] });
  store.holeErinnerungsReisen = async () => ({ data: null, error: new Error('kaputt') });
  const gemeldet: unknown[] = [];
  const { sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(store, sendeFn, '2026-08-18', async (fehler) => {
    gemeldet.push(fehler);
  });

  assertEquals(ergebnis.status, 500);
  assertEquals(gemeldet.length, 1);
});
