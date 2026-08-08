import {
  dauerFuer,
  weiter,
  zurueck,
  tagWechselt,
  FOTO_DAUER_MS,
  VIDEO_DAUER_FALLBACK_MS,
  VIDEO_DAUER_MIN_MS,
  type PlayerStand,
} from '../playerLogic';
import type { RecapMoment } from '../types';

// Minimal-Moment mit sinnvollen Defaults — jeder Test überschreibt nur, was
// ihn tatsächlich betrifft (Muster wie in tage.test.ts).
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

describe('dauerFuer', () => {
  // Literal-Assert statt nur "gegen sich selbst" (Review-Fund): ein Test,
  // der dauerFuer(...) nur gegen FOTO_DAUER_MS vergleicht, bleibt grün, auch
  // wenn die Konstante selbst mutiert (Implementierung gegen Implementierung
  // geprüft). Spec §8.2: Fotos laufen 5 Sekunden — das ist die Zahl, die
  // zählt, unabhängig vom Namen der Konstante.
  test('FOTO_DAUER_MS ist 5000 (Spec §8.2: Fotos laufen 5 Sekunden)', () => {
    expect(FOTO_DAUER_MS).toBe(5000);
  });

  test('ein Foto dauert immer FOTO_DAUER_MS (5000 ms)', () => {
    expect(dauerFuer(moment({ type: 'photo', duration_s: null }))).toBe(5000);
    // Ein duration_s auf einem Foto (sollte laut Schema nie vorkommen) darf
    // die Dauer trotzdem nicht verändern — Fotos hängen NIE von duration_s ab.
    expect(dauerFuer(moment({ type: 'photo', duration_s: 42 }))).toBe(5000);
  });

  test('ein Video dauert duration_s * 1000', () => {
    expect(dauerFuer(moment({ type: 'video', duration_s: 12 }))).toBe(12_000);
  });

  // Ein Boden verhindert, dass ein sehr kurzer/kaputter duration_s-Wert
  // (0 ist laut Check-Constraint technisch gültig) den Moment faktisch
  // unsichtbar macht — der Fortschrittsbalken würde sonst augenblicklich
  // füllen. 0 ist gleichzeitig ein gültiger, aber FALSY Wert — eine
  // Implementierung, die `duration_s ? … : Fallback` statt `=== null`
  // prüft, würde hier fälschlich den (viel längeren) Fallback statt des
  // Bodens liefern; dieser Test verlangt explizit den Boden, nicht 0 und
  // nicht VIDEO_DAUER_FALLBACK_MS.
  test('duration_s = 0 liefert den Boden VIDEO_DAUER_MIN_MS, nicht 0 und nicht den Fallback', () => {
    expect(dauerFuer(moment({ type: 'video', duration_s: 0 }))).toBe(VIDEO_DAUER_MIN_MS);
  });

  test('ein sehr kurzer, aber echter duration_s-Wert wird ebenfalls auf den Boden angehoben', () => {
    // 0.5 s * 1000 = 500 ms, unter dem Boden von VIDEO_DAUER_MIN_MS.
    expect(dauerFuer(moment({ type: 'video', duration_s: 0.5 }))).toBe(VIDEO_DAUER_MIN_MS);
  });

  test('ein Video mit ausreichender Dauer bleibt UNTER dem Boden unangetastet (Boden hebt nur an, kappt nicht)', () => {
    expect(dauerFuer(moment({ type: 'video', duration_s: 12 }))).toBe(12_000);
    expect(12_000).toBeGreaterThan(VIDEO_DAUER_MIN_MS);
  });

  test('ein Video ohne duration_s (nullable Spalte, Verteidigungsfall) bekommt den benannten Rückfallwert, kein NaN', () => {
    const dauer = dauerFuer(moment({ type: 'video', duration_s: null }));
    expect(Number.isNaN(dauer)).toBe(false);
    expect(dauer).toBe(VIDEO_DAUER_FALLBACK_MS);
  });

  // VIDEO_DAUER_FALLBACK_MS muss mindestens die laut Check-Constraint
  // maximal zulässige Videolänge (30 s) abdecken (Review-Fund) — sonst
  // schneidet der Fallback ein legales, aber dauer-loses Video mitten im
  // Bild ab.
  test('VIDEO_DAUER_FALLBACK_MS ist mindestens 30 Sekunden (maximal zulässige Videolänge laut Check-Constraint)', () => {
    expect(VIDEO_DAUER_FALLBACK_MS).toBeGreaterThanOrEqual(30_000);
  });
});

