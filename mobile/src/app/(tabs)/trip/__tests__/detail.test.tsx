import { Alert, StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';

const mockPush = jest.fn();
const mockReplace = jest.fn();
// `useEffect(cb, [cb])` reproduces the semantics of useFocusEffect exactly.
// The earlier `(cb) => cb()` fired on EVERY render instead of only on focus
// or on a changed callback reference, which hid a real gap: deleting
// `void load()` from the success path of `finishTrip()` stayed green because
// something reloaded constantly anyway. The screen memoises its callback with
// `useCallback([load])`, so the effect runs once on mount and again only when
// `id`/`userId` change. `require('react')` instead of a top-level import,
// because babel-plugin-jest-hoist forbids jest.mock() factories from
// referencing module-scope variables; names starting with "mock" are allowed.
let mockRouteId = 't1';
let mockRouteCover: string | undefined;
// Counts focus cycles, see `refocus()` below.
let mockFocusCycle = 0;
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
    useLocalSearchParams: () => ({ id: mockRouteId, cover: mockRouteCover }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb, mockFocusCycle]),
  };
});

// Alert only shows a dialog in the test, nobody taps. To make the
// destructive paths checkable, the confirming button fires immediately.
type AlertButton = { text?: string; style?: string; onPress?: () => void };
jest.spyOn(Alert, 'alert').mockImplementation((_title, _text, buttons) => {
  (buttons as AlertButton[] | undefined)?.find((b) => b.style === 'destructive')?.onPress?.();
});

const mockAuth = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/trips/tripsApi', () => ({
  fetchTrip: jest.fn(),
  fetchMembers: jest.fn(),
  removeMember: jest.fn(async () => ({ error: null })),
  deleteTrip: jest.fn(async () => ({ error: null })),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Warning: 'warning' },
}));
// Default identical to trip.my_post_count = 0, so the existing tests without
// their own expectation about the counter stay green unchanged.
jest.mock('@/features/moments/counter', () => ({ ownMomentCount: jest.fn(async () => 0) }));
jest.mock('@/features/moments/queueDb', () => ({
  allJobs: jest.fn(async () => []),
  discardedMoments: jest.fn(async () => []),
  acknowledgeDiscarded: jest.fn(async () => {}),
}));
// The real recapApi imports @/lib/supabase (and with it the AsyncStorage
// native module, absent in Jest), so it is mocked completely like every
// other feature module here.
jest.mock('@/features/recap/recapApi', () => ({ revealTrip: jest.fn() }));
// seen.ts has its own test file; here only IF and WHEN this screen calls it
// matters, not how it uses AsyncStorage internally.
jest.mock('@/features/recap/seen', () => ({
  hasSeenReveal: jest.fn(),
  markRevealSeen: jest.fn(),
}));
// expo-image is a native view, a plain placeholder passing all props through
// is enough here (same pattern as overview.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
// reportApi has its own complete test file
// (features/recap/__tests__/reportApi.test.ts), here only spies.
jest.mock('@/features/recap/reportApi', () => ({
  fetchReports: jest.fn(),
  dismissReport: jest.fn(),
  removeMoment: jest.fn(),
}));
// Only the IO function of urlPool is mocked. `retryHelps` stays real: it is
// the rule about whether «Nochmal versuchen» can achieve anything at all, and
// mocking it would stop the test from checking the very guarantee it is
// about. `jest.requireActual` pulls in @/lib/supabase, hence its mock next to
// it (same pattern as in player.test.tsx).
// `rpc` serves `isRecapShared` (features/sharing/linkManagementApi.ts): the
// screen asks whether the recap is currently shared. The default is "no",
// tests that need it otherwise set `mockRpc` themselves.
const mockRpc = jest.fn<Promise<{ data: boolean | null; error: { message: string } | null }>, unknown[]>(
  async () => ({ data: false, error: null })
);
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    rpc: (...args: unknown[]) => mockRpc(...(args as [])),
  },
}));
jest.mock('@/features/recap/urlPool', () => ({
  ...jest.requireActual('@/features/recap/urlPool'),
  getPool: jest.fn(),
}));
// The sequence itself (haptics, timing, prefers-reduced-motion) is covered by
// RevealSequence.test.tsx. Here stands a steerable placeholder: while visible
// it renders a pressable test node, a press on it simulates "sequence
// finished" (onFinished), without the real Animated timers this file (no fake
// timers) would otherwise have to sit through for 700 to 900 ms.
jest.mock('@/components/RevealSequence', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    RevealSequence: ({ visible, onFinished }: { visible: boolean; onFinished: () => void }) =>
      visible
        ? React.createElement(
            Pressable,
            { testID: 'reveal-sequence-fake', onPress: onFinished },
            React.createElement(Text, null, 'Inszenierung läuft')
          )
        : null,
  };
});

