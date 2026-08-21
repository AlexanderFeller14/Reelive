import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// Steerable like in app/__tests__/preview.test.tsx: only this way is the
// replace branch of goBack() reachable at all, with a canGoBack hardwired to
// `true` it stays dead code from a test's point of view.
let mockCanGoBack = true;
// Real effect semantics instead of `(cb) => cb()`: the latter fires on every
// render and has already cost time twice in trip/__tests__/list.test.tsx and
// detail.test.tsx as soon as a load path delivers a fresh array.
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
    useLocalSearchParams: () => ({ id: 't1' }),
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
  };
});
// expo-image is a native view; a plain placeholder passing all props through
// (incl. `source`, `testID`) is enough and lets each tile be checked for
// WHICH url it actually pulled.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrip: jest.fn() }));
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMoments: jest.fn() }));
// Only the IO function is mocked. `retryHelps` stays real: it is the rule for
// whether "Nochmal versuchen" can achieve anything at all, and mocking it
// would take away the very assurance these tests are about.
// `jest.requireActual` drags in @/lib/supabase, hence its mock beside it
// (same pattern as in player.test.tsx).
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('@/features/recap/urlPool', () => ({
  ...jest.requireActual('@/features/recap/urlPool'),
  getPool: jest.fn(),
}));
// Mutable so single tests can switch the owner role (same pattern as
// trip/__tests__/detail.test.tsx).
const mockAuth = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
// ShareSheetContent has its own complete test file
// (features/sharing/__tests__/ShareSheetContent.test.tsx); here only a
// placeholder proving THAT and WITH WHICH tripId it gets mounted, without
// dragging this file's supabase call chain in through the import graph (it is
// unmocked here and would throw on module load, see @/lib/supabase).
jest.mock('@/features/sharing/ShareSheetContent', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return {
    ShareSheetContent: ({ tripId }: { tripId: string }) =>
      ReactActual.createElement(Text, { testID: 'mock-share-sheet-content' }, tripId),
  };
});
// exportApi has its own complete test file
// (features/recap/__tests__/exportApi.test.ts), here only a spy. A real import
// would pull in expo-media-library, which cannot be mocked in this jest setup
// (native class inheritance, see the comment there).
jest.mock('@/features/recap/exportApi', () => ({ saveAllToGallery: jest.fn() }));
const mockOpenSettings = jest.fn(() => Promise.resolve());
jest.mock('expo-linking', () => ({ openSettings: () => mockOpenSettings() }));

import RecapOverview from '../[id]/overview';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { saveAllToGallery } from '@/features/recap/exportApi';
import { getPool } from '@/features/recap/urlPool';

const trip = {
  id: 't1', name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14',
  status: 'revealed' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 5,
};

function moment(overrides: Partial<{
  id: string; captured_at: string; place_name: string | null; upload_status: 'pending' | 'uploaded';
  type: 'photo' | 'video';
}>) {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo' as const, duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    upload_status: 'uploaded' as const, authorName: 'Lea',
    ...overrides,
  };
}

// Chronological (local time Lisbon, summer: UTC+1): p5 07:00, p1 09:00,
// p2 18:00, all day 1; p4 (straggler) also day 1, but it does not disturb the
// grouping (as 'pending' it is filtered out before groupByDays sees it); p3 on
// the 11th is day 2, without a place_name, which checks that the place drops
// out of the heading instead of showing an empty placeholder.
//
// p5 is 'uploaded' but deliberately NOT in the pool (the function could not
// issue a url), and deliberately placed BEFORE p1, not behind it: standing
// chronologically last, its omission would go unnoticed by any index, because
// no visible moment behind it could shift. Only placed BEFORE p1 does an index
// counted over the full list (skipped ones included) instead of over the
// visible one show up as an error.
const skippedM = moment({ id: 'p5', captured_at: '2026-08-10T07:00:00.000Z' });
const m1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const m2 = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z' });
const pendingM = moment({ id: 'p4', captured_at: '2026-08-10T20:00:00.000Z', upload_status: 'pending' });
const m3 = moment({ id: 'p3', captured_at: '2026-08-11T10:00:00.000Z', place_name: null });

// Already sorted chronologically, the way recapApi.fetchRecapMoments would
// deliver it; the component does not sort again.
const COMPLETE = [skippedM, m1, m2, pendingM, m3];

