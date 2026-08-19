import type { QueueJob } from './types';

const BASE_MS = 2_000;
const CAP_MS = 600_000; // 10 minutes

export function backoffMs(attempts: number): number {
  const raw = BASE_MS * 2 ** attempts;
  return Number.isFinite(raw) ? Math.min(raw, CAP_MS) : CAP_MS;
}

export function nextJob(
  jobs: QueueJob[],
  now: number,
  onWifi: boolean,
  wifiOnly: boolean,
  currentAuthorId: string | null
): QueueJob | null {
  if (wifiOnly && !onWifi) return null;
  if (currentAuthorId === null) return null;
  const due = jobs
    .filter(
      (j) => j.zustand === 'wartet' && j.naechster_versuch <= now && j.author_id === currentAuthorId
    )
    .sort((a, b) => a.naechster_versuch - b.naechster_versuch);
  return due[0] ?? null;
}

export function afterFailure(job: QueueJob, now: number): QueueJob {
  const attempts = job.versuche + 1;
  return { ...job, versuche: attempts, zustand: 'wartet', naechster_versuch: now + backoffMs(attempts) };
}

export function pendingCount(jobs: QueueJob[]): number {
  return jobs.filter((j) => j.zustand !== 'fertig').length;
}