import TripDetail from '../[id]/index';
import * as Haptics from 'expo-haptics';
import { fetchTrip, fetchMembers, removeMember, deleteTrip } from '@/features/trips/tripsApi';
import { ownMomentCount } from '@/features/moments/counter';
import * as queueDb from '@/features/moments/queueDb';
import { revealTrip } from '@/features/recap/recapApi';
import { hasSeenReveal, markRevealSeen } from '@/features/recap/seen';
import { fetchReports, dismissReport, removeMoment } from '@/features/recap/reportApi';
import { getPool } from '@/features/recap/urlPool';
import { placeholderCover } from '@/features/trips/placeholderCover';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  members: [
    { name: 'Lea', avatarKey: null },
    { name: 'Jonas', avatarKey: null },
  ],
  member_count: 2, my_post_count: 0,
};
// Lea carries an avatar key, Jonas does not: the sheet test below checks both
// cases in a single assertion, a real picture AND the fallback to the initial.
const members = [
  { user_id: 'u1', role: 'owner' as const, username: 'lea', display_name: 'Lea', avatar_key: 'profiles/u1/a.jpg' },
  { user_id: 'u2', role: 'member' as const, username: 'jonas', display_name: 'Jonas', avatar_key: null },
];
// Stable references: the useFocusEffect mock reruns on changed dependencies,
// and a freshly built object each time would rerender the screen endlessly.
const tripOk = { data: trip, error: null };
const membersOk = { data: members, error: null };
const noDiscarded: never[] = [];
const DISCARD_REASON =
  'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.';
const oneDiscarded = [
  { id: 'p9', trip_id: 't1', author_id: 'u1', grund: DISCARD_REASON, verworfen_am: 1 },
];

// Computed relative to the real current date instead of a fixed literal like
// the `trip` fixture above, otherwise these tests would turn brittle as soon
// as the real date passes 2026-08-14.
const TODAY = new Date().toISOString().slice(0, 10);
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
const tripBeforeEnd = { ...trip, end_date: inDays(30) };
const tripBeforeEndOk = { data: tripBeforeEnd, error: null };
const tripAtEnd = { ...trip, end_date: TODAY };
const tripAtEndOk = { data: tripAtEnd, error: null };
const tripRevealed = { ...trip, status: 'revealed' as const };
const tripRevealedOk = { data: tripRevealed, error: null };

const wrap = () => render(<ThemeProvider><TripDetail /></ThemeProvider>);

// Replays a renewed focus of the SAME screen: same component instance, same
// refs, only the effect runs again. A second `render()` would be a new mount
// and would reset exactly the refs the tests below are about.
async function refocus() {
  mockFocusCycle += 1;
  await screen.rerender(<ThemeProvider><TripDetail /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCycle = 0;
  // `clearAllMocks` takes the default implementation with it, so it has to be
  // set again here, otherwise `rpc` returns undefined and `isRecapShared`
  // would report an error in EVERY test.
  mockRpc.mockResolvedValue({ data: false, error: null });
  mockAuth.userId = 'u1';
  mockRouteId = 't1';
  mockRouteCover = undefined;
  (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
  (fetchMembers as jest.Mock).mockResolvedValue(membersOk);
  (ownMomentCount as jest.Mock).mockResolvedValue(0);
  (revealTrip as jest.Mock).mockResolvedValue({ revealed_at: '2026-08-08T00:00:00Z', error: null });
  (queueDb.allJobs as jest.Mock).mockResolvedValue([]);
  (queueDb.discardedMoments as jest.Mock).mockResolvedValue(noDiscarded);
  // Default "already seen": most existing tests here are not concerned with
  // the reveal sequence, and with `true` their screen stays unchanged.
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  (markRevealSeen as jest.Mock).mockResolvedValue(undefined);
  // Default without open reports, for the same reason.
  (fetchReports as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: { urls: new Map(), validUntil: 0, skipped: 0 }, error: null, reason: null });
});

test('the detail wears the same cover as the card that was tapped', async () => {
  mockRouteCover = '1';
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.getByTestId('trip-cover').props.source).toBe(placeholderCover(1));
});

test('without a cover parameter the first image stands in', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.getByTestId('trip-cover').props.source).toBe(placeholderCover(0));
});

test('shows the trip name and its date range', async () => {
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

// === The facepile under the date ===

test('the travellers appear as a facepile, not as a list on the screen', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.getByTestId('members-open')).toBeTruthy();
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByText('Lea')).toBeNull();
  expect(screen.queryByText('Jonas')).toBeNull();
});

test('the facepile says out loud how many people are coming along', async () => {
  await wrap();
  expect(await screen.findByLabelText('Wer dabei ist, 2 Personen')).toBeTruthy();
});

test('with a single traveller the label counts in the singular', async () => {
  (fetchMembers as jest.Mock).mockResolvedValue({ data: [members[0]], error: null });
  await wrap();
  expect(await screen.findByLabelText('Wer dabei ist, 1 Person')).toBeTruthy();
});

test('tapping the facepile opens the list of travellers', async () => {
  await wrap();
  await fireEvent.press(await screen.findByTestId('members-open'));
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('Jonas')).toBeTruthy();
  expect(screen.getByText('Hat die Reise angelegt')).toBeTruthy();
  expect(screen.getByText('@jonas')).toBeTruthy();
});

