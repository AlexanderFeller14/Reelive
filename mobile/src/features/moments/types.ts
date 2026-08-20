export type JobState = 'wartet' | 'laeuft' | 'fertig';

// A moment the worker had to permanently discard (Spec §8: "discarded with
// an explanation"). Until the Final-Review one of these vanished silently,
// the job got deleted and a console line written that nobody sees. The
// entry survives restarts (SQLite, next to the queue) and stays until the
// affected person acknowledges it in the trip detail. It deliberately
// carries no media anymore: the files are already cleaned up by this point
// (Critical 2), it's only about the explanation.
export type DiscardedMoment = {
  id: string;
  trip_id: string;
  author_id: string;
  grund: string;
  verworfen_am: number; // ms since epoch
};

// A job carries everything the posts row needs, plus the progress. post_id
// and the keys are already fixed when capturing (Spec §5), that's the only
// way a restart after a crash doesn't create a second row.
export type QueueJob = {
  id: string;
  post_id: string;
  trip_id: string;
  // Captured when enqueuing (Task-13-Fix-Runde-2), NOT read from the session
  // when writing. See preview.tsx, which sets it.
  author_id: string;
  typ: 'photo' | 'video';
  medium_uri: string;
  thumb_uri: string;
  storage_key: string;
  thumb_key: string;
  caption: string | null;
  captured_at: string;
  captured_tz: string;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
  duration_s: number | null;
  zustand: JobState;
  versuche: number;
  naechster_versuch: number; // ms since epoch
  zeile_angelegt: boolean;
  medium_geladen: boolean;
  thumb_geladen: boolean;
};