function image(id: string) {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}

const POOL_OK = {
  urls: new Map([['p1', image('p1')], ['p2', image('p2')], ['p3', image('p3')]]),
  validUntil: Date.now() + 999_999,
  skipped: 1,
};

const wrap = () => render(<ThemeProvider><RecapOverview /></ThemeProvider>);

// A load path that runs through cleanly but delivers nothing visible, for all
// tests that are not about the tiles but about what stands in the head of the
// screen regardless of them (share button, segment row). Module-wide instead
// of twice locally: two copies would drift apart eventually, and both blocks
// want exactly the same state.
const emptyLoadSuccess = () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
    error: null,
    reason: null,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockAuth.userId = 'u1';
  (fetchTrip as jest.Mock).mockResolvedValue({ data: trip, error: null });
});

// The overview opens with the photo hero now (Task 9, recap-show plan); the
// seal moved into the player (Task 2-4) and the popcorn image left with it.
test('the overview opens with the hero, not with a seal', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  expect(await screen.findByTestId('recap-hero-image')).toBeTruthy();
  expect(screen.queryByTestId('recap-seal')).toBeNull();
  expect(screen.queryByTestId('recap-popcorn')).toBeNull();
});

// The card in the tab list shows `my_post_count` (the owner's own
// contribution); the hero counts the DISPLAYED moments of all travellers
// together. `my_post_count` is deliberately set to a THIRD number here (not
// 3, not the shared fixture's 5), so a hero that read the wrong field would
// show a wrong count instead of accidentally matching by coincidence.
test('the hero counts all moments of the recap, not only my own', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, my_post_count: 7 }, error: null });
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  expect(await screen.findByText(/3 Momente/)).toBeTruthy();
});

test('play from the hero repeats the show without a seal, so with start=0', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  fireEvent.press(await screen.findByTestId('recap-hero-play'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player', params: { id: 't1', start: '0' },
  });
});

test('groups by days with the place name, and drops it where no moment carries one', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  expect(await screen.findByText('Tag 1')).toBeTruthy();
  expect(screen.getByText('Lissabon · 10. August')).toBeTruthy();
  expect(screen.getByText('Tag 2')).toBeTruthy();
  expect(screen.getByText('11. August')).toBeTruthy();
});

test('the days stand in chronological order, not backwards', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  await screen.findByText('Tag 1');

  const headings = screen.getAllByText(/^Tag \d$/).map((el) => el.props.children);
  expect(headings).toEqual(['Tag 1', 'Tag 2']);
});

test('stragglers and skipped moments get no tile, but each an honest line', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  await screen.findByText('Tag 1');

  expect(screen.getAllByTestId(/^recap-tile-/)).toHaveLength(3);
  expect(screen.queryByTestId(/^recap-tile-.*-p4$/)).toBeNull();
  expect(screen.queryByTestId(/^recap-tile-.*-p5$/)).toBeNull();

  expect(screen.getByText('1 Moment ist noch unterwegs.')).toBeTruthy();
  expect(screen.getByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
});

test('plural wording for several stragglers and several skipped moments', async () => {
  const pending2 = moment({ id: 'p6', captured_at: '2026-08-10T21:00:00.000Z', upload_status: 'pending' });
  const pending3 = moment({ id: 'p7', captured_at: '2026-08-10T22:00:00.000Z', upload_status: 'pending' });
  const skipped2 = moment({ id: 'p8', captured_at: '2026-08-10T23:00:00.000Z' });
  (fetchRecapMoments as jest.Mock).mockResolvedValue({
    data: [skippedM, m1, pendingM, pending2, pending3, skipped2],
    error: null,
  });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map([['p1', image('p1')]]), validUntil: Date.now() + 999_999, skipped: 2 },
    error: null,
    reason: null,
  });
  await wrap();
  expect(await screen.findByText('3 Momente sind noch unterwegs.')).toBeTruthy();
  expect(screen.getByText('2 Momente liessen sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.getAllByTestId(/^recap-tile-/)).toHaveLength(1);
});

