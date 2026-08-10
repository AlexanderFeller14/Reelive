// Unit-Tests für die reine Logik von konto-loeschen, ohne `supabase start`,
// ohne `functions serve`, ohne Netz, ohne Berechtigung:
//   cd supabase/functions/konto-loeschen && npx deno test ablauf_test.ts
//
// Der wichtigste Test dieser Datei ist der zweite: **scheitert der
// Speicherschritt, wird die Datenbank gar nicht angefasst.** Das ist
// Versprechen W7 in seiner konkretesten Form, und es lässt sich nur so prüfen,
// indem man den Speicherschritt scheitern lässt und danach nachweist, dass
// der Datenbankschritt NIE gerufen wurde. Gegen den echten Stack wäre dieser
// Fall kaum herstellbar (man müsste die Storage-API gezielt kaputtmachen),
// und ein Test, den es nur im Integrationslauf gibt, überspringt sich auf
// jeder Maschine ohne Docker stillschweigend.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  fuehreLoeschungAus,
  medienSchluessel,
  pfadGehoertUns,
  type PostZeile,
  sammleAlle,
  type Schritt,
} from './ablauf.ts';
import { erwarteteSchluessel } from '../media-urls/keys.ts';

const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = '11111111-1111-4111-8111-111111111111';

// Ein Schritt, der mitschreibt, ob und wann er gelaufen ist.
function schritt(name: string, ergebnis: { fehler: unknown } | 'wirft', protokoll: string[]): Schritt {
  return {
    name,
    ausfuehren: () => {
      protokoll.push(name);
      if (ergebnis === 'wirft') throw new Error(`${name} ist geplatzt`);
      return Promise.resolve(ergebnis);
    },
  };
}

const OK = { fehler: null };

// ===========================================================================
// Die Reihenfolge, Versprechen W7
// ===========================================================================

Deno.test('Reihenfolge: Speicher zuerst, danach die Datenbankschritte in genau dieser Folge', async () => {
  const protokoll: string[] = [];
  const ergebnis = await fuehreLoeschungAus(
    schritt('speicher', OK, protokoll),
    [
      schritt('fremde-reisen-verlassen', OK, protokoll),
      schritt('eigene-reisen-loeschen', OK, protokoll),
      schritt('auth-nutzer-loeschen', OK, protokoll),
    ],
  );
  assertEquals(ergebnis, { ok: true });
  assertEquals(protokoll, [
    'speicher',
    'fremde-reisen-verlassen',
    'eigene-reisen-loeschen',
    'auth-nutzer-loeschen',
  ]);
});

Deno.test('W7: scheitert der Speicherschritt, wird die Datenbank NIE angefasst', async () => {
  // Der Kern. Ein Objekt ohne Datenbankzeile ist Müll, niemand kennt seinen
  // Pfad mehr, denn die Zeile, aus der er sich ableiten liesse, wäre gerade
  // kaskadiert worden.
  const protokoll: string[] = [];
  const ergebnis = await fuehreLoeschungAus(
    schritt('speicher', { fehler: { message: 'S3 nicht erreichbar' } }, protokoll),
    [
      schritt('fremde-reisen-verlassen', OK, protokoll),
      schritt('eigene-reisen-loeschen', OK, protokoll),
      schritt('auth-nutzer-loeschen', OK, protokoll),
    ],
  );

  assertFalse(ergebnis.ok);
  assertEquals(protokoll, ['speicher']);
  assertEquals(ergebnis, {
    ok: false,
    gescheitertBei: 'speicher',
    fehler: { message: 'S3 nicht erreichbar' },
    datenbankBeruehrt: false,
  });
});

Deno.test('W7: eine geworfene Ausnahme im Speicherschritt hält die Datenbank genauso auf', async () => {
  // Ohne try/catch liefe der Fehler am Aufrufer vorbei nach oben, was
  // zufällig auch die Datenbank verschonte, aber eben nur zufällig. Hier wird
  // es zugesichert statt in Kauf genommen.
  const protokoll: string[] = [];
  const ergebnis = await fuehreLoeschungAus(
    schritt('speicher', 'wirft', protokoll),
    [schritt('eigene-reisen-loeschen', OK, protokoll)],
  );
  assertFalse(ergebnis.ok);
  assertEquals(protokoll, ['speicher']);
  assertFalse(ergebnis.ok && true);
  assertEquals((ergebnis as { datenbankBeruehrt: boolean }).datenbankBeruehrt, false);
});