// The facepile ABOVE the sheet shows the same picture, so `within` narrows
// the search to `sheet-panel`. Without that, `findByTestId` would find two
// hits and fail with "multiple elements" although the sheet is correct.
test('the traveller sheet shows the profile pictures that exist', async () => {
  await wrap();
  await openTravellers();
  const sheet = within(screen.getByTestId('sheet-panel'));
  expect(await sheet.findByTestId('avatar-image')).toBeTruthy();
});

test('with many travellers the facepile keeps counting while the sheet still lists everybody', async () => {
  const many = ['Lea', 'Jonas', 'Mira', 'Sofia', 'Ben'].map((display_name, i) => ({
    user_id: `u${i + 1}`,
    role: i === 0 ? ('owner' as const) : ('member' as const),
    username: display_name.toLowerCase(),
    display_name,
  }));
  (fetchMembers as jest.Mock).mockResolvedValue({ data: many, error: null });
  await wrap();
  expect(await screen.findByText('+2')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('members-open'));
  expect(await screen.findByText('Ben')).toBeTruthy();
  expect(screen.getByText('Sofia')).toBeTruthy();
});

test('shows the own moment counter together with its explanation', async () => {
  await wrap();
  expect(await screen.findByText('0')).toBeTruthy();
  expect(screen.getByText(/Momente eingefangen/)).toBeTruthy();
});

test('the owner can invite straight from the screen', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Freunde einladen'));
  expect(mockPush).toHaveBeenCalledWith('/trip/t1/invite');
});

// Shorthand for the tests below: the management sits behind the facepile, so
// every test that needs it has to open it first.
async function openTravellers() {
  await fireEvent.press(await screen.findByTestId('members-open'));
  await screen.findByText('Lea');
}

test('the owner can remove a traveller from inside the sheet', async () => {
  await wrap();
  await openTravellers();
  await fireEvent.press(screen.getByLabelText('Jonas entfernen'));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith('t1', 'u2'));
});

test('the owner can also invite from inside the sheet, and it closes on the way out', async () => {
  await wrap();
  await openTravellers();
  // Two buttons of that name are in the tree while the sheet is open: the one
  // in the sheet is the second (sheets stand as siblings AFTER the ScrollView).
  const buttons = screen.getAllByText('Freunde einladen');
  expect(buttons).toHaveLength(2);
  await fireEvent.press(buttons[1]);
  expect(mockPush).toHaveBeenCalledWith('/trip/t1/invite');
  await waitFor(() => expect(screen.queryByText('Hat die Reise angelegt')).toBeNull());
});

test('the owner cannot remove themselves', async () => {
  await wrap();
  await openTravellers();
  expect(screen.queryByLabelText('Lea entfernen')).toBeNull();
});

test('a member without the owner role is offered leaving instead of deleting', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  expect(await screen.findByText('Reise verlassen')).toBeTruthy();
  expect(screen.queryByText('Reise löschen')).toBeNull();
});

test('a member sees neither removing nor inviting inside the sheet', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await openTravellers();
  expect(screen.queryByLabelText('Jonas entfernen')).toBeNull();
  expect(screen.queryByLabelText('Lea entfernen')).toBeNull();
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});

test('after the reveal the sheet is pure information, even for the owner', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  await wrap();
  await openTravellers();
  expect(screen.getByText('Jonas')).toBeTruthy();
  expect(screen.queryByLabelText('Jonas entfernen')).toBeNull();
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});

test('the owner is offered deleting instead of leaving', async () => {
  await wrap();
  expect(await screen.findByText('Reise löschen')).toBeTruthy();
  expect(screen.queryByText('Reise verlassen')).toBeNull();
});

test('a revealed trip offers no invite button anymore', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'revealed' }, error: null });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});

test('the owner deletes the trip and lands back on the trip list', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise löschen'));
  await waitFor(() => expect(deleteTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip'));
});

test('a member leaves the trip and lands back on the trip list', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await fireEvent.press(await screen.findByText('Reise verlassen'));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith('t1', 'u2'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip'));
});

test('a failed deletion navigates nowhere and names the reason', async () => {
  (deleteTrip as jest.Mock).mockResolvedValueOnce({
    error: 'Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.',
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise löschen'));
  await waitFor(() => expect(deleteTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith(
      'Nicht gelöscht',
      'Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.'
    )
  );
  expect(mockReplace).not.toHaveBeenCalled();
});

const LOAD_ERROR = 'Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.';

test('a read error explains itself and offers a way back instead of staying white', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: LOAD_ERROR });
  await wrap();
  expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
  // The stack has no header, without this button there would be no way back.
  await fireEvent.press(screen.getByText('Zu meinen Reisen'));
  expect(mockReplace).toHaveBeenCalledWith('/trip');
});

test('after a read error the button loads the trip again', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: LOAD_ERROR });
  await wrap();
  await screen.findByText(LOAD_ERROR);

  (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('a trip that is gone says so instead of claiming a read error', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
  await wrap();
  expect(await screen.findByText('Diese Reise gibt es nicht mehr.')).toBeTruthy();
  expect(screen.queryByText('Nochmal versuchen')).toBeNull();
});

