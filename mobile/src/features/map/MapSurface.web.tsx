import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type * as Leaflet from 'leaflet';
// Leaflet's own stylesheet MUST be in the bundle: it positions the tile,
// overlay and marker layers absolutely relative to each other. Without it
// the tiles sit as an unordered stack of images on top of each other and
// no pin sits on its coordinate.
//
// In the test run, jest.leafletCss.js takes its place (Jest has no
// transformer for CSS). The stub isn't merely empty: it leaves a trace
// that MapSurface.web.test.tsx checks for, to make sure this line is
// still here; without it, this would be the one binding requirement of
// the brief that could be silently deleted.
import 'leaflet/dist/leaflet.css';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type ColorTokens } from '@/theme/tokens';
import { pinAppearance, pinLabel } from '@/features/map/pin';
import type { RecapMoment } from '@/features/recap/types';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapSurfaceProps,
} from '@/features/map/types';

// The map surface in the browser, the same contract as MapSurface.tsx
// (features/map/types.ts), different technology: Leaflet on OpenStreetMap
// instead of react-native-maps on Apple Maps, DOM pins instead of marker
// views. Metro picks this version in the web bundle and the native one
// otherwise; no caller knows about it.
//
// What's really different is only the technology. Everything visible stays
// the same: the same round thumbnail pin with a 2px white ring
// (DESIGN-LANGUAGE §4), the same `accent` line at width 3, the same
// counter pill, the same behavior on tap. The map tiles bring their own
// colors, they're content like a photo, not interface (spec decision R2);
// what's binding is what lies ON TOP of them.
//
// Leaflet is an imperative library: it builds its own DOM and can't be
// rendered declaratively. React therefore only holds the shell, everything
// else hangs off effects that bring the map up to the state of the props.

// WITHOUT the `{s}` subdomain pattern Leaflet carries in its examples.
//
// The three names a/b/c stem from the HTTP/1.1 era: browsers back then
// kept only around six connections per host open, and spreading tiles
// over three hosts tripled the limit. `tile.openstreetmap.org` serves
// over HTTP/2 today (measured, not assumed), and there ONE connection
// multiplexes any number of requests. The sharding therefore buys nothing
// anymore and costs two extra DNS lookups and TLS handshakes before the
// first tile is even on its way.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Spec K14 and the tile license: attribution is mandatory.
//
// And exactly this one. The OpenStreetMap Foundation's attribution policy
// requires the wording "© OpenStreetMap contributors" WITH a link to
// openstreetmap.org/copyright, "© OpenStreetMap" alone does not satisfy
// it, neither the missing addition nor the missing link. Leaflet takes
// HTML and shows the notice ONLY when `attribution` is set; whoever
// optimizes it away or shortens it violates the terms under which the
// tiles are served.
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// OpenStreetMap serves tiles up to zoom level 19; Leaflet's default for a
// TileLayer is 18. Without this line, the last level would go unused, of
// all places the one where a cluster falls apart on a city block.
const MAX_ZOOM = 19;

// The pin's dimensions, word for word matching the native version
// (components/MapPin.tsx): 44px including the ring like the largest
// avatar (DESIGN-LANGUAGE §4), ring 2px, counter and video pill 20px each.
const SIZE = 44;
const RING = 2;
const VIDEO_PILL = 20;
const COUNTER = 20;
// The same padding as native. There it's room for the overhanging counter
// pill, because Android clips a marker view at its edges; here nothing
// gets clipped, it stayed because it brings the pin's hit area up to 60px
// and makes the pin equally easy to hit on both platforms.
const PADDING = spacing.s;
const PIN_TOUCH_SIZE = SIZE + 2 * PADDING;

// `shadow.s2` from the tokens, translated to CSS: offset 0/6, radius 16,
// black at 12% (theme/tokens.ts). The RN shape (shadowOffset,
// shadowOpacity, elevation) doesn't exist in the DOM, the value is the
// same.
const SHADOW_S2 = '0 6px 16px rgba(0,0,0,0.12)';

// Lucide's `Play`, as the native pin carries it: outline, stroke 1.75,
// round caps (DESIGN-LANGUAGE §2, icons NEVER filled). Fixed text without
// any interpolation; none of this comes from data.
const PLAY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${cinema['text-1']}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;