Deno.test('Ein scheiternder Datenbankschritt hält die folgenden auf', async () => {
  const protokoll: string[] = [];
  const ergebnis = await fuehreLoeschungAus(
    schritt('speicher', OK, protokoll),
    [
      schritt('fremde-reisen-verlassen', OK, protokoll),
      schritt('eigene-reisen-loeschen', { fehler: { code: '23503' } }, protokoll),
      schritt('auth-nutzer-loeschen', OK, protokoll),
    ],
  );
  assertFalse(ergebnis.ok);
  // auth-nutzer-loeschen darf nicht gelaufen sein: die Reise-Löschung ist
  // seine Vorbedingung (trips.owner_id ist on delete restrict).
  assertEquals(protokoll, ['speicher', 'fremde-reisen-verlassen', 'eigene-reisen-loeschen']);
  assertEquals((ergebnis as { gescheitertBei: string }).gescheitertBei, 'eigene-reisen-loeschen');
  // Der Aufrufer soll dem Fehler ansehen, ob ein zweiter Versuch auf einem
  // unberührten oder auf einem halb abgeräumten Zustand aufsetzt.
  assertEquals((ergebnis as { datenbankBeruehrt: boolean }).datenbankBeruehrt, true);
});

Deno.test('Die Schritte laufen nacheinander, nicht nebeneinander', async () => {
  // Ein Promise.all über dieselben Schritte wäre in allen Tests oben grün,
  // die Reihenfolge im Protokoll bliebe zufällig sogar oft dieselbe. Hier
  // startet der zweite Schritt nachweislich erst, wenn der erste FERTIG ist.
  const protokoll: string[] = [];
  const langsam: Schritt = {
    name: 'langsam',
    ausfuehren: async () => {
      protokoll.push('langsam:start');
      await new Promise((aufloesen) => setTimeout(aufloesen, 20));
      protokoll.push('langsam:ende');
      return { fehler: null };
    },
  };
  const schnell: Schritt = {
    name: 'schnell',
    ausfuehren: () => {
      protokoll.push('schnell:start');
      return Promise.resolve({ fehler: null });
    },
  };
  await fuehreLoeschungAus(schritt('speicher', OK, protokoll), [langsam, schnell]);
  assertEquals(protokoll, ['speicher', 'langsam:start', 'langsam:ende', 'schnell:start']);
});

Deno.test('Ohne Datenbankschritte bleibt es beim Speicherschritt, und der läuft trotzdem', async () => {
  const protokoll: string[] = [];
  const ergebnis = await fuehreLoeschungAus(schritt('speicher', OK, protokoll), []);
  assertEquals(ergebnis, { ok: true });
  assertEquals(protokoll, ['speicher']);
});

// ===========================================================================
// Schlüssel werden abgeleitet, nicht übernommen
// ===========================================================================

Deno.test('medienSchluessel: Medium und Thumbnail je Moment, aus der Ableitung', async () => {
  const posts: PostZeile[] = [
    { id: 'p1', trip_id: TRIP, type: 'photo', media_ext: 'jpg' },
    { id: 'p2', trip_id: TRIP, type: 'video', media_ext: 'mov' },
  ];
  const schluessel = medienSchluessel(posts);
  assertEquals(schluessel, [
    erwarteteSchluessel(TRIP, 'p1', 'photo', 'jpg').storage_key,
    erwarteteSchluessel(TRIP, 'p1', 'photo', 'jpg').thumb_key,
    erwarteteSchluessel(TRIP, 'p2', 'video', 'mov').storage_key,
    erwarteteSchluessel(TRIP, 'p2', 'video', 'mov').thumb_key,
  ]);
  // Das Video liegt unter .mov (iOS), nicht unter dem Standard .mp4, sonst
  // bliebe die echte Datei liegen und eine nicht existierende würde
  // "gelöscht".
  assert(schluessel[2].endsWith('.mov'), schluessel[2]);
  await Promise.resolve();
});

Deno.test('medienSchluessel: ein Moment aus einer anderen Reise erzeugt den Pfad DIESER Reise', () => {
  // trip_id kommt aus der posts-Zeile, nicht aus einem Parameter, ein
  // eigener Moment in einer fremden Reise wird also unter dem Pfad der
  // fremden Reise gelöscht, und genau dort liegt er auch.
  const fremd = '00000000-0000-4000-8000-0000000000ff';
  assertEquals(
    medienSchluessel([{ id: 'p9', trip_id: fremd, type: 'photo', media_ext: 'jpg' }])[0],
    `trips/${fremd}/p9.jpg`,
  );
});

Deno.test('medienSchluessel: eine leere Liste ergibt keine Schlüssel', () => {
  assertEquals(medienSchluessel([]), []);
});

