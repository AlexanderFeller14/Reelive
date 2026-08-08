import type { QueueJob, VerworfenerMoment } from './types';

// Web-Fassung von queueDb.ts (Task-4-Brief, Phase 6).
//
// Es gibt im Browser keine Kamera-Aufnahme und keinen Hintergrund-Upload —
// uploadWorker.starte() läuft auf Web nie an, weil es dort nie eine Sitzung
// gibt (siehe secureSessionStorage.web.ts) und der Worker laut Root-Layout
// nur bei status === 'signedIn' startet. Diese Datei existiert trotzdem,
// weil uploadWorker.ts, zaehler.ts und reise/[id]/index.tsx queueDb per
// Namespace-Import ("import * as queueDb") einbinden: Metro löst auf Web
// automatisch diese *.web.ts-Fassung auf und zieht damit nie expo-sqlite in
// den Bundle-Graphen (das native Modul lässt sich dort ohnehin nicht bündeln
// — siehe Task-4-Brief zum baseline-Fehler von `expo-sqlite/web/worker.ts`,
// das eine WASM-Datei importiert, die Metro nicht auflöst).
//
// Absichtlich eine leere In-Memory-Fassung ohne jede Ablage: Es gibt auf
// dieser Plattform nie einen Job einzureihen (kein Aufnehmen-Screen läuft
// hier je produktiv), also muss auch nichts persistiert werden. Jede
// Funktion erfüllt nur die Schnittstelle der nativen Fassung 1:1 — gleiche
// Namen, gleiche Signaturen, keine geworfenen Fehler.

export async function initQueue(): Promise<void> {}

export async function jobHinzufuegen(_job: QueueJob): Promise<void> {}

export async function alleJobs(): Promise<QueueJob[]> {
  return [];
}

export async function jobAktualisieren(_job: QueueJob): Promise<void> {}

export async function jobEntfernen(_id: string): Promise<void> {}

export async function verworfenenMerken(_eintrag: VerworfenerMoment): Promise<void> {}

export async function verworfene(_tripId: string, _autorId: string): Promise<VerworfenerMoment[]> {
  return [];
}

export async function verworfeneQuittieren(_tripId: string, _autorId: string): Promise<void> {}