test('an error while loading the travellers takes the place of the facepile', async () => {
  const message = 'Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.';
  (fetchMembers as jest.Mock).mockResolvedValue({ data: [], error: message });
  await wrap();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByTestId('members-open')).toBeNull();
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('the destructive dialog «Jonas entfernen» announces itself with warning haptics', async () => {
  await wrap();
  await openTravellers();
  await fireEvent.press(screen.getByLabelText('Jonas entfernen'));
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('the destructive dialog «Reise löschen» announces itself with warning haptics', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise löschen'));
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('«Reise verlassen» announces itself with warning haptics', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await fireEvent.press(await screen.findByText('Reise verlassen'));
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('haptics stay sparing: nothing fires without a destructive dialog', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Freunde einladen'));
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('the counter comes from ownMomentCount, not from the raw server count', async () => {
  (ownMomentCount as jest.Mock).mockResolvedValue(7);
  await wrap();
  expect(await screen.findByText('7')).toBeTruthy();
  expect(screen.queryByText('0')).toBeNull();
  expect(ownMomentCount).toHaveBeenCalledWith('t1');
});

test('an empty queue shows no waiting line at all', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText(/unterwegs/)).toBeNull();
});

test('pending moments of this trip are reported discreetly', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValue([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'laeuft' },
    { trip_id: 't1', zustand: 'fertig' },
    { trip_id: 't2', zustand: 'wartet' },
  ]);
  await wrap();
  expect(await screen.findByText('2 Momente sind noch unterwegs.')).toBeTruthy();
});

test('a single pending moment is reported in the singular', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValue([{ trip_id: 't1', zustand: 'wartet' }]);
  await wrap();
  expect(await screen.findByText('1 Moment ist noch unterwegs.')).toBeTruthy();
});

test('ownMomentCount fails: the trip still appears, falling back to the server count', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, my_post_count: 3 }, error: null });
  (ownMomentCount as jest.Mock).mockRejectedValue(new Error('SQLite broken'));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.queryByText(/unterwegs/)).toBeNull();
});

test('queueDb.allJobs fails: the trip still appears, only without the waiting line', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, my_post_count: 3 }, error: null });
  (queueDb.allJobs as jest.Mock).mockRejectedValue(new Error('SQLite broken'));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText(/unterwegs/)).toBeNull();
});

// === Moments the worker had to discard for good ===

test('a permanently discarded moment is explained with its cause', async () => {
  (queueDb.discardedMoments as jest.Mock).mockResolvedValue(oneDiscarded);
  await wrap();

  expect(await screen.findByText('Ein Moment konnte nicht mehr eingesendet werden')).toBeTruthy();
  expect(screen.getByText(DISCARD_REASON)).toBeTruthy();
  expect(queueDb.discardedMoments).toHaveBeenCalledWith('t1', 'u1');
});

test('the explanation only disappears once it has been acknowledged', async () => {
  (queueDb.discardedMoments as jest.Mock).mockResolvedValue(oneDiscarded);
  // The real store deletes on acknowledging, the double follows suit,
  // otherwise the next focus run would bring the notice straight back.
  (queueDb.acknowledgeDiscarded as jest.Mock).mockImplementation(() => {
    (queueDb.discardedMoments as jest.Mock).mockResolvedValue(noDiscarded);
    return Promise.resolve();
  });
  await wrap();
  await screen.findByText('Ein Moment konnte nicht mehr eingesendet werden');

  await fireEvent.press(screen.getByText('Verstanden'));

  await waitFor(() =>
    expect(screen.queryByText('Ein Moment konnte nicht mehr eingesendet werden')).toBeNull()
  );
  expect(queueDb.acknowledgeDiscarded).toHaveBeenCalledWith('t1', 'u1');
});

test('with nothing discarded, nothing stands there', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText(/konnte nicht mehr eingesendet werden/)).toBeNull();
});

test('queueDb.discardedMoments fails: the trip still appears', async () => {
  (queueDb.discardedMoments as jest.Mock).mockRejectedValue(new Error('SQLite broken'));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

// === Finishing the trip ===

// A single style check on two known buttons would not cover ANY other button
// (say «Reise bearbeiten» or «Verstanden») accidentally turning primary as
// well, so this walks the whole rendered tree.
//
// It does not ENFORCE §7 by itself, it only counts, for the ONE tree it is
// called with. The tests below therefore also call it for the sheet-open
// case; complete the coverage still is not (revealed/archived/non-owner
// states stay unchecked), a deliberate gap rather than a hidden one.
type TreeNode = { type?: string; props?: { style?: unknown }; children?: (TreeNode | string)[] | null };
function countAccentSurfaces(tree: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (node == null || typeof node === 'string') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as TreeNode;
    if (n.props?.style) {
      const flat = StyleSheet.flatten(n.props.style as never) as { backgroundColor?: string };
      if (flat.backgroundColor === palette.accent) count += 1;
    }
    n.children?.forEach(visit);
  };
  visit(tree);
  return count;
}

test('«Reise abschliessen» is missing for members without the owner role', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Reise abschliessen')).toBeNull();
});

