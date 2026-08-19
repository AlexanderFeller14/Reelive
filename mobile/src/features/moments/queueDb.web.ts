import type { QueueJob, DiscardedMoment } from './types';

// Web version of queueDb.ts (Task-4-Brief, Phase 6).
//
// There's no camera capture and no background upload in the browser,
// uploadWorker.start() never runs on web, because there's never a session
// there (see secureSessionStorage.web.ts) and the worker, per the root
// layout, only starts on status === 'signedIn'. This file exists anyway
// because uploadWorker.ts, counter.ts, and trip/[id]/index.tsx pull in
// queueDb via a namespace import ("import * as queueDb"): Metro
// automatically resolves this *.web.ts version on web and thereby never
// pulls expo-sqlite into the bundle graph (the native module can't be
// bundled there anyway, see Task-4-Brief on the baseline error of
// `expo-sqlite/web/worker.ts`, which imports a WASM file that Metro doesn't
// resolve).
//
// Deliberately an empty in-memory version without any storage at all: on
// this platform there's never a job to enqueue (no capture screen ever runs
// here in production), so nothing needs to be persisted either. Every
// function only fulfills the native version's interface 1:1, same names,
// same signatures, no thrown errors.

export async function initQueue(): Promise<void> {}

export async function addJob(_job: QueueJob): Promise<void> {}

export async function allJobs(): Promise<QueueJob[]> {
  return [];
}

export async function updateJob(_job: QueueJob): Promise<void> {}

export async function removeJob(_id: string): Promise<void> {}

export async function rememberDiscarded(_entry: DiscardedMoment): Promise<void> {}

export async function discardedMoments(_tripId: string, _authorId: string): Promise<DiscardedMoment[]> {
  return [];
}

export async function acknowledgeDiscarded(_tripId: string, _authorId: string): Promise<void> {}
