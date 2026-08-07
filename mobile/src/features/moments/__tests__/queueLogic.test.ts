import { backoffMs, naechsterJob, nachFehlschlag, wartendeAnzahl } from '../queueLogic';
import type { QueueJob } from '../types';

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
  ...over,
});

test.each([
  [0, 2_000],
  [1, 4_000],
  [2, 8_000],
  [3, 16_000],
])('backoffMs(%i) → %i', (versuche, erwartet) => {
  expect(backoffMs(versuche)).toBe(erwartet);
});

test('backoffMs ist bei 10 Minuten gedeckelt', () => {
  expect(backoffMs(20)).toBe(600_000);
  expect(backoffMs(100)).toBe(600_000);
});

test('naechsterJob nimmt den ältesten fälligen Job', () => {
  const jobs = [
    job({ id: 'a', naechster_versuch: 5_000 }),
    job({ id: 'b', naechster_versuch: 1_000 }),
  ];
  expect(naechsterJob(jobs, 10_000, true, false, 'u1')?.id).toBe('b');
});

test('naechsterJob überspringt noch nicht fällige Jobs', () => {
  const jobs = [job({ id: 'a', naechster_versuch: 50_000 })];
  expect(naechsterJob(jobs, 10_000, true, false, 'u1')).toBeNull();
});

test('naechsterJob überspringt laufende und fertige Jobs', () => {
  const jobs = [
    job({ id: 'a', zustand: 'laeuft' }),
    job({ id: 'b', zustand: 'fertig' }),
  ];
  expect(naechsterJob(jobs, 10_000, true, false, 'u1')).toBeNull();
});

test('nurWlan pausiert auf Mobilfunk statt Jobs scheitern zu lassen', () => {
  const jobs = [job()];
  expect(naechsterJob(jobs, 10_000, false, true, 'u1')).toBeNull();
  expect(naechsterJob(jobs, 10_000, true, true, 'u1')?.id).toBe('j1');
  expect(naechsterJob(jobs, 10_000, false, false, 'u1')?.id).toBe('j1');
});

// Task-13-Fix-Runde-2: der ENTSCHEIDENDE Fall braucht KEIN Race. Ein Job
// liegt bloss in der Warteschlange (zustand: 'wartet', längst fällig) —
// A meldet sich ab, B an, und der nächste reguläre Tick läuft vollständig
// unter B's gültiger, frischer Sitzung. Ohne den author_id-Filter würde
// naechsterJob diesen Job trotzdem auswählen, und momentAnlegen würde ihn
// unter B's Namen schreiben.
describe('naechsterJob wählt nur Jobs der aktuell angemeldeten Person', () => {
  test('ein Job einer anderen Person wird NICHT ausgewählt, obwohl er längst fällig ist — kein Race nötig', () => {
    const jobs = [job({ id: 'a', author_id: 'person-a', naechster_versuch: 0 })];
    // "person-b" ist jetzt angemeldet, der Job gehört "person-a" — er bleibt
    // liegen, wird nicht verworfen und nicht als Fehlschlag gezählt.
    expect(naechsterJob(jobs, 10_000, true, false, 'person-b')).toBeNull();
  });

  test('sobald die passende Person wieder angemeldet ist, wird derselbe Job ausgewählt', () => {
    const jobs = [job({ id: 'a', author_id: 'person-a', naechster_versuch: 0 })];
    expect(naechsterJob(jobs, 10_000, true, false, 'person-a')?.id).toBe('a');
  });

  test('auf einem geteilten Gerät wählt jede Person nur ihre eigenen Jobs, unabhängig vom Alter', () => {
    const jobs = [
      job({ id: 'alt-von-a', author_id: 'person-a', naechster_versuch: 0 }),
      job({ id: 'neu-von-b', author_id: 'person-b', naechster_versuch: 5_000 }),
    ];
    expect(naechsterJob(jobs, 10_000, true, false, 'person-b')?.id).toBe('neu-von-b');
    expect(naechsterJob(jobs, 10_000, true, false, 'person-a')?.id).toBe('alt-von-a');
  });

  // Alt-Bestand (Migration von vor Task 13) oder ein fehlgeschlagener
  // Sitzungs-Lookup: aktuelleAutorId() liefert dann null. Ein Job matcht
  // niemals gegen null — istVollstaendig() in queueDb sorgt ohnehin schon
  // dafür, dass author_id nie null in einem QueueJob steckt, aber die Logik
  // hier verlässt sich nicht darauf und ist defensiv korrekt.
  test('aktuelleAutorId === null wählt keinen Job aus, auch keinen mit author_id null', () => {
    const jobs = [job({ id: 'a', author_id: null as unknown as string, naechster_versuch: 0 })];
    expect(naechsterJob(jobs, 10_000, true, false, null)).toBeNull();
  });
});

test('nachFehlschlag zählt hoch und verschiebt den nächsten Versuch', () => {
  const nachher = nachFehlschlag(job({ versuche: 1 }), 10_000);
  expect(nachher.versuche).toBe(2);
  expect(nachher.naechster_versuch).toBe(10_000 + 8_000);
  expect(nachher.zustand).toBe('wartet');
});

test('nachFehlschlag verwirft einen Job nie', () => {
  let j = job();
  for (let i = 0; i < 50; i++) j = nachFehlschlag(j, 0);
  expect(j.zustand).toBe('wartet');
});

test('wartendeAnzahl zählt alles, was noch nicht fertig ist', () => {
  const jobs = [job({ zustand: 'wartet' }), job({ zustand: 'laeuft' }), job({ zustand: 'fertig' })];
  expect(wartendeAnzahl(jobs)).toBe(2);
});
