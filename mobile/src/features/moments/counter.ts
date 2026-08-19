import * as tripsApi from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';
import { pendingCount } from './queueLogic';
import * as momentsApi from './momentsApi';
import * as queueDb from './queueDb';

// Before the reveal, the counter is the only information about sealed
// moments at all, nobody sees the captures themselves. It must therefore
// never jump backwards after an offline capture: it counts the server
// count PLUS the own, not yet uploaded moments of the same trip from the
// queue (pendingCount instead of a separate "!== fertig" check, so this
// rule isn't maintained twice).
//
// Fix-Runde 1: a job stays in the queue from the moment uploadWorker.processJob
// created the posts row (zeile_angelegt: true) until confirmed completion,
// the media/thumbnail upload can fail and be retried multiple times without
// the job disappearing. `my_post_counts()` counts every posts row regardless
// of upload status though, so it already counts this job in the server
// count. Without the exclusion here it would be counted a second time, and
// the counter would then jump back as soon as the job finally disappears
// from the queue (N → N+1 → N+2 → N+1). Only jobs WITHOUT a created row are
// invisible to the server and may be added locally.
//
// Final-Review, Important 6: a FAILED fetch is not "null". Previously
// tripsApi swallowed the rpc error and returned an empty mapping, whoever
// had 40 sealed moments and took one in flight mode saw the number drop to
// 1. Now ownMomentCount() passes the error along, and the last known server
// count from tripsCache steps in. Conversely every successful fetch writes
// this count forward, that's the only place that maintains it.
export async function ownMomentCount(tripId: string): Promise<number> {
  const [read, jobs, userId] = await Promise.all([
    tripsApi.eigeneZaehler(),
    queueDb.allJobs(),
    momentsApi.currentAuthorId(),
  ]);

  let counts: Record<string, number>;
  if (read.error) {
    counts = await tripsCache.gemerkteZaehler(userId);
  } else {
    counts = read.data;
    await tripsCache.zaehlerMerken(userId, counts);
  }

  const serverCount = counts[tripId] ?? 0;
  const notYetOnServer = jobs.filter((job) => job.trip_id === tripId && !job.zeile_angelegt);
  return serverCount + pendingCount(notYetOnServer);
}
