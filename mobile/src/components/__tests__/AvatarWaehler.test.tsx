import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Sheet } from '@/components/Sheet';
import { AvatarSheetInhalt, AvatarWaehler } from '../AvatarWaehler';

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
// Auch die Kamera-Berechtigung ist jetzt eine steuerbare jest.fn und keine
// fest auf `granted: true` verdrahtete Funktion mehr: der Kamera-Zweig der
// Fehlermeldung (eigener Text!) war sonst von keinem Test erreichbar. Ein
// nachträgliches Überschreiben der Modul-Eigenschaft funktioniert hier NICHT —
// AvatarWaehler.tsx importiert per `import * as ImagePicker`, und Babels
// `_interopRequireWildcard` legt für ein CJS-Mock-Objekt ohne `__esModule`
// eine KOPIE an; die Zuweisung ginge ins Leere, der Test liefe in den
// Erfolgspfad und schlösse das Sheet.
const mockKameraRecht = jest.fn();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockAusGalerie(...a),
  launchCameraAsync: (...a: unknown[]) => mockAusKamera(...a),
  requestMediaLibraryPermissionsAsync: () => mockGalerieRecht(),
  requestCameraPermissionsAsync: () => mockKameraRecht(),
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
  // clearAllMocks VOR den Defaults: sonst liefe die Aufrufliste von Test zu
  // Test über, und «der Bildwähler wurde gar nicht erst geöffnet» (die
  // Zusicherung im Berechtigungs-Test unten) wäre nicht mehr prüfbar.
  // clearAllMocks löscht nur Aufrufe, keine Implementierungen — die Defaults
  // darunter gelten also unverändert weiter.
  jest.clearAllMocks();
  mockAusGalerie.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///gewaehlt.jpg' }] });
  mockAusKamera.mockResolvedValue({ canceled: true, assets: null });
  mockGalerieRecht.mockResolvedValue({ granted: true });
  mockKameraRecht.mockResolvedValue({ granted: true });
});

// Der Bildwähler ist seit der Merge-Fixrunde zweigeteilt (Begründung in
// AvatarWaehler.tsx: das Sheet muss ein Geschwister des Screen-Inhalts sein,
// nicht ein Kind des 44-px-Kreises). Diese Miniatur-Hülle spielt nach, was
// beide Screens tun — Kreis oben, Sheet daneben, Sichtbarkeit im Screen —, und
// sie hält die Tests unten an genau der Baumform, die auf dem Gerät gilt.
function Buehne({
  avatarKey = null, lokaleUri = null, onGewaehlt = jest.fn(), onEntfernen = jest.fn(),
}: {
  avatarKey?: string | null;
  lokaleUri?: string | null;
  onGewaehlt?: (uri: string) => void;
  onEntfernen?: () => void;
}) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <AvatarWaehler
        name="Lea"
        avatarKey={avatarKey}
        lokaleUri={lokaleUri}
        onOeffnen={() => setOffen(true)}
      />
      <Sheet sichtbar={offen} titel="Profilbild" onSchliessen={() => setOffen(false)}>
        <AvatarSheetInhalt
          avatarKey={avatarKey}
          lokaleUri={lokaleUri}
          onGewaehlt={onGewaehlt}
          onEntfernen={onEntfernen}
          onSchliessen={() => setOffen(false)}
        />
      </Sheet>
    </>
  );
}

// Der Kreis kennt das Sheet nicht mehr, er meldet nur den Tap. Das ist die
// halbe Zusicherung aus dem Review-Fund: was er NICHT tut, ist ein Sheet in
// seinen eigenen 44-px-Wrapper hängen.
test('ein Tap auf den Kreis meldet nach oben und rendert selbst kein Sheet', async () => {
  const onOeffnen = jest.fn();
  await wrap(<AvatarWaehler name="Lea" avatarKey={null} onOeffnen={onOeffnen} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(onOeffnen).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('sheet-root')).toBeNull();
  expect(screen.queryByText('Foto auswählen')).toBeNull();
});

