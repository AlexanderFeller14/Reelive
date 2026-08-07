import type { QueueJob } from './types';

const BASIS_MS = 2_000;
const DECKEL_MS = 600_000; // 10 Minuten

// Verdoppelnder Backoff. Bewusst ohne Obergrenze für die Versuchszahl: ein Moment
// darf nie still verlorengehen, nur weil das Netz lange weg war (Spec §5).
export function backoffMs(versuche: number): number {
  const roh = BASIS_MS * 2 ** versuche;
  return Number.isFinite(roh) ? Math.min(roh, DECKEL_MS) : DECKEL_MS;
}

export function naechsterJob(
  jobs: QueueJob[],
  jetzt: number,
  aufWlan: boolean,
  nurWlan: boolean
): QueueJob | null {
  if (nurWlan && !aufWlan) return null;
  const faellig = jobs
    .filter((j) => j.zustand === 'wartet' && j.naechster_versuch <= jetzt)
    .sort((a, b) => a.naechster_versuch - b.naechster_versuch);
  return faellig[0] ?? null;
}

export function nachFehlschlag(job: QueueJob, jetzt: number): QueueJob {
  const versuche = job.versuche + 1;
  return { ...job, versuche, zustand: 'wartet', naechster_versuch: jetzt + backoffMs(versuche) };
}

export function wartendeAnzahl(jobs: QueueJob[]): number {
  return jobs.filter((j) => j.zustand !== 'fertig').length;
}
