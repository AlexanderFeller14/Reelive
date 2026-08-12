import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AvatarWaehler } from '../AvatarWaehler';

// "mock"-Präfix ist hier keine Geschmacksfrage: babel-plugin-jest-hoist hebt
// jest.mock()-Aufrufe vor alle anderen Anweisungen (auch vor `const X =
// jest.fn()`), damit das Modul schon gemockt ist, bevor es importiert wird.
// Referenziert eine Factory eine Variable von ausserhalb, prüft das Plugin,
// ob sie diese Hebung übersteht — und das tut nur, was mit „mock" beginnt
// (case-insensitive), das hebt es gleich mit an. Ohne das Präfix bricht schon
// der Testlauf mit "not allowed to reference any out-of-scope variables" ab
// (dieselbe Falle wie in avatarApi.test.ts).
const mockAusGalerie = jest.fn();
const mockAusKamera = jest.fn();
const mockGalerieRecht = jest.fn();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockAusGalerie(...a),
  launchCameraAsync: (...a: unknown[]) => mockAusKamera(...a),
  requestMediaLibraryPermissionsAsync: () => mockGalerieRecht(),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

// AvatarWaehler rendert Avatar (Task 3), und dessen eigener Test
// (Avatar.test.tsx) mockt expo-image bereits aus demselben Grund: ohne Mock
// scheitert schon der Import, expo-image/src/observe.ts erwartet eine native
// Umgebung (requireOptionalNativeModule('ExpoObserve') liefert unter
// jest-expo ein Auto-Mock-NativeModule zurück, dessen getIntegrations()
// fehlt, und der Aufruf wirft). Derselbe Mock wie dort, hier nötig, weil
// dieser Test Avatar nicht isoliert, sondern über AvatarWaehler mitzieht.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  mockAusGalerie.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///gewaehlt.jpg' }] });
  mockAusKamera.mockResolvedValue({ canceled: true, assets: null });
  mockGalerieRecht.mockResolvedValue({ granted: true });
});

test('ein Tap auf den Kreis oeffnet das Sheet', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Foto auswählen')).toBeTruthy();
  expect(screen.getByText('Selfie aufnehmen')).toBeTruthy();
});

// «Bild entfernen» darf nicht dastehen, wenn es nichts zu entfernen gibt.
test('ohne Bild fehlt der Entfernen-Eintrag', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.queryByText('Bild entfernen')).toBeNull();
});

test('mit Bild steht der Entfernen-Eintrag da', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey="profiles/u/a.jpg" onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Bild entfernen')).toBeTruthy();
});

test('die Galerie liefert die URI an onGewaehlt', async () => {
  const onGewaehlt = jest.fn();
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={onGewaehlt} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(onGewaehlt).toHaveBeenCalledWith('file:///gewaehlt.jpg'));
});

// Quadratischer Zuschnitt ist eine Zusicherung, keine Kosmetik: ein
// nicht-quadratisches Bild stünde im runden Kreis verzerrt.
test('die Auswahl verlangt einen quadratischen Zuschnitt', async () => {
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() =>
    expect(mockAusGalerie).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1], mediaTypes: 'images' })
    )
  );
});

test('ein Abbruch im Bildwaehler meldet nichts nach oben', async () => {
  const onGewaehlt = jest.fn();
  mockAusGalerie.mockResolvedValue({ canceled: true, assets: null });
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={onGewaehlt} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(mockAusGalerie).toHaveBeenCalled());
  expect(onGewaehlt).not.toHaveBeenCalled();
});

// Eine abgelehnte Berechtigung darf kein stummes Nichts sein.
test('eine abgelehnte Berechtigung zeigt eine Meldung', async () => {
  mockGalerieRecht.mockResolvedValue({ granted: false });
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onGewaehlt={jest.fn()} onEntfernen={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() =>
    expect(screen.getByText('Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.')).toBeTruthy()
  );
});
