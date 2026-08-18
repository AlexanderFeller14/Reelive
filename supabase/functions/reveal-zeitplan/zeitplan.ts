// Entscheidungslogik von reveal-zeitplan, dem zeitgesteuerten Gegenstück zum
// manuellen reveal-trip (Spec docs/superpowers/specs/2026-08-18-auto-reveal-design.md).
// Aufbau wie ../reveal-trip/reveal.ts: reine Funktionen über einer schmalen
// Store-Schnittstelle, I/O steckt in zeitplanStore.ts, der Handler in
// index.ts übersetzt nur HTTP.
//
// Der Kalendertag «heute» kommt als Parameter herein (berechnet in SQL vom
// Cron-Wrapper rufe_reveal_zeitplan, Europe/Zurich nach der DB-Uhr): die
// Logik hier besitzt bewusst KEINE eigene Uhr, das hält sie deterministisch
// testbar und die Fällig-Entscheidung an derselben Uhr wie revealed_at.
//
// Kein Owner-Check wie in fuehreRevealAus: den Abschluss löst der Kalender
// aus, nicht eine Person. Die Absicherung der Function übernimmt das
// Cron-Secret (pruefeZeitplanAnfrage), nicht ein JWT.
import {
  versendeRevealPush,
  type RevealStore,
  type SendeFn,
  type StoreErgebnis,
  type TripZeile,
} from '../reveal-trip/reveal.ts';
import type { PushNachricht } from '../reveal-trip/push.ts';
import type { MeldeFn } from '../_shared/fehlermelder.ts';

const KEIN_MELDER: MeldeFn = async () => {};

export type ZeitplanAufgabe = 'reveal' | 'erinnerung';
export type ZeitplanAnfrage = { aufgabe: ZeitplanAufgabe; heute: string };
export type ZeitplanErgebnis = { status: number; body: Record<string, unknown> };

export interface ZeitplanStore extends RevealStore {
  // status='active' und end_date < heute; die Bedingungen stehen als echte
  // Postgres-Abfrage im Adapter (zeitplanStore.ts), geprüft im
  // Integrationstest, hier zählt nur: was zurückkommt, ist fällig.
  holeFaelligeReisen(heute: string): Promise<StoreErgebnis<TripZeile[]>>;
  // status='active', end_date = heute, end_reminder_sent_at is null.
  holeErinnerungsReisen(heute: string): Promise<StoreErgebnis<TripZeile[]>>;
  // CAS auf den Marker (… where end_reminder_sent_at is null): null heisst
  // 0 Zeilen, ein anderer Lauf war schneller, kein zweiter Push.
  markiereErinnerung(tripId: string): Promise<StoreErgebnis<{ end_reminder_sent_at: string }>>;
}

const HEUTE_FORM = /^\d{4}-\d{2}-\d{2}$/;

// Die komplette Zulassungsprüfung des Handlers als reine Funktion, damit
// zeitplan_test.ts sie ohne Deno.serve prüfen kann. Reihenfolge: erst die
// Server-Konfiguration (500), dann das Secret (401), dann der Body (400);
// ein leeres konfiguriertes Secret darf NIE als «Header passt» durchgehen.
export function pruefeZeitplanAnfrage(
  geheimnisHeader: string | null,
  konfiguriertesGeheimnis: string,
  body: unknown,
): { ok: true; anfrage: ZeitplanAnfrage } | { ok: false; status: number; fehler: string } {
  if (!konfiguriertesGeheimnis) {
    return { ok: false, status: 500, fehler: 'Server nicht konfiguriert.' };
  }
  if (!geheimnisHeader || geheimnisHeader !== konfiguriertesGeheimnis) {
    return { ok: false, status: 401, fehler: 'Nicht berechtigt.' };
  }
  const b = (body ?? {}) as { aufgabe?: unknown; heute?: unknown };
  if (b.aufgabe !== 'reveal' && b.aufgabe !== 'erinnerung') {
    return { ok: false, status: 400, fehler: 'Ungültige Anfrage.' };
  }
  if (typeof b.heute !== 'string' || !HEUTE_FORM.test(b.heute)) {
    return { ok: false, status: 400, fehler: 'Ungültige Anfrage.' };
  }
  return { ok: true, anfrage: { aufgabe: b.aufgabe, heute: b.heute } };
}