describe('weiter', () => {
  const stand = (overrides: Partial<PlayerStand> = {}): PlayerStand => ({
    index: 0,
    pausiert: false,
    fortschritt: 0,
    ...overrides,
  });

  test('erhöht den Index um eins und setzt den Fortschritt zurück', () => {
    const ergebnis = weiter(stand({ index: 1, fortschritt: 3400 }), 5);
    expect(ergebnis).toEqual({ index: 2, pausiert: false, fortschritt: 0 });
  });

  test('lässt "pausiert" unverändert — weiter/zurueck entscheiden nicht über Pause', () => {
    const ergebnis = weiter(stand({ index: 0, pausiert: true }), 5);
    expect(ergebnis).toEqual({ index: 1, pausiert: true, fortschritt: 0 });
  });

  // Brief: am letzten Moment liefert weiter 'ende', NICHT Index `anzahl` —
  // ein off-by-one hier würde stattdessen { index: anzahl, ... } liefern.
  test('am letzten Moment liefert weiter "ende", nicht Index anzahl', () => {
    const ergebnis = weiter(stand({ index: 4 }), 5);
    expect(ergebnis).toBe('ende');
  });

  test('leere Liste: weiter liefert sofort "ende"', () => {
    expect(weiter(stand({ index: 0 }), 0)).toBe('ende');
  });

  test('genau ein Moment (anzahl 1): weiter liefert sofort "ende"', () => {
    expect(weiter(stand({ index: 0 }), 1)).toBe('ende');
  });
});

describe('zurueck', () => {
  const stand = (overrides: Partial<PlayerStand> = {}): PlayerStand => ({
    index: 0,
    pausiert: false,
    fortschritt: 0,
    ...overrides,
  });

  test('verringert den Index um eins und setzt den Fortschritt zurück', () => {
    const ergebnis = zurueck(stand({ index: 2, fortschritt: 1200 }));
    expect(ergebnis).toEqual({ index: 1, pausiert: false, fortschritt: 0 });
  });

  // Brief: zurueck am ersten Moment bleibt bei Index 0 und setzt den
  // Fortschritt zurück — es springt NICHT aus dem Tag/der Filmrolle hinaus
  // (kein negativer Index).
  test('am ersten Moment bleibt der Index bei 0, statt negativ zu werden', () => {
    const ergebnis = zurueck(stand({ index: 0, fortschritt: 800 }));
    expect(ergebnis).toEqual({ index: 0, pausiert: false, fortschritt: 0 });
  });

  // Brief: zurueck setzt fortschritt IMMER auf 0, auch mitten in einem
  // Video — unabhängig davon, ob der Index sich überhaupt verändert.
  test('setzt fortschritt immer auf 0, auch wenn der Index gleich bleibt (Index 0)', () => {
    const ergebnis = zurueck(stand({ index: 0, fortschritt: 3999 }));
    expect(ergebnis.fortschritt).toBe(0);
  });

  test('lässt "pausiert" unverändert', () => {
    const ergebnis = zurueck(stand({ index: 3, pausiert: true }));
    expect(ergebnis).toEqual({ index: 2, pausiert: true, fortschritt: 0 });
  });
});

