import * as tripsApi from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';
import { pendingCount } from './queueLogic';
import * as momentsApi from './momentsApi';
import * as queueDb from './queueDb';

// Before the reveal, the counter is the only information about sealed
// moments at all, nobody sees the captures themselves. Uses pendingCount
// instead of a separate "!== fertig" check, so this rule isn't maintained
// twice.
//
// Fix-Runde 1: `my_post_counts()` counts every posts row server-side
// regardless of upload status, including a job that already has
// zeile_angelegt: true but isn't confirmed yet.
//
// Final-Review, Important 6: a FAILED fetch is not "null". Previously
// tripsApi swallowed the rpc error and returned an empty mapping, whoever
// had 40 sealed moments and took one in flight mode saw the number drop to
// 1.
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
