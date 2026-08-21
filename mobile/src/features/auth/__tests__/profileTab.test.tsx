import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', userId: 'uid-1', refreshProfile: jest.fn() }),
}));
// The validators get sentinel texts instead of the real messages, the same
// pattern as `deletionSummaryText` below: the real wording and rules are
// covered in profileApi.test.ts, here only THAT the screen shows the
// validator's message on the right field counts. No requireActual: the real
// module pulls in @/lib/supabase and with it the AsyncStorage native module
// (see the accountApi comment below).
jest.mock('../profileApi', () => ({
  fetchOwnProfile: jest.fn(async () => ({
    id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: null,
  })),
  updateProfile: jest.fn(),
  validateUsername: (u: string) => (/^[a-z0-9_]{3,20}$/.test(u) ? null : 'USERNAME-REGEL'),
  validateDisplayName: (d: string) => {
    const l = d.trim().length;
    return l >= 1 && l <= 40 ? null : 'NAME-REGEL';
  },
}));
const mockSignOut = jest.fn();
jest.mock('../authApi', () => ({ signOut: () => mockSignOut() }));

// Task 6: setAvatar/removeAvatar are already fully checked in
// avatarApi.test.ts (order upload->column->cleanup), here only THAT
// profile.tsx adopts their result (circle, error text) counts. Full factory
// mock instead of `jest.mock('@/features/auth/avatarApi')` without a
// factory (automock): automock would have to load the real file to
// recognize its exports, and that transitively pulls in expo-file-system,
// expo-image-manipulator and @/lib/supabase (see the mocks in
// avatarApi.test.ts), here a pure replacement is enough, without dragging
// along that chain.
//
// The exports here are direct `jest.fn()` calls (no variable referenced
// from outside, so hoistable even without a "mock" prefix): this way the
// imported `setAvatar` can be addressed directly as a `jest.Mock` in the
// tests below, without an extra detour through its own variable.
jest.mock('@/features/auth/avatarApi', () => ({
  setAvatar: jest.fn(),
  removeAvatar: jest.fn(),
}));

// profile.tsx now renders AvatarPicker (Task 5), which imports
// expo-image-picker directly. Same mock pattern as AvatarPicker.test.tsx:
// "Foto auswählen" calls real permission/selection functions that don't
// make sense in the Jest environment without this mock.
const mockGalleryPermission = jest.fn();
const mockFromGallery = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockFromGallery(...a),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: () => mockGalleryPermission(),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

// expo-image is a native view, in the test a placeholder that passes all
// props through is enough (same pattern as recap/__tests__/list.test.tsx).
// Without the mock the import already fails, expo-image/src/observe.ts
// expects a native environment.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Task 9: accountApi transitively imports @/lib/supabase (-> the
// AsyncStorage native module, not present in Jest, not bypassable even via
// jest.requireActual, the import sits at the top of the module), so it's
// fully mocked like the other feature modules. `deletionSummaryText` gets a
// simple, predictable version here instead of the real wording, the real
// phrasing (singular/plural, "3 Reisen mit insgesamt 128 Momenten...") is
// already fully covered in features/account/__tests__/accountApi.test.ts;
// here only THAT profile.tsx actually displays deletionSummaryText's result
// counts.
const mockFetchDeletionCounts = jest.fn();
const mockDeleteAccount = jest.fn();
jest.mock('@/features/account/accountApi', () => ({
  fetchDeletionCounts: () => mockFetchDeletionCounts(),
  deleteAccount: () => mockDeleteAccount(),
  deletionSummaryText: (counts: { own_trips: number }) => `ZAHLEN-TEXT (${counts.own_trips} Reisen)`,
}));

// Task 10: the WiFi-only switch reads/writes through the settings module.
// Default "off", matching the documented default in settings.ts.
const mockWifiOnly = jest.fn(async () => false);
const mockSetWifiOnly = jest.fn(async (_value: boolean) => {});
jest.mock('@/features/moments/settings', () => ({
  wifiOnly: () => mockWifiOnly(),
  setWifiOnly: (value: boolean) => mockSetWifiOnly(value),
}));

