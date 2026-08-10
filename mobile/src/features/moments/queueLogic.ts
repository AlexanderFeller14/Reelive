import type { QueueJob } from './types';

const BASIS_MS = 2_000;
const DECKEL_MS = 600_000; // 10 Minuten

// Verdoppelnder Backoff. Bewusst ohne Obergrenze für die Versuchszahl: ein Moment
// darf nie still verlorengehen, nur weil das Netz lange weg war (Spec §5).
export function backoffMs(versuche: number): number {
  const roh = BASIS_MS * 2 ** versuche;
  return Number.isFinite(roh) ? Math.min(roh, DECKEL_MS) : DECKEL_MS;
}

// aktuelleAutorId: die gerade angemeldete Person (Task-13-Fix-Runde-2). Ein
// Job trägt seine Autoren-Kennung fest ab dem Einreihen (QueueJob.author_id),
// nur ein Job, dessen Kennung dazu passt, ist gerade auswählbar. Kein Race
// nötig, um das zu brauchen: liegt ein Moment bloss in der Warteschlange
// (zustand: 'wartet'), während sich A ab- und B anmeldet, würde ohne diesen
// Filter der nächste reguläre Tick unter B's Sitzung laufen und A's Aufnahme
// unter B's Namen schreiben. Ein nicht passender Job wird NICHT verworfen
// oder als Fehlschlag gezählt, er bleibt einfach liegen, bis die passende
// Person sich wieder anmeldet (und der Filter wieder durchlässt). Ein Job
// ohne bekannte Kennung (aktuelleAutorId === null, z.B. Sitzung nicht lesbar)
// matcht nie.
export function naechsterJob(
  jobs: QueueJob[],
  jetzt: number,
  aufWlan: boolean,
  nurWlan: boolean,
  aktuelleAutorId: string | null
): QueueJob | null {
  if (nurWlan && !aufWlan) return null;
  // aktuelleAutorId === null (Sitzung nicht lesbar) matcht bewusst NICHT gegen
  // eine (eigentlich unmögliche, siehe istVollstaendig) author_id von null,
  // ohne bekannte Identität wird gar nichts ausgewählt, kein Rätselraten.
  if (aktuelleAutorId === null) return null;
  const faellig = jobs
    .filter(
      (j) => j.zustand === 'wartet' && j.naechster_versuch <= jetzt && j.author_id === aktuelleAutorId
    )
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
