// Zugang zum nativen Modul `MultiKamera` (modules/kamera-zoom, Datei
// MultiKameraModule.swift). Diese Datei ist die EINZIGE Stelle, die es
// kennt, dasselbe Muster wie nativeAufnahme.ts und nativeZoom.ts. Fehlt das
// Modul (Android, Simulator, alter Build) oder schlägt der Aufbau zweimal in
// Folge fehl, antworten die Helfer mit false/null: der Screen fällt dann für
// den Rest der Sitzung auf den expo-camera-Pfad zurück (Laufzeit-Fallback,
// Spec §8/§9).
import type { ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { MultiCamZiel } from './zoom';

type Druckstufe = 'nominal' | 'ernst' | 'kritisch';

type NativesMultiKameraModul = {
  istVerfuegbar(): boolean;
  starten(): Promise<void>;
  stoppen(): Promise<void>;
  wechsleKamera(): Promise<'front' | 'back'>;
  zoomSetzen(kamera: string, faktor: number, sanft: boolean): void;
  fokussiere(x: number, y: number): Promise<void>;
  addListener(
    eventName: 'druckGeaendert',
    hoerer: (ereignis: { stufe: Druckstufe }) => void
  ): { remove(): void };
};

// `undefined` heisst «noch nicht nachgesehen», `null` heisst «gibt es hier
// nicht»: auf Android und am Simulator ist das der Normalfall, kein Fehler.
let modul: NativesMultiKameraModul | null | undefined;

function nativesModul(): NativesMultiKameraModul | null {
  if (modul === undefined) {
    modul = requireOptionalNativeModule<NativesMultiKameraModul>('MultiKamera');
  }
  return modul;
}

// Zwei Fehlschläge beim Aufbau in Folge schalten den MultiCam-Pfad für den
// Rest der Sitzung ab: kein dritter Versuch mehr, `starten` und `verfuegbar`
// antworten danach sofort mit false. Ein Erfolg setzt den Zähler zurück, ein
// einzelner Ausrutscher schaltet also noch nicht ab.
const MAX_FEHLSCHLAEGE_IN_FOLGE = 2;
let fehlschlägeInFolge = 0;
let gescheitert = false;

export function verfuegbar(): boolean {
  if (gescheitert) return false;
  const m = nativesModul();
  return m !== null && m.istVerfuegbar();
}

export async function starten(): Promise<boolean> {
  if (gescheitert) return false;
  const m = nativesModul();
  if (!m) return false;
  try {
    await m.starten();
    fehlschlägeInFolge = 0;
    return true;
  } catch {
    fehlschlägeInFolge += 1;
    if (fehlschlägeInFolge >= MAX_FEHLSCHLAEGE_IN_FOLGE) gescheitert = true;
    return false;
  }
}

export function stoppen(): void {
  void nativesModul()
    ?.stoppen()
    .catch(() => {});
}

export async function wechsleKamera(): Promise<'front' | 'back' | null> {
  const m = nativesModul();
  if (!m) return null;
  try {
    return await m.wechsleKamera();
  } catch {
    return null;
  }
}

export function zoomSetzen(ziel: MultiCamZiel, sanft: boolean): void {
  nativesModul()?.zoomSetzen(ziel.kamera, ziel.faktor, sanft);
}

export function fokussiere(x: number, y: number): void {
  void nativesModul()
    ?.fokussiere(x, y)
    .catch(() => {});
}

// Liefert die Abmeldung; ohne Modul ein No-op, das nichts abzumelden hat.
export function aufDruck(hoerer: (stufe: Druckstufe) => void): () => void {
  const m = nativesModul();
  if (!m) return () => {};
  const abo = m.addListener('druckGeaendert', (ereignis) => hoerer(ereignis.stufe));
  return () => abo.remove();
}

// Der Sucher des MultiCam-Pfads (Muster SofortVorschau). Zwei getrennte
// Fälle brauchen die leere Fallback-View, und sie greifen unterschiedlich:
// Android und Jest kennen das native Modul gar nicht, dort liefert
// `nativesModul()` null, und der erste Guard greift sofort, ohne
// `requireNativeViewManager` überhaupt aufzurufen. Der Simulator dagegen hat
// das Modul registriert (`platforms: ["apple"]`), der null-Guard greift dort
// also NICHT. Dass `AVCaptureMultiCamSession.isMultiCamSupported` auf dem
// Simulator false ist, prüft erst `istVerfuegbar()` innerhalb des Moduls,
// nicht dieser Guard hier: auf dem Simulator läuft der Aufruf also bis zum
// try/catch durch, das ihn nur abfängt, falls `requireNativeViewManager`
// dort tatsächlich wirft.
function sucherKomponente(): ComponentType<ViewProps> {
  if (nativesModul() === null) return View;
  try {
    return requireNativeViewManager<ViewProps>('MultiKamera');
  } catch {
    return View;
  }
}

export const MultiKameraSucher: ComponentType<ViewProps> = sucherKomponente();