test('ein Tap auf den Kreis oeffnet das Sheet des Screens', async () => {
  await wrap(<Buehne />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Foto auswählen')).toBeTruthy();
  expect(screen.getByText('Selfie aufnehmen')).toBeTruthy();
});

// «Bild entfernen» darf nicht dastehen, wenn es nichts zu entfernen gibt.
test('ohne Bild fehlt der Entfernen-Eintrag', async () => {
  await wrap(<Buehne />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.queryByText('Bild entfernen')).toBeNull();
});

test('mit Bild steht der Entfernen-Eintrag da', async () => {
  await wrap(<Buehne avatarKey="profiles/u/a.jpg" />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Bild entfernen')).toBeTruthy();
});

// Der Onboarding-Fall: `avatarKey` ist dort strukturell immer null, das Bild
// liegt nur als lokale URI vor. Auch dann muss es sich entfernen lassen.
test('eine blosse lokale URI zaehlt ebenfalls als Bild', async () => {
  await wrap(<Buehne lokaleUri="file:///gewaehlt.jpg" />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  expect(screen.getByText('Bild entfernen')).toBeTruthy();
});

test('die Galerie liefert die URI an onGewaehlt und schliesst das Sheet', async () => {
  const onGewaehlt = jest.fn();
  await wrap(<Buehne onGewaehlt={onGewaehlt} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(onGewaehlt).toHaveBeenCalledWith('file:///gewaehlt.jpg'));
  expect(screen.queryByTestId('sheet-root')).toBeNull();
});

// Diese Zusicherung hat sich am 2026-08-13 UMGEDREHT, und das ist der Kern
// eines behobenen Fehlers: Vorher stand hier, die Auswahl müsse
// `allowsEditing: true` verlangen. Genau das war die Ursache — auf iOS
// erzwingt die Option den alten UIImagePickerController (nur der kann
// zuschneiden), der die Vorlage vollständig in den Speicher lädt und bei
// grossen Bildern vom System abgeräumt wird. In der App kam dann ein
// `canceled: true` an, ununterscheidbar von einem echten Abbruch, ohne
// Ausnahme und ohne Meldung: ein grosses Bild liess sich schlicht nicht
// auswählen.
//
// Das Quadrat entsteht jetzt in features/auth/avatarApi.ts (mittiger Zuschnitt
// auf die kürzere Kante, dort getestet). Hier wird nur noch bewacht, dass die
// Option NICHT zurückkehrt.
test('die Auswahl fordert keinen System-Zuschnitt an', async () => {
  await wrap(<Buehne />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(mockAusGalerie).toHaveBeenCalled());
  const optionen = mockAusGalerie.mock.calls[0][0];
  expect(optionen.allowsEditing).toBeUndefined();
  expect(optionen.mediaTypes).toBe('images');
});

// Ein geworfener Fehler darf nicht spurlos verschwinden. Der Aufruf lautet
// `void waehlen(…)`, eine Ablehnung wäre also eine unbehandelte Promise —
// beim Fehler vom 2026-08-13 genau der Grund, warum nichts zu sehen war.
test('wirft der Bildwaehler, steht die Meldung im Sheet', async () => {
  mockAusGalerie.mockRejectedValueOnce(new Error('kaputt'));
  await wrap(<Buehne />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  const panel = await screen.findByTestId('sheet-panel');
  await waitFor(() =>
    expect(
      within(panel).getByText('Das Bild liess sich nicht öffnen. Probier es nochmal oder nimm ein anderes.')
    ).toBeTruthy()
  );
});

test('ein Abbruch im Bildwaehler meldet nichts nach oben', async () => {
  const onGewaehlt = jest.fn();
  mockAusGalerie.mockResolvedValue({ canceled: true, assets: null });
  await wrap(<Buehne onGewaehlt={onGewaehlt} />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(mockAusGalerie).toHaveBeenCalled());
  expect(onGewaehlt).not.toHaveBeenCalled();
  expect(screen.queryByTestId('sheet-root')).toBeNull();
});

// Review-Fund (Important 2): Eine abgelehnte Berechtigung darf kein stummes
// Nichts sein (Spec §5.2) — und «nicht stumm» heisst SICHTBAR, nicht bloss
// «irgendwo im Elementbaum». Vorher stand der Text als Geschwister VOR dem
// Sheet, also auf dem Screen unter dem Backdrop; RNTL fand ihn trotzdem, weil
// es den Baum abfragt und nicht den Bildschirm. Deshalb prüft dieser Test
// nicht `screen.getByText`, sondern sucht INNERHALB des Sheet-Panels — und
// prüft zusätzlich, dass das Sheet dafür offen bleibt.
test('eine abgelehnte Berechtigung zeigt die Meldung IM Sheet, das offen bleibt', async () => {
  mockGalerieRecht.mockResolvedValue({ granted: false });
  await wrap(<Buehne />);
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
  // Offen bleiben ist Teil der Zusicherung: eine Meldung in einem Sheet, das
  // sich im selben Atemzug schliesst, ist wieder das stumme Nichts.
  expect(within(panel).getByText('Foto auswählen')).toBeTruthy();
  expect(mockAusGalerie).not.toHaveBeenCalled();
});

// Der zweite Eintrag hat einen EIGENEN Text («Kamera» statt «deine Fotos»),
// und der war bisher von keinem Test berührt.
test('eine abgelehnte Kamera-Berechtigung meldet die Kamera, nicht die Fotos', async () => {
  mockKameraRecht.mockResolvedValue({ granted: false });
  await wrap(<Buehne />);
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
  expect(mockAusKamera).not.toHaveBeenCalled();
});