// The core case: p5 lies chronologically BEFORE all visible tiles (see the
// fixture comment above). Counting the index over the full list instead of
// over the visible moments would give p1 the index 1 instead of 0, and the
// player would open the second moment on a tap on the first tile.
test('a tap on a tile hands over the right start index, counted across the day border', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  await screen.findByText('Tag 1');

  // Day 1 has exactly two visible moments (p1, p2) -> a `pair` row, both
  // `half`; day 2 has exactly one (p3) -> a `single` row, `wide`.
  await fireEvent.press(screen.getByTestId('recap-tile-half-p1'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/player', params: { id: 't1', start: '0' } });

  await fireEvent.press(screen.getByTestId('recap-tile-wide-p3'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/player', params: { id: 't1', start: '2' } });
});

test('the tile pulls the thumbnail, not the full image', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  const imageElement = await screen.findByTestId('recap-image-p2');
  expect(imageElement.props.source).toEqual({ uri: image('p2').thumb_url });
  expect(imageElement.props.source).not.toEqual({ uri: image('p2').medium_url });
});

// Task 10: the uniform three-column grid becomes a mosaic, each shape its
// own testID (`recap-tile-<shape>-<id>`) so the layout the screen actually
// produces is part of what these tests assert, not just which moments got
// a tile at all. `describe('mosaic', …)` on purpose (not just matching test
// titles): the plan's own verification command filters with `-t "mosaic"`,
// which matches against the full "describe > test" name.
describe('mosaic', () => {
  // Day 1 gets four moments here (COMPLETE only has two), so the mosaic
  // actually has to pick a `lead` tile instead of laying out a uniform row.
  // p1 stays the earliest (07:00), the same role it already plays in
  // COMPLETE, so a tap on it opens the player at index 0.
  const p1 = moment({ id: 'p1', captured_at: '2026-08-10T07:00:00.000Z' });
  const p2 = moment({
    id: 'p2', captured_at: '2026-08-10T08:00:00.000Z', type: 'video' as const,
  });
  const p3 = moment({ id: 'p3', captured_at: '2026-08-10T09:00:00.000Z' });
  const p4 = moment({ id: 'p4', captured_at: '2026-08-10T10:00:00.000Z' });
  const FOUR_ON_DAY_ONE = [p1, p2, p3, p4];
  const poolFor = (ids: string[]) => ({
    urls: new Map(ids.map((id) => [id, image(id)] as const)),
    validUntil: Date.now() + 999_999,
    skipped: 0,
  });

  test('a day heads its moments in two lines, not as one glued string', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: FOUR_ON_DAY_ONE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: poolFor(['p1', 'p2', 'p3', 'p4']), error: null, reason: null });
    await wrap();
    expect(await screen.findByText('Tag 1')).toBeTruthy();
    expect(screen.getByText('Lissabon · 10. August')).toBeTruthy();
    expect(screen.queryByText('Tag 1 · Lissabon · 10. August')).toBeNull();
  });

  test('the first moment of a day leads the mosaic', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: FOUR_ON_DAY_ONE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: poolFor(['p1', 'p2', 'p3', 'p4']), error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('recap-tile-lead-p1')).toBeTruthy();
  });

  test('every moment stays tappable, the lead one too', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: FOUR_ON_DAY_ONE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: poolFor(['p1', 'p2', 'p3', 'p4']), error: null, reason: null });
    await wrap();
    fireEvent.press(await screen.findByTestId('recap-tile-lead-p1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recap/[id]/player', params: { id: 't1', start: '0' },
    });
  });

  test('a video tile carries a play badge, a photo does not', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: FOUR_ON_DAY_ONE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: poolFor(['p1', 'p2', 'p3', 'p4']), error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('recap-tile-video-p2')).toBeTruthy();
    expect(screen.queryByTestId('recap-tile-video-p1')).toBeNull();
  });

  // The badge above only proves it on a `third` tile (p2); the brief is
  // explicit that it sits "on the big tile just like on the small ones",
  // and `MosaicTileView` draws the badge the same way for every shape, so
  // this checks the `lead` tile specifically instead of assuming the
  // uniform code path behaves the same for it too.
  test('the play badge shows on the lead tile too, not only on a third', async () => {
    const leadVideo = moment({
      id: 'v1', captured_at: '2026-08-10T06:00:00.000Z', type: 'video' as const,
    });
    const data = [leadVideo, p2, p3, p4];
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data, error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: poolFor(['v1', 'p2', 'p3', 'p4']), error: null, reason: null,
    });
    await wrap();
    expect(await screen.findByTestId('recap-tile-lead-v1')).toBeTruthy();
    expect(screen.getByTestId('recap-tile-video-v1')).toBeTruthy();
  });

  test('a day with a single moment shows it full width instead of a lonely tile', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [p1], error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: poolFor(['p1']), error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('recap-tile-wide-p1')).toBeTruthy();
  });

  // FOUR_ON_DAY_ONE's fourth moment (p4) is exactly the case the trailing
  // `triple` row's spacers exist for (review Important 1): a lone tile
  // after the feature row. It must still be a real, tappable `third` tile
  // at its own index, not merely occupy space.
  test('a trailing partial row still holds its own tile, tappable at its own index', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: FOUR_ON_DAY_ONE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: poolFor(['p1', 'p2', 'p3', 'p4']), error: null, reason: null });
    await wrap();
    fireEvent.press(await screen.findByTestId('recap-tile-third-p4'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recap/[id]/player', params: { id: 't1', start: '3' },
    });
  });

  // `fetchTrip` never resolves, so `loaded` never flips to true (see the
  // `if (!loaded)` guard in the component): the only way to reach the
  // skeleton branch at all. Both testIDs are new (Task 10 review, Important
  // 2): the plain `recap-skeleton` root testID predates this task and would
  // have passed against the old nine-square-grid skeleton too, so it alone
  // proved nothing about THIS rewrite.
  test('the skeleton shows a hero block and a feature row, not the old nine-square grid', async () => {
    (fetchTrip as jest.Mock).mockReturnValue(new Promise(() => {}));
    (fetchRecapMoments as jest.Mock).mockReturnValue(new Promise(() => {}));
    (getPool as jest.Mock).mockReturnValue(new Promise(() => {}));
    await wrap();
    expect(await screen.findByTestId('recap-skeleton-hero')).toBeTruthy();
    expect(screen.getByTestId('recap-skeleton-feature')).toBeTruthy();
  });
});

