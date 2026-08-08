// Reine Zustandsmaschine des Story-Players: rein, netzfrei, kein React
// (Task-7-Brief). Der Screen aus Task 11 bedient nur noch diese Funktionen,
// alle Entscheidungen (welcher Moment als nächstes, wann ein Tag beginnt,
// wie lange ein Moment steht) sind hier und damit ohne laufenden Stack
// testbar.
import type { RecapMoment } from './types';
import { gruppiereNachTagen } from './tage';

export type PlayerStand = { index: number; pausiert: boolean; fortschritt: number };

// Anzeigedauer eines Fotos, bevor der Player automatisch weiterspringt.
export const FOTO_DAUER_MS = 5000;

// Die Check-Constraint posts_duration_s_check (Migration
// 20260803090600_role_hardening.sql) verlangt seit ihrer Verschärfung für
// jede Video-Zeile `duration_s is not null and duration_s between 0 and 30`
// — ein Video ohne Dauer ist für neue Zeilen in dieser Datenbank also gar
// nicht mehr erzeugbar. Der Fallback hier ist trotzdem kein toter Code,
// sondern reine Verteidigung gegen Daten, auf die sich diese Garantie nicht
// verlassen kann: eine ältere Zeile von vor der Migration, ein fremder
// Client, ein direkter DB-Zugriff ausserhalb der App. RecapMoment.duration_s
// bleibt `number | null` (die Spalte selbst ist weiterhin nullable, nur für
// `type = 'video'` zusätzlich eingeschränkt) — dauerFuer muss den Fall also
// weiterhin typsicher behandeln.
//
// Review-Fund: 30 s statt der ursprünglichen 15 s, weil die Constraint
// Videos bis zu 30 s zulässt — ein Fallback, der kürzer ist als das
// zulässige Maximum, würde ein legales, aber (in diesem Verteidigungsfall)
// dauer-loses Video vorzeitig mitten im Bild abschneiden. 30 s ist der
// einzige Wert, der das nie tut.
export const VIDEO_DAUER_FALLBACK_MS = 30_000;

// Ein Boden für sehr kurze/kaputte duration_s-Werte (0 oder nahe 0 ist laut
// Constraint technisch gültig): ohne Boden würde der Fortschrittsbalken für
// einen solchen Moment praktisch augenblicklich füllen und der Player
// spränge weiter, bevor irgendjemand das Bild überhaupt wahrgenommen hat —
// der Moment wäre faktisch unsichtbar. Eine Sekunde ist kurz genug, um kein
// echtes Video merklich zu verlängern, aber lang genug, um real sichtbar zu
// sein.
export const VIDEO_DAUER_MIN_MS = 1000;

export function dauerFuer(m: RecapMoment): number {
  if (m.type === 'photo') return FOTO_DAUER_MS;
  if (m.duration_s === null) return VIDEO_DAUER_FALLBACK_MS;
  return Math.max(VIDEO_DAUER_MIN_MS, m.duration_s * 1000);
}

// Ein Moment weiter. `pausiert` bleibt unangetastet (weiter/zurueck
// entscheiden nicht über Pause — das ist eine eigene, vom Screen gesteuerte
// Geste, siehe Task 11 «Halten = Pause»), `fortschritt` beginnt beim neuen
// Moment immer bei 0. Am letzten Moment (und bei einer leeren Liste: dort
// ist index + 1 = 1 >= 0 = anzahl, der Vergleich greift ohne Sonderfall)
// liefert die Funktion 'ende', NIE den Index `anzahl` — es gibt an dieser
// Stelle keinen Moment mehr, den ein Aufrufer als "aktuell" behandeln könnte.
//
// Vertrag für Task 11 (Review-Fund): "pausiert bleibt unangetastet" gilt nur
// für eine GESTE (der Screen ruft weiter()/zurueck() als Reaktion auf ein
// Tippen auf, während der Zustand von `pausiert` unverändert weiterlebt).
// Bei einem PROGRAMMATISCHEN Weiterschalten — Video zu Ende, URL-Erneuerung
// nach 403 (V10), eine übersprungene Tages-Zwischenkarte — bedeutet ein
// weiterhin `pausiert: true` aus einem GANZ ANDEREN Grund (z.B. weil der
// Moment davor per Halten pausiert war) einen Player, der lautlos stehen
// bleibt. Für diese Aufrufe muss Task 11 selbst `pausiert: false` im
// zurückgegebenen Stand setzen, weiter() tut das nicht automatisch.
export function weiter(stand: PlayerStand, anzahl: number): PlayerStand | 'ende' {
  const naechsterIndex = stand.index + 1;
  if (naechsterIndex >= anzahl) return 'ende';
  return { ...stand, index: naechsterIndex, fortschritt: 0 };
}

// Ein Moment zurück. fortschritt geht IMMER auf 0 — auch mitten in einem
// Video zurückgetippt, beginnt der (nun vorherige) Moment von vorn, nie an
// der Stelle, an der man ihn verlassen hatte. Am ersten Moment (index 0)
// bleibt der Index bei 0: ein "zurueck" darf nie vor den Anfang der Filmrolle
// hinaus- oder in einen vorherigen Tag hineinspringen (Brief) — es setzt nur
// den Fortschritt des ersten Moments zurück.
export function zurueck(stand: PlayerStand): PlayerStand {
  return { ...stand, index: Math.max(0, stand.index - 1), fortschritt: 0 };
}

