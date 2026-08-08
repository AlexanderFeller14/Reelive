// Unit-Tests für die aus index.ts herausgelöste Prüfkette der Aktion `lesen`
// — laufen OHNE `supabase start` und OHNE ein zweites Terminal mit
// `functions serve`, im Gegensatz zu lesen_test.ts (das echte HTTP-Aufrufe
// gegen den laufenden Stack braucht und darum `ignore: !stackBereit` trägt).
// Genau das war der Kern-Befund des Final-Reviews: die einzige Absicherung
// von Versprechen V1 der Spec («vor dem Reveal liest niemand ein Medium,
// auch nicht die Autorin des Moments») war ausschliesslich über einen Test
// verfügbar, der auf einer Maschine ohne Docker kommentarlos übersprungen
// wird — «ignored», nicht «failed», in jeder Zusammenfassung nicht von
// bestanden zu unterscheiden. Diese Datei läuft immer, auf jeder Maschine,
// in jeder CI ohne Docker-Voraussetzung — `deno test` ohne --allow-net,
// --allow-run oder sonst eine Berechtigung.
//
// Deckt exakt dieselben sechs Fälle wie der "Belegt"-Kopfkommentar von
// lesen_test.ts (dort Fälle 1, 2, 3 plus die Archiv-Variante von 'lesen'
// selbst — Fälle 4/5 dort betreffen das Signieren/PUT/Blättern, das bleibt
// I/O und damit ausserhalb einer reinen Funktion).

import { assertEquals } from 'jsr:@std/assert';
import { beurteileLesezugriff, type LesePruefTrip } from './lesenZugriff.ts';

const MITGLIED = { user_id: '11111111-1111-4111-8111-111111111111' };

// --- Fall 1: vor dem Reveal keine URL, auch nicht für die Autorin ---------
Deno.test('lesen: aktive (versiegelte) Reise weist ab, auch wenn die anfragende Person Mitglied ist', () => {
  const trip: LesePruefTrip = { status: 'active' };
  assertEquals(beurteileLesezugriff(trip, MITGLIED), {
    erlaubt: false,
    nachricht: 'Diese Reise ist noch versiegelt.',
    status: 403,
  });
});

Deno.test('lesen: aktive Reise weist auch ein Nicht-Mitglied mit derselben Meldung ab', () => {
  const trip: LesePruefTrip = { status: 'active' };
  assertEquals(beurteileLesezugriff(trip, null), {
    erlaubt: false,
    nachricht: 'Diese Reise ist noch versiegelt.',
    status: 403,
  });
});

// --- Fall 2: unbekannte trip_id --------------------------------------------
Deno.test('lesen: keine Trip-Zeile (trip_id existiert nicht) liefert 404, unabhängig von der Mitgliedschaft', () => {
  assertEquals(beurteileLesezugriff(null, MITGLIED), {
    erlaubt: false,
    nachricht: 'Reise nicht gefunden.',
    status: 404,
  });
  assertEquals(beurteileLesezugriff(null, null), {
    erlaubt: false,
    nachricht: 'Reise nicht gefunden.',
    status: 404,
  });
});

// --- Fall 3: Nicht-Mitglied nach dem Reveal --------------------------------
Deno.test('lesen: revealed Reise weist ein Nicht-Mitglied ab', () => {
  const trip: LesePruefTrip = { status: 'revealed' };
  assertEquals(beurteileLesezugriff(trip, null), {
    erlaubt: false,
    nachricht: 'Kein Zugriff auf diese Reise.',
    status: 403,
  });
});

// --- Mitglied nach dem Reveal: erlaubt -------------------------------------
Deno.test('lesen: revealed Reise erlaubt einem Mitglied den Zugriff', () => {
  const trip: LesePruefTrip = { status: 'revealed' };
  assertEquals(beurteileLesezugriff(trip, MITGLIED), { erlaubt: true });
});

// --- Archiv bleibt lesbar ("weggelegt ist nicht zugesperrt") --------------
Deno.test('lesen: archivierte Reise erlaubt einem Mitglied weiterhin den Zugriff', () => {
  const trip: LesePruefTrip = { status: 'archived' };
  assertEquals(beurteileLesezugriff(trip, MITGLIED), { erlaubt: true });
});

Deno.test('lesen: archivierte Reise weist ein Nicht-Mitglied weiterhin ab', () => {
  const trip: LesePruefTrip = { status: 'archived' };
  assertEquals(beurteileLesezugriff(trip, null), {
    erlaubt: false,
    nachricht: 'Kein Zugriff auf diese Reise.',
    status: 403,
  });
});

// --- mitgliedschaft ist "unknown", nicht nur "{user_id} | null" -----------
// index.ts faltet einen mitgliedError ebenfalls auf null (siehe Kommentar in
// lesenZugriff.ts) — die Funktion selbst behandelt aber jeden falsy-Wert
// gleich, falls sich das Aufrufer-Mapping je ändert. undefined ist ein
// Grenzfall, der in index.ts nie vorkommt (die Variable wird immer auf
// `null` initialisiert), aber die Funktion darf dabei nicht crashen.
Deno.test('lesen: ein falsy, aber nicht null-wertiger Mitgliedschafts-Wert wird wie "kein Zugriff" behandelt', () => {
  const trip: LesePruefTrip = { status: 'revealed' };
  assertEquals(beurteileLesezugriff(trip, undefined), {
    erlaubt: false,
    nachricht: 'Kein Zugriff auf diese Reise.',
    status: 403,
  });
});
