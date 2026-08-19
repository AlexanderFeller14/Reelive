import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Sheet } from '@/components/Sheet';
import { AvatarSheetContent, AvatarPicker } from '../AvatarPicker';

// The "mock" prefix here isn't a matter of taste: babel-plugin-jest-hoist
// hoists jest.mock() calls above every other statement (even above `const X =
// jest.fn()`), so the module is already mocked before it gets imported. If a
// factory references a variable from outside, the plugin checks whether it
// survives this hoisting, and only names starting with "mock"
// (case-insensitive) do, which it hoists right along with it. Without the
// prefix, the test run already breaks with "not allowed to reference any
// out-of-scope variables" (the same trap as in avatarApi.test.ts).
const mockFromGallery = jest.fn();
const mockFromCamera = jest.fn();
const mockGalleryPermission = jest.fn();
// The camera permission is now also a controllable jest.fn rather than a
// function hard-wired to `granted: true`: the camera branch of the error
// message (its own text!) was otherwise unreachable by any test. Overwriting
// the module property afterward does NOT work here, AvatarPicker.tsx imports
// via `import * as ImagePicker`, and Babel's `_interopRequireWildcard` builds
// a COPY for a CJS mock object without `__esModule`; the assignment would go
// nowhere, the test would run down the success path and close the sheet.
const mockCameraPermission = jest.fn();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockFromGallery(...a),
  launchCameraAsync: (...a: unknown[]) => mockFromCamera(...a),
  requestMediaLibraryPermissionsAsync: () => mockGalleryPermission(),
  requestCameraPermissionsAsync: () => mockCameraPermission(),
}));

// AvatarPicker renders Avatar (Task 3), and its own test (Avatar.test.tsx)
// already mocks expo-image for the same reason: without the mock, the import
// itself already fails, expo-image/src/observe.ts expects a native
// environment (requireOptionalNativeModule('ExpoObserve') returns an
// auto-mock native module under jest-expo whose getIntegrations() is missing,
// and the call throws). The same mock as there, needed here because this test
// doesn't isolate Avatar but pulls it in through AvatarPicker.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  // clearAllMocks BEFORE the defaults: otherwise the call list would carry
  // over from test to test, and "the image picker wasn't even opened" (the
  // assertion in the permission test below) would no longer be checkable.
  // clearAllMocks only wipes calls, not implementations, the defaults below
  // still apply unchanged.
  jest.clearAllMocks();
  mockFromGallery.mockResolvedValue({
    canceled: false,
    // Dimensions belong here: the crop screen relies on them.
    assets: [{ uri: 'file:///gewaehlt.jpg', width: 4000, height: 3000 }],
  });
  mockFromCamera.mockResolvedValue({ canceled: true, assets: null });
  mockGalleryPermission.mockResolvedValue({ granted: true });
  mockCameraPermission.mockResolvedValue({ granted: true });
});

// The image picker has been split in two since the merge fix round (reasoning
// in AvatarPicker.tsx: the sheet must be a sibling of the screen content, not
// a child of the 44 px circle). This miniature shell replays what both
// screens do: circle up top, sheet alongside, visibility in the screen,
// and it keeps the tests below at exactly the tree shape that holds on the
// device.
function Stage({
  avatarKey = null, localUri = null, onSelected = jest.fn(), onRemove = jest.fn(),
}: {
  avatarKey?: string | null;
  localUri?: string | null;
  onSelected?: (uri: string, width: number, height: number) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AvatarPicker
        name="Lea"
        avatarKey={avatarKey}
        localUri={localUri}
        onOpen={() => setOpen(true)}
      />
      <Sheet visible={open} title="Profilbild" onClose={() => setOpen(false)}>
        <AvatarSheetContent
          avatarKey={avatarKey}
          localUri={localUri}
          onSelected={onSelected}
          onRemove={onRemove}
          onClose={() => setOpen(false)}
        />
      </Sheet>
    </>
  );
}

// The circle no longer knows the sheet, it only reports the tap. That's half
// of the assertion from the review finding: what it does NOT do is hang a
// sheet inside its own 44 px wrapper.
test('a tap on the circle reports upward and renders no sheet of its own', async () => {
  const onOpen = jest.fn();
  await wrap(<AvatarPicker name="Lea" avatarKey={null} onOpen={onOpen} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('sheet-root')).toBeNull();
  expect(screen.queryByText('Foto auswählen')).toBeNull();
});

// The profile tab has shown its own picture as a large header image since the
// swap on 2026-08-13. `large` scales BOTH the circle AND the badge: an 18 px
// badge on a 160 circle would read as a speck of dust, not as "something here
// can be changed".
test('large draws the hero circle with a badge that grows along with it', async () => {
  await wrap(<AvatarPicker name="Lea" avatarKey={null} onOpen={jest.fn()} large />);
  expect(StyleSheet.flatten(screen.getByTestId('avatar-kreis').props.style).width).toBe(160);
  const badge = StyleSheet.flatten(screen.getByTestId('avatar-waehler-badge').props.style);
  expect(badge.width).toBe(32);
  expect(badge.height).toBe(32);
});

// Onboarding and cards stay unchanged: without `large`, the §4 upper bound of
// 44 still applies.
test('without large the circle stays at 44', async () => {
  await wrap(<AvatarPicker name="Lea" avatarKey={null} onOpen={jest.fn()} />);
  expect(StyleSheet.flatten(screen.getByTestId('avatar-kreis').props.style).width).toBe(44);
  expect(StyleSheet.flatten(screen.getByTestId('avatar-waehler-badge').props.style).width).toBe(18);
});

