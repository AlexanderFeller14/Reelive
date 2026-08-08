import { sortiereMomente, gruppiereNachTagen, ortDesTages } from '../tage';
import type { RecapMoment } from '../types';

// Minimal-Moment mit sinnvollen Defaults — jeder Test überschreibt nur, was
// ihn tatsächlich betrifft (Muster wie job in postsApi.test.ts).
function moment(overrides: Partial<RecapMoment>): RecapMoment {
  return {
    id: 'm0',
    trip_id: 't1',
    author_id: 'u1',
    type: 'photo',
    duration_s: null,
    caption: null,
    captured_at: '2026-08-01T10:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    place_name: null,
    upload_status: 'uploaded',
    autor_name: 'Lea',
    ...overrides,
  };
}

describe('sortiereMomente', () => {
  test('sortiert nach captured_at aufsteigend', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T12:00:00.000Z' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z' });
    const c = moment({ id: 'c', captured_at: '2026-08-01T15:00:00.000Z' });
    expect(sortiereMomente([a, b, c]).map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  // CLAUDE.md: Sortierung IMMER nach captured_at, bei gleicher Sekunde
  // entscheidet id — nie created_at (das RecapMoment gar nicht trägt).
  test('bei gleicher captured_at entscheidet id', () => {
    const gleich = '2026-08-01T12:00:00.000Z';
    const z = moment({ id: 'z', captured_at: gleich });
    const a = moment({ id: 'a', captured_at: gleich });
    const m = moment({ id: 'm', captured_at: gleich });
    expect(sortiereMomente([z, a, m]).map((x) => x.id)).toEqual(['a', 'm', 'z']);
  });

  test('das Ergebnis ist bei wiederholtem Sortieren identisch (stabil, nicht bloss zufällig richtig)', () => {
    const gleich = '2026-08-01T12:00:00.000Z';
    const momente = [
      moment({ id: 'c', captured_at: gleich }),
      moment({ id: 'a', captured_at: gleich }),
      moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z' }),
    ];
    const einmal = sortiereMomente(momente);
    const zweimal = sortiereMomente(einmal);
    expect(zweimal.map((m) => m.id)).toEqual(einmal.map((m) => m.id));
    expect(zweimal.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  test('lässt die Eingabe unverändert (liefert eine neue Liste)', () => {
    const b = moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z' });
    const a = moment({ id: 'a', captured_at: '2026-08-01T12:00:00.000Z' });
    const eingabe = [a, b];
    sortiereMomente(eingabe);
    expect(eingabe.map((m) => m.id)).toEqual(['a', 'b']);
  });

  test('leere Eingabe liefert eine leere Liste, keinen Fehler', () => {
    expect(sortiereMomente([])).toEqual([]);
  });

  // Ein reiner Text-Vergleich der ISO-Strings wäre hier falsch: "22" < "23"
  // liest sich lexikalisch kleiner, obwohl a (21:00 UTC) tatsächlich VOR b
  // (22:00 UTC) liegt — captured_at kommt mit unterschiedlichem Offset-
  // Format aus der Datenbank (Kommentar im Code), und genau das prüft dieser
  // Test konkret nach.
  test('vergleicht captured_at als echten Zeitpunkt, nicht als Text (unterschiedliche Offset-Formate)', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T23:00:00+02:00' }); // = 21:00 UTC
    const b = moment({ id: 'b', captured_at: '2026-08-01T22:00:00Z' }); // = 22:00 UTC
    expect(sortiereMomente([b, a]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Ein unparsbares captured_at darf die Sortierung nicht zum Werfen bringen
  // (Date.parse liefert dafür NaN) — es landet stattdessen deterministisch
  // ans Ende, id entscheidet auch hier bei mehreren kaputten Werten.
  test('ein unparsbares captured_at wirft nicht und landet deterministisch am Ende', () => {
    const gueltig = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' });
    const kaputtZ = moment({ id: 'z', captured_at: 'kein-datum' });
    const kaputtY = moment({ id: 'y', captured_at: 'auch-kaputt' });
    expect(() => sortiereMomente([kaputtZ, gueltig, kaputtY])).not.toThrow();
    expect(sortiereMomente([kaputtZ, gueltig, kaputtY]).map((m) => m.id)).toEqual(['a', 'y', 'z']);
  });
});

describe('gruppiereNachTagen', () => {
  const startDate = '2026-08-01';

  test('leere Eingabe liefert eine leere Liste, keinen Fehler', () => {
    expect(gruppiereNachTagen([], startDate)).toEqual([]);
  });

  test('zählt ab start_date als Tag 1', () => {
    const tag1 = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const tag2 = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const tage = gruppiereNachTagen([tag1, tag2], startDate);
    expect(tage.map((t) => ({ nummer: t.nummer, datum: t.datum }))).toEqual([
      { nummer: 1, datum: '2026-08-01' },
      { nummer: 2, datum: '2026-08-02' },
    ]);
  });

  // Eigene Tagesarithmetik (nicht dieselbe Implementierung wie tripDay.ts) —
  // ein Monatswechsel wird deshalb hier separat geprüft, analog zu
  // tripDay.test.ts.
  test('zählt Tage korrekt über einen Monatswechsel hinweg', () => {
    const vorMonatswechsel = moment({ id: 'a', captured_at: '2026-07-30T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const nachMonatswechsel = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const tage = gruppiereNachTagen([vorMonatswechsel, nachMonatswechsel], '2026-07-30');
    expect(tage.map((t) => ({ nummer: t.nummer, datum: t.datum }))).toEqual([
      { nummer: 1, datum: '2026-07-30' },
      { nummer: 4, datum: '2026-08-02' },
    ]);
  });

  // Brief: ein Moment vor dem Startdatum (Anreise) bekommt Tag 1 und wird
  // nicht verworfen.
  test('ein Moment vor dem Startdatum bekommt Tag 1, statt verworfen zu werden', () => {
    const vorAbreise = moment({
      id: 'a',
      captured_at: '2026-07-30T18:00:00.000Z',
      captured_tz: 'Europe/Zurich',
    });
    const tage = gruppiereNachTagen([vorAbreise], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].nummer).toBe(1);
    expect(tage[0].datum).toBe('2026-08-01');
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a']);
  });

  // Die Tagesgrenze richtet sich nach captured_tz des Moments — nicht nach
  // dem UTC-Datum von captured_at. Los Angeles (UTC-7 im Sommer) ist der
  // UTC-Zeit hier so weit hinterher, dass der Moment lokal noch am Vortag
  // liegt, obwohl captured_at bereits den nächsten UTC-Kalendertag zeigt.
  test('die Tagesgrenze folgt captured_tz, nicht dem UTC-Datum von captured_at', () => {
    const spaetAbendsLokal = moment({
      id: 'a',
      captured_at: '2026-08-02T01:00:00.000Z', // UTC: schon der 2. August
      captured_tz: 'America/Los_Angeles', // lokal: 1. August, 18:00 Uhr
    });
    const tage = gruppiereNachTagen([spaetAbendsLokal], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].nummer).toBe(1);
  });

  // Umgekehrter Fall: lokal schon der nächste Tag, obwohl das UTC-Datum von
  // captured_at noch auf den Vortag zeigt (Tokio, UTC+9).
  test('ein Moment kurz vor Mitternacht UTC gehört lokal schon zum nächsten Tag', () => {
    const kurzVorMitternachtUtc = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // UTC: noch der 1. August
      captured_tz: 'Asia/Tokyo', // lokal: 2. August, 08:30 Uhr
    });
    const tage = gruppiereNachTagen([kurzVorMitternachtUtc], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].nummer).toBe(2);
  });

  // Die Gruppe überquert eine Zeitzonengrenze (z.B. Eurotunnel Paris→London),
  // beide Momente liegen auf demselben Ortstag in ihrer jeweils eigenen Zone.
  // Sie dürfen NICHT auseinanderfallen, nur weil captured_tz unterschiedlich
  // ist — massgeblich ist allein die daraus abgeleitete Tagesnummer.
  test('zwei Momente am selben Ortstag in verschiedenen Zeitzonen bleiben in einem Tag', () => {
    const paris = moment({
      id: 'a',
      captured_at: '2026-08-01T09:00:00.000Z', // 11:00 CEST (Europe/Paris)
      captured_tz: 'Europe/Paris',
    });
    const london = moment({
      id: 'b',
      captured_at: '2026-08-01T21:30:00.000Z', // 22:30 BST (Europe/London), noch derselbe Ortstag
      captured_tz: 'Europe/London',
    });
    const tage = gruppiereNachTagen([london, paris], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].nummer).toBe(1);
    // sortiert bleibt nach captured_at: Paris (09:00 UTC) vor London (21:30 UTC).
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Ein echter, lokal spürbarer Tageswechsel (Nachtflug) bleibt dagegen ein
  // Tageswechsel — das ist kein Bug, sondern die reale Ortszeit am Zielort.
  test('ein echter Ortstag-Wechsel (Nachtflug) erzeugt zwei Tage', () => {
    const abflugOslo = moment({
      id: 'a',
      captured_at: '2026-08-01T21:00:00.000Z', // 23:00 CEST (Europe/Oslo)
      captured_tz: 'Europe/Oslo',
    });
    const ankunftTokyo = moment({
      id: 'b',
      captured_at: '2026-08-02T08:00:00.000Z', // 17:00 JST (Asia/Tokyo), nächster Ortstag
      captured_tz: 'Asia/Tokyo',
    });
    const tage = gruppiereNachTagen([abflugOslo, ankunftTokyo], startDate);
    expect(tage.map((t) => t.nummer)).toEqual([1, 2]);
  });

  test('das datum eines Tages ist unabhängig davon, welche captured_tz seine Momente tragen', () => {
    const paris = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Paris' });
    const london = moment({ id: 'b', captured_at: '2026-08-01T21:30:00.000Z', captured_tz: 'Europe/London' });
    const tage = gruppiereNachTagen([london, paris], startDate);
    expect(tage[0].datum).toBe('2026-08-01');
  });

  test('setzt ort über ortDesTages je Tag', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', place_name: 'Oslo' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', place_name: 'Oslo' });
    const c = moment({ id: 'c', captured_at: '2026-08-01T11:00:00.000Z', place_name: 'Bergen' });
    const tage = gruppiereNachTagen([a, b, c], startDate);
    expect(tage[0].ort).toBe('Oslo');
  });

  test('die Tage stehen aufsteigend sortiert, unabhängig von der Eingabereihenfolge', () => {
    const tag3 = moment({ id: 'c', captured_at: '2026-08-03T09:00:00.000Z' });
    const tag1 = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' });
    const tag2 = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z' });
    const tage = gruppiereNachTagen([tag3, tag1, tag2], startDate);
    expect(tage.map((t) => t.nummer)).toEqual([1, 2, 3]);
  });

  // Review-Fund, Important 1: ein Ostwärts-Zeitsprung (Tokio → Los Angeles)
  // lässt den EIGENEN lokalen Kalendertag eines späteren Moments hinter den
  // eines früheren zurückfallen. Ohne Korrektur würde die chronologisch
  // spätere Ankunft unter einer KLEINEREN Tagesnummer erscheinen als der
  // frühere Abflug — Chronologie ist der Eckpfeiler dieses Projekts.
  test('die Tagesreihenfolge bleibt chronologisch, auch wenn der lokale Kalendertag rückwärts läuft', () => {
    const abflugTokio = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // lokal: 02.08., 08:30 (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const ankunftLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // chronologisch SPÄTER, lokal aber: 01.08., 18:00 (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const tage = gruppiereNachTagen([abflugTokio, ankunftLosAngeles], startDate);
    // Beide Momente landen im selben, höheren Tag — die Ankunft rutscht NICHT
    // rückwärts vor den Abflug.
    expect(tage).toHaveLength(1);
    expect(tage[0].nummer).toBe(2);
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Re-Review-Fund: mit nur ZWEI Momenten fällt die Mutation
  // "laufendeNummer = nummer" → "laufendeNummer = roh" nicht auf (das war
  // gerade der Fall oben). Ein DRITTER, chronologisch noch späterer Moment
  // mit demselben (niedrigeren) eigenen lokalen Tag wie der zweite deckt sie
  // auf: mit der Mutation würde die laufende Nummer nach dem zweiten Moment
  // fälschlich auf dessen ROHEN Wert (1) zurückfallen statt auf der bereits
  // erreichten Nummer (2) zu bleiben — der dritte Moment eröffnete dadurch
  // wieder einen (kleineren, "abgeschlossenen") Tag, und die Tagesliste
  // stünde erneut absteigend (exakt Important 1 zurück).
  test('die monotone Vergabe bleibt über mehr als zwei Momente stabil (kein Rückfall in einen abgeschlossenen Tag)', () => {
    const abflugTokio = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // lokal: 02.08. (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const ankunftLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // lokal: 01.08., abends (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const spaeterLosAngeles = moment({
      id: 'c',
      captured_at: '2026-08-02T03:00:00.000Z', // chronologisch NOCH später, lokal weiterhin 01.08.
      captured_tz: 'America/Los_Angeles',
    });
    const tage = gruppiereNachTagen([abflugTokio, ankunftLosAngeles, spaeterLosAngeles], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].nummer).toBe(2);
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  // Minor (Review): die Nebenwirkung der monotonen Vergabe ist nicht bloss
  // eine übersprungene Nummer, sondern kann RecapTag.datum vom EIGENEN
  // lokalen Datum eines einzelnen Moments abweichen lassen, sobald dessen
  // Kalendertag von einem vorherigen, "laufenden" Tag verschluckt wird —
  // bewusst in Kauf genommen (siehe Kommentarkopf), hier als Vertrag
  // festgehalten, damit Task 10/11 sich nicht auf das Gegenteil verlassen.
  test('bei einem verschluckten Ortstag kann RecapTag.datum vom eigenen lokalen Datum eines Moments abweichen', () => {
    const abflugTokio = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // lokal: 02.08. (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const ankunftLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // eigenes lokales Datum: 01.08. (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const tage = gruppiereNachTagen([abflugTokio, ankunftLosAngeles], startDate);
    expect(tage).toHaveLength(1);
    // b's eigenes lokales Datum wäre 2026-08-01 — die Gruppe trägt aber das
    // Datum von a's (höherem, laufendem) Tag.
    expect(tage[0].datum).toBe('2026-08-02');
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Review-Fund (neu, vom Fix für Important 2/3 eingeführt): ein einzelner
  // Moment, dessen roher Tageswert NaN wird, darf NICHT über
  // Math.max(NaN, laufendeNummer) die laufende Nummer für ALLE
  // nachfolgenden Momente vergiften — sonst kostet er nicht nur sich
  // selbst, sondern reisst gültige Momente mit sich.
  test('ein einzelner kaputter Moment vergiftet nicht die Tagesnummern nachfolgender, gültiger Momente', () => {
    const gueltigVorher = moment({ id: 'a', captured_at: '2026-08-01T08:00:00.000Z' });
    const kaputt = moment({ id: 'b', captured_at: 'kein-datum' });
    const gueltigNachher = moment({ id: 'c', captured_at: '2026-08-02T08:00:00.000Z' });
    const tage = gruppiereNachTagen([gueltigVorher, kaputt, gueltigNachher], startDate);
    expect(tage.map((t) => ({ nummer: t.nummer, momente: t.momente.map((m) => m.id) }))).toEqual([
      { nummer: 1, momente: ['a'] },
      { nummer: 2, momente: ['c'] },
    ]);
  });

  // Review-Fund, Important (halb behoben): formatToParts() liefert auf
  // manchen Intl-Teilimplementierungen (Hermes/iOS historisch — siehe
  // Kommentar in mobile/src/app/(tabs)/aufnehmen/preview.tsx, der Intl
  // gerade DESHALB meidet) 'year'/'month'/'day' nicht als eigene Parts,
  // sondern alles als einen einzigen 'literal'-Part. Nachgestellt über einen
  // Spy auf Intl.DateTimeFormat.prototype.formatToParts.
  test('eine Intl-Teilimplementierung ohne year/month/day-Parts wirft nicht und kostet nur den betroffenen Moment', () => {
    const spy = jest
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValueOnce([{ type: 'literal', value: 'unbrauchbar' }] as unknown as Intl.DateTimeFormatPart[]);
    // kaputt zuerst (chronologisch früher), damit der EINE abgefangene
    // formatToParts-Aufruf sicher ihn trifft, nicht den gültigen Moment.
    const kaputt = moment({ id: 'b', captured_at: '2026-08-01T08:00:00.000Z' });
    const gueltig = moment({ id: 'a', captured_at: '2026-08-01T10:00:00.000Z' });
    const tage = gruppiereNachTagen([kaputt, gueltig], startDate);
    spy.mockRestore();
    expect(tage).toHaveLength(1);
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a']);
  });

  // Zweite, unabhängige NaN-Quelle: ein kaputtes/leeres startDate selbst
  // (nicht captured_at/captured_tz eines Moments) — derselbe
  // Number.isFinite-Guard fängt auch das ab, statt NaN-Tagesnummern für
  // JEDEN Moment zu erzeugen.
  test('ein kaputtes startDate wirft nicht und liefert eine leere Liste statt NaN-Tagesnummern', () => {
    const a = moment({ id: 'a' });
    expect(() => gruppiereNachTagen([a], 'kaputtes-startdatum')).not.toThrow();
    expect(gruppiereNachTagen([a], 'kaputtes-startdatum')).toEqual([]);
  });

  // Review-Fund, Important 2: captured_tz hat keine CHECK-Constraint und ist
  // vom Client frei setzbar — ein ungültiger Bezeichner (fremder/älterer
  // Client, abweichende tzdata zwischen zwei Geräten desselben Recaps) lässt
  // Intl.DateTimeFormat schon beim Konstruieren werfen. Das darf höchstens
  // den betroffenen Moment kosten, nie den gesamten Recap.
  test('ein ungültiges captured_tz wirft nicht und kostet nur den betroffenen Moment', () => {
    const gueltig = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const kaputt = moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    expect(() => gruppiereNachTagen([gueltig, kaputt], startDate)).not.toThrow();
    const tage = gruppiereNachTagen([gueltig, kaputt], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a']);
  });

  // Gleiche Rand-Ursache wie oben, anderer Auslöser: ein unparsbares
  // captured_at lässt Intl.DateTimeFormat beim FORMATIEREN werfen (Invalid
  // Date), nicht beim Konstruieren.
  test('ein unparsbares captured_at wirft nicht und kostet nur den betroffenen Moment', () => {
    const gueltig = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' });
    const kaputt = moment({ id: 'b', captured_at: 'kein-datum' });
    expect(() => gruppiereNachTagen([gueltig, kaputt], startDate)).not.toThrow();
    const tage = gruppiereNachTagen([gueltig, kaputt], startDate);
    expect(tage).toHaveLength(1);
    expect(tage[0].momente.map((m) => m.id)).toEqual(['a']);
  });
});

describe('ortDesTages', () => {
  test('liefert den häufigsten place_name', () => {
    const momente = [
      moment({ id: 'a', place_name: 'Oslo' }),
      moment({ id: 'b', place_name: 'Bergen' }),
      moment({ id: 'c', place_name: 'Oslo' }),
    ];
    expect(ortDesTages(momente)).toBe('Oslo');
  });

  // Bei Gleichstand entscheidet, welcher der gleich häufigen Orte zum
  // chronologisch frühesten Moment gehört.
  test('bei Gleichstand entscheidet der Ort des frühesten Moments', () => {
    const momente = [
      moment({ id: 'a', captured_at: '2026-08-01T11:00:00.000Z', place_name: 'Bergen' }),
      moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z', place_name: 'Oslo' }),
    ];
    expect(ortDesTages(momente)).toBe('Oslo');
  });

  test('null-place_name zählt nicht mit, auch nicht bei einem Gleichstand', () => {
    const momente = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', place_name: null }),
      moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', place_name: 'Oslo' }),
    ];
    expect(ortDesTages(momente)).toBe('Oslo');
  });

  test('null, wenn alle Momente ohne place_name sind', () => {
    const momente = [moment({ id: 'a', place_name: null }), moment({ id: 'b', place_name: null })];
    expect(ortDesTages(momente)).toBeNull();
  });

  // Ein leerer String ist genauso "kein Ort" wie null (`!!ort` filtert
  // beide gleich heraus) — eigener Test, damit das nicht unbemerkt abweicht.
  test('ein leerer place_name zählt nicht mit, wie null', () => {
    const momente = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', place_name: '' }),
      moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', place_name: 'Oslo' }),
    ];
    expect(ortDesTages(momente)).toBe('Oslo');
  });

  test('leere Eingabe liefert null, keinen Fehler', () => {
    expect(ortDesTages([])).toBeNull();
  });
});
