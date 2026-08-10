import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripStatus } from './types';

// Der lokale Rückfall für den Kamera-Screen und den Momente-Zähler.
//
// Warum es das gibt (Final-Review, Critical 1 / Important 6): «Aufnehmen
// funktioniert vollständig offline» ist das Kernversprechen dieser Phase,
// aber der Sucher erscheint erst, wenn eine laufende Reise bekannt ist. Ohne
// lokalen Bestand lieferte fetchTrips() im Flugmodus `{ data: [], error }`,
// und statt Sucher und Auslöser stand dort eine Fehlerseite. Queue,
// Kompression und Worker waren alle korrekt, und alle unerreichbar.
//
// Gespeichert wird bewusst nur das Nötigste (Kennung, Name, Status, Zeitraum,
// Zähler), nicht die ganze Trip-Zeile: Mitgliedernamen braucht die Kamera
// nicht, und was nicht gespeichert wird, kann auch nicht veralten oder
// unnötig auf dem Gerät liegen bleiben.
//
// PRO PERSON getrennt (Schlüssel trägt die Benutzer-Kennung): auf einem
// geteilten Gerät darf B offline nie A's Reisen sehen. Ohne Kennung
// (`null`, Sitzung nicht lesbar) wird weder gelesen noch geschrieben,
// dann gibt es eben keinen Rückfall, statt zu raten.

const REISEN_PRAEFIX = 'reelive.reisen.';
const ZAEHLER_PRAEFIX = 'reelive.zaehler.';

// Genau die Felder, die der Kamera-Screen braucht. `Trip` ist ein Obermenge
// davon und lässt sich deshalb direkt zuweisen (siehe zuGemerkt unten).
export type GemerkteReise = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  my_post_count: number;
};

const ERLAUBTE_STATUS: readonly TripStatus[] = ['active', 'revealed', 'archived'];

export function zuGemerkt(reise: GemerkteReise): GemerkteReise {
  return {
    id: reise.id,
    name: reise.name,
    start_date: reise.start_date,
    end_date: reise.end_date,
    status: reise.status,
    my_post_count: reise.my_post_count,
  };
}

// Gleiche Vorsicht wie in queueDb.zuJob: was aus dem Speicher zurückkommt,
// hat schon ein App-Update, einen abgebrochenen Schreibvorgang oder eine
// ältere Feldform hinter sich. Eine unvollständige Zeile wird verworfen statt
// als Reise ausgegeben, sonst stünde im Sucher eine Reise ohne Namen.
function istGemerkteReise(wert: unknown): wert is GemerkteReise {
  if (typeof wert !== 'object' || wert === null) return false;
  const r = wert as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.start_date === 'string' &&
    typeof r.end_date === 'string' &&
    ERLAUBTE_STATUS.includes(r.status as TripStatus) &&
    typeof r.my_post_count === 'number'
  );
}

export async function reisenMerken(
  benutzerId: string | null,
  reisen: GemerkteReise[]
): Promise<void> {
  if (!benutzerId) return;
  try {
    await AsyncStorage.setItem(
      REISEN_PRAEFIX + benutzerId,
      JSON.stringify(reisen.map(zuGemerkt))
    );
  } catch {
    // Ein nicht fortgeschriebener Bestand kostet höchstens den Rückfall beim
    // nächsten Flugmodus, kein Grund, den Kamera-Screen scheitern zu lassen.
  }
}

// `null` heisst «nichts vorgehalten» und ist damit vom (gültigen) leeren
// Bestand unterscheidbar: nur im ersten Fall darf die Fehlerseite erscheinen.
export async function gemerkteReisen(benutzerId: string | null): Promise<GemerkteReise[] | null> {
  if (!benutzerId) return null;
  try {
    const roh = await AsyncStorage.getItem(REISEN_PRAEFIX + benutzerId);
    if (roh === null) return null;
    const geparst: unknown = JSON.parse(roh);
    if (!Array.isArray(geparst)) return null;
    return geparst.filter(istGemerkteReise);
  } catch {
    return null;
  }
}

export async function zaehlerMerken(
  benutzerId: string | null,
  zaehler: Record<string, number>
): Promise<void> {
  if (!benutzerId) return;
  try {
    await AsyncStorage.setItem(ZAEHLER_PRAEFIX + benutzerId, JSON.stringify(zaehler));
  } catch {
    // Siehe reisenMerken.
  }
}

// Hier genügt das leere Objekt als Rückfall: der Aufrufer (zaehler.ts) addiert
// darauf die wartenden Momente, und «kein gemerkter Stand» ist für ihn
// dasselbe wie «Serverstand 0», anders als bei den Reisen gibt es keine
// Fehlerseite, die davon abhängt.
export async function gemerkteZaehler(benutzerId: string | null): Promise<Record<string, number>> {
  if (!benutzerId) return {};
  try {
    const roh = await AsyncStorage.getItem(ZAEHLER_PRAEFIX + benutzerId);
    if (roh === null) return {};
    const geparst: unknown = JSON.parse(roh);
    if (typeof geparst !== 'object' || geparst === null || Array.isArray(geparst)) return {};
    const sauber: Record<string, number> = {};
    for (const [id, wert] of Object.entries(geparst)) {
      if (typeof wert === 'number' && Number.isFinite(wert)) sauber[id] = wert;
    }
    return sauber;
  } catch {
    return {};
  }
}