describe('tagWechselt', () => {
  const startDate = '2026-08-01';

  test('true beim allerersten Moment überhaupt (index 0)', () => {
    const momente = [moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' })];
    expect(tagWechselt(momente, startDate, 0)).toBe(true);
  });

  test('false, solange zwei aufeinanderfolgende Momente am selben Tag liegen', () => {
    const momente = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b', captured_at: '2026-08-01T15:00:00.000Z' }),
    ];
    expect(tagWechselt(momente, startDate, 1)).toBe(false);
  });

  test('true genau beim ersten Moment eines neuen Tages', () => {
    const momente = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b', captured_at: '2026-08-01T15:00:00.000Z' }),
      moment({ id: 'c', captured_at: '2026-08-02T09:00:00.000Z' }),
    ];
    expect(tagWechselt(momente, startDate, 0)).toBe(true); // allererster Moment
    expect(tagWechselt(momente, startDate, 1)).toBe(false); // noch Tag 1
    expect(tagWechselt(momente, startDate, 2)).toBe(true); // Tag 2 beginnt
  });

  test('ausserhalb der Liste liegende Indizes liefern false, statt zu werfen', () => {
    const momente = [moment({ id: 'a' })];
    expect(tagWechselt(momente, startDate, -1)).toBe(false);
    expect(tagWechselt(momente, startDate, 1)).toBe(false);
    expect(tagWechselt([], startDate, 0)).toBe(false);
  });

  // Integrationstest zur eigentlichen Anforderung des Briefs: die Tagesnummer
  // hängt von den Momenten DAVOR ab und lässt sich nicht isoliert pro Moment
  // bestimmen. Review-Fund aus tage.ts: bei einem Ostwärts-Zeitsprung
  // (Tokio → Los Angeles) läuft der EIGENE lokale Kalendertag der späteren
  // Ankunft hinter den des früheren Abflugs zurück (Los Angeles: 1. August,
  // Tokio: 2. August) — gruppiereNachTagen hält die Reihenfolge trotzdem
  // chronologisch und ordnet beide demselben (höheren) Tag zu. Eine
  // Implementierung, die stattdessen naiv die LOKALEN Kalendertage der
  // beiden Momente miteinander vergliche, würde hier fälschlich true
  // liefern (1. August ≠ 2. August) — dieser Test verlangt explizit false.
  test('folgt der monoton fortgeschriebenen Tagesnummer aus gruppiereNachTagen, nicht dem rohen lokalen Kalendertag', () => {
    const abflugTokio = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // lokal: 02.08., 08:30 (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const ankunftLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // chronologisch später, lokal aber 01.08. (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const momente = [abflugTokio, ankunftLosAngeles];
    expect(tagWechselt(momente, startDate, 1)).toBe(false);
  });

  // Ein echter Ortstag-Wechsel (Nachtflug) bleibt dagegen ein Tageswechsel —
  // Gegenprobe zum Test oben, damit "immer false bei unterschiedlicher
  // captured_tz" nicht versehentlich als Regel durchrutscht.
  test('ein echter Ortstag-Wechsel (Nachtflug) bleibt ein Tageswechsel', () => {
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
    expect(tagWechselt([abflugOslo, ankunftTokyo], startDate, 1)).toBe(true);
  });

  // Review-Fund, Important 3/4: der ursprüngliche Test prüfte hier NUR
  // not.toThrow() — die eigentliche Designentscheidung (id-basierte
  // Zuordnung statt Position im ggf. verkürzten Ergebnis von
  // gruppiereNachTagen) war dadurch durch keinen einzigen Rückgabewert
  // gedeckt. Ein Mutant, der stattdessen positional in eine geflachte
  // Ausgabe indiziert (`gruppiereNachTagen(...).flatMap(t => t.momente.map(
  // () => t.nummer))`, dann `flach[index] !== flach[index - 1]`), blieb bei
  // reinem not.toThrow() unbemerkt grün.
  //
  // Fall A: der verworfene Moment liegt INNERHALB eines Tages (a, kaputt, b
  // sind real alle Tag 1). Review-Fund, Important 4: ein fehlender
  // Map-Eintrag auf EINER Seite gilt als "kein Wechsel" (false), nicht als
  // Wechsel — sonst kündigt der Player denselben Tag zweimal an (an kaputts
  // Position UND an b's Position direkt danach).
  test('ein verworfener Moment INNERHALB eines Tages erzeugt keine falsche Tages-Zwischenkarte (weder an seiner Position noch danach)', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const kaputt = moment({ id: 'kaputt', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T11:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const momente = [a, kaputt, b];
    expect(() => tagWechselt(momente, startDate, 1)).not.toThrow();
    expect(tagWechselt(momente, startDate, 1)).toBe(false); // an kaputts Position
    expect(tagWechselt(momente, startDate, 2)).toBe(false); // an b's Position, direkt danach
  });

  // Fall B: der verworfene Moment liegt GENAU AN einer echten Tagesgrenze
  // (a ist Tag 1, b ist Tag 2). Der bewusste Kompromiss aus Important 4:
  // auch hier liefert tagWechselt an beiden Nachbarpositionen false — der
  // echte Wechsel wird nicht angezeigt, weil sein einziger unmittelbarer
  // Zeuge der verworfene Moment gewesen wäre. Das ist zugleich der Test, der
  // eine positionale Re-Implementierung am schärfsten von der id-basierten
  // unterscheidet: gruppiereNachTagen liefert für [a, kaputt, b] nur zwei
  // Tage mit je einem Moment (kaputt fehlt), macht eine geflachte Ausgabe
  // `[1, 2]` (Länge 2) — `flach[2]` wäre dort `undefined` (Index aus dem
  // 3-elementigen `momente` direkt in die 2-elementige Ausgabe gespiegelt)
  // und `undefined !== 2` läge fälschlich bei `true`.
  test('ein verworfener Moment GENAU AN einer Tagesgrenze zeigt an keiner Nachbarposition einen Wechsel (dokumentierter Kompromiss)', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const kaputt = moment({ id: 'kaputt', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    const b = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const momente = [a, kaputt, b];
    expect(tagWechselt(momente, startDate, 1)).toBe(false);
    expect(tagWechselt(momente, startDate, 2)).toBe(false);
  });

  // Review-Fund, Important 5: tagWechselt memoisiert die Tagesnummern über
  // die Array-REFERENZ von `momente` (WeakMap), damit ein Player mit
  // hunderten Momenten nicht pro Momentwechsel erneut gruppiereNachTagen
  // (und damit pro Moment ein frisches Intl.DateTimeFormat) aufbaut. Ein
  // Cache, der stattdessen z.B. nach Länge oder startDate allein schlüsselte
  // (statt nach der Referenz), würde zwei verschiedene, gleich lange Listen
  // verwechseln — dieser Test ruft beide verschachtelt auf und verlangt,
  // dass jede ihr eigenes, korrektes Ergebnis behält.
  test('zwei verschiedene momente-Arrays gleicher Länge werden unabhängig zwischengespeichert, keine Verwechslung', () => {
    const listeA = [
      moment({ id: 'a1', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'a2', captured_at: '2026-08-01T15:00:00.000Z' }), // gleicher Tag wie a1
    ];
    const listeB = [
      moment({ id: 'b1', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b2', captured_at: '2026-08-02T09:00:00.000Z' }), // anderer Tag als b1
    ];
    expect(tagWechselt(listeA, startDate, 1)).toBe(false);
    expect(tagWechselt(listeB, startDate, 1)).toBe(true);
    // Nochmal, verschachtelt in umgekehrter Reihenfolge: ein Cache, der
    // Listen verwechselt, würde spätestens hier eines der beiden Ergebnisse
    // kippen.
    expect(tagWechselt(listeB, startDate, 1)).toBe(true);
    expect(tagWechselt(listeA, startDate, 1)).toBe(false);
  });
});