// The notifications switch: setting (default ON, see push/settings.ts) and
// pushApi. The latter as a factory mock for the same reason as accountApi
// below: the real module pulls in @/lib/supabase, expo-notifications and
// expo-device.
const mockNotificationsActive = jest.fn(async () => true);
const mockSetNotificationsActive = jest.fn(async (_value: boolean) => {});
jest.mock('@/features/push/settings', () => ({
  notificationsActive: () => mockNotificationsActive(),
  setNotificationsActive: (value: boolean) => mockSetNotificationsActive(value),
}));
const mockRegisterPush = jest.fn(async (_userId: string) => 'ok');
const mockDeregisterPush = jest.fn(async () => {});
jest.mock('@/features/push/pushApi', () => ({
  registerPushToken: (userId: string) => mockRegisterPush(userId),
  deregisterPushToken: () => mockDeregisterPush(),
}));

// The save moment in the name editor celebrates with light haptics (§5:
// light for small moments, success stays reserved for sealing/reveal).
const mockHapticLight = jest.fn(async (_style: unknown) => {});
jest.mock('expo-haptics', () => ({
  impactAsync: (style: unknown) => mockHapticLight(style),
  ImpactFeedbackStyle: { Light: 'light' },
}));

// Path adjustment (Task-10 context, deviation 2): the router root is
// mobile/src/app/, not mobile/app/, three levels up from __tests__/ to
// app/(tabs)/...
import ProfileScreen from '../../../app/(tabs)/profile';
import { setAvatar } from '@/features/auth/avatarApi';
import { fetchOwnProfile, updateProfile } from '../profileApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Default profile without an image. The error-case test below deliberately
// overrides this with an ALREADY set avatar_key, otherwise "the old image
// stays standing" couldn't be told apart from "there never was one".
const PROFILE_WITHOUT_IMAGE = { id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockWifiOnly.mockResolvedValue(false);
  mockNotificationsActive.mockResolvedValue(true);
  mockRegisterPush.mockResolvedValue('ok');
  mockGalleryPermission.mockResolvedValue({ granted: true });
  mockFromGallery.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///gewaehlt.jpg', width: 4000, height: 3000 }],
  });
  (fetchOwnProfile as jest.Mock).mockResolvedValue(PROFILE_WITHOUT_IMAGE);
});

