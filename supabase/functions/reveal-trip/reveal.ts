// Die gesamte Entscheidungs- und Versandlogik von reveal-trip, herausgelöst
// aus Deno.serve — Reaktion auf den Final-Review-Befund, dass diese Function
// null automatisierte Tests hatte (push_test.ts deckt nur push.ts isoliert
// ab). reveal-trip ist der einzige Weg, auf dem eine Reise je ihren Status
// wechselt, unumkehrbar, und öffnet in einem Schlag alle Momente für alle
// Mitglieder — das ist der sicherste Code der App neben media-urls/lesen.
//
// Stil wie media-urls/lesenZugriff.ts und ../reveal-trip/push.ts: I/O steckt
// hinter einer schmalen, injizierbaren Schnittstelle (`RevealStore`,
// `SendeFn`), die eigentliche Entscheidung ist eine reine Funktion darüber.
// index.ts implementiert `RevealStore` als dünne, 1:1-Weiterleitung an
// supabaseAdmin (dieselben Abfragen wie in der Vorfassung, nur hierher
// verschoben) und ruft `fuehreRevealAus` nur noch auf.
//
// Was das für Tests bedeutet: reveal_test.ts prüft `fuehreRevealAus` und
// `versendeRevealPush` mit einem Fake-Store — kein Docker, kein Netz, läuft
// auf jeder Maschine. Das deckt die komplette VERZWEIGUNGSLOGIK ab: Owner-
// Check, idempotente Antwort, Archiv-Konflikt, Push nur im Gewinner-Zweig
// (nie im Verlierer-Zweig — genau der Fund, der in f26437a einmal schon
// behoben wurde), Ausschluss der auslösenden Person aus den Empfängern,
// und dass ein scheiternder Push den bereits vollzogenen Statuswechsel nicht
// mehr zurücknimmt. Was eine reine Funktion NICHT abdecken kann — dass die
// CAS-Bedingung (`status = 'active'`) in der ECHTEN Postgres-Abfrage steht
// und zwei wirklich parallele Aufrufe tatsächlich nur einen Gewinner
// erzeugen — deckt reveal_integration_test.ts gegen den echten Stack ab.

import type { PushNachricht } from './push.ts';
import type { MeldeFn } from '../_shared/fehlermelder.ts';

// Ohne übergebenen Melder ein No-Op — Tests, die `fuehreRevealAus` mit den
// bisherigen vier Argumenten aufrufen (reveal_test.ts), bleiben dadurch
// unverändert lauffähig; index.ts übergibt den echten, aus SENTRY_DSN
// gebauten Melder als fünftes Argument (Stil wie `sendeFn`).
const KEIN_MELDER: MeldeFn = async () => {};

export type TripStatus = 'active' | 'revealed' | 'archived';

export type TripZeile = {
  id: string;
  name: string;
  owner_id: string;
  status: TripStatus;
  revealed_at: string | null;
};

// Ergebnis einer Store-Operation im Supabase-Stil (data/error), damit sich
// index.ts' Adapter fast wortgleich aus der Vorfassung übernehmen lässt —
// weniger Umformung heisst weniger Gelegenheit, beim Verschieben
// Verhalten zu ändern.
type StoreErgebnis<T> = { data: T | null; error: unknown };

export interface RevealStore {
  holeTrip(tripId: string): Promise<StoreErgebnis<TripZeile>>;

  // Der CAS-Update: setzt status/revealed_at NUR, wenn status aktuell
  // 'active' ist. data === null bedeutet "0 Zeilen betroffen" — ein
  // paralleler Aufruf hat gewonnen, nicht dieser. Die Bedingung
  // `.eq('status','active')` steht in der Adapter-Implementierung (echte
  // Postgres-Abfrage) — sie ist der Teil, den nur ein Integrationstest gegen
  // echtes Postgres beweisen kann, siehe Kopfkommentar.
  aktualisiereWennAktiv(tripId: string): Promise<StoreErgebnis<{ revealed_at: string }>>;