// Set styles, but typed.
//
// `Object.assign(el.style, { … })` does NOT check the names: `borderRadus`
// translates cleanly and does nothing. With a dozen style blocks this
// would be the one place in this file where "strict" catches nothing. A
// parameter of type `Partial<CSSStyleDeclaration>` gives an object literal
// the check for excess properties, the typo becomes a compile error.
function setStyles(element: HTMLElement, values: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, values);
}

// Leaflet only gets loaded when the map is set up, not when this module
// loads, and that's not an optimization but the condition for the app to
// build for web at all.
//
// `app.json` sets `web.output: "static"`: expo-router pre-renders every
// route in NODE on export. Leaflet 1.9 accesses `document`, `navigator`
// and `window` at module scope (dist/leaflet-src.js: `var style =
// document.documentElement.style`, `parseInt(/WebKit\/([0-9]+)|$/.exec(
// navigator.userAgent)…`, finally `window.L = exports`), in both builds,
// UMD and ESM alike. A module-scope import made `npx expo export -p web`
// abort with "ReferenceError: window is not defined"; measured, not
// assumed.
//
// `require` inside a function instead of `await import(…)`: Metro's
// module system is CommonJS, the call is synchronous. A dynamic import
// would make the setup effect asynchronous, and that would need state
// that kicks the pin and line effects again afterward, plus a guard for
// the case where the screen is left again before it resolves. Effects run
// in the browser, never in Node: loading here is entirely sufficient.
// Same pattern and same reason as `initErrorReporter()` in
// lib/errorReporter.ts.
//
// Leaflet's stylesheet stays above at module scope: it's plain text that
// Metro collects, and has to go into the exported page's `<head>`.
type LeafletModule = typeof import('leaflet');
function loadLeaflet(): LeafletModule {
  // Exactly here `require` is the intent, not the convenience: an
  // `import` above would load the module when this file loads, see above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('leaflet');
}

// Viewport → Leaflet bounds. `Viewport` describes a center and a span,
// Leaflet works with south-west and north-east corners.
function boundsFor(L: LeafletModule, viewport: Viewport): Leaflet.LatLngBounds {
  return L.latLngBounds(
    [viewport.latitude - viewport.latitudeDelta / 2, viewport.longitude - viewport.longitudeDelta / 2],
    [viewport.latitude + viewport.latitudeDelta / 2, viewport.longitude + viewport.longitudeDelta / 2]
  );
}

// And back: what the map is showing RIGHT NOW.
//
// Leaflet doesn't normalize the longitudes of its bounds to [-180, 180),
// crossing the 180th meridian gives e.g. 190 here. That's exactly right:
// the difference east minus west thereby stays the true span (instead of
// giving 350 instead of 10), and `clustering.toScreen` computes the
// offset modulo 360 anyway.
function viewportFrom(map: Leaflet.Map): Viewport {
  const bounds = map.getBounds();
  const center = bounds.getCenter();
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: bounds.getNorth() - bounds.getSouth(),
    longitudeDelta: bounds.getEast() - bounds.getWest(),
  };
}

// A camera flight. DESIGN-LANGUAGE §5: with reduced motion it jumps
// instead of flying, the same switch as native (animateToRegion/setRegion).
//
// Via center and zoom instead of `fitBounds`: that's how `flyTo` flies,
// and both branches should demonstrably hit the same target.
function flyCamera(L: LeafletModule, map: Leaflet.Map, target: Viewport, reduced: boolean): void {
  const bounds = boundsFor(L, target);
  const zoom = map.getBoundsZoom(bounds);
  const center = bounds.getCenter();
  if (reduced) map.setView(center, zoom, { animate: false });
  // Leaflet computes durations in seconds, the tokens in milliseconds.
  else map.flyTo(center, zoom, { duration: motion.duration.base / 1000 });
}

