import {
  dauerFuer,
  weiter,
  zurueck,
  tagWechselt,
  mitGrund,
  ohneGrund,
  ohneGruende,
  blockiertAutomatischenVorschub,
  FOTO_DAUER_MS,
  VIDEO_DAUER_FALLBACK_MS,
  VIDEO_DAUER_MIN_MS,
  type PauseGrund,
  type PlayerStand,
} from '../playerLogic';
import * as tage from '../tage';
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

  // Phase-5-Final-Review, Punkt 8 (Review-Fund): fehlte bisher — die beiden
  // Boden-Tests unten vergleichen `dauerFuer(...)` gegen `VIDEO_DAUER_MIN_MS`
  // SELBST, nicht gegen ein Literal. Ein Mutant, der die Konstante von 1000
  // auf z.B. 8000 ändert, bliebe bei BEIDEN grün (die Implementierung würde
  // dann tatsächlich 8000 liefern, und der Test vergleicht ja weiterhin nur
  // gegen dieselbe — inzwischen mutierte — Konstante). Zwei Zeilen weiter
  // oben macht die Suite es für FOTO_DAUER_MS bereits richtig
  // (`expect(FOTO_DAUER_MS).toBe(5000)`) — dasselbe Literal-Pinning fehlte
  // hier für den Video-Boden.
  test('VIDEO_DAUER_MIN_MS ist 1000 (Kommentar am Export: „eine Sekunde ist kurz genug … aber lang genug, um real sichtbar zu sein")', () => {
    expect(VIDEO_DAUER_MIN_MS).toBe(1000);
  });

  // Ein Boden verhindert, dass ein sehr kurzer/kaputter duration_s-Wert
  // (0 ist laut Check-Constraint technisch gültig) den Moment faktisch
  // unsichtbar macht — der Fortschrittsbalken würde sonst augenblicklich
  // füllen. 0 ist gleichzeitig ein gültiger, aber FALSY Wert — eine
  // Implementierung, die `duration_s ? … : Fallback` statt `=== null`
  // prüft, würde hier fälschlich den (viel längeren) Fallback statt des
  // Bodens liefern; dieser Test verlangt explizit den Boden, nicht 0 und
  // nicht VIDEO_DAUER_FALLBACK_MS. Literal `1000` statt `VIDEO_DAUER_MIN_MS`
  // (Review-Fund, siehe oben): sonst bliebe der Test grün, selbst wenn die
  // Konstante (und mit ihr die tatsächliche Anzeigedauer) sich änderte.
  test('duration_s = 0 liefert den Boden von 1000 ms, nicht 0 und nicht den Fallback', () => {
    expect(dauerFuer(moment({ type: 'video', duration_s: 0 }))).toBe(1000);
  });

  test('ein sehr kurzer, aber echter duration_s-Wert wird ebenfalls auf den Boden von 1000 ms angehoben', () => {
    // 0.5 s * 1000 = 500 ms, unter dem Boden.
    expect(dauerFuer(moment({ type: 'video', duration_s: 0.5 }))).toBe(1000);
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
  // Phase-5-Final-Review, Punkt 1: `pausiert` ist jetzt ein
  // `ReadonlySet<PauseGrund>` statt eines booleans (siehe playerLogic.ts) —
  // dieselben Fixtures wie zuvor, nur mit der neuen Repräsentation.
  const stand = (overrides: Partial<PlayerStand> = {}): PlayerStand => ({
    index: 0,
    pausiert: new Set(),
    fortschritt: 0,
    ...overrides,
  });
  const GEHALTEN = new Set<PauseGrund>(['halten']);

  test('erhöht den Index um eins und setzt den Fortschritt zurück', () => {
    const ergebnis = weiter(stand({ index: 1, fortschritt: 3400 }), 5);
    expect(ergebnis).toEqual({ index: 2, pausiert: new Set(), fortschritt: 0 });
  });

  // "pausiert bleibt unangetastet" heisst hier konkret: dieselbe Set-
  // REFERENZ geht unverändert durch — weiter() liest/schreibt sie nicht.
  test('lässt "pausiert" unverändert (dieselbe Referenz) — weiter/zurueck entscheiden nicht über Pause', () => {
    const ergebnis = weiter(stand({ index: 0, pausiert: GEHALTEN }), 5);
    expect(ergebnis).not.toBe('ende');
    if (ergebnis === 'ende') throw new Error('unreachable');
    expect(ergebnis.pausiert).toBe(GEHALTEN);
    expect(ergebnis).toEqual({ index: 1, pausiert: GEHALTEN, fortschritt: 0 });
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
    pausiert: new Set(),
    fortschritt: 0,
    ...overrides,
  });
  const GEHALTEN = new Set<PauseGrund>(['halten']);

  test('verringert den Index um eins und setzt den Fortschritt zurück', () => {
    const ergebnis = zurueck(stand({ index: 2, fortschritt: 1200 }));
    expect(ergebnis).toEqual({ index: 1, pausiert: new Set(), fortschritt: 0 });
  });

  // Brief: zurueck am ersten Moment bleibt bei Index 0 und setzt den
  // Fortschritt zurück — es springt NICHT aus dem Tag/der Filmrolle hinaus
  // (kein negativer Index).
  test('am ersten Moment bleibt der Index bei 0, statt negativ zu werden', () => {
    const ergebnis = zurueck(stand({ index: 0, fortschritt: 800 }));
    expect(ergebnis).toEqual({ index: 0, pausiert: new Set(), fortschritt: 0 });
  });

  // Brief: zurueck setzt fortschritt IMMER auf 0, auch mitten in einem
  // Video — unabhängig davon, ob der Index sich überhaupt verändert.
  test('setzt fortschritt immer auf 0, auch wenn der Index gleich bleibt (Index 0)', () => {
    const ergebnis = zurueck(stand({ index: 0, fortschritt: 3999 }));
    expect(ergebnis.fortschritt).toBe(0);
  });

  test('lässt "pausiert" unverändert (dieselbe Referenz)', () => {
    const ergebnis = zurueck(stand({ index: 3, pausiert: GEHALTEN }));
    expect(ergebnis.pausiert).toBe(GEHALTEN);
    expect(ergebnis).toEqual({ index: 2, pausiert: GEHALTEN, fortschritt: 0 });
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

  // Phase-5-Final-Review, Punkt 8 (Review-Fund, "wenn es billig ist"): bis
  // hierhin prüft keine einzige Zeile den eigentlichen ZWECK des WeakMap-
  // Caches (siehe Kommentar bei `tageNummernCache` in playerLogic.ts) — die
  // Tests oben prüfen nur RICHTIGE Ergebnisse, die auch eine Implementierung
  // OHNE jeden Cache liefern würde (die WeakMap ersatzlos zu streichen liesse
  // alle bisherigen Tests grün). Dieser Test spioniert `gruppiereNachTagen`
  // direkt an: mehrere `tagWechselt`-Aufrufe für DIESELBE Array-Referenz
  // dürfen es nur EINMAL aufrufen.
  test('gruppiereNachTagen wird für dieselbe momente-Referenz nur EINMAL aufgerufen (WeakMap-Cache)', () => {
    const spy = jest.spyOn(tage, 'gruppiereNachTagen');
    const momente = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b', captured_at: '2026-08-01T15:00:00.000Z' }),
      moment({ id: 'c', captured_at: '2026-08-02T09:00:00.000Z' }),
    ];
    tagWechselt(momente, startDate, 0);
    tagWechselt(momente, startDate, 1);
    tagWechselt(momente, startDate, 2);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('PauseGrund: mitGrund/ohneGrund/blockiertAutomatischenVorschub', () => {
  const leer = (): ReadonlySet<PauseGrund> => new Set();

  test('mitGrund fügt einen neuen Grund hinzu', () => {
    const ergebnis = mitGrund(leer(), 'halten');
    expect(ergebnis.has('halten')).toBe(true);
    expect(ergebnis.size).toBe(1);
  });

  // Review-Fund-Prinzip (bissiger Test statt reiner Ergebnisprüfung): bei
  // einem bereits vorhandenen Grund liefert mitGrund DIESELBE Referenz
  // zurück (kein neues Set) — ein Mutant, der stattdessen IMMER
  // `new Set(pausiert).add(grund)` zurückgibt, würde von einer reinen
  // `.has()`-Prüfung nicht erkannt.
  test('mitGrund liefert bei bereits vorhandenem Grund DIESELBE Set-Referenz (kein unnötiger Re-Render)', () => {
    const stand = mitGrund(leer(), 'halten');
    const nochmal = mitGrund(stand, 'halten');
    expect(nochmal).toBe(stand);
  });

  test('ohneGrund nimmt genau den eigenen Grund zurück, andere Gründe bleiben unberührt', () => {
    let stand = mitGrund(leer(), 'halten');
    stand = mitGrund(stand, 'kommentare');
    const ergebnis = ohneGrund(stand, 'halten');
    expect(ergebnis.has('halten')).toBe(false);
    expect(ergebnis.has('kommentare')).toBe(true);
  });

  // Das ist die eigentliche Pointe des Moduls (Final-Review Punkt 1): ein
  // Aufruf mit einem NICHT vorhandenen Grund — z.B. ein verwaister Timer,
  // dessen eigener Grund längst von anderswo zurückgenommen wurde — ist ein
  // sicheres No-Op, auch wenn INZWISCHEN ein FREMDER Grund gesetzt wurde. Ein
  // naiver `pausiert = false`-Ersatz (die alte Repräsentation) würde diesen
  // fremden Grund hier mitreissen — dieser Test verlangt explizit, dass er
  // stehen bleibt.
  test('ohneGrund für einen nicht vorhandenen Grund ist ein No-Op — ein FREMDER, inzwischen gesetzter Grund bleibt unberührt', () => {
    const stand = mitGrund(leer(), 'kommentare');
    const ergebnis = ohneGrund(stand, 'zwischenkarte');
    expect(ergebnis.has('kommentare')).toBe(true);
    expect(ergebnis).toBe(stand); // No-Op: dieselbe Referenz, kein neues Set.
  });

  // Final-Review Phase-5-Nachbesserung: ohneGruende nimmt mehrere Gründe auf
  // einmal zurück — genau das, was ein echter Indexwechsel (Tipp-Navigation,
  // automatischer Vorschub) braucht, damit weder 'halten' noch 'neuversuch'
  // vom VERLASSENEN Moment auf den NEUEN übergehen (siehe player.tsx,
  // MOMENTWECHSEL_GRUENDE).
  test('ohneGruende nimmt mehrere Gründe auf einmal zurück, andere Gründe bleiben unberührt', () => {
    let stand = mitGrund(leer(), 'halten');
    stand = mitGrund(stand, 'neuversuch');
    stand = mitGrund(stand, 'kommentare');
    const ergebnis = ohneGruende(stand, ['halten', 'neuversuch']);
    expect(ergebnis.has('halten')).toBe(false);
    expect(ergebnis.has('neuversuch')).toBe(false);
    expect(ergebnis.has('kommentare')).toBe(true);
  });

  // Dieselbe No-Op-Pointe wie bei ohneGrund, jetzt für mehrere Gründe auf
  // einmal: sind ALLE übergebenen Gründe bereits abwesend, liefert
  // ohneGruende dieselbe Referenz zurück — kein unnötiger Re-Render, wenn
  // z.B. weiterAutomatisch aufgerufen wird, obwohl 'halten'/'neuversuch'
  // ohnehin schon leer sind (der Normalfall über den Auto-Vorschub-Timer).
  test('ohneGruende ist ein No-Op (dieselbe Referenz), wenn KEINER der übergebenen Gründe vorhanden ist', () => {
    const stand = mitGrund(leer(), 'kommentare');
    const ergebnis = ohneGruende(stand, ['halten', 'neuversuch']);
    expect(ergebnis.has('kommentare')).toBe(true);
    expect(ergebnis).toBe(stand);
  });

  // Regression, die den Final-Review-Fund exakt nachbildet: 'neuversuch'
  // allein (kein 'halten') muss ebenfalls zurückgenommen werden — ein
  // Mutant, der ohneGruende nur auf den ERSTEN Grund der Liste anwendet,
  // fiele hier durch.
  test('ohneGruende nimmt auch einen NUR teilweise vorhandenen Grund zurück (nur "neuversuch", kein "halten")', () => {
    const stand = mitGrund(leer(), 'neuversuch');
    const ergebnis = ohneGruende(stand, ['halten', 'neuversuch']);
    expect(ergebnis.size).toBe(0);
  });

  test('blockiertAutomatischenVorschub ist false, wenn kein Grund gesetzt ist', () => {
    expect(blockiertAutomatischenVorschub(leer())).toBe(false);
  });

  // Vertrag 4, Kernfall (Repro aus dem Final-Review, Punkt 1): ein playToEnd
  // während einer Halten-Geste MUSS durchgelassen werden.
  test('blockiertAutomatischenVorschub ist false, wenn NUR "halten" gesetzt ist', () => {
    expect(blockiertAutomatischenVorschub(mitGrund(leer(), 'halten'))).toBe(false);
  });

  test('blockiertAutomatischenVorschub ist true, wenn die Zwischenkarte steht', () => {
    expect(blockiertAutomatischenVorschub(mitGrund(leer(), 'zwischenkarte'))).toBe(true);
  });

  test('blockiertAutomatischenVorschub ist true, wenn das Kommentar-Sheet offen ist', () => {
    expect(blockiertAutomatischenVorschub(mitGrund(leer(), 'kommentare'))).toBe(true);
  });

  test('blockiertAutomatischenVorschub ist true, wenn ein stiller Neuversuch läuft', () => {
    expect(blockiertAutomatischenVorschub(mitGrund(leer(), 'neuversuch'))).toBe(true);
  });

  // Task 8, Phase 6: 'melden' blockiert genau wie 'kommentare' — ein
  // offenes «Diesen Moment melden»-Sheet darf den Player nicht
  // weiterschalten lassen.
  test('blockiertAutomatischenVorschub ist true, wenn das Melden-Sheet offen ist', () => {
    expect(blockiertAutomatischenVorschub(mitGrund(leer(), 'melden'))).toBe(true);
  });

  // "halten" zusammen mit einem blockierenden Grund bleibt blockierend — die
  // Ausnahme gilt nur, wenn "halten" der EINZIGE Grund ist.
  test('blockiertAutomatischenVorschub bleibt true, wenn "halten" UND ein weiterer Grund gesetzt sind', () => {
    const stand = mitGrund(mitGrund(leer(), 'halten'), 'kommentare');
    expect(blockiertAutomatischenVorschub(stand)).toBe(true);
  });
});