  // Nachlesen nach einem verlorenen CAS-Rennen: die Reise IST inzwischen
  // revealed (ein anderer Aufruf hat gewonnen), wir lesen nur den
  // Zeitstempel nach.
  holeRevealedAtNachlese(tripId: string): Promise<StoreErgebnis<{ revealed_at: string | null }>>;

  // ALLE Mitglieder einer Reise, EINSCHLIESSLICH der auslösenden Person.
  // Bewusst ohne `.neq('user_id', ausloesendeId)` in der Abfrage: der
  // Ausschluss passiert in `versendeRevealPush` (reine JS-Filterung), damit
  // er unit-testbar ist, statt nur in einer SQL-Klausel zu stehen, die kein
  // Test ohne Docker erreicht.
  holeMitglieder(tripId: string): Promise<StoreErgebnis<{ user_id: string }[]>>;

  holeTokens(userIds: string[]): Promise<StoreErgebnis<{ token: string }[]>>;

  // tokens: von Expo als "DeviceNotRegistered" gemeldete Tokens.
  // userIds: zusätzliche Einschränkung auf den gerade angeschriebenen
  // Empfängerkreis (Review-Minor, siehe Kommentar in versendeRevealPush) —
  // beide Parameter kommen bereits korrekt eingeschränkt aus der reinen
  // Orchestrierung, der Adapter muss sie nur noch 1:1 in die Abfrage
  // übernehmen.
  loescheTokens(tokens: string[], userIds: string[]): Promise<{ error: unknown }>;
}

// Signatur wie `sende` aus push.ts, aber ohne dessen eigenes `fetchImpl`-
// Argument — die Injektion passiert hier eine Ebene höher, index.ts übergibt
// standardmässig die echte `sende`-Funktion (die ihrerseits das echte
// globale `fetch` benutzt).
export type SendeFn = (nachrichten: PushNachricht[]) => Promise<string[]>;