test('«Reise abschliessen» is missing on an already revealed trip', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'revealed' }, error: null });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Reise abschliessen')).toBeNull();
});

test('«Reise abschliessen» is missing on an archived trip', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' }, error: null });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Reise abschliessen')).toBeNull();
});

test('before the end date «Reise abschliessen» sits below as a secondary button while «Freunde einladen» stays primary', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripBeforeEndOk);
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Eure Reise ist zu Ende. Zeit für den Recap.')).toBeNull();

  const finish = StyleSheet.flatten(screen.getByText('Reise abschliessen').parent?.props.style);
  expect(finish.borderWidth).toBe(1);
  expect(finish.backgroundColor).toBe(palette['bg-0']);

  const invite = StyleSheet.flatten(screen.getByText('Freunde einladen').parent?.props.style);
  expect(invite.backgroundColor).toBe(palette.accent);

  // The anchor is the moment counter in the middle of the screen: the upper
  // block stands before it, the lower one behind it. RNTL v14 exposes no
  // sibling-order matchers, but `JSON.stringify(toJSON())` keeps the
  // document order.
  const tree = JSON.stringify(screen.toJSON());
  expect(tree.indexOf('Reise abschliessen')).toBeGreaterThan(tree.indexOf('Momente eingefangen'));

  // DESIGN-LANGUAGE §7: at most one surface carries the accent colour.
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('from the end date on, «Reise abschliessen» moves up and turns primary while «Freunde einladen» steps back', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAtEndOk);
  await wrap();
  expect(await screen.findByText('Eure Reise ist zu Ende. Zeit für den Recap.')).toBeTruthy();

  // getByText throws on more than one hit, which also proves the button does
  // not stand at the top AND at the bottom at the same time.
  const finish = StyleSheet.flatten(screen.getByText('Reise abschliessen').parent?.props.style);
  expect(finish.backgroundColor).toBe(palette.accent);

  const invite = StyleSheet.flatten(screen.getByText('Freunde einladen').parent?.props.style);
  expect(invite.borderWidth).toBe(1);
  expect(invite.backgroundColor).toBe(palette['bg-0']);

  const tree = JSON.stringify(screen.toJSON());
  expect(tree.indexOf('Reise abschliessen')).toBeLessThan(tree.indexOf('Momente eingefangen'));

  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('tapping «Reise abschliessen» opens the confirmation sheet with the honest text and warning haptics', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(await screen.findByText('Reise abschliessen?')).toBeTruthy();
  expect(
    screen.getByText(
      'Danach kann niemand mehr neue Momente aufnehmen. Bereits aufgenommene Momente von allen kommen noch durch, und alle sehen den Recap. Das lässt sich nicht rückgängig machen.'
    )
  ).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('the sheet leaves out the personal reassurance when nothing of your own is waiting', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(screen.queryByText(/kommt noch durch, er/)).toBeNull();
  expect(screen.queryByText(/wartenden Momente kommen noch durch/)).toBeNull();
});

test('the sheet reassures in the plural when several of your own moments are waiting', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValue([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'wartet' },
  ]);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(
    await screen.findByText('Deine 3 wartenden Momente kommen noch durch, sie sind vor der Aufdeckung entstanden.')
  ).toBeTruthy();
});

test('the sheet reassures in the singular when exactly one of your own moments is waiting', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValue([{ trip_id: 't1', zustand: 'wartet' }]);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(
    await screen.findByText('Dein wartender Moment kommt noch durch, er ist vor der Aufdeckung entstanden.')
  ).toBeTruthy();
});

test('cancelling closes the sheet without ever calling revealTrip', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  await fireEvent.press(screen.getByText('Abbrechen'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
  expect(revealTrip).not.toHaveBeenCalled();
});

test('tapping the backdrop closes the confirmation sheet', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
});

