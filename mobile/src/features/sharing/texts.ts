// What a share link reveals, in one sentence.
//
// It appears in two places and must say the same thing in both:
//
//   - in the share sheet, where the owner reads it BEFORE creating a link
//     (features/sharing/ShareSheetContent.tsx),
//   - on the trip screen, where every fellow traveler reads it WHILE a link
//     exists (app/(tabs)/trip/[id]/index.tsx).
//
// Two versions of the same sentence would be especially unpleasant here: it
// is the disclosure of what happens to other people's moments. If one drifts
// from the other, someone agreed to a link that shows something different
// from what fellow travelers were told.
//
// The places are explicitly named. They have been part of what the link
// shows, uncropped, since Phase 7 (spec decision R4), and that is exactly
// the fact nobody would learn without this sentence.
export const LINK_REACH_TEXT =
  'Wer diesen Link hat, sieht den ganzen Recap: alle Momente aller Mitreisenden samt den Orten, an denen sie entstanden sind, auch ohne eigenes Konto.';