// Task 9's reviewer flagged that nothing tested this phrase's branches even
// though it is easy to get wrong; `fellowTravellersText`/`heroSubtitle`
// (overview.tsx) are not exported, so tested through the rendered subtitle.
describe('heroSubtitle: the fellow-travellers phrase', () => {
  beforeEach(() => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  });

  test('a lone traveller gets no phrase at all', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, member_count: 1 }, error: null });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByText(/zu zweit|zu dritt|zu viert|Mitreisenden/)).toBeNull();
  });

  test('two travellers: "zu zweit"', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, member_count: 2 }, error: null });
    await wrap();
    expect(await screen.findByText(/zu zweit/)).toBeTruthy();
  });

  test('three travellers: "zu dritt"', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, member_count: 3 }, error: null });
    await wrap();
    expect(await screen.findByText(/zu dritt/)).toBeTruthy();
  });

  test('four travellers: "zu viert"', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, member_count: 4 }, error: null });
    await wrap();
    expect(await screen.findByText(/zu viert/)).toBeTruthy();
  });

  test('five or more travellers: "mit N Mitreisenden"', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, member_count: 5 }, error: null });
    await wrap();
    expect(await screen.findByText(/mit 5 Mitreisenden/)).toBeTruthy();
  });
});

// `skipped: 5` is deliberately higher here than what `uploaded.length -
// withImage.length` would give locally (the local difference would be 1 in
// this fixture), so a screen showing the local difference instead visibly
// shows a different number.
test('the skipped line shows the number the server counted, not one recomputed locally', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { ...POOL_OK, skipped: 5 },
    error: null,
    reason: null,
  });
  await wrap();
  expect(await screen.findByText('5 Momente liessen sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.queryByText(/^1 Moment liess/)).toBeNull();
});

test('a trip without a single visible moment says so kindly', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
    error: null,
    reason: null,
  });
  await wrap();
  expect(await screen.findByText('Diese Reise ist leer geblieben.')).toBeTruthy();
});

test('with only a straggler on its way the empty line stays away, something is still coming', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [pendingM], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
    error: null,
    reason: null,
  });
  await wrap();
  expect(await screen.findByText('1 Moment ist noch unterwegs.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise ist leer geblieben.')).toBeNull();
});