// Tagesnummern für eine `momente`-Liste, gecacht über die Array-REFERENZ
// (nicht den Inhalt). Review-Fund, Important 5: tagWechselt wird vom Player
// einmal pro Momentwechsel aufgerufen — ohne Cache baute jeder einzelne
// Aufruf über gruppiereNachTagen für JEDEN Moment ein frisches
// Intl.DateTimeFormat neu auf (tage.ts, lokalesDatum), macht den gesamten
// Recap-Durchlauf also O(n²) auf genau dem Thread, der den Übergang
// animiert — auf Hermes ist Intl-Konstruktion mit die teuerste verfügbare
// Operation.
//
// WeakMap statt eines einzelnen "letzter Aufruf"-Slots: mehrere gleichzeitig
// offene Recaps (oder ein Wechsel zwischen zwei `momente`-Listen) würden
// einen einzelnen Cache-Slot ständig invalidieren und den Vorteil zunichte
// machen; die WeakMap hält pro tatsächlich verwendeter Liste ihren eigenen
// Eintrag und gibt ihn automatisch frei, sobald die Liste selbst nirgends
// mehr referenziert wird (kein manuelles Aufräumen nötig). Die Cache-Treffer
// setzen voraus, dass `momente` unveränderlich behandelt wird (derselbe
// Aufruf mit denselben Objekten liefert dieselbe Referenz) — genau das Muster,
// das dieser Codebase ohnehin entspricht (sortiereMomente/gruppiereNachTagen
// selbst mutieren nie in place, sondern liefern neue Arrays). Verändert sich
// die Filmrolle (Nachzügler-Upload, andere Reise), ist es zwangsläufig eine
// NEUE Array-Referenz — der Cache verfehlt dann korrekt und rechnet neu,
// nie mit veralteten Tagesnummern.
const tageNummernCache = new WeakMap<RecapMoment[], Map<string, Map<string, number>>>();

function tagesnummernProId(momente: RecapMoment[], startDate: string): Map<string, number> {
  let proStartDate = tageNummernCache.get(momente);
  if (!proStartDate) {
    proStartDate = new Map();
    tageNummernCache.set(momente, proStartDate);
  }
  let tageNummer = proStartDate.get(startDate);
  if (!tageNummer) {
    tageNummer = new Map<string, number>();
    for (const tag of gruppiereNachTagen(momente, startDate)) {
      for (const moment of tag.momente) tageNummer.set(moment.id, tag.nummer);
    }
    proStartDate.set(startDate, tageNummer);
  }
  return tageNummer;
}

// true genau beim allerersten Moment überhaupt (index 0) und immer dann,
// wenn der Moment an `index` einem anderen Reisetag angehört als der Moment
// direkt davor. Die Tageszuordnung kommt bewusst aus gruppiereNachTagen
// (Brief: "Benutz gruppiereNachTagen, statt die Logik nachzubauen") statt
// aus einer eigenen, isolierten Berechnung pro Moment — die Tagesnummer
// eines Moments hängt von den Momenten VOR ihm ab (monotones Fortschreiben
// bei einem Zeitzonensprung, siehe tage.ts), sie lässt sich für einen
// einzelnen Moment gar nicht isoliert bestimmen.
//
// Die Zuordnung läuft über `id`, nicht über die Position im von
// gruppiereNachTagen zurückgegebenen (gruppierten, ggf. um kaputte Momente
// verkürzten) Ergebnis: gruppiereNachTagen lässt einen Moment mit
// unbrauchbarem captured_at/captured_tz aus (tage.ts, Review-Fund Important
// 2) — dessen Position im Ergebnis würde dann nicht mehr mit `index` in der
// hier übergebenen `momente`-Liste übereinstimmen.
//
// Review-Fund, Important 4 (korrigiert): fehlt EINER der beiden Nachbarn in
// der Map (weil er verworfen wurde), gilt das als "kein Wechsel" (false),
// NICHT als Wechsel. Die erste Fassung verglich `undefined !== echteZahl`
// und wertete das als Wechsel — für [a, kaputt, b], alle real am selben Tag,
// entstanden dadurch ZWEI falsche Zwischenkarten (an kaputts Position UND an
// b's Position direkt danach), die dem gleichen Tag zweimal ankündigten.
// Bewusster Kompromiss: ein wirklicher Tageswechsel, dessen einziger Zeuge
// der direkt benachbarte, aber verworfene Moment gewesen wäre, wird dadurch
// NICHT angezeigt (an keiner der beiden Nachbarpositionen) — das ist die
// sicherere Richtung, weil ein verworfener Moment laut tage.ts ohnehin schon
// "höchstens sich selbst" kosten soll, nicht die Anzeige seiner intakten
// Nachbarn verfälschen.
export function tagWechselt(momente: RecapMoment[], startDate: string, index: number): boolean {
  if (index < 0 || index >= momente.length) return false;
  if (index === 0) return true;

  const tageNummer = tagesnummernProId(momente, startDate);
  const aktuell = tageNummer.get(momente[index].id);
  const vorherig = tageNummer.get(momente[index - 1].id);
  if (aktuell === undefined || vorherig === undefined) return false;
  return aktuell !== vorherig;
}
