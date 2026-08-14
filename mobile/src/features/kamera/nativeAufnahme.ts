// Zugang zum nativen Modul `KameraAufnahme` (modules/kamera-zoom, Datei
// KameraAufnahmeModule.swift). Diese Datei ist die EINZIGE Stelle, die es
// kennt — dasselbe Muster wie nativeZoom.ts. Fehlt das Modul (Android,
// Simulator, alter Build) oder scheitert der Start, antworten die Helfer mit
// false/null: die Kamera nimmt dann den recordAsync-Weg (Rückfallebene der
// Spec 2026-08-14-instant-video-vorschau).
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

type NativesAufnahmeModul = {
  aufnahmeStarten(maxSekunden: number): Promise<void>;
  aufnahmeStoppen(): Promise<{ uri: string; dauerS: number }>;
  dateiAbwarten(): Promise<void>;
  verwerfen(): Promise<void>;
};

// `undefined` heisst «noch nicht nachgesehen», `null` heisst «gibt es hier
// nicht»: auf Android und am Simulator ist das der Normalfall, kein Fehler.
let modul: NativesAufnahmeModul | null | undefined;

function nativesModul(): NativesAufnahmeModul | null {
  if (modul === undefined) {
    modul = requireOptionalNativeModule<NativesAufnahmeModul>('KameraAufnahme');
  }
  return modul;
}

export function verfuegbar(): boolean {
  return nativesModul() !== null;
}

export async function aufnahmeStarten(maxSekunden: number): Promise<boolean> {
  const m = nativesModul();
  if (!m) return false;
  try {
    await m.aufnahmeStarten(maxSekunden);
    return true;
  } catch {
    return false;
  }
}

export async function aufnahmeStoppen(): Promise<{ uri: string; dauerS: number } | null> {
  const m = nativesModul();
  if (!m) return null;
  try {
    return await m.aufnahmeStoppen();
  } catch {
    return null;
  }
}

// Löst, wenn finishWriting durch ist — das Gegenstück zu foto.datei beim
// Instant-Foto. Ablehnungen (voller Speicher) erreichen den Aufrufer
// unverändert, der Einsenden-catch zeigt sie an.
export function dateiFertig(): Promise<void> {
  const m = nativesModul();
  if (!m) return Promise.resolve();
  return m.dateiAbwarten();
}

export function verwerfen(): void {
  void nativesModul()?.verwerfen().catch(() => {});
}

// Die native Sofort-Vorschau (AVSampleBufferDisplayLayer): spielt Ringpuffer,
// dann Datei, loopt. Entsteht nativ in Task 8/9.
export const SofortVorschau = requireNativeViewManager('KameraAufnahme');