// The pin as a DOM tree instead of an HTML string.
//
// `L.divIcon` takes both, but a string would mean gluing the image URL
// into a `src="…"`. Signed URLs come from the server, and a quote in one
// would break out of the attribute. With `createElement` and
// `setAttribute` the question doesn't even arise.
function pinElement(
  moment: RecapMoment,
  thumbUrl: string | null,
  count: number,
  colors: ColorTokens
): HTMLElement {
  const outer = document.createElement('div');
  setStyles(outer, {
    width: `${PIN_TOUCH_SIZE}px`,
    height: `${PIN_TOUCH_SIZE}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const frame = document.createElement('div');
  setStyles(frame, {
    position: 'relative',
    boxSizing: 'border-box',
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    borderRadius: `${radius.pill}px`,
    border: `${RING}px solid ${colors['bg-0']}`,
    // Without a usable URL, this calm bg-1 surface stays, like an avatar
    // without a picture. No pulse: in the browser the image loads without
    // the detour over a bridge, and a skeleton for two frames would be
    // noise without information.
    background: colors['bg-1'],
    boxShadow: SHADOW_S2,
  });
  outer.appendChild(frame);

  const clip = document.createElement('div');
  setStyles(clip, {
    position: 'absolute',
    inset: '0',
    borderRadius: `${radius.pill}px`,
    overflow: 'hidden',
  });
  frame.appendChild(clip);

  if (thumbUrl !== null) {
    const image = document.createElement('img');
    image.setAttribute('src', thumbUrl);
    // The pin carries its label outside (see below on the element), a
    // second text on the image would be read out twice by a screen
    // reader.
    image.setAttribute('alt', '');
    setStyles(image, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
    clip.appendChild(image);
  }

  if (moment.type === 'video') {
    const center = document.createElement('div');
    setStyles(center, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    const pill = document.createElement('div');
    setStyles(pill, {
      width: `${VIDEO_PILL}px`,
      height: `${VIDEO_PILL}px`,
      borderRadius: `${radius.pill}px`,
      // Translucent pill like native (DESIGN-LANGUAGE §1: UI on a foreign
      // surface sits exclusively as a pill).
      background: cinema['overlay-pill'],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    pill.innerHTML = PLAY_SVG;
    center.appendChild(pill);
    clip.appendChild(center);
  }

  if (count > 1) {
    const counter = document.createElement('div');
    setStyles(counter, {
      position: 'absolute',
      top: '0',
      right: '0',
      boxSizing: 'border-box',
      minWidth: `${COUNTER}px`,
      height: `${COUNTER}px`,
      padding: `0 ${spacing.xs}px`,
      borderRadius: `${radius.pill}px`,
      background: colors.accent,
      color: colors['on-accent'],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Figtree_500Medium',
      fontSize: '12px',
      letterSpacing: '0.24px',
      // §2: numbers always tabular-nums, an "11" shouldn't be narrower
      // than a "44", otherwise the pill wobbles between two zoom levels.
      fontVariantNumeric: 'tabular-nums',
    });
    counter.textContent = String(count);
    frame.appendChild(counter);
  }

  return outer;
}

function pinIcon(
  L: LeafletModule,
  moment: RecapMoment,
  thumbUrl: string | null,
  count: number,
  colors: ColorTokens
): Leaflet.DivIcon {
  return L.divIcon({
    html: pinElement(moment, thumbUrl, count, colors),
    // Leaflet's own class brings a white box with a border, the pin
    // brings its look entirely by itself.
    className: '',
    iconSize: [PIN_TOUCH_SIZE, PIN_TOUCH_SIZE],
    // The center point sits on the coordinate, not the bottom edge: the
    // pin is a round thumbnail, not a pushpin with a tip.
    iconAnchor: [PIN_TOUCH_SIZE / 2, PIN_TOUCH_SIZE / 2],
  });
}

// What's remembered about a placed pin: its marker, the appearance its
// icon was built for, and the cluster it's CURRENTLY representing.
type Pin = { marker: Leaflet.Marker; appearance: string; cluster: Cluster };

export const MapSurface = forwardRef<MapSurfaceHandle, MapSurfaceProps>(
  function MapSurface(
    {
      initialViewport,
      clusters,
      line,
      thumbFor,
      onCluster,
      opensSheet,
      onViewportChange,
      reducedMotion,
    },
    ref
  ) {
    const { colors } = useTheme();
    const container = useRef<HTMLDivElement | null>(null);
    // The Leaflet module itself, loaded in the setup below (see
    // `loadLeaflet`). It's therefore available from the same moment as
    // `mapRef`, the effects below check both together.
    const leaflet = useRef<LeafletModule | null>(null);
    const mapRef = useRef<Leaflet.Map | null>(null);
    const pins = useRef(new Map<string, Pin>());
    const lineRef = useRef<Leaflet.Polyline | null>(null);

    // What the surface needs to know from the caller at runtime, in ONE
    // place.
    //
    // In a ref, because the receivers get bound to Leaflet ONCE (`map.on`,
    // `marker.on`) and then stay put there. Without this, a click would
    // report to the function from the render in which the pin was set;
    // on the map screen that would be an `onCluster` with the trip id
    // from back then.
    //
    // Updated in an effect, not while rendering: writing to a ref while
    // rendering is the same violation as reading it there
    // (react-hooks/refs). A click comes at the earliest after the commit,
    // so the effect is always earlier.
    const latestRef = useRef({ onViewportChange, onCluster, reducedMotion });
    useEffect(() => {
      latestRef.current = { onViewportChange, onCluster, reducedMotion };
    }, [onViewportChange, onCluster, reducedMotion]);

    const initialViewportRef = useRef(initialViewport);

    // A `flyTo` that arrived BEFORE the setup.
    //
    // `useImperativeHandle` is a layout effect, the setup below a passive
    // one, in between lies a window where the handle exists but the map
    // doesn't yet.
    const pendingTargetRef = useRef<Viewport | null>(null);

    // Build the map, exactly once.
    useEffect(() => {
      const el = container.current;
      if (!el) return;
      // The collection of placed pins, captured for the cleanup below:
      // reading the ref itself only in the cleanup would be a reach into a
      // state that could be a different one by then
      // (react-hooks/exhaustive-deps). The Map is never swapped, only
      // filled and emptied, so the variable points at the same one.
      const placedPins = pins.current;

      const L = loadLeaflet();
      leaflet.current = L;

      const instance = L.map(el, {
        // No +/- buttons: they're Leaflet's own chrome (white box with a
        // border) and would sit on the map surface, where DESIGN-LANGUAGE
        // §1 only allows translucent pills, of all places top left, where
        // the screen's back button sits. The native version shows none
        // there either. Zooming happens with the wheel, gestures, double
        // click and keyboard.
        zoomControl: false,
      });

      // The listener hangs BEFORE the first flight, and that's not
      // cosmetic.
      //
      // Leaflet fires `moveend` synchronously from `_resetView`, even on
      // the very first `setView`. This exact report is the most important
      // of all: `fitBounds` snaps to a WHOLE zoom level and thereby
      // regularly shows noticeably more than requested. If it were lost,
      // the screen would cluster by hand up to the first movement with
      // the REQUESTED instead of the VISIBLE delta: `toScreen` would
      // calculate too many screen points per degree, and pins covering
      // each other on screen would get no shared cluster. Natively,
      // `onRegionChangeComplete` corrects the same difference after
      // layout.
      instance.on('moveend', () => latestRef.current.onViewportChange(viewportFrom(instance)));

      instance.fitBounds(boundsFor(L, initialViewportRef.current), { animate: false });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: MAX_ZOOM,
        // Only fetch tiles once the map STANDS STILL. Leaflet's default is
        // the opposite (`updateWhenIdle: Browser.mobile`, i.e. `false` in
        // a desktop browser): there it keeps loading during the whole
        // drag, and a single pan across a continent requests dozens of
        // tiles that are already out of frame the next moment.
        //
        // The OSM Foundation's tile usage policy names exactly this as
        // undesirable (they serve from donations, not a CDN budget), and
        // the map doesn't lose anything by it: it clusters its pins anew
        // only once the movement ends anyway (`moveend`).
        //
        // What doesn't work here: the policy also requires a custom
        // user agent. In a browser, the browser sets that, a page can't
        // determine it; this app is identifiable there only via the
        // `Referer` of its own domain. Should the map ever fetch tiles
        // outside a browser, it belongs set there.
        updateWhenIdle: true,
      }).addTo(instance);

      mapRef.current = instance;

      const pending = pendingTargetRef.current;
      pendingTargetRef.current = null;
      if (pending) flyCamera(L, instance, pending, latestRef.current.reducedMotion);

      return () => {
        // Without `remove()`, tile requests and resize/window listeners
        // stay hanging, the map would be out of the tree, its image
        // stream would keep running.
        instance.remove();
        mapRef.current = null;
        leaflet.current = null;
        placedPins.clear();
        lineRef.current = null;
      };
    }, []);

    // Camera flights. Deps empty, the handle thus immutable: what `flyTo`
    // should do right now lives in the ref above, a handle that gets
    // rebuilt on every change of `reducedMotion` would force every caller
    // to re-grab it.
    useImperativeHandle(
      ref,
      () => ({
        flyTo: (target: Viewport) => {
          const instance = mapRef.current;
          const L = leaflet.current;
          if (!instance || !L) {
            pendingTargetRef.current = target;
            return;
          }
          flyCamera(L, instance, target, latestRef.current.reducedMotion);
        },
      }),
      []
    );

    useEffect(() => {
      const instance = mapRef.current;
      const L = leaflet.current;
      if (!instance || !L) return;
      const existingPins = pins.current;
      const seen = new Set<string>();

      for (const cluster of clusters) {
        const anchor = cluster.anchor;
        const id = anchor.moment.id;
        seen.add(id);
        const thumbUrl = thumbFor(id);
        const count = cluster.points.length;
        const appearance = pinAppearance(anchor.moment, thumbUrl, count);
        const label = pinLabel(anchor.moment, count, opensSheet(cluster));

        let pin = existingPins.get(id);
        if (!pin) {
          const marker = L.marker([anchor.lat, anchor.lng], {
            // Once merged, the pin is ONE element, it must be reachable
            // without a mouse too. Leaflet sets `tabindex` for that and
            // triggers the same `click` on Enter.
            icon: pinIcon(L, anchor.moment, thumbUrl, count, colors),
            keyboard: true,
          });
          pin = { marker, appearance, cluster };
          const entry = pin;
          marker.on('click', () => latestRef.current.onCluster(entry.cluster));
          marker.addTo(instance);
          existingPins.set(id, pin);
        } else {
          pin.cluster = cluster;
          if (pin.appearance !== appearance) {
            pin.marker.setIcon(pinIcon(L, anchor.moment, thumbUrl, count, colors));
            pin.appearance = appearance;
          }
        }

        // The label hangs on the element, not on the icon: it can change
        // without the appearance changing. A cluster of the same size
        // says "view" instead of "zoom in" as soon as it sits at the same
        // spot, and likewise as soon as a zoom attempt hasn't moved the
        // camera anymore (clusterTap.ts). Tied to the icon, it would stay
        // put in exactly these cases, and the label would promise
        // something the click doesn't deliver.
        const element = pin.marker.getElement();
        if (element) {
          element.setAttribute('role', 'button');
          element.setAttribute('aria-label', label);
        }
      }

      for (const [id, pin] of existingPins) {
        if (seen.has(id)) continue;
        pin.marker.remove();
        existingPins.delete(id);
      }
      // `opensSheet` belongs in the dependencies even though it only
      // affects the label: the answer depends on history (clusterTap.ts),
      // and an effect that doesn't reread it would keep the label at its
      // previous state. The screen passes in a reference-stable function,
      // so the effect doesn't run more often because of this.
    }, [clusters, thumbFor, opensSheet, colors]);

    // The trip as a line (Spec K3/§5.6). It sits in Leaflet's
    // `overlayPane` and thus automatically UNDER the pins (`markerPane`),
    // the native version achieves the same via order in the tree. Under
    // two points there's nothing to connect.
    useEffect(() => {
      const instance = mapRef.current;
      const L = leaflet.current;
      if (!instance || !L) return;
      const points: Leaflet.LatLngExpression[] = line.map((p) => [p.latitude, p.longitude]);

      if (points.length < 2) {
        lineRef.current?.remove();
        lineRef.current = null;
        return;
      }
      if (lineRef.current) {
        lineRef.current.setLatLngs(points);
        lineRef.current.setStyle({ color: colors.accent });
        return;
      }
      lineRef.current = L.polyline(points, { color: colors.accent, weight: 3 }).addTo(instance);
    }, [line, colors]);

    // The container fills the screen, like `StyleSheet.absoluteFill`
    // natively. Leaflet writes its own DOM into it, React doesn't touch it
    // again after mounting.
    return (
      <div
        ref={container}
        data-testid="map-surface"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
    );
  }
);