test('with only skipped moments the empty line stays away as well', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [skippedM], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 1 },
    error: null,
    reason: null,
  });
  await wrap();
  expect(await screen.findByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise ist leer geblieben.')).toBeNull();
});

test('an error while loading the pool names its cause instead of showing an empty grid', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [m1], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: null,
    error: 'Diese Reise ist noch versiegelt.',
    reason: 'versiegelt',
  });
  await wrap();
  expect(await screen.findByText('Diese Reise ist noch versiegelt.')).toBeTruthy();
  expect(screen.queryByTestId(/^recap-tile-/)).toBeNull();
});

test('a trip that no longer exists offers a way back instead of an empty screen', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: null, error: null, reason: null });
  await wrap();
  expect(await screen.findByText('Diese Reise gibt es nicht mehr.')).toBeTruthy();
});

// The three parallel fetches hang on purpose here: without the `loaded` guard
// the screen would claim the trip is gone, because `trip` is `null` until the
// first answer arrives.
test('while everything is still loading the skeleton stands there, not "gibt es nicht mehr"', async () => {
  (fetchTrip as jest.Mock).mockReturnValue(new Promise(() => {}));
  (fetchRecapMoments as jest.Mock).mockReturnValue(new Promise(() => {}));
  (getPool as jest.Mock).mockReturnValue(new Promise(() => {}));
  await wrap();
  expect(screen.getByTestId('recap-skeleton')).toBeTruthy();
  expect(screen.queryByText('Diese Reise gibt es nicht mehr.')).toBeNull();
});

test('the back arrow leaves the screen via back() when there is a way back', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
    error: null,
    reason: null,
  });
  await wrap();
  await screen.findByText('Lissabon Städtetrip');
  await fireEvent.press(screen.getByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

// Without a way back (deep link straight into the overview, say) there is
// nothing to take off the stack, and only there is `replace('/recap')` right.
test('without a way back on the stack the back arrow replaces its way to the list', async () => {
  mockCanGoBack = false;
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
    error: null,
    reason: null,
  });
  await wrap();
  await screen.findByText('Lissabon Städtetrip');
  await fireEvent.press(screen.getByLabelText('Zurück'));
  expect(mockReplace).toHaveBeenCalledWith('/recap');
  expect(mockBack).not.toHaveBeenCalled();
});

// `trip` (fixture above) is already status:'revealed', owner_id:'u1';
// mockAuth.userId starts at 'u1' as well (beforeEach).
describe('"Recap teilen": the owner only, and only once revealed', () => {
  test('the owner sees the share button on a revealed trip', async () => {
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.getByTestId('overview-share-open')).toBeTruthy();
  });

  test('a tap on the share button opens the sheet with ShareSheetContent for this trip', async () => {
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('mock-share-sheet-content')).toBeNull();
    await fireEvent.press(screen.getByTestId('overview-share-open'));
    const content = await screen.findByTestId('mock-share-sheet-content');
    expect(content).toHaveTextContent('t1');
  });

  test('a swipe or tap on the backdrop closes the sheet again', async () => {
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-share-open'));
    await screen.findByTestId('mock-share-sheet-content');
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('mock-share-sheet-content')).toBeNull();
  });

  test('someone who is not the owner never sees the share button', async () => {
    mockAuth.userId = 'jemand-anders';
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('overview-share-open')).toBeNull();
  });

  test('on a trip still sealed (status "active") the share button is missing, even for the owner', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'active' as const }, error: null });
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('overview-share-open')).toBeNull();
  });

  // Deliberately WITHOUT an exception for 'archived', even though an already
  // existing link on an archived trip would stay revocable per server policy
  // (supabase/migrations/20260808130000_share_links_widerruf_archiviert.sql).
  // That is a real gap: as soon as a trip is archived, THIS app version loses
  // the only way to revoke a link created earlier. Held here as an assurance
  // that the gating rule follows the brief exactly and is not secretly more
  // generous.
  test('on an archived trip the share button is missing as well, owner or not', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' as const }, error: null });
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('overview-share-open')).toBeNull();
  });
});

