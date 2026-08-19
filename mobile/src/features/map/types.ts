import type { RecapMoment } from '@/features/recap/types';

// A moment known to have a place. That's the difference to RecapMoment:
// there lat/lng are nullable, here no longer, every calculation in this
// feature folder can rely on that.
export type MapPoint = {
  moment: RecapMoment;
  lat: number;
  lng: number;
  // Position in the list that toMapPoints RECEIVES, and that has to be the
  // playable list, the same one the recap player builds:
  // uploaded.filter((m) => urls.has(m.id)) (player.tsx, uebersicht.tsx).
  // This exact value goes as `start` to the player. Passing the raw
  // moments list instead shifts everything behind it with every still
  // uploading moment, and the jump lands on the wrong moment, without
  // anyone noticing unless they count.
  index: number;
};

// The visible map viewport, in the shape react-native-maps expects.
export type Viewport = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

// Points that lie too close together on screen to show individually.
// `anchor` is the earliest moment of the cluster and represents it.
export type Cluster = {
  anchor: MapPoint;
  points: MapPoint[];
};

// The contract of the map surface, fulfilled by BOTH versions: MapSurface.tsx
// (react-native-maps) and MapSurface.web.tsx (Leaflet). Metro picks the
// `.web.tsx` in the web bundle and the `.tsx` otherwise, without a caller
// knowing about it, the same platform switch as queueDb.web.ts, pushApi.web.ts
// and secureSessionStorage.web.ts from Phase 6.
//
// The contract lives HERE and not in either version: the web version must
// not touch the native one, not even for a type, react-native-maps has no
// web version, and even an `import type` from there would be an invitation
// to pull in a value later.
export type MapSurfaceProps = {
  /**
   * The viewport the map OPENS WITH, and only that. Later changes to this
   * prop move nothing anymore: after that, the surface drives its own
   * camera. Where it stands is reported by `onViewportChange`; where it
   * should fly to is told by `flyTo` on the handle below.
   *
   * The name says so because a comment can't enforce it: if it were called
   * `viewport`, "I set it anew, then it flies there" would be the obvious
   * assumption, and it's wrong. The map screen gets away with this today
   * only because it goes to `null` on a trip change and the surface
   * remounts.
   */
  initialViewport: Viewport;
  clusters: Cluster[];
  line: { latitude: number; longitude: number }[];
  /** Image URL for a moment's pin; `null` when there is none. */
  thumbFor: (postId: string) => string | null;
  /** Tap on a pin, with the WHOLE cluster behind it. */
  onCluster: (cluster: Cluster) => void;
  /**
   * Does a tap on this cluster open its list instead of flying into it?
   * Only for the label VoiceOver reads out; the surface doesn't act on it
   * itself, it still reports the tap to `onCluster` as always.
   *
   * It's a prop and not a calculation of the surface, even though
   * `isSameSpot` would be at hand here: since the merge fix round of
   * Phase 7 there's a SECOND reason a tap opens the sheet (the map is at
   * the limit of its zoom levels), and that depends on history only the
   * screen knows. A rule of its own here ran against the one there, and
   * the divergence is only visible to someone who turns on VoiceOver.
   */
  opensSheet: (cluster: Cluster) => boolean;
  /** The map stands still and shows exactly this. Basis of the clustering. */
  onViewportChange: (viewport: Viewport) => void;
  /** DESIGN-LANGUAGE §5: this makes it jump instead of fly. */
  reducedMotion: boolean;
};

// A camera flight is a COMMAND, not state: the same target twice means
// flying twice (tapping the same cluster twice), and a prop with an
// unchanged value would trigger nothing the second time. Hence an
// imperative handle instead of a `target` prop, both versions offer it.
//
// The command applies from mount onward, even from a caller's own
// `useLayoutEffect`: the web version builds its map in a passive effect
// and catches up on a target that arrived earlier, instead of swallowing
// it (reasoning there). The shared player needs exactly that, it jumps to
// the moment from the link on open.
export type MapSurfaceHandle = {
  flyTo: (target: Viewport) => void;
};