// ===========================================================================
// Der Wächter für client-geschriebene Pfade
// ===========================================================================

Deno.test('pfadGehoertUns: ein fremder Pfad in der eigenen cover_key-Spalte wird nicht gelöscht', () => {
  // Der Angriff: Wer 'covers/lissabon.jpg', das Titelbild einer FREMDEN
  // Reise, in sein eigenes cover_key schreibt und danach sein Konto löscht,
  // dürfte damit nicht das fremde Objekt mitlöschen. Eine Kontolöschung darf
  // nie ein Werkzeug gegen fremde Daten werden.
  const erlaubt = [`trips/${TRIP}/`];
  assertFalse(pfadGehoertUns('covers/lissabon.jpg', erlaubt));
  assertFalse(pfadGehoertUns('trips/00000000-0000-4000-8000-0000000000ff/cover.jpg', erlaubt));
  assert(pfadGehoertUns(`trips/${TRIP}/cover.jpg`, erlaubt));
});

Deno.test('pfadGehoertUns: Ausbruchsversuche und Unsinn werden abgewiesen', () => {
  const erlaubt = [`trips/${TRIP}/`, `profiles/${USER}/`];
  assertFalse(pfadGehoertUns(null, erlaubt));
  assertFalse(pfadGehoertUns(undefined, erlaubt));
  assertFalse(pfadGehoertUns('', erlaubt));
  assertFalse(pfadGehoertUns(`/trips/${TRIP}/cover.jpg`, erlaubt));
  assertFalse(pfadGehoertUns(`trips/${TRIP}/../${TRIP}x/cover.jpg`, erlaubt));
  // Ein leeres Präfix darf nicht plötzlich alles erlauben.
  assertFalse(pfadGehoertUns('irgendwas.jpg', ['']));
  assertFalse(pfadGehoertUns('irgendwas.jpg', []));
  assert(pfadGehoertUns(`profiles/${USER}/avatar.jpg`, erlaubt));
});

// ===========================================================================
// Seitenweise einsammeln
// ===========================================================================

function seitenServer(anzahl: number, seitengroesse: number) {
  const alle = Array.from({ length: anzahl }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}` }));
  return {
    alle,
    holeSeite: (von: number, mitZaehlung: boolean) =>
      Promise.resolve({
        zeilen: alle.slice(von, von + seitengroesse),
        anzahl: mitZaehlung ? anzahl : null,
        fehler: null,
      }),
  };
}

Deno.test('sammleAlle: blättert über die Seitengrenze, sonst blieben zwei Objekte je übersehenem Moment liegen', async () => {
  const server = seitenServer(1001, 1000);
  const { zeilen, verloren, fehler } = await sammleAlle(server.holeSeite);
  assertEquals(fehler, null);
  assertEquals(zeilen.length, 1001);
  assertEquals(zeilen.map((z) => z.id), server.alle.map((z) => z.id));
  assertEquals(verloren, 0);
});

Deno.test('sammleAlle: eine Doublette an der Seitengrenze erscheint nur einmal', async () => {
  const seiten = [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], []];
  let i = 0;
  const { zeilen, verloren } = await sammleAlle((_von, mitZaehlung) =>
    Promise.resolve({ zeilen: seiten[i++] ?? [], anzahl: mitZaehlung ? 4 : null, fehler: null })
  );
  assertEquals(zeilen.map((z) => z.id), ['a', 'b', 'c']);
  assertEquals(verloren, 1);
});

Deno.test('sammleAlle: eine Seite aus lauter Doubletten führt nicht in eine Endlosschleife', async () => {
  let abrufe = 0;
  const { zeilen } = await sammleAlle((_von, mitZaehlung) => {
    abrufe += 1;
    if (abrufe > 5) return Promise.resolve({ zeilen: [], anzahl: null, fehler: null });
    return Promise.resolve({ zeilen: [{ id: 'a' }, { id: 'a' }], anzahl: mitZaehlung ? 99 : null, fehler: null });
  });
  assertEquals(zeilen.map((z) => z.id), ['a']);
  assert(abrufe <= 6, `sammleAlle hat ${abrufe} Abrufe gebraucht`);
});

Deno.test('sammleAlle: ein Fehler bricht ab und wird durchgereicht', async () => {
  const { fehler, zeilen } = await sammleAlle(() =>
    Promise.resolve({ zeilen: [] as Array<{ id: string }>, anzahl: null, fehler: { message: 'kaputt' } })
  );
  assertEquals(fehler, { message: 'kaputt' });
  assertEquals(zeilen.length, 0);
});
