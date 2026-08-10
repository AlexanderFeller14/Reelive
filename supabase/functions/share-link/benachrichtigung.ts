import type { PushNachricht } from '../reveal-trip/push.ts';

// Was Mitreisende erfahren, wenn ihr Recap geteilt oder ein Link widerrufen
// wird, als reine Logik: kein I/O, kein Client, kein Netz. Muster wie
// reveal-trip/reveal.ts, aus demselben Grund, und der wiegt hier besonders
// schwer: der Empfängerkreis ist die eigentliche Zusicherung. Steht er nur in
// einer SQL-Klausel, prüft ihn kein Test, der ohne Docker läuft.
//
// ---------------------------------------------------------------------------
// Warum es diese Benachrichtigung gibt
// ---------------------------------------------------------------------------
// Ein Teilen-Link zeigt seit Phase 7 nicht nur die Momente, sondern auch die
// Orte, an denen sie entstanden sind, unbeschnitten (Spec-Entscheid R4). Bis
// hierher wusste davon nur die Owner-Person, die den Link erstellt hat. Alle
// anderen haben ihre Momente eingesendet, ohne je zu erfahren, dass sie jetzt
// hinter einer öffentlichen URL stehen.
//
// Die Push ist die eine Hälfte der Antwort, die flüchtige. Die andere, die
// nachlesbare, ist `public.recap_ist_geteilt` (Migration 20260810100000) und
// die Zeile, die der Reise-Screen daraus baut. Wer die Meldung wegwischt oder
// Push nie erlaubt hat, findet die Auskunft trotzdem.

export type TeilenEreignis = 'erstellt' | 'widerrufen';

// Die beiden Texte. Titel und Rumpf sind verschieden, anders als beim
// Reveal-Push (dort steht derselbe Satz zweimal): der Titel ist die Lage, der
// Rumpf sagt, was daraus folgt.
//
// `wer` ist der Anzeigename der Owner-Person, denn sie ist die einzige, die
// teilen oder widerrufen kann. «Mira hat euren Recap geteilt» beantwortet die
// erste Frage gleich mit, die eine solche Meldung auslöst. Fehlt der Name,
// bleibt der Satz stehen, nur ohne Person, statt eine Lücke zu zeigen.
//
// Kein Gedankenstrich (DESIGN-LANGUAGE §6), Ihr-Form wie beim Reveal-Push:
// die Meldung geht an die Gruppe, nicht an eine einzelne Person.
export function texteFuer(
  ereignis: TeilenEreignis,
  reiseName: string,
  wer: string | null,
): { title: string; body: string } {
  if (ereignis === 'erstellt') {
    return {
      title: 'Euer Recap ist geteilt',
      body: wer
        ? `${wer} hat euren Recap von «${reiseName}» geteilt. Wer den Link hat, sieht alle Momente samt ihren Orten.`
        : `Euer Recap von «${reiseName}» ist geteilt. Wer den Link hat, sieht alle Momente samt ihren Orten.`,
    };
  }
  return {
    title: 'Der geteilte Link gilt nicht mehr',
    body: wer
      ? `${wer} hat den Link zu «${reiseName}» widerrufen. Der Recap ist wieder nur für euch.`
      : `Der Link zu «${reiseName}» wurde widerrufen. Der Recap ist wieder nur für euch.`,
  };
}

// Wer die Meldung bekommt: alle Mitglieder ausser der auslösenden Person.
//
// Sie weiss es bereits, sie hat gerade selbst getippt, und eine Push für die
// eigene Handlung ist keine Auskunft, sondern ein Echo. Dieselbe Regel und
// dieselbe Begründung wie beim Reveal, und wie dort ausdrücklich als reine
// Filterung statt als `.neq(…)` in der Abfrage, damit ein Test sie erreicht.
export function empfaengerKreis(
  mitglieder: { user_id: string }[],
  ausloesendeId: string,
): string[] {
  return mitglieder.map((m) => m.user_id).filter((userId) => userId !== ausloesendeId);
}