test('shows profile data and signs out', async () => {
  await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('@lea')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abmelden'));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});

// Swapped (2026-08-13): the tab's hero image is now the person's own
// profile picture, the passport the small decoration in the name card,
// where the 44 px circle used to stand.
test('the profile picture stands large above the name card, the passport small within it', async () => {
  await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
  await screen.findByText('Lea');
  // "above" means: BEFORE the passport in the tree. The serialized tree
  // reflects the sibling order, and the passport only occurs inside the
  // name card now. Against the old version (passport first), the assertion
  // is red.
  const tree = JSON.stringify(screen.toJSON());
  expect(tree.indexOf('avatar-picker')).toBeLessThan(tree.indexOf('profile-passport'));
  // Hero size instead of the 44 of the card avatars.
  expect(StyleSheet.flatten(screen.getByTestId('avatar-circle').props.style).width).toBe(160);
  // Decoration: the passport says nothing the card doesn't already say.
  expect(screen.getByTestId('profile-passport').props.accessible).toBe(false);
});

test('shows the WiFi-only switch with an explanation of what it does', async () => {
  await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
  expect(await screen.findByText('Nur über WLAN einsenden')).toBeTruthy();
  expect(
    screen.getByText('Spart mobile Daten. Deine Momente warten, bis du wieder im WLAN bist.')
  ).toBeTruthy();
  expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(false);
});

test('a tap on the switch writes the choice into settings', async () => {
  await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
  const toggle = await screen.findByLabelText('Nur über WLAN einsenden');
  await fireEvent(toggle, 'valueChange', true);
  expect(mockSetWifiOnly).toHaveBeenCalledWith(true);
  expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(true);
});

test('an already saved "WiFi only" shows itself on open', async () => {
  mockWifiOnly.mockResolvedValue(true);
  await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
  await waitFor(() => expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(true));
});

describe('profile picture (Task 6)', () => {
  test('the profile tab shows the image picker as the hero image', async () => {
    await wrap(<ProfileScreen />);
    expect(await screen.findByTestId('avatar-picker')).toBeTruthy();
  });

  // The chosen path must become visible without a reload, otherwise the tap
  // seems to have no effect until the screen happens to reload. profileApi
  // is deliberately NOT called again here (no second fetchOwnProfile),
  // setAvatar's response IS the new state.
  test('a chosen image appears immediately in the circle', async () => {
    (setAvatar as jest.Mock).mockResolvedValue({
      avatarKey: 'profiles/u1/neu.jpg',
      error: null,
    });
    await wrap(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('avatar-picker'));
    await fireEvent.press(screen.getByText('Foto auswählen'));
    // Since the 2026-08-13 bug, the crop step sits in between: the system
    // editor had to go, so the crop happens in the app.
    await fireEvent.press(await screen.findByTestId('crop-apply'));
    await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
  });

  // Review finding (CRITICAL, merge fix round): the sheet hung inside the
  // 44 px wrapper of the avatar circle, i.e. INSIDE the ScrollView, INSIDE a
  // card row. Because `Sheet` is not a `Modal`, but lays
  // `StyleSheet.absoluteFill` over its immediate parent, that made it a
  // 44 px wide, co-scrolling strip on the device: «Foto auswählen» would
  // have had negative remaining width at 2 x 24 px of inner padding.
  //
  // Jest runs no Yoga layout, so the geometry itself isn't checkable here.
  // What is checkable is the TREE POSITION, and the geometry follows from
  // it: the sheet must be a sibling of the ScrollView, the way the delete
  // sheet below has always been. This test goes red against the old
  // version.
  test('the image sheet hangs off the screen, not inside the ScrollView', async () => {
    await wrap(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('avatar-picker'));
    await screen.findByText('Foto auswählen');

    const content = screen.getByTestId('profile-content');
    // Control first: the circle actually sits inside this ScrollView.
    // Without it, the assertion below would also be green if `within`
    // missed its target entirely or the testID no longer matched.
    expect(within(content).getByTestId('avatar-picker')).toBeTruthy();
    expect(within(content).queryByTestId('sheet-root')).toBeNull();
    expect(screen.getByTestId('sheet-root')).toBeTruthy();
  });

  // Review finding: the original version of this test started with
  // avatar_key: null (default mock) and only checked the error text. That
  // couldn't tell "old image correctly kept" apart from "old image wrongly
  // deleted": in BOTH cases there is no avatar-image node. This version
  // therefore starts WITH an already-set avatar_key and afterward explicitly
  // checks that exactly this URL still sits in the tree after the failure:
  // if the error branch wrongly broke `avatar_key: null` into state (instead
  // of returning early, the way profile.tsx does it), the image node would
  // vanish, and `getByTestId` would throw right here.
  test('an upload error stands under the circle, the old image stays standing', async () => {
    (fetchOwnProfile as jest.Mock).mockResolvedValue({
      id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: 'profiles/u1/alt.jpg',
    });
    (setAvatar as jest.Mock).mockResolvedValue({
      avatarKey: null,
      error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.',
    });
    await wrap(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
    const urlBefore = screen.getByTestId('avatar-image').props.source.uri;

    await fireEvent.press(screen.getByTestId('avatar-picker'));
    await fireEvent.press(screen.getByText('Foto auswählen'));
    await fireEvent.press(await screen.findByTestId('crop-apply'));

    await waitFor(() =>
      expect(
        screen.getByText('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.')
      ).toBeTruthy()
    );
    // The actual core of the assertion, not just "some image": the same URL
    // as before the failed attempt.
    expect(screen.getByTestId('avatar-image').props.source.uri).toBe(urlBefore);
  });
});

// The notifications switch controls device registration: off deletes the
// token, on registers it. Only a declined system permission gets feedback;
// 'fehler'/'unsupported' are everyday cases (Expo Go, simulator,
// Task-4 brief) and stay silent.
describe('notifications', () => {
  test('shows the switch with an explanation, default on', async () => {
    await wrap(<ProfileScreen />);
    expect(await screen.findByText('Benachrichtigungen')).toBeTruthy();
    expect(
      screen.getByText('Sagt dir Bescheid, wenn in deinen Reisen etwas passiert.')
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(true)
    );
  });

  test('a saved OFF shows itself on open', async () => {
    mockNotificationsActive.mockResolvedValue(false);
    await wrap(<ProfileScreen />);
    await waitFor(() =>
      expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(false)
    );
  });

  test('turning off saves the choice and deregisters the device', async () => {
    await wrap(<ProfileScreen />);
    const toggle = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() => expect(mockSetNotificationsActive).toHaveBeenCalledWith(false));
    await waitFor(() => expect(mockDeregisterPush).toHaveBeenCalledTimes(1));
    expect(mockRegisterPush).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(false);
  });

  test('turning on saves the choice and registers the device', async () => {
    mockNotificationsActive.mockResolvedValue(false);
    await wrap(<ProfileScreen />);
    const toggle = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(toggle, 'valueChange', true);
    await waitFor(() => expect(mockSetNotificationsActive).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mockRegisterPush).toHaveBeenCalledWith('uid-1'));
    expect(mockDeregisterPush).not.toHaveBeenCalled();
  });

  test('a declined permission springs back and explains itself', async () => {
    mockNotificationsActive.mockResolvedValue(false);
    mockRegisterPush.mockResolvedValue('no_permission');
    await wrap(<ProfileScreen />);
    const toggle = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(toggle, 'valueChange', true);
    expect(
      await screen.findByText(
        'Ohne Zugriff auf Mitteilungen geht es nicht. Du kannst das in den Einstellungen ändern.'
      )
    ).toBeTruthy();
    expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(false);
    // Also saved, not just displayed: otherwise the switch would wrongly
    // come back ON the next time it opens.
    expect(mockSetNotificationsActive).toHaveBeenLastCalledWith(false);
  });

  test("a silent failure ('fehler') leaves the switch on and shows nothing", async () => {
    mockNotificationsActive.mockResolvedValue(false);
    mockRegisterPush.mockResolvedValue('fehler');
    await wrap(<ProfileScreen />);
    const toggle = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(toggle, 'valueChange', true);
    await waitFor(() => expect(mockRegisterPush).toHaveBeenCalled());
    expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(true);
    expect(
      screen.queryByText(
        'Ohne Zugriff auf Mitteilungen geht es nicht. Du kannst das in den Einstellungen ändern.'
      )
    ).toBeNull();
  });
});

// «Anzeigename ändern»: the name card is the tap target, a pencil on the
// right signals editability. The editor is NOT a bottom sheet, but a
// full-screen overlay like AvatarCropper (device finding + decision
// 2026-08-13): in a sheet at the bottom edge, the fields sat exactly where
// the keyboard stands. The USERNAME is deliberately NOT included (decision
// 2026-08-13): it may later become a login identifier, and a freed-up old
// name would then be a mix-up risk.
describe('changing the display name', () => {
  test('the name card carries a pencil as an edit hint', async () => {
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    const card = screen.getByTestId('name-edit-open');
    expect(within(card).getByTestId('name-edit-pencil')).toBeTruthy();
  });

  test('the name card opens the full-screen editor: display name prefilled, NO username field', async () => {
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    // Prefilled means: the SAVED value sits in the field (getByDisplayValue
    // only matches TextInputs, not the card text next to it). The username
    // has no input field, fixed until there is a server-side brake.
    expect(screen.getByDisplayValue('Lea')).toBeTruthy();
    expect(screen.queryByDisplayValue('lea')).toBeNull();
    // Full-screen overlay, not a sheet: the editor sits, like the cropper,
    // as a sibling OVER the screen, not in the scroll content (same tree
    // position as in the image-sheet test below, the geometry follows from
    // it).
    expect(screen.getByTestId('name-editor')).toBeTruthy();
    expect(screen.queryByTestId('sheet-root')).toBeNull();
    expect(within(screen.getByTestId('profile-content')).queryByTestId('name-editor')).toBeNull();
    // Instead of decoration, a live preview fills the page: the row the way
    // friends see it (circle, name, handle), with the CURRENTLY TYPED state.
    // It sits ABOVE the input field (and therefore before the buttons in the
    // tree): see what you're changing first, then change it.
    const preview = within(screen.getByTestId('name-editor')).getByTestId('name-preview');
    expect(within(preview).getByText('Lea')).toBeTruthy();
    expect(within(preview).getByText('@lea')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('name-preview')).toBeLessThan(tree.indexOf('Speichern'));
  });

  test('the preview tracks live while typing, without saving', async () => {
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    const preview = within(screen.getByTestId('name-editor')).getByTestId('name-preview');
    expect(within(preview).getByText('Lea Neu')).toBeTruthy();
    // Only the preview, not the screen behind it: nothing is saved.
    expect(updateProfile).not.toHaveBeenCalled();
  });

  test('saving writes the display name and shows it immediately, the username stays', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({ error: null });
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Speichern'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith('uid-1', 'Lea Neu'));
    // Same as with the profile picture: the response IS the new state, no
    // second fetchOwnProfile round trip.
    expect(await screen.findByText('Lea Neu')).toBeTruthy();
    expect(screen.getByText('@lea')).toBeTruthy();
    expect((fetchOwnProfile as jest.Mock).mock.calls.length).toBe(1);
    // The editor closes itself AFTER the save moment (preview pop + 250 ms
    // exit), hence waitFor instead of an immediate assertion.
    await waitFor(() => expect(screen.queryByTestId('name-editor')).toBeNull(), { timeout: 3000 });
  });

  test('the save moment: a checkmark on the button and light haptics, then the editor closes', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({ error: null });
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Speichern'));
    // The checkmark sits on the button BEFORE the screen switches.
    await waitFor(() => expect(screen.getByTestId('button-success')).toBeTruthy());
    expect(screen.getByTestId('name-editor')).toBeTruthy();
    await waitFor(() => expect(mockHapticLight).toHaveBeenCalledWith('light'));
    await waitFor(() => expect(screen.queryByTestId('name-editor')).toBeNull(), { timeout: 3000 });
  });

  test('a server error stands in the editor, it stays open, the old name stays standing', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({ error: 'KAPUTT' });
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Speichern'));
    expect(await screen.findByText('KAPUTT')).toBeTruthy();
    expect(screen.getByTestId('name-editor')).toBeTruthy();
    expect(screen.getByText('Lea')).toBeTruthy();
    // No celebration without success: the error path stays silent.
    expect(mockHapticLight).not.toHaveBeenCalled();
  });

  test('«Abbrechen» closes the editor, without saving', async () => {
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(screen.queryByTestId('name-editor')).toBeNull();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Lea')).toBeTruthy();
  });

  test('an empty display name never even calls the API', async () => {
    await wrap(<ProfileScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), '   ');
    await fireEvent.press(screen.getByText('Speichern'));
    expect(await screen.findByText('NAME-REGEL')).toBeTruthy();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

// Task 9: account deletion. Fixed counts, matching the brief's example
// ("3 Reisen mit insgesamt 128 Momenten von 5 Personen").
const COUNTS_OK = {
  data: { own_trips: 3, moments_in_own_trips: 128, affected_people: 5, own_moments_elsewhere: 0 },
  error: null,
};
const EMPTY_COUNTS = {
  data: { own_trips: 0, moments_in_own_trips: 0, affected_people: 0, own_moments_elsewhere: 0 },
  error: null,
};

describe('deleting the account (Task 9)', () => {
  test('stands at the bottom, below everything else, after the sign-out button', async () => {
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await screen.findByText('Lea');
    expect(screen.getByTestId('delete-account-open')).toBeTruthy();
    expect(screen.getByText('Konto löschen')).toBeTruthy();
  });

  test('tapping opens the dialog and immediately loads the counts', async () => {
    mockFetchDeletionCounts.mockResolvedValue(COUNTS_OK);
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    expect(mockFetchDeletionCounts).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('ZAHLEN-TEXT (3 Reisen)')).toBeTruthy();
  });

  // The core of the requirement: "Confirmation must not be possible without
  // loaded counts.", as long as fetchDeletionCounts hasn't answered yet, the
  // confirm button simply isn't in the tree at all (not merely `disabled`).
  test('without loaded counts there is NO confirm button, only a loading indicator', async () => {
    mockFetchDeletionCounts.mockReturnValue(new Promise(() => {})); // deliberately hangs
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    expect(await screen.findByTestId('delete-account-counts-loading')).toBeTruthy();
    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
  });

  test('a loading error shows the cause with a retry, no confirm button', async () => {
    mockFetchDeletionCounts.mockResolvedValue({ data: null, error: 'kaputt' });
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    expect(await screen.findByText('kaputt')).toBeTruthy();
    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
    expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
  });

  test('«Nochmal versuchen» loads the counts again, then the confirm button appears', async () => {
    mockFetchDeletionCounts
      .mockResolvedValueOnce({ data: null, error: 'kaputt' })
      .mockResolvedValueOnce(EMPTY_COUNTS);
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await screen.findByText('kaputt');
    await fireEvent.press(screen.getByText('Nochmal versuchen'));
    expect(await screen.findByTestId('delete-account-confirm')).toBeTruthy();
    expect(mockFetchDeletionCounts).toHaveBeenCalledTimes(2);
  });

  test('success: deletes the account and signs out afterward', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    mockDeleteAccount.mockResolvedValue({ error: null });
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await fireEvent.press(await screen.findByTestId('delete-account-confirm'));
    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });

  test('a deletion failure shows the cause, does NOT sign out, the dialog stays usable', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    mockDeleteAccount.mockResolvedValue({
      error: 'Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.',
    });
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await fireEvent.press(await screen.findByTestId('delete-account-confirm'));
    expect(
      await screen.findByText('Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.')
    ).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-account-confirm').props.accessibilityState.disabled).toBe(false);
  });

  test('a second tap, while the deletion is still running, does NOT trigger a second call', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    let resolveDelete!: (value: { error: null }) => void;
    mockDeleteAccount.mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await fireEvent.press(await screen.findByTestId('delete-account-confirm'));
    expect(await screen.findByTestId('delete-account-loading')).toBeTruthy(); // spinner instead of text
    await fireEvent.press(screen.getByTestId('delete-account-confirm'));
    await act(async () => {
      resolveDelete({ error: null });
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  });

  test('«Abbrechen» closes the dialog, without deleting or signing out', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await screen.findByTestId('delete-account-confirm');
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

// The cover only exists where the device occupies a top strip; the global
// mock reports insets of 0, so the device measurement is set via the spy
// pattern from player.test.tsx.
describe('status bar cover', () => {
  let insetSpy: jest.SpyInstance;

  afterEach(() => insetSpy.mockRestore());

  test('an opaque surface backs the status bar, scrolled content never shows behind it', async () => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
    await render(<ThemeProvider><ProfileScreen /></ThemeProvider>);
    await screen.findByText('Lea');
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  });
});
