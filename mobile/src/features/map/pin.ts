import type { RecapMoment } from '@/features/recap/types';
import { timeInZone } from '@/features/recap/timeOfDay';

// What a pin SAYS and what its appearance DEPENDS ON, the two rules shared
// by the native pin (components/MapPin.tsx) and the browser pin
// (MapSurface.web.tsx).
//
// They lived module-private in MapPin.tsx until Task 14. They can't
// stay there: that file imports `Marker` from react-native-maps, and the
// library has no web version (`main` points at TypeScript source with
// native modules). An import from there into the `.web.tsx` would pull it
// into the browser bundle, where it can't be built.
//
// Both versions from the SAME source: a second wording of the label would
// eventually promise something different via VoiceOver than the tap does,
// and a second appearance calculation would let one version redraw where
// the other stays still.

// Everything that determines a pin's appearance, as ONE value.
//
// Natively both components in MapPin.tsx build it the same way: the
// pin, to know when it has to report its finished state again, and the
// marker, to know whether the reported state is still current
// (`tracksViewChanges`). In the browser, the same value decides whether
// the `divIcon` gets rebuilt; rebuilt without cause it would reload its
// image on every map movement and the pin would flicker while panning.
export function pinAppearance(moment: RecapMoment, thumbUrl: string | null, count: number): string {
  return `${moment.type}|${count}|${thumbUrl ?? ''}`;
}

// After clustering, the pin is ONE element for VoiceOver, what's inside is
// then no longer reachable. The label therefore belongs on the marker, not
// inside the pin. Same shape as in uebersicht.tsx ("Moment 3 öffnen"), just
// with what's known here: author and time, and for a cluster its count
// instead of a single moment.
//
// For a cluster, the label names the action the tap REALLY triggers.
// Anyone who has VoiceOver announce what an element does otherwise gets a
// promise the map doesn't keep. And these are two different things here:
// either the tap flies into the cluster (Spec §5.5) or it opens its list
// (§5.7).
//
// `opensSheet` says which of the two. It's deliberately NOT "do they all
// sit on the same spot": that was the only reason until the merge fix
// round of Phase 7 added the second one (the map is at the limit of its
// zoom levels, features/map/clusterTap.ts). Anyone asking here for the
// REASON instead of the OUTCOME says the wrong thing again for the second
// reason. The question is therefore answered by the screen, with the same
// function that also decides the tap.
//
// "At this place" is literally true in both cases: bit-identical
// coordinates in one, and in the other the 40 screen points of the
// clustering at the last zoom level, so roughly nine meters. For a cluster
// that can still be zoomed apart, it would be a lie, there the same 40
// points can be 150 km, and that's exactly not what it says there either.
export function pinLabel(moment: RecapMoment, count: number, opensSheet: boolean): string {
  if (count > 1) {
    return opensSheet
      ? `${count} Momente an diesem Ort ansehen`
      : `Auf ${count} Momente heranzoomen`;
  }
  return momentLabel(moment);
}

// What VoiceOver says about ONE moment, at every place it can be opened
// from: the single pin above, the rows of the cluster list and the tiles
// of moments without a place (features/map/MomentSheet.tsx), in the app as
// well as in the shared recap.
//
// It stood here three times, word for word, once per call site. Three
// copies of one announcement that all describe the same action drift apart
// as soon as one of them is touched, and the divergence is only visible to
// someone who turns on VoiceOver.
export function momentLabel(moment: RecapMoment): string {
  const time = timeInZone(moment.captured_at, moment.captured_tz);
  return `Moment von ${moment.authorName} um ${time} öffnen`;
}
