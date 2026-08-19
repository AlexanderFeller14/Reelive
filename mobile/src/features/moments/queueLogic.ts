import type { QueueJob } from './types';

const BASE_MS = 2_000;
const CAP_MS = 600_000; // 10 minutes

// Doubling backoff. Deliberately without an upper limit on the attempt
// count: a moment must never quietly get lost just because the network was
// gone for a long time (Spec §5).
export function backoffMs(attempts: number): number {
  const raw = BASE_MS * 2 ** attempts;
  return Number.isFinite(raw) ? Math.min(raw, CAP_MS) : CAP_MS;
}

// currentAuthorId: the currently signed-in person (Task-13-Fix-Runde-2). A
// job carries its author identity fixed from the moment it's enqueued
// (QueueJob.author_id), only a job whose identity matches is currently
// selectable. No race is needed to require this: if a moment merely sits in
// the queue (zustand: 'wartet') while A signs out and B signs in, without
// this filter the next regular tick would run under B's session and write
// A's capture under B's name. A non-matching job is NOT discarded or
// counted as a failure, it simply stays put until the matching person signs
// in again (and the filter lets it through again). A job without a known
// identity (currentAuthorId === null, e.g. session unreadable) never
// matches.
export function nextJob(
  jobs: QueueJob[],
  now: number,
  onWifi: boolean,
  wifiOnly: boolean,
  currentAuthorId: string | null
): QueueJob | null {
  if (wifiOnly && !onWifi) return null;
  // currentAuthorId === null (session unreadable) deliberately does NOT
  // match against an (actually impossible, see isComplete) author_id of
  // null, without a known identity nothing at all gets selected, no
  // guessing.
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
