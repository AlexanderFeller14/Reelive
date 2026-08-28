import type { AcceptedMedia, ImportPeriod, RefusedMedia } from './libraryImport';

// The assessed selection travels from the camera screen to the review
// route through this holder, the same reasoning as camera/handoff.ts:
// router params are strings, a list of assessed elements with their
// picker copies is not. Exactly ONE handoff is ever pending.
export type ImportHandoff = {
  tripId: string;
  tripName: string;
  authorId: string;
  // The trip period and the video limit the elements were assessed
  // against: the review's refusal summary names them.
  period: ImportPeriod;
  maxVideoSeconds: number;
  accepted: AcceptedMedia[];
  refused: RefusedMedia[];
  // The trip counter before the batch, for the celebration's roll; null
  // when it was not known at the time.
  counterBefore: number | null;
};

let pending: ImportHandoff | null = null;

export function setImport(handoff: ImportHandoff): void {
  pending = handoff;
}

export function takeImport(): ImportHandoff | null {
  const handoff = pending;
  pending = null;
  return handoff;
}