test('finishing calls revealTrip and, on success, closes the sheet and reloads the trip EXACTLY ONE more time', async () => {
  let revealed = false;
  (fetchTrip as jest.Mock).mockImplementation(async () => (revealed ? tripRevealedOk : tripOk));
  (revealTrip as jest.Mock).mockImplementation(async () => {
    revealed = true;
    return { revealed_at: '2026-08-08T00:00:00Z', error: null };
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  const loadCallsBeforeFinish = (fetchTrip as jest.Mock).mock.calls.length;
  await fireEvent.press(screen.getByText('Abschliessen'));

  await waitFor(() => expect(revealTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
  await waitFor(() => expect(screen.queryByText('Reise abschliessen')).toBeNull());
  // With the corrected useFocusEffect mock fetchTrip no longer reloads on
  // every render, so this really fails when `void load()` is deleted from the
  // success path of `finishTrip()`.
  await waitFor(() => expect((fetchTrip as jest.Mock).mock.calls.length).toBe(loadCallsBeforeFinish + 1));
});

test('a failed reveal names the cause and leaves the button usable, because the function is idempotent', async () => {
  (revealTrip as jest.Mock).mockResolvedValue({
    revealed_at: null,
    error: 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.',
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  await fireEvent.press(screen.getByText('Abschliessen'));
  await waitFor(() => expect(revealTrip).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText('Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.')
  ).toBeTruthy();
  expect(screen.getByText('Reise abschliessen?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abschliessen'));
  await waitFor(() => expect(revealTrip).toHaveBeenCalledTimes(2));
});

test('reopening the sheet after a failure no longer shows the stale error', async () => {
  const errorText = 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.';
  (revealTrip as jest.Mock).mockResolvedValue({ revealed_at: null, error: errorText });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await fireEvent.press(screen.getByText('Abschliessen'));
  await screen.findByText(errorText);

  await fireEvent.press(screen.getByText('Abbrechen'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());

  await fireEvent.press(screen.getByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(screen.queryByText(errorText)).toBeNull();
});

// === Discovering the reveal without a push ===
//
// Not a single mock in this file knows pushes or deep links. The tests below
// trigger NOTHING but an ordinary render or focus cycle, and the sequence
// appears anyway.

test('a running trip never even asks whether the reveal was seen', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(hasSeenReveal).not.toHaveBeenCalled();
  expect(screen.queryByTestId('reveal-sequence-fake')).toBeNull();
  expect(screen.queryByText('Recap starten')).toBeNull();
});

test('an already seen revealed trip shows «Recap starten» at once, without the sequence', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  expect(await screen.findByText('Recap starten')).toBeTruthy();
  expect(screen.queryByTestId('reveal-sequence-fake')).toBeNull();
  expect(hasSeenReveal).toHaveBeenCalledWith('t1');
  expect(markRevealSeen).not.toHaveBeenCalled();
});

test('a freshly revealed, never seen trip plays the sequence first and only then offers «Recap starten», which is remembered', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (hasSeenReveal as jest.Mock).mockResolvedValue(false);
  await wrap();

  await screen.findByTestId('reveal-sequence-fake');
  // While the sequence runs the primary button is NOT there yet: "shows
  // AFTERWARDS" is an order, not mere coexistence.
  expect(screen.queryByText('Recap starten')).toBeNull();
  expect(markRevealSeen).not.toHaveBeenCalled();

  // Simulates the end of the sequence (onFinished); the real look and timing
  // are covered by RevealSequence.test.tsx.
  await fireEvent.press(screen.getByTestId('reveal-sequence-fake'));

  await waitFor(() => expect(screen.queryByTestId('reveal-sequence-fake')).toBeNull());
  expect(await screen.findByText('Recap starten')).toBeTruthy();
  expect(markRevealSeen).toHaveBeenCalledWith('t1');
});

test('«Recap starten» leads to the recap overview of this trip', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  await fireEvent.press(await screen.findByText('Recap starten'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/overview', params: { id: 't1' } });
});

test('«Recap starten» stays the only primary button of a revealed trip', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  await screen.findByText('Recap starten');
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('an archived trip gets the same reveal discovery as a revealed one', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' as const }, error: null });
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  expect(await screen.findByText('Recap starten')).toBeTruthy();
  expect(hasSeenReveal).toHaveBeenCalledWith('t1');
});

test('a second load after the decision was made never asks again, even when remembering it still counts as failed', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (hasSeenReveal as jest.Mock).mockResolvedValue(false);
  await wrap();

  await fireEvent.press(await screen.findByTestId('reveal-sequence-fake'));
  await screen.findByText('Recap starten');
  expect(hasSeenReveal).toHaveBeenCalledTimes(1);

  // Refocusing is the honest trigger: that is exactly how the second load
  // comes about in operation, when somebody leaves the screen and returns.
  await refocus();
  await waitFor(() => expect((fetchTrip as jest.Mock).mock.calls.length).toBeGreaterThan(1));

  expect(hasSeenReveal).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('reveal-sequence-fake')).toBeNull();
  expect(screen.getByText('Recap starten')).toBeTruthy();
});

// A deliberately unresolved promise holds the FIRST call in mid-wait while
// the refocus triggers a SECOND one, before the first has come back.
test('two overlapping load() calls ask about the seen reveal only once, guarding against concurrency', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  let release!: (value: boolean) => void;
  (hasSeenReveal as jest.Mock).mockImplementation(
    () => new Promise<boolean>((resolve) => { release = resolve; })
  );
  await wrap();
  await waitFor(() => expect(hasSeenReveal).toHaveBeenCalledTimes(1));

  await refocus();
  await waitFor(() => expect((fetchTrip as jest.Mock).mock.calls.length).toBeGreaterThan(1));

  // Without the "currently running" guard (the ref assignment BEFORE the
  // await) the second call would have asked a second time although the first
  // was not finished yet.
  expect(hasSeenReveal).toHaveBeenCalledTimes(1);

  release(false);
  await screen.findByTestId('reveal-sequence-fake');
});

test('with the sheet open only its own «Abschliessen» stays primary, the screen button behind it steps back', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAtEndOk);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('a reveal while the sheet is open, say from a second device, still leaves exactly one accent surface', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAtEndOk);
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  await refocus();

  await screen.findByText('Recap starten');
  // The sheet stays open, nothing in this flow closes it by itself.
  expect(screen.getByText('Reise abschliessen?')).toBeTruthy();
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('with the traveller sheet open only its «Freunde einladen» carries the accent colour', async () => {
  await wrap();
  await openTravellers();
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('from the end date on, «Reise abschliessen» also steps back behind the open traveller sheet', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAtEndOk);
  await wrap();
  await openTravellers();
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

test('a reveal while the traveller sheet is open takes the sheet its own button away', async () => {
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  await openTravellers();

  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  await refocus();

  await screen.findByText('Recap starten');
  expect(screen.queryByText('Freunde einladen')).toBeNull();
  expect(countAccentSurfaces(screen.toJSON())).toBe(1);
});

// `mockRouteId` makes the trip id deliberately different for THIS one test.
// Every other fixture here is called `t1`, so a hard wired string would have
// been indistinguishably "right" everywhere else.
test('«Recap starten» uses the actual trip id instead of a hard wired «t1»', async () => {
  mockRouteId = 'trip-xyz';
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...tripRevealed, id: 'trip-xyz' }, error: null });
  (hasSeenReveal as jest.Mock).mockResolvedValue(true);
  await wrap();
  await fireEvent.press(await screen.findByText('Recap starten'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/overview',
    params: { id: 'trip-xyz' },
  });
});

describe('moderation of reported moments', () => {
  const reportFixture = {
    id: 'r1', post_id: 'p1', reason: 'Unpassend', created_at: '2026-08-05T09:30:00.000Z',
  };
  const expectedTime = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(reportFixture.created_at));

  test('without open reports the screen shows no entry point at all', async () => {
    await wrap();
    await screen.findByText('Norwegen mit dem Camper');
    expect(screen.queryByTestId('moderation-open')).toBeNull();
  });

  test('the owner sees the reported moments, a member without the owner role does NOT, even on the same data', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    await wrap();
    expect(await screen.findByText('Ein gemeldeter Moment')).toBeTruthy();

    mockAuth.userId = 'u2'; // Jonas, not the owner
    await wrap();
    await screen.findByText('Norwegen mit dem Camper');
    expect(screen.queryByTestId('moderation-open')).toBeNull();
  });

  test('the singular and plural wording follows the number of reports', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({
      data: [reportFixture, { ...reportFixture, id: 'r2', post_id: 'p2' }],
      error: null,
    });
    await wrap();
    expect(await screen.findByText('2 gemeldete Momente')).toBeTruthy();
  });

  test('tapping opens the list with preview image, reason and time', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: {
        urls: new Map([['p1', { post_id: 'p1', medium_url: 'https://cdn.example/p1.jpg', thumb_url: 'https://cdn.example/p1-thumb.jpg' }]]),
        validUntil: Date.now() + 999_999,
        skipped: 0,
      },
      error: null,
      reason: null,
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');

    expect(screen.getByText('Unpassend')).toBeTruthy();
    expect(screen.getByText(expectedTime)).toBeTruthy();
    expect(screen.getByTestId('report-preview-r1').props.source).toEqual({
      uri: 'https://cdn.example/p1-thumb.jpg',
    });
  });

  test('without a thumbnail in the pool an empty surface appears instead of a broken image', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');
    expect(screen.queryByTestId('report-preview-r1')).toBeNull();
  });

  test('a report with an unreadable timestamp shows no time rather than tearing down the list', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({
      data: [{ ...reportFixture, created_at: 'not-a-timestamp' }],
      error: null,
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));

    const row = within(await screen.findByTestId('report-r1'));
    expect(row.getByText(reportFixture.reason)).toBeTruthy();
    expect(screen.queryByText(expectedTime)).toBeNull();
    expect(screen.queryByText(/not-a-timestamp/)).toBeNull();
  });

  test('a failed list load shows the cause with a retry, never an empty list', async () => {
    (fetchReports as jest.Mock)
      .mockResolvedValueOnce({ data: [reportFixture], error: null }) // the counter on the first load
      .mockResolvedValueOnce({ data: null as unknown as [], error: 'Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.' });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    expect(
      await screen.findByText('Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.queryByTestId('report-r1')).toBeNull();
  });

  // The marker below is deliberately not a real German error text: if the
  // count ever stopped degrading silently, the string would surface on the
  // screen and be recognisable at once.
  test('a failed report count degrades to zero silently instead of blocking the whole screen', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({
      data: null as unknown as [],
      error: 'report count unavailable',
    });
    await wrap();
    expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
    expect(screen.queryByTestId('moderation-open')).toBeNull();
    expect(screen.queryByText('report count unavailable')).toBeNull();
  });

  test('«Meldung verwerfen» drops the row and lowers the counter while the moment itself stays untouched', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (dismissReport as jest.Mock).mockResolvedValue({ error: null });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');

    await fireEvent.press(screen.getByText('Meldung verwerfen'));
    expect(dismissReport).toHaveBeenCalledWith('r1');
    expect(removeMoment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('report-r1')).toBeNull());
    expect(screen.getByText('Keine offenen Meldungen mehr.')).toBeTruthy();
    // The entry point disappears because the count is 0 now.
    expect(screen.queryByTestId('moderation-open')).toBeNull();
  });

  test('while an action runs, that row swaps both of its buttons for a single loading indicator', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (dismissReport as jest.Mock).mockImplementation(() => new Promise(() => {}));
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');

    await fireEvent.press(screen.getByText('Meldung verwerfen'));

    expect(await screen.findByTestId('report-loading-r1')).toBeTruthy();
    expect(screen.queryByText('Meldung verwerfen')).toBeNull();
    expect(screen.queryByText('Moment entfernen')).toBeNull();
  });

  test('a failed dismissal shows the cause at EXACTLY that row while the list stays', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (dismissReport as jest.Mock).mockResolvedValue({
      error: 'Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.',
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');
    await fireEvent.press(screen.getByText('Meldung verwerfen'));
    expect(
      await screen.findByText('Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.getByTestId('report-r1')).toBeTruthy();
  });

  // Alert.alert is mocked globally (see the head of this file) and calls the
  // destructive button right away, so «Moment entfernen» needs no separate
  // confirmation step here, exactly like deleting and removing above.
  test('«Moment entfernen» asks destructively with warning haptics and then takes the moment AND the row away', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (removeMoment as jest.Mock).mockResolvedValue({ error: null });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');

    await fireEvent.press(screen.getByText('Moment entfernen'));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    expect(removeMoment).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(screen.queryByTestId('report-r1')).toBeNull());
    expect(screen.getByText('Keine offenen Meldungen mehr.')).toBeTruthy();
  });

  test('a failed removal shows the cause at EXACTLY that row while the list stays', async () => {
    (fetchReports as jest.Mock).mockResolvedValue({ data: [reportFixture], error: null });
    (removeMoment as jest.Mock).mockResolvedValue({
      error: 'Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.',
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('report-r1');
    await fireEvent.press(screen.getByText('Moment entfernen'));
    expect(
      await screen.findByText('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.getByTestId('report-r1')).toBeTruthy();
  });

  test('opening loads the list FRESH instead of the state seen on the first load', async () => {
    (fetchReports as jest.Mock)
      .mockResolvedValueOnce({ data: [reportFixture], error: null }) // on the first load()
      .mockResolvedValueOnce({
        data: [reportFixture, { ...reportFixture, id: 'r2', post_id: 'p2', reason: 'Zweite Meldung' }],
        error: null,
      });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    expect(await screen.findByText('Zweite Meldung')).toBeTruthy();
    expect(fetchReports).toHaveBeenCalledTimes(2);
  });
});

// Until this notice existed only the owner knew that a link was out there:
// the SELECT policy on share_links is owner-only, and it stays that way,
// because whoever reads the row reads the token. Everybody else had sent in
// their moments without ever learning that they now sit behind a public URL,
// places included. The answer comes from `public.recap_is_shared`
// (migration 20260820090000).
describe('the notice about an existing share link', () => {
  test('stands there while the recap is shared, together with the sentence about what the link reveals', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await wrap();

    expect(await screen.findByTestId('shared-hint')).toBeTruthy();
    expect(screen.getByText('Dieser Recap ist geteilt')).toBeTruthy();
    // The places are the reason this notice exists at all.
    expect(screen.getByText(/samt den Orten/)).toBeTruthy();
  });

  test('is seen by everyone, including those who did NOT create the trip', async () => {
    mockAuth.userId = 'u2'; // a member, not the owner
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await wrap();

    expect(await screen.findByTestId('shared-hint')).toBeTruthy();
  });

  test('without a link nothing stands there, no not-shared noise', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: false, error: null });
    await wrap();
    // Wait for the answer, otherwise the test would only check that the
    // screen shows nothing while loading and would be green on `data: true`.
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    expect(screen.queryByTestId('shared-hint')).toBeNull();
    expect(screen.queryByTestId('shared-unknown')).toBeNull();
  });

  test('when the query fails the screen says so instead of handing out an all clear', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await wrap();

    expect(await screen.findByTestId('shared-unknown')).toBeTruthy();
    expect(screen.queryByTestId('shared-hint')).toBeNull();
  });

  test('a running trip never even asks', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
    await wrap();
    await screen.findByText(/Momente eingefangen/);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.queryByTestId('shared-hint')).toBeNull();
  });

  test('the question is asked about EXACTLY this trip', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await wrap();
    await screen.findByTestId('shared-hint');

    expect(mockRpc).toHaveBeenCalledWith('recap_is_shared', { p_trip_id: 't1' });
  });
});

// The cover only exists where the device occupies a top strip; the global
// mock reports insets of 0, so the device measurement is set via the spy
// pattern from player.test.tsx.
describe('status bar cover', () => {
  let insetSpy: jest.SpyInstance | undefined;

  afterEach(() => {
    insetSpy?.mockRestore();
    insetSpy = undefined;
  });

  test('the cover stands on the trip detail', async () => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
    await wrap();
    await screen.findByText('Norwegen mit dem Camper');
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  });
});
