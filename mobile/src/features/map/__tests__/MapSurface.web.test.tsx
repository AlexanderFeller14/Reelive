/**
 * @jest-environment jsdom
 */
import { act, createRef, useLayoutEffect, type Ref, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import L from 'leaflet';
import { motion, palette } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapSurfaceProps,
  MapPoint,
} from '@/features/map/types';
import { TILE_ATTRIBUTION, TILE_URL, MapSurface } from '../MapSurface.web';

// The browser version, against REAL Leaflet in jsdom, not against a mock.
// The reason stands at the first test: that an option turns into a
// visible license notice is Leaflet's decision. A mock would certify the
// call and still let a map without attribution through.
//
// Rendered with `react-dom` instead of @testing-library/react-native: this
// version builds real DOM (it's allowed to, in the browser React Native
// Web renders there anyway), and Leaflet needs a container to attach
// itself to. The native version and the contract both fulfill live in
// MapSurface.test.tsx.

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
    ...overrides,
  };
}

function point(id: string, lat: number, lng: number, index: number): MapPoint {
  return { moment: moment({ id, lat, lng }), lat, lng, index };
}

const pA = point('p1', 38.71, -9.14, 0);
const pB = point('p2', 38.72, -9.13, 1);
const clusterA: Cluster = { anchor: pA, points: [pA] };
const clusterB: Cluster = { anchor: pB, points: [pB] };
const separable: Cluster = { anchor: pA, points: [pA, pB] };

const VIEWPORT: Viewport = {
  latitude: 38.715, longitude: -9.135, latitudeDelta: 0.02, longitudeDelta: 0.02,
};
const TARGET: Viewport = {
  latitude: 38.71, longitude: -9.14, latitudeDelta: 0.004, longitudeDelta: 0.004,
};

const base: MapSurfaceProps = {
  initialViewport: VIEWPORT,
  clusters: [],
  line: [],
  thumbFor: () => null,
  onCluster: () => {},
  // The surface no longer calculates itself whether a tap opens the
  // sheet, it asks (features/map/types.ts). `false` is the normal case: a
  // cluster you can still fly into.
  opensSheet: () => false,
  onViewportChange: () => {},
  reducedMotion: false,
};

const WIDTH = 800;
const HEIGHT = 600;

beforeAll(() => {
  // jsdom measures every element at 0x0. Leaflet reads its container's
  // size via `clientWidth`/`clientHeight`, without these two lines every
  // viewport would be empty and `getBoundsZoom` would run toward infinity.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: WIDTH });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: HEIGHT });
  // jsdom doesn't know `SVGSVGElement.createSVGRect`, and that's exactly
  // how Leaflet detects on load whether SVG is available (`Browser.svg`).
  // Without this line it would fall back to a renderer it would never
  // take in a real browser, and the line wouldn't be an element at all
  // anymore, but a stroke on a canvas. The switch sets up what every
  // browser brings along.
  (L.Browser as { svg: boolean }).svg = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let mapSpy: jest.SpyInstance<L.Map, Parameters<typeof L.map>>;

// The Leaflet instance the component created. It doesn't expose it to the
// outside (it's a detail of its technology), for the test it's the only
// way to trigger a real map movement instead of replaying one.
function mapInstance(): L.Map {
  const result = mapSpy.mock.results[0];
  if (!result || result.type !== 'return') throw new Error('no map created');
  return result.value;
}

async function draw(
  props: Partial<MapSurfaceProps> = {},
  ref?: Ref<MapSurfaceHandle>
): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<MapSurface ref={ref} {...base} {...props} />);
  });
  return container;
}

async function redraw(props: Partial<MapSurfaceProps>, ref?: Ref<MapSurfaceHandle>) {
  await act(async () => {
    root?.render(<MapSurface ref={ref} {...base} {...props} />);
  });
}

async function teardown() {
  const previous = root;
  root = null;
  await act(async () => {
    previous?.unmount();
  });
}