// The local-URI branch (the onboarding path) must scale along too, otherwise
// `large` plus a local file would show a 44 circle under a 32 badge.
test('large also applies to the local-URI circle', async () => {
  await wrap(
    <AvatarPicker name="Lea" avatarKey={null} localUri="file:///gewaehlt.jpg" onOpen={jest.fn()} large />
  );
  // The image node fills its circle by percentage, so the wrapper carries the
  // size: measure it there instead.
  const wrapper = screen.getByTestId('avatar-waehler-lokal');
  expect(StyleSheet.flatten(wrapper.props.style).width).toBe(160);
});

test("a tap on the circle opens the screen's sheet", async () => {
  await wrap(<Stage />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Foto auswählen')).toBeTruthy();
  expect(screen.getByText('Selfie aufnehmen')).toBeTruthy();
});

// "Bild entfernen" must not appear when there's nothing to remove.
test('without an image the remove entry is missing', async () => {
  await wrap(<Stage />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.queryByText('Bild entfernen')).toBeNull();
});

test('with an image the remove entry is there', async () => {
  await wrap(<Stage avatarKey="profiles/u/a.jpg" />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Bild entfernen')).toBeTruthy();
});

// The onboarding case: `avatarKey` is structurally always null there, the
// image only exists as a local URI. Even then it must be removable.
test('a bare local URI counts as an image too', async () => {
  await wrap(<Stage localUri="file:///gewaehlt.jpg" />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Bild entfernen')).toBeTruthy();
});

// The dimensions travel along: the crop screen needs them to compute, and the
// image picker delivers them anyway, measuring them again later would mean
// decoding a large original a second time.
test('the gallery delivers URI and dimensions to onSelected and closes the sheet', async () => {
  const onSelected = jest.fn();
  await wrap(<Stage onSelected={onSelected} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() =>
    expect(onSelected).toHaveBeenCalledWith('file:///gewaehlt.jpg', 4000, 3000)
  );
  expect(screen.queryByTestId('sheet-root')).toBeNull();
});

// This assertion FLIPPED on 2026-08-13, and that's the core of a fixed bug:
// this used to say the selection must request `allowsEditing: true`. That was
// exactly the cause, on iOS the option forces the old
// UIImagePickerController (only that one can crop), which loads the source
// image fully into memory and gets killed by the system for large images. The
// app then received a `canceled: true`, indistinguishable from a real cancel,
// without an exception and without a message: a large image simply couldn't
// be selected.
//
// The square is now produced in features/auth/avatarApi.ts (centered crop to
// the shorter edge, tested there). Here it's only guarded that the option
// does NOT come back.
test('the selection does not request a system crop', async () => {
  await wrap(<Stage />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(mockFromGallery).toHaveBeenCalled());
  const options = mockFromGallery.mock.calls[0][0];
  expect(options.allowsEditing).toBeUndefined();
  expect(options.mediaTypes).toBe('images');
});

// A thrown error must not vanish without a trace. The call reads `void
// choose(…)`, so a rejection would be an unhandled promise, exactly why
// nothing showed up in the bug from 2026-08-13.
test('when the image picker throws, the message shows up in the sheet', async () => {
  mockFromGallery.mockRejectedValueOnce(new Error('kaputt'));
  await wrap(<Stage />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  const panel = await screen.findByTestId('sheet-panel');
  await waitFor(() =>
    expect(
      within(panel).getByText('Das Bild liess sich nicht öffnen. Probier es nochmal oder nimm ein anderes.')
    ).toBeTruthy()
  );
});

test('a cancel in the image picker reports nothing upward', async () => {
  const onSelected = jest.fn();
  mockFromGallery.mockResolvedValue({ canceled: true, assets: null });
  await wrap(<Stage onSelected={onSelected} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(mockFromGallery).toHaveBeenCalled());
  expect(onSelected).not.toHaveBeenCalled();
  expect(screen.queryByTestId('sheet-root')).toBeNull();
});

// Review finding (Important 2): a denied permission must not be a silent
// nothing (Spec §5.2), and "not silent" means VISIBLE, not just "somewhere
// in the element tree". The text used to sit as a sibling BEFORE the sheet,
// i.e. on the screen under the backdrop; RNTL found it anyway, because it
// queries the tree, not the screen. That's why this test doesn't check
// `screen.getByText`, but searches INSIDE the sheet panel, and additionally
// checks that the sheet stays open for it.
test('a denied permission shows the message IN the sheet, which stays open', async () => {
  mockGalleryPermission.mockResolvedValue({ granted: false });
  await wrap(<Stage />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));

  const panel = await screen.findByTestId('sheet-panel');
  await waitFor(() =>
    expect(
      within(panel).getByText(
        'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.'
      )
    ).toBeTruthy()
  );
  // Staying open is part of the assertion: a message in a sheet that closes
  // in the same breath is the silent nothing all over again.
  expect(within(panel).getByText('Foto auswählen')).toBeTruthy();
  expect(mockFromGallery).not.toHaveBeenCalled();
});

// The second entry has its OWN text ("camera" instead of "your photos"), and
// that had not been touched by any test so far.
test('a denied camera permission names the camera, not the photos', async () => {
  mockCameraPermission.mockResolvedValue({ granted: false });
  await wrap(<Stage />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Selfie aufnehmen'));
  const panel = await screen.findByTestId('sheet-panel');
  await waitFor(() =>
    expect(
      within(panel).getByText(
        'Ohne Zugriff auf die Kamera geht es nicht. Du kannst das in den Einstellungen ändern.'
      )
    ).toBeTruthy()
  );
  expect(mockFromCamera).not.toHaveBeenCalled();
});