describe('"Alle sichern"', () => {
  beforeEach(() => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  });

  test('visible to someone who is not the owner, as long as there are moments to save', async () => {
    mockAuth.userId = 'jemand-anders';
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.getByTestId('overview-save-all-open')).toBeTruthy();
  });

  test('missing when there is literally nothing to save', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    await screen.findByText('Diese Reise ist leer geblieben.');
    expect(screen.queryByTestId('overview-save-all-open')).toBeNull();
  });

  test('calls saveAllToGallery with EXACTLY the three visible moments (moment plus url)', async () => {
    (saveAllToGallery as jest.Mock).mockReturnValue(new Promise(() => {}));
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    expect(saveAllToGallery).toHaveBeenCalledTimes(1);
    const entries = (saveAllToGallery as jest.Mock).mock.calls[0][0] as { moment: { id: string } }[];
    expect(entries.map((e) => e.moment.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  test('shows the running progress ("N von M") as soon as onProgress fires', async () => {
    let reportProgress!: (state: { done: number; total: number }) => void;
    (saveAllToGallery as jest.Mock).mockImplementation(
      (_entries: unknown, onProgress: (state: { done: number; total: number }) => void) => {
        reportProgress = onProgress;
        return new Promise(() => {});
      }
    );
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    expect(screen.getByText('0 von 3 gesichert')).toBeTruthy();
    await act(async () => {
      reportProgress({ done: 2, total: 3 });
    });
    expect(screen.getByText('2 von 3 gesichert')).toBeTruthy();
  });

  test('an honest summary at the end, failures included, never a blanket "fertig"', async () => {
    (saveAllToGallery as jest.Mock).mockResolvedValue({
      status: 'finished', saved: 2, total: 3, failed: 1, cancelled: false,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    await act(async () => {});
    expect(await screen.findByTestId('export-outcome')).toHaveTextContent(
      '2 von 3 Momenten gesichert. 1 ist fehlgeschlagen.'
    );
  });

  test('an aborted run names where it stopped, and what failed on the way there', async () => {
    (saveAllToGallery as jest.Mock).mockResolvedValue({
      status: 'finished', saved: 1, total: 3, failed: 1, cancelled: true,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    await act(async () => {});
    expect(await screen.findByTestId('export-outcome')).toHaveTextContent(
      'Abgebrochen bei 1 von 3 Momenten. 1 ist dabei fehlgeschlagen.'
    );
  });

  test('"Fertig" closes the sheet again', async () => {
    (saveAllToGallery as jest.Mock).mockResolvedValue({
      status: 'finished', saved: 3, total: 3, failed: 0, cancelled: false,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    await act(async () => {});
    await screen.findByTestId('export-outcome');
    await fireEvent.press(screen.getByText('Fertig'));
    expect(screen.queryByTestId('export-outcome')).toBeNull();
  });

  test('a missing permission names the cause and offers the settings, instead of simply doing nothing', async () => {
    (saveAllToGallery as jest.Mock).mockResolvedValue({
      status: 'no_permission', text: 'Reelive braucht Zugriff auf deine Fotobibliothek …',
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    await act(async () => {});
    expect(await screen.findByText('Reelive braucht Zugriff auf deine Fotobibliothek …')).toBeTruthy();
    await fireEvent.press(screen.getByText('Einstellungen öffnen'));
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  test('"Abbrechen" stops the running export through the AbortSignal', async () => {
    let receivedSignal: AbortSignal | undefined;
    (saveAllToGallery as jest.Mock).mockImplementation(
      (_entries: unknown, _onProgress: unknown, signal?: AbortSignal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      }
    );
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    expect(receivedSignal?.aborted).toBe(false);
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(receivedSignal?.aborted).toBe(true);
  });

  test('closing the sheet WHILE the run is going aborts it as well', async () => {
    let receivedSignal: AbortSignal | undefined;
    (saveAllToGallery as jest.Mock).mockImplementation(
      (_entries: unknown, _onProgress: unknown, signal?: AbortSignal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      }
    );
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(receivedSignal?.aborted).toBe(true);
  });

  test('closing AFTER the end aborts nothing any more', async () => {
    (saveAllToGallery as jest.Mock).mockResolvedValue({
      status: 'finished', saved: 3, total: 3, failed: 0, cancelled: false,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('overview-save-all-open'));
    await act(async () => {});
    await screen.findByTestId('export-outcome');
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('export-outcome')).toBeNull();
    expect(saveAllToGallery).toHaveBeenCalledTimes(1);
  });
});

// Spec §5.1: the segment row is the ONLY place the map turns up at all, there
// is no tab, no second button, no other way there. So this row alone decides
// whether the map can be reached.
describe('segment row "Nach Tagen" / "Auf der Karte"', () => {
  test('a revealed trip offers both readings', async () => {
    emptyLoadSuccess();
    await wrap();
    expect(await screen.findByText('Auf der Karte')).toBeTruthy();
    expect(screen.getByText('Nach Tagen')).toBeTruthy();
  });

  test('a tap leads to the map of THIS trip', async () => {
    emptyLoadSuccess();
    await wrap();
    await fireEvent.press(await screen.findByText('Auf der Karte'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recap/[id]/map',
      params: { id: 't1' },
    });
  });

  test('the active half is one piece of information, not a button that would promise a tap', async () => {
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Nach Tagen');
    const activeHalf = screen.getByTestId('overview-segment-days');
    expect(activeHalf.props.accessibilityRole).toBe('text');
    expect(activeHalf.props.accessible).toBe(true);
  });

  test('a trip still sealed (status "active") does not offer the map', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'active' as const }, error: null });
    emptyLoadSuccess();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByText('Auf der Karte')).toBeNull();
    // The whole ROW is missing, not just the second pill (Spec §5.1,
    // verbatim: "gibt es die Zeile nicht"): a single untouched "Nach Tagen"
    // pill would be a segment control with exactly one segment, claiming a
    // choice that does not exist here.
    expect(screen.queryByText('Nach Tagen')).toBeNull();
  });

  test('an archived trip still offers the map', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' as const }, error: null });
    emptyLoadSuccess();
    await wrap();
    expect(await screen.findByText('Auf der Karte')).toBeTruthy();
    expect(screen.getByText('Nach Tagen')).toBeTruthy();
  });

  test('someone who is not the owner sees the map too', async () => {
    mockAuth.userId = 'jemand-anders';
    emptyLoadSuccess();
    await wrap();
    expect(await screen.findByText('Auf der Karte')).toBeTruthy();
  });
});

// This screen has TWO error sites: one without a loaded trip (the screen is
// then only head and error text) and one with. Both offered the button
// unconditionally up to this point, even under "Diese Reise ist noch
// versiegelt.", where a second attempt never gets anything else. The rule
// lives in features/recap/urlPool.ts and is real here, not mocked.
describe('the error only offers what it can keep', () => {
  const LOAD_ERROR = 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.';
  const TRIP_LOAD_ERROR = 'Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.';

  test.each([
    ['Diese Reise ist noch versiegelt.', 'versiegelt'],
    ['Kein Zugriff auf diese Reise.', 'kein_zugriff'],
  ])('with the trip loaded, no button stands under "%s"', async (text, reason) => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: text, reason });
    await wrap();

    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByLabelText('Nochmal versuchen')).toBeNull();
  });

  test('without a loaded trip a domain refusal carries no button either', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: null, error: 'Diese Reise ist noch versiegelt.', reason: 'versiegelt',
    });
    await wrap();

    expect(await screen.findByText('Diese Reise ist noch versiegelt.')).toBeTruthy();
    expect(screen.queryByLabelText('Nochmal versuchen')).toBeNull();
  });

  test('an error without a reason keeps its button', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: LOAD_ERROR, reason: null });
    await wrap();

    expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.getByLabelText('Nochmal versuchen')).toBeTruthy();
  });

  test('a failed trip fetch outranks the pool refusal and keeps its own button', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: TRIP_LOAD_ERROR });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: null, error: 'Diese Reise ist noch versiegelt.', reason: 'versiegelt',
    });
    await wrap();

    expect(await screen.findByText(TRIP_LOAD_ERROR)).toBeTruthy();
    expect(screen.queryByText('Diese Reise ist noch versiegelt.')).toBeNull();
    expect(screen.getByLabelText('Nochmal versuchen')).toBeTruthy();
  });
});

// The cover only exists where the device occupies a top strip; the global
// mock reports insets of 0, so the device measurement is set via the spy
// pattern from player.test.tsx.
describe('status bar cover', () => {
  let insetSpy: jest.SpyInstance;

  beforeEach(() => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: COMPLETE, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  });

  afterEach(() => insetSpy.mockRestore());

  test('the cover stands on the open recap', async () => {
    await wrap();
    await screen.findByText('Tag 1');
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  });
});
