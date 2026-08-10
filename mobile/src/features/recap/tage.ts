// Reine Kernlogik des Recaps: sortieren, nach Ortstagen gruppieren, den Ort
// eines Tages bestimmen. Kein Netz, kein React, deshalb ohne laufenden
// Stack vollständig testbar (Task-5-Brief).
//
// Zeitzonen-Entscheidung (Brief lässt sie bewusst offen, hier begründet):
// Die Tagesgrenze richtet sich strikt nach captured_tz DES MOMENTS, nie nach
// der Zeitzone des Geräts, das den Recap gerade anschaut, es gibt deshalb
// unten auch gar keinen Parameter für eine "Betrachter-Zeitzone". Für zwei
// Momente, die am selben Ortstag in verschiedenen Zeitzonen entstanden sind
// (Gruppe überquert eine Zeitzonengrenze), ist die TagesNUMMER die einzige
// Klammer, die zählt: jeder Moment bekommt seine Nummer unabhängig aus dem
// eigenen lokalen Kalendertag berechnet, und `RecapTag.datum` wird NICHT vom
// captured_tz irgendeines Moments abgeleitet, sondern rein arithmetisch aus
// start_date + (nummer - 1) Tagen. Zwei Momente mit unterschiedlichem
// captured_tz landen deshalb automatisch im selben RecapTag, sobald ihre
// jeweils eigenen Ortstage auf dieselbe Tagesnummer fallen, es gibt keinen
// zusätzlichen Gruppierungsschlüssel (etwa "captured_tz + Datum"), der sie
// künstlich auseinanderreissen könnte. Ein ECHTER Ortstag-Wechsel (z.B. ein
// Nachtflug, der Kalendertag am Zielort ist lokal ein anderer) bleibt davon
// unberührt ein Tageswechsel, das ist keine Willkür, sondern die reale
// Ortszeit am jeweiligen Ort.
//
// Nachtrag (Review-Fund, Important 1): die reine Zugehörigkeit («welcher Tag»)
// war damit schon richtig, die REIHENFOLGE der Tage untereinander aber nicht
// zwingend, der eigene lokale Kalendertag eines Moments kann bei einem
// Ostwärts-Zeitsprung (z.B. Tokio → Los Angeles) chronologisch RÜCKWÄRTS
// laufen, weil die Zielzone der Ausgangszone weit hinterherhinkt. Ohne
// Korrektur würde die spätere Ankunft unter einer kleineren Tagesnummer als
// der frühere Abflug erscheinen, für einen Recap, dessen ganzer Zweck
// Chronologie ist (CLAUDE.md-Eckpfeiler), ist das falsch. gruppiereNachTagen
// geht deshalb die chronologisch sortierten Momente der Reihe nach durch und
// schreibt die höchste bisher vergebene Tagesnummer monoton fort: die
// tatsächlich vergebene Nummer eines Moments ist das Maximum aus seinem
// EIGENEN lokalen Kalendertag und dieser laufenden Nummer. Ein Moment, dessen
// eigener Kalendertag rückwärts läuft, rutscht dadurch in den bereits
// laufenden (höheren) Tag statt einen vorherigen, bereits abgeschlossenen Tag
// wiederzueröffnen, chronologisch später bedeutet dadurch immer auch:
// gleiche oder höhere Tagesnummer, nie eine kleinere.
//
// Nebenwirkung (Review-Fund, korrigiert, die erste Fassung dieses Kommentars
// beschrieb die falsche Richtung): WESTWÄRTS ist harmlos. Eine Tagesnummer
// kann dort fehlen (z.B. L.A. abends → Tokio zwei Tage später ergibt Tag 1,
// Tag 3), aber nur, weil der übersprungene Tag WIRKLICH keine Momente hat,
// das war schon vor diesem Fix so und ist reine Anzeige-Kosmetik (ein Tag
// ohne Momente erscheint ohnehin nicht in der Liste).
//
// Die echte Nebenwirkung liegt OSTWÄRTS: der gerade laufende Tag "saugt" so
// lange weitere Momente auf, bis deren eigener lokaler Kalendertag ihn
// einholt, ein ganzer lokaler Kalendertag der nachhinkenden Zone (z.B. der
// gesamte 01.08. in Los Angeles, nachdem der 02.08. in Tokio bereits lief)
// bekommt dadurch KEINE eigene Tageskarte, sondern wird Teil des vorherigen
// Tages. Für einen so "verschluckten" Moment weicht `RecapTag.datum` damit
// von seinem EIGENEN lokalen Kalendertag ab (das Datum bleibt weiterhin rein
// arithmetisch aus start_date + (nummer - 1) abgeleitet, siehe datumFuerTag
// unten, es gehört jetzt einfach zu einer anderen Nummer, als der Moment
// alleine ergäbe). Vor diesem Fix galt ausnahmslos `datum` == lokales Datum
// jedes Moments der Gruppe; das gilt jetzt nicht mehr uneingeschränkt. Bewusst
// in Kauf genommen, die Alternative wäre, einen bereits abgeschlossenen Tag
// wiederzueröffnen (Important 1) und die Chronologie erneut zu brechen.
// Task 10/11 dürfen sich deshalb NICHT darauf verlassen, dass `datum` das
// Ortsdatum jedes einzelnen Moments der Gruppe ist, nur, dass es das Datum
// DES TAGES ist. Test: "bei einem verschluckten Ortstag kann RecapTag.datum
// vom eigenen lokalen Datum eines Moments abweichen".