// Schickt die Reveal-Benachrichtigung an alle Mitglieder der Reise ausser der
// auslösenden Person und löscht Tokens, die Expo als abgemeldet meldet.
//
// WICHTIG: `fuehreRevealAus` ruft das NUR im Gewinner-Zweig des CAS-Updates
// auf. Ein paralleler Aufruf, der den Statuswechsel selbst nicht ausgelöst
// hat (0 betroffene Zeilen, Nachlese-Zweig), darf den Push nicht ein zweites
// Mal verschicken — genau dieser Doppel-Versand war ein Review-Fund an einer
// früheren Fassung dieser Function (f26437a) und ist jetzt durch
// reveal_test.ts mit einem echten Zwei-Aufrufe-Rennen gegen einen
// gemeinsamen Fake-Store belegt, nicht nur durch Code-Lesen.
export async function versendeRevealPush(
  store: RevealStore,
  sendeFn: SendeFn,
  trip: TripZeile,
  ausloesendeId: string,
): Promise<void> {
  const { data: mitglieder, error: mitgliederError } = await store.holeMitglieder(trip.id);
  if (mitgliederError) {
    console.error('reveal-trip: trip_members-Select fehlgeschlagen', mitgliederError);
    return;
  }

  // Die auslösende Person bekommt ihren eigenen Reveal nicht gepusht — sie
  // weiss es bereits, sie hat gerade selbst auf "Reise abschliessen"
  // getippt. Vorher eine `.neq('user_id', ausloesendeId)`-Klausel in der
  // SQL-Abfrage selbst, jetzt dieselbe Menge als reine JS-Filterung, damit
  // reveal_test.ts sie ohne Docker prüfen kann.
  const empfaengerIds = (mitglieder ?? [])
    .map((m) => m.user_id)
    .filter((userId) => userId !== ausloesendeId);
  if (empfaengerIds.length === 0) return;

  const { data: tokenZeilen, error: tokenError } = await store.holeTokens(empfaengerIds);
  if (tokenError) {
    console.error('reveal-trip: push_tokens-Select fehlgeschlagen', tokenError);
    return;
  }
  const tokens = tokenZeilen ?? [];
  if (tokens.length === 0) return;

  const nachrichten: PushNachricht[] = tokens.map((t) => ({
    to: t.token,
    title: `✈️ Euer Recap von «${trip.name}» ist bereit!`,
    body: `✈️ Euer Recap von «${trip.name}» ist bereit!`,
    data: { trip_id: trip.id },
  }));

  const tote = await sendeFn(nachrichten);
  if (tote.length === 0) return;

  // Zusätzlich auf `empfaengerIds` eingeschränkt (Review-Minor): die
  // Ticket->Token-Zuordnung in push.ts ist rein positionsbasiert (Ticket i
  // gehört zu Nachricht i). Käme von Expo je ein versetzter `data`-Block
  // zurück, dürfte ein fälschlich als DeviceNotRegistered gelesenes Token
  // NIE ausserhalb des gerade angeschriebenen Empfängerkreises löschen —
  // die Einschränkung begrenzt den Schaden auf genau diesen Kreis, statt
  // als Service-Role über die ganze Tabelle zu laufen.
  const { error: deleteError } = await store.loescheTokens(tote, empfaengerIds);
  if (deleteError) {
    console.error('reveal-trip: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
  }
}

export type RevealErgebnis = { status: number; body: Record<string, unknown> };

// Die komplette Entscheidungskette von reveal-trip ab der geladenen
// Trip-Zeile: Owner-Check → idempotent (schon revealed) → Archiv-Konflikt →
// CAS-Update → Push nur im Gewinner-Zweig → Nachlesen im Verlierer-Zweig.
// Wortgleich zur Vorfassung in Deno.serve (Fehlertexte, Status-Codes,
// Reihenfolge, welcher Zweig den Push auslöst) — index.ts ruft das nur noch
// auf und übersetzt das Ergebnis in eine Response.
// `melde` ist das fünfte, optionale Argument (Stil wie `sendeFn`): index.ts
// übergibt den echten, aus SENTRY_DSN gebauten Melder, Tests lassen es weg
// (KEIN_MELDER) oder injizieren einen eigenen Fake, um zu belegen, DASS er an
// den drei folgenden Stellen wirklich aufgerufen wird — nicht nur, dass ein
// Melder existiert (siehe Punkt 2 des Abschluss-Reviews: "ein Fehler-Melder,
// der keinen Aufrufer hat, ist wertlos"). Absichtlich NICHT in
// `versendeRevealPush` verdrahtet: Ein Netzfehler gegen Expo, ein kaputtes
// Ticket oder eine leere Empfängerliste sind dort laut Kommentar dort bereits
// bewusst tolerierte, nicht-kritische Ausgänge — dieselbe Function würde sich
// selbst widersprechen, meldete sie an Sentry, was sie im nächsten Atemzug als
// "darf den Reveal nicht scheitern lassen" einstuft.
export async function fuehreRevealAus(
  store: RevealStore,
  sendeFn: SendeFn,
  tripId: string,
  anfragendeId: string,
  melde: MeldeFn = KEIN_MELDER,
): Promise<RevealErgebnis> {
  const { data: trip, error: tripError } = await store.holeTrip(tripId);
  if (tripError) {
    console.error('reveal-trip: trips-Select fehlgeschlagen', tripError);
    await melde(tripError, { trip_id: tripId });
    return { status: 500, body: { fehler: 'Reise konnte nicht geladen werden.' } };
  }
  if (!trip) {
    return { status: 404, body: { fehler: 'Reise nicht gefunden.' } };
  }

  if (trip.owner_id !== anfragendeId) {
    return { status: 403, body: { fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' } };
  }

  // Idempotent: ein zweiter Tipp auf «Reise abschliessen» (z. B. weil das
  // Netz beim ersten Mal wackelte) ist kein Fehler — die App bekommt
  // denselben revealed_at-Wert wie beim ersten erfolgreichen Aufruf. Dieser
  // Zweig erreicht das CAS-Update gar nicht erst, also auch keinen zweiten
  // Push — nur für einen SEQUENZIELLEN zweiten Aufruf, nachdem die erste
  // Antwort schon zurück war. Das echte Wettrennen (zwei Aufrufe, die BEIDE
  // status==='active' lesen, bevor einer committet) durchläuft stattdessen
  // den CAS-Zweig unten, Gewinner und Verlierer unterschieden am
  // Update-Ergebnis.
  if (trip.status === 'revealed') {
    return { status: 200, body: { ok: true, revealed_at: trip.revealed_at } };
  }
  if (trip.status === 'archived') {
    return { status: 409, body: { fehler: 'Diese Reise ist schon archiviert.' } };
  }

  // status === 'active': einziger Statuswechsel, atomar über die CAS-
  // Bedingung im Adapter (`.eq('status','active')` bei der echten
  // Postgres-Abfrage — siehe RevealStore-Kommentar).
  const { data: aktualisiert, error: updateError } = await store.aktualisiereWennAktiv(tripId);
  if (updateError) {
    console.error('reveal-trip: trips-Update fehlgeschlagen', updateError);
    await melde(updateError, { trip_id: tripId, user_id: anfragendeId });
    return { status: 500, body: { fehler: 'Reise konnte nicht abgeschlossen werden.' } };
  }

  let revealedAt: string | null;
  if (aktualisiert) {
    // Wir haben den Statuswechsel ausgelöst — und nur deshalb auch den Push.
    // Der Versand steht bewusst INNERHALB dieses Zweigs: stünde er nach dem
    // if/else, würde auch der Verlierer eines Rennens (unten, 0 betroffene
    // Zeilen) ihn erneut auslösen und dieselbe Benachrichtigung ein zweites
    // Mal an alle Mitglieder verschicken, obwohl sein eigener Aufruf gar
    // nichts geändert hat.
    revealedAt = aktualisiert.revealed_at;

    // Der Statuswechsel ist die Wahrheit, die Benachrichtigung nur die
    // Botschaft: ein Netzfehler gegen Expo, ein kaputtes Ticket oder eine
    // leere Empfängerliste dürfen den Reveal nicht scheitern lassen — die
    // Antwort an die Owner-Person bleibt 200 mit dem bereits ermittelten
    // revealedAt, unabhängig vom Ausgang des Versands.
    try {
      await versendeRevealPush(store, sendeFn, trip, anfragendeId);
    } catch (err) {
      console.error('reveal-trip: Push-Versand fehlgeschlagen', err);
    }
  } else {
    // 0 betroffene Zeilen: ein paralleler Aufruf war schneller und hat den
    // Status bereits von 'active' auf 'revealed' gedreht (die CAS-Bedingung
    // griff dadurch nicht mehr). Das ist kein Fehler — die Reise IST jetzt
    // revealed, wir lesen nur nach, mit welchem Zeitstempel. KEIN Push hier:
    // der Gewinner-Zweig oben hat ihn bereits verschickt.
    const { data: nachgelesen, error: nachlesenError } = await store.holeRevealedAtNachlese(tripId);
    if (nachlesenError || !nachgelesen) {
      console.error('reveal-trip: Nachlesen nach paralellem Reveal fehlgeschlagen', nachlesenError);
      await melde(nachlesenError ?? new Error('reveal-trip: Nachlesen nach parallelem Reveal ohne Zeile.'), {
        trip_id: tripId,
      });
      return { status: 500, body: { fehler: 'Reise konnte nicht abgeschlossen werden.' } };
    }
    revealedAt = nachgelesen.revealed_at;
  }

  return { status: 200, body: { ok: true, revealed_at: revealedAt } };
}
