import type { Href } from 'expo-router';
import type { RedeemResult } from './types';

// Reine Entscheidung, unabhängig von der Quelle des Ergebnisses, Root-Layout
// UND Beitritts-Screen nutzen dieselbe Regel, statt sie je einmal zu wiederholen:
// `already_member` ist kein Fehler, ein doppelt eingelöster Link führt genauso
// in die Reise wie ein frischer Beitritt.
export function ermittleZielPfad(ergebnis: RedeemResult): Href | null {
  if (ergebnis.trip_id && (ergebnis.status === 'joined' || ergebnis.status === 'already_member')) {
    return `/reise/${ergebnis.trip_id}`;
  }
  return null;
}

export type PendingInviteDeps = {
  peekRememberedInvite: () => Promise<string | null>;
  redeemInvite: (code: string) => Promise<RedeemResult>;
  discardRememberedInvite: () => Promise<void>;
  // Liefert, ob der aufrufende Effect noch aktiv ist (nicht abgeräumt). Als
  // Funktion statt Bool injiziert, damit der aktuelle Wert zum Zeitpunkt der
  // Abfrage zählt, nicht der Wert beim Start des Aufrufs.
  istAktiv: () => boolean;
};

// Orchestriert das Einlösen eines vor dem Login gemerkten Codes, getrennt vom
// Root-Layout-Effect testbar, weil alle IO-Abhängigkeiten injiziert werden.
// Liefert den Zielpfad, falls navigiert werden soll, sonst null.
//
// Replay-Sicherheit: der Code wird NICHT beim Lesen gelöscht (peek statt take),
// sonst geht er verloren, wenn der Effect zwischen Lesen und dem eigentlichen
// Einlöseversuch abgeräumt wird (z.B. weil `status` durch eine
// hasProfile-Neubewertung kurz wegkippt und zurückkommt). Erst wenn
// redeemInvite() wirklich aufgerufen wurde, gilt der Versuch als stattgefunden,
// dann wird IMMER verworfen, auch bei einem Fehlschlag: sonst würde ein
// dauerhaft ungültiger Code bei jedem künftigen signedIn erneut versucht.
export async function redeemPendingInvite(deps: PendingInviteDeps): Promise<Href | null> {
  const code = await deps.peekRememberedInvite();
  if (!code) return null;
  if (!deps.istAktiv()) return null; // vor dem Versuch abgeräumt: Code bleibt liegen
  const ergebnis = await deps.redeemInvite(code);
  await deps.discardRememberedInvite(); // Versuch fand statt: immer verwerfen
  if (!deps.istAktiv()) return null; // Effect ist weg: nicht mehr navigieren
  return ermittleZielPfad(ergebnis);
}