import type { RecapMoment, RecapTag } from './types';

const MS_PRO_TAG = 86_400_000;

// Ein ungültiger/unparsbarer Zeitpunkt (siehe berechneRohTagesnummer weiter
// unten) bekommt hier bewusst "unendlich spät" statt NaN: NaN als
// Comparator-Ergebnis ist laut ECMA-262 keine gültige Sortier-Funktion mehr
// (Ergebnis implementierungsabhängig, die id-Rückfallebene würde nie
// greifen), Number.POSITIVE_INFINITY sortiert einen kaputten Zeitpunkt
// stattdessen deterministisch ans Ende, id entscheidet danach unter mehreren
// kaputten Zeitpunkten weiterhin stabil.
function zeitWert(capturedAt: string): number {
  const wert = Date.parse(capturedAt);
  return Number.isNaN(wert) ? Number.POSITIVE_INFINITY : wert;
}

// Sortierung IMMER nach captured_at aufsteigend (CLAUDE.md-Eckpfeiler), nie
// nach created_at (das RecapMoment gar nicht trägt), bei exakt gleichem
// Zeitpunkt entscheidet id als zweites, stabiles Kriterium, damit ein
// wiederholtes Sortieren immer dasselbe Ergebnis liefert. Der Vergleich läuft
// über die Zeitstempel-Millisekunden statt über einen Text-Vergleich der
// ISO-Strings: captured_at kann mit unterschiedlichem Offset-Format aus der
// Datenbank kommen, ein reiner String-Vergleich wäre dafür nicht verlässlich.
export function sortiereMomente(momente: RecapMoment[]): RecapMoment[] {
  return [...momente].sort((a, b) => {
    const av = zeitWert(a.captured_at);
    const bv = zeitWert(b.captured_at);
    // Bewusst über Vergleichsoperatoren statt Subtraktion (av - bv): sind
    // BEIDE Zeitpunkte kaputt, stehen beide auf Number.POSITIVE_INFINITY,
    // Infinity - Infinity ist NaN, und ein NaN-Comparator-Ergebnis wäre exakt
    // dieselbe undefinierte Sortierung, die zeitWert() oben gerade vermeiden
    // soll. < / > liefern für zwei gleiche Infinity-Werte sauber `false`,
    // die id-Rückfallebene greift dadurch auch zwischen zwei kaputten
    // Zeitpunkten zuverlässig.
    if (av !== bv) return av < bv ? -1 : 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function toUtcTag(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

function parseIsoDatum(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

// Lokales Kalenderdatum (Jahr, Monat, Tag) eines Zeitpunkts in EINER
// bestimmten Zeitzone.
//
// Bewusst über formatToParts() gelesen statt über format() + Text-Parsing
// eines Locale-Strings (Review-Fund, Important 3): die Vorfassung verliess
// sich darauf, dass die Locale 'en-CA' unter JEDER Intl-Implementierung
// exakt "YYYY-MM-DD" liefert. Das stimmt unter Node/Jest (volle ICU-Daten),
// ist aber für die App selbst NIE geprüft, Hermes baut sein
// Intl.DateTimeFormat auf iOS aus Foundation, nicht zwingend aus denselben
// ICU-Daten wie Node. Ein abweichendes Format hätte NICHT laut geworfen,
// sondern über parseIsoDatum(...) still zu NaN geführt (NaN < 0 ist immer
// false, das Vor-Start-Klemmen unten hätte also nie gegriffen), ein reiner
// Lokale-Formatvertrag ist damit ein stiller, nicht ein lauter Fehlerpfad.
// formatToParts() mit gezieltem Auslesen der Feldtypen 'year'/'month'/'day'
// ist von der gewählten Locale unabhängig (hier 'en-US' nur als neutrale,
// beliebige Wahl mit westlichen Ziffern) und schliesst diesen stillen Pfad.
function lokalesDatum(capturedAt: string, capturedTz: string): [number, number, number] {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: capturedTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(capturedAt));
  const wert = (typ: string) => Number(teile.find((t) => t.type === typ)?.value);
  return [wert('year'), wert('month'), wert('day')];
}

// Der eigene, unveränderte lokale Kalendertag eines Moments als Tagesnummer
// (kann <= 0 sein, wenn der Moment vor start_date liegt, das Klemmen auf
// Tag 1 UND das monotone Fortschreiben passieren erst in gruppiereNachTagen,
// wo beide Regeln ohnehin zusammenlaufen müssen).
//
// Liefert `null` statt zu werfen, wenn captured_tz keine gültige IANA-Zone
// ist oder captured_at nicht als Zeitpunkt parsbar ist (Review-Fund,
// Important 2): Intl.DateTimeFormat wirft in beiden Fällen einen RangeError,
// beim Konstruieren (ungültige Zone) bzw. beim Formatieren (Invalid Date).
// captured_tz hat keine CHECK-Constraint (nur `text not null`) und der
// INSERT-Spaltengrant lässt den Client den Wert frei setzen, ein fremder
// oder älterer Client, oder schlicht abweichende tzdata zwischen zwei
// Geräten desselben Recaps, sind hier kein Rand-, sondern ein Alltagsfall.
// Ein einzelner kaputter Moment darf höchstens sich selbst kosten (er bleibt
// ausserhalb jeder Tagesgruppe), nie den gesamten Recap zum Absturz bringen.
function berechneRohTagesnummer(moment: RecapMoment, startDate: string): number | null {
  try {
    const [ly, lm, ld] = lokalesDatum(moment.captured_at, moment.captured_tz);
    const [sy, sm, sd] = parseIsoDatum(startDate);
    const diffTage = Math.round((toUtcTag(ly, lm, ld) - toUtcTag(sy, sm, sd)) / MS_PRO_TAG);
    // Number.isFinite statt blindem Vertrauen (Review-Fund, Important 3 war
    // nur halb behoben): formatToParts() liefert auf manchen Intl-Teil-
    // implementierungen (Hermes/iOS historisch, siehe Kommentar in
    // mobile/src/app/(tabs)/aufnehmen/preview.tsx) 'year'/'month'/'day' NICHT
    // als eigene Parts, sondern alles als einen einzigen 'literal'-Part,
    // dann liefert teile.find(...)?.value undefined, Number(undefined) ist
    // NaN, und OHNE diesen Guard würde NaN + 1 als "gültige" Tagesnummer
    // zurückgegeben. Derselbe Guard fängt eine zweite, unabhängige NaN-Quelle
    // gleich mit ab: ein kaputtes/leeres startDate (parseIsoDatum('') → NaN).
    // Beide Quellen würfen hier NICHT (Math.round(NaN) ist NaN, kein Wurf),
    // die Prüfung muss deshalb explizit stehen, nicht im try/catch aufgehen.
    if (!Number.isFinite(diffTage)) {
      throw new RangeError('Tagesnummer liess sich nicht berechnen (kein auswertbares Kalenderdatum).');
    }
    return diffTage + 1;
  } catch (fehler) {
    console.error('[tage] Moment ohne verwertbaren Zeitpunkt/Zeitzone übersprungen', moment.id, fehler);
    return null;
  }
}

// Kanonisches Datum für eine Tagesnummer: start_date + (nummer - 1) Tage.
// Bewusst NICHT aus dem lokalen Datum irgendeines Moments dieses Tages
// abgeleitet (siehe Zeitzonen-Begründung oben), sonst müsste willkürlich
// gewählt werden, wessen captured_tz dafür massgeblich ist, sobald ein Tag
// mehrere Zeitzonen enthält.
function datumFuerTag(startDate: string, nummer: number): string {
  const [sy, sm, sd] = parseIsoDatum(startDate);
  const datum = new Date(toUtcTag(sy, sm, sd) + (nummer - 1) * MS_PRO_TAG);
  const y = datum.getUTCFullYear();
  const m = String(datum.getUTCMonth() + 1).padStart(2, '0');
  const d = String(datum.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function gruppiereNachTagen(momente: RecapMoment[], startDate: string): RecapTag[] {
  const sortiert = sortiereMomente(momente);
  const gruppen = new Map<number, RecapMoment[]>();
  // Läuft monoton mit (Review-Fund, Important 1, Begründung im Kommentarkopf
  // oben): die tatsächliche Tagesnummer eines Moments ist das Maximum aus
  // seinem eigenen lokalen Kalendertag und der bisher höchsten vergebenen
  // Nummer. Start bei 1 erledigt zugleich das Klemmen "vor dem Startdatum"
  // (ein negativer/nullwertiger roher Wert kann diese 1 nie unterschreiten).
  // Weil `sortiert` bereits chronologisch ist und die Nummer je Moment nur
  // gleich bleiben oder wachsen kann, entstehen die Gruppen zwangsläufig
  // schon in aufsteigender Reihenfolge, ein zusätzliches .sort() der
  // fertigen Gruppen wäre an dieser Stelle nur eine unbeweisbare Behauptung
  // über eine Invariante, die der Code hier stattdessen erzwingt.
  let laufendeNummer = 1;
  for (const moment of sortiert) {
    const roh = berechneRohTagesnummer(moment, startDate);
    // roh ist ab hier garantiert eine endliche Zahl (berechneRohTagesnummer
    // wirft NIE ein NaN weiter, siehe dortiger Number.isFinite-Guard), sonst
    // würde EIN kaputter Moment über Math.max(NaN, laufendeNummer) = NaN die
    // laufende Nummer für ALLE nachfolgenden Momente vergiften (Review-Fund):
    // ein einzelner kaputter Moment darf nur sich selbst kosten, nie die
    // Gruppierung der übrigen.
    if (roh === null) continue;
    const nummer = Math.max(roh, laufendeNummer);
    laufendeNummer = nummer;
    const bisherige = gruppen.get(nummer);
    if (bisherige) {
      bisherige.push(moment);
    } else {
      gruppen.set(nummer, [moment]);
    }
  }
  return [...gruppen.entries()].map(([nummer, momenteDesTages]) => ({
    nummer,
    datum: datumFuerTag(startDate, nummer),
    ort: ortDesTages(momenteDesTages),
    momente: momenteDesTages,
  }));
}

// Häufigster place_name; bei Gleichstand gewinnt der Ort des chronologisch
// frühesten Moments (nicht einfach der erste Treffer in der Eingabereihen-
// folge, die Funktion sortiert deshalb selbst, statt sich auf die
// Aufrufreihenfolge zu verlassen). Ein leerer String zählt wie null nicht
// mit (`!!ort` filtert beide gleich heraus).
export function ortDesTages(momente: RecapMoment[]): string | null {
  const orte = momente.map((m) => m.place_name).filter((ort): ort is string => !!ort);
  if (orte.length === 0) return null;

  const haeufigkeit = new Map<string, number>();
  for (const ort of orte) {
    haeufigkeit.set(ort, (haeufigkeit.get(ort) ?? 0) + 1);
  }
  const maxHaeufigkeit = Math.max(...haeufigkeit.values());
  const kandidaten = new Set(
    [...haeufigkeit.entries()].filter(([, anzahl]) => anzahl === maxHaeufigkeit).map(([ort]) => ort)
  );

  for (const moment of sortiereMomente(momente)) {
    if (moment.place_name && kandidaten.has(moment.place_name)) {
      return moment.place_name;
    }
  }
  // Unerreichbar: orte.length > 0 garantiert oben mindestens einen Treffer.
  return null;
}
