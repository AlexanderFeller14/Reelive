import {
  dauerFuer,
  weiter,
  zurueck,
  tagWechselt,
  FOTO_DAUER_MS,
  VIDEO_DAUER_FALLBACK_MS,
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
  test('ein Foto dauert immer FOTO_DAUER_MS', () => {
    expect(dauerFuer(moment({ type: 'photo', duration_s: null }))).toBe(FOTO_DAUER_MS);
    // Ein duration_s auf einem Foto (sollte laut Schema nie vorkommen) darf
    // die Dauer trotzdem nicht verändern — Fotos hängen NIE von duration_s ab.
    expect(dauerFuer(moment({ type: 'photo', duration_s: 42 }))).toBe(FOTO_DAUER_MS);
  });

  test('ein Video dauert duration_s * 1000', () => {
    expect(dauerFuer(moment({ type: 'video', duration_s: 12 }))).toBe(12_000);
  });

  // 0 ist ein gültiger, aber falsy Wert — eine Implementierung, die
  // `duration_s ? … : Fallback` statt `duration_s === null` prüft, würde
  // hier fälschlich den Fallback liefern. Dieser Test unterscheidet beide.
  test('duration_s = 0 liefert 0, nicht den Fallback (falsy ist nicht null)', () => {
    expect(dauerFuer(moment({ type: 'video', duration_s: 0 }))).toBe(0);
  });

  test('ein Video ohne duration_s (nullable Spalte) bekommt den benannten Rückfallwert, kein NaN', () => {
    const dauer = dauerFuer(moment({ type: 'video', duration_s: null }));
    expect(Number.isNaN(dauer)).toBe(false);
    expect(dauer).toBe(VIDEO_DAUER_FALLBACK_MS);
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

  // Ein Moment mit unbrauchbarem captured_tz kostet laut tage.ts höchstens
  // sich selbst (er fehlt in gruppiereNachTagens Ergebnis) — tagWechselt
  // darf dabei weder werfen noch die Zuordnung der Nachbarn durcheinander
  // bringen.
  test('ein Moment mit ungültigem captured_tz wirft nicht, benachbarte Momente bleiben korrekt zugeordnet', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const kaputt = moment({ id: 'kaputt', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T11:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const momente = [a, kaputt, b];
    expect(() => tagWechselt(momente, startDate, 1)).not.toThrow();
    expect(() => tagWechselt(momente, startDate, 2)).not.toThrow();
  });
});
