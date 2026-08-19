// Only the types this phase actually needs (Task-5 brief). Reaction and
// Comment are already included here because Task 12 (reactions/comments) is
// meant to build on the same types instead of a second, separate
// definition; both tasks run in parallel, this file excerpt is their shared
// contract.

export type RecapMoment = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
  duration_s: number | null;
  caption: string | null;
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  // Coordinates of the capture. null is the normal case, not an error:
  // determinePlace() (Phase 4) deliberately returns null when location
  // services aren't allowed, no fix is obtained indoors, or the timeout
  // runs out; the moment gets submitted regardless.
  lat: number | null;
  lng: number | null;
  upload_status: 'pending' | 'uploaded';
  // Comes from profiles.display_name (join, see recapApi.fetchRecapMoments),
  // so it isn't a field of posts itself.
  authorName: string;
  // Like autor_name, from the profiles join (recapApi.fetchRecapMoments).
  // Null means "no picture", then the circle carries the initial.
  authorAvatarKey: string | null;
};

// A group of moments of the same trip day (see days.ts).
export type RecapDay = {
  nummer: number; // counts from trips.start_date as day 1
  datum: string; // 'YYYY-MM-DD', canonical from start_date + (nummer - 1) days
  ort: string | null;
  momente: RecapMoment[];
};

// Defined here for Task 12 as well, so both tasks use the same types.
export type Reaction = { post_id: string; user_id: string; emoji: string };
export type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
  autor_name: string;
};