// Deckt alle fälligen Reisen auf. Pro Reise: CAS-Update wie beim manuellen
// Reveal; nur der Gewinner (1 Zeile) schickt den Push, an ALLE Mitglieder
// (ausloesendeId null, siehe versendeRevealPush). Fehler einer Reise werden
// gemeldet und stoppen die Schleife nicht: die übrigen Reisen kommen dran.
export async function fuehreAutoRevealAus(
  store: ZeitplanStore,
  sendeFn: SendeFn,
  heute: string,
  melde: MeldeFn = KEIN_MELDER,
): Promise<ZeitplanErgebnis> {
  const { data: faellige, error } = await store.holeFaelligeReisen(heute);
  if (error || !faellige) {
    console.error('reveal-zeitplan: Auswahl fälliger Reisen fehlgeschlagen', error);
    await melde(error ?? new Error('reveal-zeitplan: Auswahl ohne Daten.'), { heute });
    return { status: 500, body: { fehler: 'Auswahl fehlgeschlagen.' } };
  }

  let verarbeitet = 0;
  for (const trip of faellige) {
    const { data: aktualisiert, error: updateError } = await store.aktualisiereWennAktiv(trip.id);
    if (updateError) {
      console.error('reveal-zeitplan: trips-Update fehlgeschlagen', updateError);
      await melde(updateError, { trip_id: trip.id, heute });
      continue;
    }
    // 0 Zeilen: zwischen Auswahl und Update hat jemand manuell abgeschlossen,
    // dessen Zweig hat den Push bereits verschickt.
    if (!aktualisiert) continue;
    verarbeitet++;
    // Wie beim manuellen Reveal: der Statuswechsel ist die Wahrheit, der Push
    // nur die Botschaft, ein Versandfehler nimmt nichts zurück.
    try {
      await versendeRevealPush(store, sendeFn, trip, null);
    } catch (err) {
      console.error('reveal-zeitplan: Push-Versand fehlgeschlagen', err);
      await melde(err, { trip_id: trip.id, heute });
    }
  }
  return { status: 200, body: { ok: true, verarbeitet } };
}

// Erinnert die Owner-Person am Morgen des letzten Reisetags (Spec §2 Punkt 2).
// CAS auf den Marker macht einen doppelten Lauf folgenlos; nur der Gewinner
// schickt den Push. Scheitert der Versand NACH dem gesetzten Marker, bleibt
// die Erinnerung aus (kein Retry): sie ist Komfort, der Reveal am Folgetag
// kommt unabhängig davon (Spec §6).
export async function fuehreErinnerungAus(
  store: ZeitplanStore,
  sendeFn: SendeFn,
  heute: string,
  melde: MeldeFn = KEIN_MELDER,
): Promise<ZeitplanErgebnis> {
  const { data: reisen, error } = await store.holeErinnerungsReisen(heute);
  if (error || !reisen) {
    console.error('reveal-zeitplan: Auswahl der Erinnerungen fehlgeschlagen', error);
    await melde(error ?? new Error('reveal-zeitplan: Erinnerungs-Auswahl ohne Daten.'), { heute });
    return { status: 500, body: { fehler: 'Auswahl fehlgeschlagen.' } };
  }

  let verarbeitet = 0;
  for (const trip of reisen) {
    const { data: markiert, error: markerError } = await store.markiereErinnerung(trip.id);
    if (markerError) {
      console.error('reveal-zeitplan: Erinnerungs-Marker fehlgeschlagen', markerError);
      await melde(markerError, { trip_id: trip.id, heute });
      continue;
    }
    if (!markiert) continue;
    verarbeitet++;

    try {
      const { data: tokenZeilen, error: tokenError } = await store.holeTokens([trip.owner_id]);
      if (tokenError) {
        console.error('reveal-zeitplan: push_tokens-Select fehlgeschlagen', tokenError);
        await melde(tokenError, { trip_id: trip.id, heute });
        continue;
      }
      const tokens = tokenZeilen ?? [];
      if (tokens.length === 0) continue;

      const text = `Heute ist der letzte Tag eurer Reise «${trip.name}». Um Mitternacht wird euer Recap aufgedeckt.`;
      const nachrichten: PushNachricht[] = tokens.map((t) => ({
        to: t.token,
        title: text,
        body: text,
        data: { trip_id: trip.id },
      }));
      const tote = await sendeFn(nachrichten);
      if (tote.length > 0) {
        const { error: deleteError } = await store.loescheTokens(tote, [trip.owner_id]);
        if (deleteError) {
          console.error('reveal-zeitplan: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
        }
      }
    } catch (err) {
      console.error('reveal-zeitplan: Erinnerungs-Versand fehlgeschlagen', err);
      await melde(err, { trip_id: trip.id, heute });
    }
  }
  return { status: 200, body: { ok: true, verarbeitet } };
}