function pins(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.leaflet-marker-icon'));
}

function linePath(host: HTMLElement): SVGPathElement | null {
  return host.querySelector<SVGPathElement>('.leaflet-overlay-pane path');
}

// The image FROM THE PIN, not the first `img` in the container: Leaflet's
// tiles are `img` too, and they sit in the tree before the pins.
function pinImage(host: HTMLElement, position = 0): HTMLImageElement | null {
  return pins(host)[position]?.querySelector('img') ?? null;
}

beforeEach(() => {
  // Without mockImplementation: the spy calls the real factory and just
  // remembers what it returned.
  mapSpy = jest.spyOn(L, 'map');
});

afterEach(async () => {
  if (root) await teardown();
  container?.remove();
  container = null;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Attribution, Spec K14 and the tile license
// ---------------------------------------------------------------------------

// THE test of this file. OpenStreetMap's tiles may only be used with
// attribution, and Leaflet shows the notice ONLY when `attribution` is
// set. Optimizing the value away breaks nothing that would stand out, the
// map would look exactly the same, just without the license notice, and
// the breach would only show up in a cease-and-desist letter.
//
// Checked against the rendered DOM, not the passed value: that the option
// becomes a visible notice is Leaflet's decision.
test('the map credits OpenStreetMap visibly', async () => {
  const host = await draw();
  expect(host.querySelector('.leaflet-control-attribution')?.textContent).toContain(
    'OpenStreetMap'
  );
});

// And exactly as the OpenStreetMap Foundation's attribution policy
// requires it: the wording "© OpenStreetMap contributors" WITH a link to
// openstreetmap.org/copyright. "© OpenStreetMap" alone does not satisfy
// it, neither the missing addition nor the missing link. K14 promises
// license compliance, not a string of characters.
test('the attribution satisfies the terms of the license', async () => {
  const host = await draw();
  const notice = host.querySelector('.leaflet-control-attribution');
  expect(notice?.textContent).toContain('© OpenStreetMap contributors');
  const link = notice?.querySelector<HTMLAnchorElement>(
    'a[href="https://www.openstreetmap.org/copyright"]'
  );
  expect(link).not.toBeNull();
  expect(link?.textContent).toBe('OpenStreetMap');
});

test('the tiles come from OpenStreetMap', async () => {
  const tiles = jest.spyOn(L, 'tileLayer');
  await draw();
  expect(tiles).toHaveBeenCalledTimes(1);
  expect(tiles.mock.calls[0][0]).toBe(TILE_URL);
  expect(TILE_URL).toContain('tile.openstreetmap.org');
  expect(tiles.mock.calls[0][1]?.attribution).toBe(TILE_ATTRIBUTION);
});

// What the OSM Foundation's tile policy requires of an app, as far as a
// page in a browser can influence it at all. Attribution is checked by
// the test above, here are the two points that determine the NUMBER of
// requests.
describe('the map is sparing with someone else\'s tiles', () => {
  test('it only loads once the map stands still, not while dragging', async () => {
    const tiles = jest.spyOn(L, 'tileLayer');
    await draw();
    // Leaflet's default is `false` in a desktop browser: there it keeps
    // loading during every movement, and a single pan across a continent
    // requests dozens of tiles that are already out of frame the next
    // frame.
    expect(tiles.mock.calls[0][1]?.updateWhenIdle).toBe(true);
  });

  // No `{s}`: the three names a/b/c are an HTTP/1.1 workaround, and
  // tile.openstreetmap.org serves over HTTP/2. They'd cost two extra DNS
  // lookups and TLS handshakes there and buy nothing.
  test('it does not spread its requests over three hosts', async () => {
    expect(TILE_URL).not.toContain('{s}');
    expect(TILE_URL.startsWith('https://tile.openstreetmap.org/')).toBe(true);
  });

  // And the upper limit: OpenStreetMap serves up to level 19. Without it
  // the map would request tiles at level 20 that don't exist, and get a
  // 404 for each.
  test('it does not request a zoom level that does not exist', async () => {
    const tiles = jest.spyOn(L, 'tileLayer');
    await draw();
    expect(tiles.mock.calls[0][1]?.maxZoom).toBe(19);
  });
});

// Leaflet's own stylesheet MUST be in the bundle, without it the tiles sit
// as an unordered stack of images on top of each other and no pin sits on
// its coordinate. That's the one binding requirement of this version whose
// absence shows up in no test: `moduleNameMapper` replaces the file, and an
// empty replacement makes the missing import invisible.
//
// The replacement (jest.leafletCss.js) therefore leaves a trace. It's set
// exactly when `import 'leaflet/dist/leaflet.css'` is in the version, this
// test file imports the version above and nothing else that would pull in
// the stylesheet.
test('Leaflet\'s stylesheet is in the bundle', () => {
  const trace = (globalThis as { __leafletCssImportiert?: boolean }).__leafletCssImportiert;
  expect(trace).toBe(true);
});

// ---------------------------------------------------------------------------
// The viewport it opens with, and the one it reports
// ---------------------------------------------------------------------------

test('opens with the given viewport', async () => {
  await draw({ clusters: [clusterA] });
  const map = mapInstance();
  expect(map.getCenter().lat).toBeCloseTo(VIEWPORT.latitude, 3);
  expect(map.getCenter().lng).toBeCloseTo(VIEWPORT.longitude, 3);
  // The whole requested viewport must be visible, otherwise a moment
  // would lie outside the image even though the map was opened for it.
  expect(
    map.getBounds().contains(
      L.latLngBounds(
        [VIEWPORT.latitude - VIEWPORT.latitudeDelta / 2, VIEWPORT.longitude - VIEWPORT.longitudeDelta / 2],
        [VIEWPORT.latitude + VIEWPORT.latitudeDelta / 2, VIEWPORT.longitude + VIEWPORT.longitudeDelta / 2]
      )
    )
  ).toBe(true);
});

// The FIRST viewport has to be reported too, not just the second one.
//
// `fitBounds` snaps to a whole zoom level and thereby regularly shows
// noticeably more than requested. If this one report were missing, the
// screen would cluster by hand up to the first movement with the
// REQUESTED instead of the VISIBLE delta, `toScreen` would calculate too
// many screen points per degree, and pins covering each other on screen
// would get no shared cluster. Natively, `onRegionChangeComplete`
// corrects the same difference after layout.
//
// Leaflet fires `moveend` synchronously from the first `setView`, the
// report only gets lost if the listener is attached only AFTER
// `fitBounds`. That's exactly why there's no `mockClear()` before the
// assertion here.
test('reports the viewport it opens with already', async () => {
  const onViewportChange = jest.fn<void, [Viewport]>();
  await draw({ clusters: [clusterA], onViewportChange });

  expect(onViewportChange).toHaveBeenCalled();
  const reported = onViewportChange.mock.calls[0][0];
  const bounds = mapInstance().getBounds();
  expect(reported.latitudeDelta).toBeCloseTo(bounds.getNorth() - bounds.getSouth(), 9);
  expect(reported.longitudeDelta).toBeCloseTo(bounds.getEast() - bounds.getWest(), 9);
});

// And the counter-proof that shows why the report above is needed:
// `fitBounds` really does show more than requested. Without this
// difference, the test above would be an assertion without a subject.
test('the visible viewport is wider than the requested one', async () => {
  await draw({ clusters: [clusterA] });
  const bounds = mapInstance().getBounds();
  expect(bounds.getNorth() - bounds.getSouth()).toBeGreaterThan(VIEWPORT.latitudeDelta);
});

// `moveend` is Leaflet's `onRegionChangeComplete`: the map stands still
// and shows exactly this. Without this report, the screen would cluster
// forever by the zoom the map opened with, a cluster would never fall
// apart through any more zooming in.
test('reports the viewport once the map stands still', async () => {
  const onViewportChange = jest.fn<void, [Viewport]>();
  await draw({ clusters: [clusterA], onViewportChange });
  const before = onViewportChange.mock.calls.length;

  const map = mapInstance();
  await act(async () => {
    map.setZoom(map.getZoom() + 2, { animate: false });
  });

  expect(onViewportChange.mock.calls.length).toBeGreaterThan(before);
});

// And the report describes what's REALLY visible: center and spans come
// from the map itself. The screen measures distances in screen points, a
// span that's wrong clusters incorrectly.
test('the report describes exactly the viewport of the map', async () => {
  const onViewportChange = jest.fn<void, [Viewport]>();
  await draw({ clusters: [clusterA], onViewportChange });
  const map = mapInstance();
  await act(async () => {
    map.setZoom(map.getZoom() + 2, { animate: false });
  });

  const reported = onViewportChange.mock.calls.at(-1)?.[0];
  const bounds = map.getBounds();
  expect(reported?.latitude).toBeCloseTo(bounds.getCenter().lat, 9);
  expect(reported?.longitude).toBeCloseTo(bounds.getCenter().lng, 9);
  expect(reported?.latitudeDelta).toBeCloseTo(bounds.getNorth() - bounds.getSouth(), 9);
  expect(reported?.longitudeDelta).toBeCloseTo(bounds.getEast() - bounds.getWest(), 9);
});

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

test('places one pin per cluster', async () => {
  const host = await draw({ clusters: [clusterA, clusterB] });
  expect(pins(host)).toHaveLength(2);
});

test('a cluster that goes away takes its pin with it', async () => {
  const host = await draw({ clusters: [clusterA, clusterB] });
  await redraw({ clusters: [clusterA] });
  expect(pins(host)).toHaveLength(1);
});

test('the pin carries the image of its anchor', async () => {
  const host = await draw({
    clusters: [separable],
    thumbFor: (postId) => `https://cdn.example/${postId}.jpg`,
  });
  expect(pinImage(host)?.getAttribute('src')).toBe('https://cdn.example/p1.jpg');
});

test('the pin of a cluster shows its count', async () => {
  const host = await draw({ clusters: [separable] });
  expect(pins(host)[0].textContent).toContain('2');
});

// A cluster of one is not a cluster, it carries no "1".
test('a single pin shows no number', async () => {
  const host = await draw({ clusters: [clusterA] });
  expect(pins(host)[0].textContent).toBe('');
});

// Once merged, the pin is ONE element. What a click triggers stands only
// in the label, and in the same wording as native (features/map/pin.ts),
// so both platforms promise the same thing.
test('the pin says what a click on it does', async () => {
  const host = await draw({ clusters: [separable] });
  expect(pins(host)[0].getAttribute('aria-label')).toBe('Auf 2 Momente heranzoomen');
  expect(pins(host)[0].getAttribute('role')).toBe('button');
});

// Like native: the surface doesn't calculate the switch itself, it asks
// the screen. Until the merge it only knew half the reason (`isSameSpot`)
// and kept promising a zoom on a stuck cluster that no click would
// deliver anymore. The cluster here deliberately has two different
// coordinates: all that counts is the answer.
test('the surface does not calculate the answer itself, it asks', async () => {
  const host = await draw({ clusters: [separable], opensSheet: () => true });
  expect(pins(host)[0].getAttribute('aria-label')).toBe('2 Momente an diesem Ort ansehen');
});

test('asked with the WHOLE cluster, not just its anchor', async () => {
  const opensSheet = jest.fn(() => false);
  await draw({ clusters: [separable], opensSheet });
  expect(opensSheet).toHaveBeenCalledWith(separable);
});

test('reports the click on a cluster upward', async () => {
  const onCluster = jest.fn();
  const host = await draw({ clusters: [clusterA, clusterB], onCluster });
  await act(async () => {
    pins(host)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(onCluster).toHaveBeenCalledTimes(1);
  expect(onCluster).toHaveBeenCalledWith(clusterB);
});

// The click reports the cluster of NOW, not the one from back then: the
// pin stays put while zooming, its cluster keeps changing underneath. A
// closure on the cluster from the render in which the pin was set would
// later report one that no longer exists, and the sheet would show
// moments that already have their own pin.
test('the click reports the current cluster, not the one from back then', async () => {
  const onCluster = jest.fn();
  const host = await draw({ clusters: [separable], onCluster });
  await redraw({ clusters: [clusterA], onCluster });

  await act(async () => {
    pins(host)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(onCluster).toHaveBeenCalledWith(clusterA);
});

// The counterpart to `tracksViewChanges` natively: a pin whose appearance
// is unchanged stays as DOM. Rebuilt, its image would reload on every map
// movement, and the pin would flicker while panning.
test('unchanged pins are not rebuilt on redraw', async () => {
  const thumbFor = (postId: string) => `https://cdn.example/${postId}.jpg`;
  const host = await draw({ clusters: [clusterA], thumbFor });
  const before = pinImage(host);
  expect(before).not.toBeNull();

  // A new array with the same content: exactly what every map movement
  // produces (the screen clusters again on every reported viewport).
  await redraw({ clusters: [{ ...clusterA }], thumbFor });
  expect(pinImage(host)).toBe(before);
});

// And the counter-proof, without which leaving it in place above would be
// a trap: if the appearance changes, the pin MUST be rebuilt, otherwise a
// cluster would keep its old count after growing.
test('a changed appearance rebuilds the pin', async () => {
  const host = await draw({ clusters: [clusterA] });
  const before = pins(host)[0].firstElementChild;
  await redraw({ clusters: [separable] });

  expect(pins(host)[0].firstElementChild).not.toBe(before);
  expect(pins(host)[0].textContent).toContain('2');
});

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

test('flyTo() flies the map to the target', async () => {
  const flight = jest.spyOn(L.Map.prototype, 'flyTo');
  const handle = createRef<MapSurfaceHandle>();
  await draw({ clusters: [clusterA] }, handle);

  await act(async () => {
    handle.current?.flyTo(TARGET);
  });

  expect(flight).toHaveBeenCalledTimes(1);
  const [center, , options] = flight.mock.calls[0];
  expect(L.latLng(center).lat).toBeCloseTo(TARGET.latitude, 6);
  expect(L.latLng(center).lng).toBeCloseTo(TARGET.longitude, 6);
  // Leaflet computes durations in seconds, the tokens in milliseconds.
  expect(options?.duration).toBe(motion.duration.base / 1000);
});

// The flight goes IN: the target is tighter than the viewport it was
// tapped from, so the zoom level has to increase. A flight that zooms out
// in the process would be the opposite of what a tap on a cluster should
// do.
test('flyTo() zooms in on a tighter target', async () => {
  const handle = createRef<MapSurfaceHandle>();
  await draw({ clusters: [clusterA], reducedMotion: true }, handle);
  const map = mapInstance();
  const before = map.getZoom();

  await act(async () => {
    handle.current?.flyTo(TARGET);
  });
  expect(map.getZoom()).toBeGreaterThan(before);
});

// DESIGN-LANGUAGE §5 / Spec K12: with reduced motion it jumps instead of
// flying, the same switch as in the native version.
test('with reduced motion, flyTo() jumps instead of flying', async () => {
  const flight = jest.spyOn(L.Map.prototype, 'flyTo');
  const jump = jest.spyOn(L.Map.prototype, 'setView');
  const handle = createRef<MapSurfaceHandle>();
  await draw({ clusters: [clusterA], reducedMotion: true }, handle);
  jump.mockClear();

  await act(async () => {
    handle.current?.flyTo(TARGET);
  });

  expect(flight).not.toHaveBeenCalled();
  expect(jump).toHaveBeenCalledTimes(1);
  expect(jump.mock.calls[0][2]?.animate).toBe(false);
});

// A `flyTo` from the caller's layout effect, immediately after mounting.
// That's exactly how the shared player (Task 15) will use the surface: it
// jumps to the moment from the link on open, without waiting for a user
// action.
//
// `useImperativeHandle` is a layout effect, the map setup here a passive
// one, in between stands the handle, but no map yet. Without precautions
// the command would be swallowed SILENTLY, and only in the browser:
// natively the MapView ref is already set at commit. The same assertion
// therefore stands word for word in MapSurface.test.tsx.
function EarlyTarget({ handle }: { handle: RefObject<MapSurfaceHandle | null> }) {
  useLayoutEffect(() => {
    handle.current?.flyTo(TARGET);
  }, [handle]);
  return null;
}

test('a flyTo() from the caller\'s layout effect is not lost', async () => {
  const handle = createRef<MapSurfaceHandle>();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <>
        <MapSurface {...base} clusters={[clusterA]} reducedMotion ref={handle} />
        <EarlyTarget handle={handle} />
      </>
    );
  });

  const center = mapInstance().getCenter();
  expect(center.lat).toBeCloseTo(TARGET.latitude, 6);
  expect(center.lng).toBeCloseTo(TARGET.longitude, 6);
});

// "Jumps" alone isn't an assertion: a jump to 0/0 would be one too.
test('the jump hits the same target as the flight', async () => {
  const handle = createRef<MapSurfaceHandle>();
  await draw({ clusters: [clusterA], reducedMotion: true }, handle);

  await act(async () => {
    handle.current?.flyTo(TARGET);
  });
  const center = mapInstance().getCenter();
  expect(center.lat).toBeCloseTo(TARGET.latitude, 6);
  expect(center.lng).toBeCloseTo(TARGET.longitude, 6);
});

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

const LINE = [
  { latitude: 38.71, longitude: -9.14 },
  { latitude: 38.72, longitude: -9.13 },
];

test('the line is the accent at width 3', async () => {
  const host = await draw({ line: LINE });
  expect(linePath(host)?.getAttribute('stroke')).toBe(palette.accent);
  expect(linePath(host)?.getAttribute('stroke-width')).toBe('3');
});

// A line needs two points, otherwise an overlay would sit on the map that
// connects nothing.
test('a single point yields no line', async () => {
  const host = await draw({ line: [LINE[0]] });
  expect(linePath(host)).toBeNull();
});

// The day filter can shrink the line to a single point, then it has to
// disappear, not stay as a remnant.
test('when the line shrinks to a point, it disappears', async () => {
  const host = await draw({ line: LINE });
  expect(linePath(host)).not.toBeNull();
  await redraw({ line: [LINE[0]] });
  expect(linePath(host)).toBeNull();
});

// And it doesn't get a second element when it changes, for the same
// reason as the pins above.
test('a changed line does not get a second element', async () => {
  const host = await draw({ line: LINE });
  const before = linePath(host);

  await redraw({ line: [...LINE, { latitude: 38.75, longitude: -9.1 }] });
  expect(linePath(host)).toBe(before);
  expect(host.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// Without `map.remove()`, tile requests and window listeners stay
// hanging: the map would be out of the tree, its image stream would keep
// running. On a screen you enter and leave, that accumulates.
test('the map cleans up on teardown', async () => {
  const cleanup = jest.spyOn(L.Map.prototype, 'remove');
  const host = await draw({ clusters: [clusterA] });
  expect(pins(host)).toHaveLength(1);

  await teardown();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.leaflet-marker-icon')).toBeNull();
});