export function baueNachrichten(
  tokens: { token: string }[],
  ereignis: TeilenEreignis,
  trip: { id: string; name: string },
  wer: string | null,
): PushNachricht[] {
  const { title, body } = texteFuer(ereignis, trip.name, wer);
  return tokens.map((t) => ({
    to: t.token,
    title,
    body,
    // Dasselbe Feld wie beim Reveal-Push, damit ein Tipp auf die Meldung in
    // derselben Weiche landet. `ereignis` steht daneben, falls die App später
    // unterscheiden will, wohin sie springt.
    data: { trip_id: trip.id, ereignis },
  }));
}

// Der Store-Ausschnitt, den der Versand braucht. Absichtlich kleiner als
// `ShareStore`: was hier steht, ist alles, was eine Benachrichtigung berührt,
// und ein Test muss nicht den ganzen Store nachbauen.
export interface BenachrichtigungsStore {
  holeMitglieder(tripId: string): Promise<{ data: { user_id: string }[] | null; error: unknown }>;
  holeTokens(userIds: string[]): Promise<{ data: { token: string }[] | null; error: unknown }>;
  loescheTokens(tokens: string[], userIds: string[]): Promise<{ error: unknown }>;
  holeAnzeigename(userId: string): Promise<{ data: string | null; error: unknown }>;
}

export type SendeFn = (nachrichten: PushNachricht[]) => Promise<string[]>;

// Schickt die Meldung und räumt Tokens weg, die Expo als abgemeldet meldet.
//
// Wirft nie und meldet nichts an Sentry: eine Push, die nicht ankommt, darf
// weder das Erstellen noch das Widerrufen scheitern lassen. Beim Widerruf
// wiegt das am schwersten, er ist der einzige Hebel, mit dem ein Link wieder
// aus der Welt kommt, und der darf an einem fremden Dienst nicht hängen.
// Dieselbe Haltung wie `versendeRevealPush`, samt der Entscheidung, den
// Fehler-Melder hier NICHT zu verdrahten.
export async function versendeTeilenPush(
  store: BenachrichtigungsStore,
  sendeFn: SendeFn,
  trip: { id: string; name: string },
  ausloesendeId: string,
  ereignis: TeilenEreignis,
): Promise<void> {
  const { data: mitglieder, error: mitgliederError } = await store.holeMitglieder(trip.id);
  if (mitgliederError) {
    console.error('share-link: trip_members-Select fehlgeschlagen', mitgliederError);
    return;
  }

  const empfaengerIds = empfaengerKreis(mitglieder ?? [], ausloesendeId);
  if (empfaengerIds.length === 0) return;

  const { data: tokenZeilen, error: tokenError } = await store.holeTokens(empfaengerIds);
  if (tokenError) {
    console.error('share-link: push_tokens-Select fehlgeschlagen', tokenError);
    return;
  }
  const tokens = tokenZeilen ?? [];
  if (tokens.length === 0) return;

  // Der Name wird erst hier geholt, nicht oben: gibt es niemanden zu
  // benachrichtigen, ist auch die Abfrage überflüssig. Ein Fehler dabei kostet
  // nur den Namen, nicht die Meldung.
  const { data: wer, error: nameError } = await store.holeAnzeigename(ausloesendeId);
  if (nameError) {
    console.error('share-link: profiles-Select für den Anzeigenamen fehlgeschlagen', nameError);
  }

  const tote = await sendeFn(baueNachrichten(tokens, ereignis, trip, wer ?? null));
  if (tote.length === 0) return;

  // Auf `empfaengerIds` eingeschränkt, aus demselben Grund wie beim Reveal:
  // die Ticket-zu-Token-Zuordnung in push.ts ist rein positionsbasiert. Käme
  // von Expo je ein versetzter Block zurück, dürfte ein fälschlich als
  // abgemeldet gelesenes Token NIE ausserhalb des gerade angeschriebenen
  // Kreises löschen.
  const { error: deleteError } = await store.loescheTokens(tote, empfaengerIds);
  if (deleteError) {
    console.error('share-link: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
  }
}
