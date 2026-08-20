import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import ProfileSetupScreen from '../profile-setup';
import { createProfile } from '@/features/auth/profileApi';
import { setAvatar } from '@/features/auth/avatarApi';

// Scaffolding note: `createProfile` is pulled from the real module via
// `jest.requireActual` (validateUsername/validateDisplayName must stay REAL,
// the screen calls them directly). The real profileApi.ts imports
// `@/lib/supabase` at the top though, and that throws on import without
// EXPO_PUBLIC_SUPABASE_ANON_KEY ("Supabase-Konfiguration fehlt", see
// src/lib/supabase.ts), a value the test environment does not set
// (jest.setup.ts sets only the URL). So `@/lib/supabase` is mocked here as
// well, exactly as profileApi.test.ts already does for the same import.
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ insert: jest.fn(), select: jest.fn() }) },
}));
jest.mock('@/features/auth/profileApi', () => ({
  ...jest.requireActual('@/features/auth/profileApi'),
  createProfile: jest.fn(),
}));
jest.mock('@/features/auth/avatarApi');
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'u1', refreshProfile: jest.fn() }),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [{ uri: 'file:///gewaehlt.jpg', width: 4000, height: 3000 }],
  }),
  launchCameraAsync: async () => ({ canceled: true, assets: null }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));
// Scaffolding note: `AvatarPicker` still renders `Avatar` when no local URI
// is chosen, and that imports `expo-image`. Without a mock the import itself
// already fails, same reasoning as in AvatarPicker.test.tsx and
// profileTab.test.tsx.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Scaffolding note: `Input` (floating label, src/components/Input.tsx) only
// passes `placeholder` down to the native field once it is focused OR
// already carries a value (`lifted`), see Input.test.tsx, test "placeholder
// erscheint erst mit Fokus". An empty, unfocused field therefore has no
// `placeholder` prop at all, and `getByPlaceholderText('lea_2026')` finds
// nothing. Every other test file that types into an `Input` addresses the
// field through its visible `label` text (`accessibilityLabel`) instead of
// the placeholder, and so does this one.
const usernameField = () => screen.getByLabelText('Username');
const displayNameField = () => screen.getByLabelText('Anzeigename');

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  (createProfile as jest.Mock).mockResolvedValue({ error: null, field: null });
  (setAvatar as jest.Mock).mockResolvedValue({ avatarKey: 'profiles/u1/neu.jpg', error: null });
});

test('the onboarding screen offers the avatar picker right away', async () => {
  await wrap(<ProfileSetupScreen />);
  expect(screen.getByTestId('avatar-picker')).toBeTruthy();
});

// Review finding (CRITICAL, merge fix round): the sheet used to hang in the
// wrapper of the avatar circle, which itself sits in the centred, roughly
// 72 px tall image row of the form. `Sheet` is not a `Modal`: it lays
// `StyleSheet.absoluteFill` over its IMMEDIATE parent, and Yoga resolves its
// `bottom:0` panel against exactly that one. On the device this was a short
// band in the middle of the form instead of a sheet coming up from below.
//
// The onboarding screen has no ScrollView, so the form now stands as its own
// level under a bare frame (profile-setup.tsx) and the sheet is its sibling.
// Jest checks no geometry (no Yoga), but it does check tree position, and
// the geometry follows from that.
test('the image sheet hangs off the screen frame, not inside the form', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-picker'));
  await screen.findByText('Foto auswählen');

  const form = screen.getByTestId('onboarding-form');
  // Control first: the circle really does live inside the form. Without it
  // the assertion below would be green even with a testID that no longer fits.
  expect(within(form).getByTestId('avatar-picker')).toBeTruthy();
  expect(within(form).queryByTestId('sheet-root')).toBeNull();
  expect(screen.getByTestId('sheet-root')).toBeTruthy();
});

// Skippable means: you get through without an image, and createProfile
// receives null, not an empty string (empty strings have been a problem in
// this schema before, see
// 20260808150000_leerstrings_und_profil_grants.sql).
//
// Scaffolding note: all three tests below `await` EVERY `fireEvent`. Without
// that await React does not commit the state update from `changeText` before
// the following `fireEvent.press("Los geht's")`, `submit()` then still reads
// the empty initial values from the closure, `validateUsername`/
// `validateDisplayName` fail, and `createProfile` is never called. Visible in
// the `screen.debug()` output while debugging this test: the fields showed
// the new `value`, but BOTH error texts were still there. Same React 19 /
// RNTL v14 stumbling block as documented in Input.test.tsx ("await nötig:
// fireEvent ist in dieser RNTL-Version async").
test('without an image the onboarding still goes through and avatar_key stays null', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.changeText(usernameField(), 'lea_2026');
  await fireEvent.changeText(displayNameField(), 'Lea');
  await fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() => expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', null));
  expect(setAvatar).not.toHaveBeenCalled();
});

// Upload first, then create the row: createProfile writes avatar_key along
// with it, a follow-up update would be a second write that can fail after
// the profile already stands.
test('a chosen image is uploaded before the profile row is created', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-picker'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  // The crop step has sat in between since 2026-08-13 (the system editor had
  // to go, it made large images fail).
  await fireEvent.press(await screen.findByTestId('crop-apply'));
  await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
  await fireEvent.changeText(usernameField(), 'lea_2026');
  await fireEvent.changeText(displayNameField(), 'Lea');
  await fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() =>
    expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', 'profiles/u1/neu.jpg')
  );
});

// Review finding (fix round 1): `avatarKey` is structurally ALWAYS null
// during onboarding (profile-setup.tsx passes it hard-wired), so a freshly
// chosen, only locally present image could NOT be removed again: the
// "Bild entfernen" entry in the sheet hung on `avatarKey` alone. This test
// chooses an image, opens the picker again, checks that the entry is there
// now, removes the image through it and checks against the rendered tree
// (not against internal state) that it is really gone: `avatar-image` (the
// local preview image) must not exist afterwards.
test('a chosen image can be taken back before the form is submitted', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-picker'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  // The crop step has sat in between since 2026-08-13 (the system editor had
  // to go, it made large images fail).
  await fireEvent.press(await screen.findByTestId('crop-apply'));
  await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('avatar-picker'));
  await waitFor(() => expect(screen.getByText('Bild entfernen')).toBeTruthy());
  await fireEvent.press(screen.getByText('Bild entfernen'));

  await waitFor(() => expect(screen.queryByTestId('avatar-image')).toBeNull());
});

// A failed upload must not block the onboarding: the name is the required
// field, the image is the extra.
test('a failed upload still creates the profile', async () => {
  (setAvatar as jest.Mock).mockResolvedValue({ avatarKey: null, error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.' });
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-picker'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  // The crop step has sat in between since 2026-08-13 (the system editor had
  // to go, it made large images fail).
  await fireEvent.press(await screen.findByTestId('crop-apply'));
  await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
  await fireEvent.changeText(usernameField(), 'lea_2026');
  await fireEvent.changeText(displayNameField(), 'Lea');
  await fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() => expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', null));
});
