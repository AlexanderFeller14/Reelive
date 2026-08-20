import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', userId: 'uid-1', refreshProfile: jest.fn() }),
}));
// Die Validatoren bekommen Sentinel-Texte statt der echten Meldungen,
// dasselbe Muster wie `zahlenText` unten: die echten Formulierungen und
// Regeln sind in profileApi.test.ts abgedeckt, hier zählt nur, DASS der
// Screen die Meldung des Validators am richtigen Feld zeigt. Kein
// requireActual: das echte Modul zieht @/lib/supabase und damit das
// AsyncStorage-Nativmodul mit (siehe kontoApi-Kommentar unten).
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

// Task 6: setAvatar/removeAvatar sind in avatarApi.test.ts bereits voll
// geprüft (Reihenfolge Upload→Spalte→Aufräumen), hier zählt nur, DASS
// profil.tsx ihr Ergebnis übernimmt (Kreis, Fehlertext). Volles
// Factory-Mock statt `jest.mock('@/features/auth/avatarApi')` ohne Factory
// (Automock): Automock müsste die echte Datei laden, um ihre Exporte zu
// erkennen, und die zieht transitiv expo-file-system, expo-image-manipulator
// und @/lib/supabase mit (siehe die Mocks in avatarApi.test.ts), hier reicht
// ein reiner Ersatz, ohne diese Kette mitzuschleppen.
//
// Die Exporte sind hier direkt `jest.fn()` (keine Variable von aussen
// referenziert, also auch ohne "mock"-Präfix hebbar): so lässt sich der
// importierte `setAvatar` in den Tests unten unmittelbar als `jest.Mock`
// ansprechen, ohne einen zusätzlichen Umweg über eine eigene Variable.
jest.mock('@/features/auth/avatarApi', () => ({
  setAvatar: jest.fn(),
  removeAvatar: jest.fn(),
}));

// profil.tsx rendert jetzt AvatarPicker (Task 5), und die importiert
// expo-image-picker direkt. Gleiches Mock-Muster wie AvatarPicker.test.tsx:
// "Foto auswählen" ruft echte Berechtigungs-/Auswahlfunktionen, die es im
// Jest-Environment ohne diesen Mock nicht sinnvoll gibt.
const mockGalerieRecht = jest.fn();
const mockAusGalerie = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockAusGalerie(...a),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: () => mockGalerieRecht(),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie recap/__tests__/list.test.tsx). Ohne
// Mock scheitert schon der Import, expo-image/src/observe.ts erwartet eine
// native Umgebung.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Task 9: kontoApi importiert transitiv @/lib/supabase (→ AsyncStorage-
// Nativmodul, in Jest nicht vorhanden, auch über jest.requireActual nicht
// umgehbar, der Import steht am Modulkopf), deshalb wie die übrigen
// Feature-Module vollständig gemockt. `zahlenText` bekommt hier eine simple,
// vorhersagbare Fassung statt der echten Wortwahl, die echte Formulierung
// (Singular/Plural, "3 Reisen mit insgesamt 128 Momenten…") ist bereits in
// features/account/__tests__/accountApi.test.ts vollständig abgedeckt; hier
// zählt nur, DASS profil.tsx das Ergebnis von zahlenText tatsächlich anzeigt.
const mockFetchDeletionCounts = jest.fn();
const mockDeleteAccount = jest.fn();
jest.mock('@/features/account/accountApi', () => ({
  fetchDeletionCounts: () => mockFetchDeletionCounts(),
  deleteAccount: () => mockDeleteAccount(),
  deletionSummaryText: (z: { own_trips: number }) => `ZAHLEN-TEXT (${z.own_trips} Reisen)`,
}));

// Task 10: der WLAN-Schalter liest/schreibt über das Einstellungen-Modul.
// Default "aus", passend zum dokumentierten Standard in settings.ts.
const mockNurUeberWlan = jest.fn(async () => false);
const mockSetzeNurUeberWlan = jest.fn(async (_wert: boolean) => {});
jest.mock('@/features/moments/settings', () => ({
  wifiOnly: () => mockNurUeberWlan(),
  setWifiOnly: (wert: boolean) => mockSetzeNurUeberWlan(wert),
}));

// Der Benachrichtigungs-Schalter: Einstellung (Default AN, siehe
// push/settings.ts) und pushApi. Letztere als Factory-Mock aus demselben
// Grund wie kontoApi unten: das echte Modul zieht @/lib/supabase,
// expo-notifications und expo-device mit.
const mockNotificationsActive = jest.fn(async () => true);
const mockSetzeBenachrichtigungen = jest.fn(async (_wert: boolean) => {});
jest.mock('@/features/push/settings', () => ({
  notificationsActive: () => mockNotificationsActive(),
  setNotificationsActive: (wert: boolean) => mockSetzeBenachrichtigungen(wert),
}));
const mockRegistrierePush = jest.fn(async (_userId: string) => 'ok');
const mockDeregistrierePush = jest.fn(async () => {});
jest.mock('@/features/push/pushApi', () => ({
  registerPushToken: (userId: string) => mockRegistrierePush(userId),
  deregisterPushToken: () => mockDeregistrierePush(),
}));

// Der Speicher-Moment im Namen-Editor feiert mit Haptik light (§5: light für
// kleine Momente, success bleibt Versiegeln/Reveal vorbehalten).
const mockHaptikLeicht = jest.fn(async (_stil: unknown) => {});
jest.mock('expo-haptics', () => ({
  impactAsync: (stil: unknown) => mockHaptikLeicht(stil),
  ImpactFeedbackStyle: { Light: 'light' },
}));

// Pfad-Anpassung (Task-10-Kontext, Abweichung 2): Router-Root ist mobile/src/app/,
// nicht mobile/app/, von __tests__/ drei Ebenen hoch zu app/(tabs)/...
import ProfilScreen from '../../../app/(tabs)/profile';
import { setAvatar } from '@/features/auth/avatarApi';
import { fetchOwnProfile, updateProfile } from '../profileApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Default-Profil ohne Bild. Der Fehlerfall-Test unten überschreibt dies
// gezielt mit einem BEREITS gesetzten avatar_key, sonst liesse sich "das
// alte Bild bleibt stehen" von "es gab nie eines" nicht unterscheiden.
const PROFIL_OHNE_BILD = { id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockNurUeberWlan.mockResolvedValue(false);
  mockNotificationsActive.mockResolvedValue(true);
  mockRegistrierePush.mockResolvedValue('ok');
  mockGalerieRecht.mockResolvedValue({ granted: true });
  mockAusGalerie.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///gewaehlt.jpg', width: 4000, height: 3000 }],
  });
  (fetchOwnProfile as jest.Mock).mockResolvedValue(PROFIL_OHNE_BILD);
});

test('zeigt Profildaten und meldet ab', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('@lea')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abmelden'));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});

// Getauscht (2026-08-13): das Kopfbild des Tabs ist jetzt das eigene
// Profilbild, der Reisepass die kleine Dekoration in der Namens-Karte, wo
// vorher der 44-px-Kreis stand.
test('das Profilbild steht gross über der Namens-Karte, der Reisepass klein darin', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  await screen.findByText('Lea');
  // «über» heisst: VOR dem Reisepass im Baum. Der serialisierte Baum bildet
  // die Reihenfolge der Geschwister ab, und der Reisepass kommt nur noch in
  // der Namens-Karte vor. Gegen die alte Fassung (Reisepass zuerst) ist die
  // Zusicherung rot.
  const baum = JSON.stringify(screen.toJSON());
  expect(baum.indexOf('avatar-picker')).toBeLessThan(baum.indexOf('profile-passport'));
  // Hero-Grösse statt der 44 der Karten-Avatare.
  expect(StyleSheet.flatten(screen.getByTestId('avatar-circle').props.style).width).toBe(160);
  // Dekoration: der Reisepass sagt nichts, was die Karte nicht schon sagt.
  expect(screen.getByTestId('profile-passport').props.accessible).toBe(false);
});

test('zeigt den WLAN-Schalter mit Erklärung, was er bewirkt', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Nur über WLAN einsenden')).toBeTruthy();
  expect(
    screen.getByText('Spart mobile Daten. Deine Momente warten, bis du wieder im WLAN bist.')
  ).toBeTruthy();
  expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(false);
});

test('ein Tipp auf den Schalter schreibt die Wahl in die Einstellungen', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  const schalter = await screen.findByLabelText('Nur über WLAN einsenden');
  await fireEvent(schalter, 'valueChange', true);
  expect(mockSetzeNurUeberWlan).toHaveBeenCalledWith(true);
  expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(true);
});

test('ein bereits gespeichertes „Nur über WLAN" zeigt sich beim Öffnen', async () => {
  mockNurUeberWlan.mockResolvedValue(true);
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  await waitFor(() => expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(true));
});

describe('Profilbild (Task 6)', () => {
  test('der Profil-Tab zeigt den Bildwaehler als Kopfbild', async () => {
    await wrap(<ProfilScreen />);
    expect(await screen.findByTestId('avatar-picker')).toBeTruthy();
  });

  // Der gewählte Pfad muss ohne erneutes Laden sichtbar werden, sonst wirkt
  // der Tap folgenlos, bis der Screen zufällig neu lädt. profileApi wird
  // hier absichtlich NICHT erneut aufgerufen (kein zweiter fetchOwnProfile),
  // die Antwort von setAvatar IST der neue Stand.
  test('ein gewaehltes Bild erscheint sofort im Kreis', async () => {
    (setAvatar as jest.Mock).mockResolvedValue({
      avatarKey: 'profiles/u1/neu.jpg',
      error: null,
    });
    await wrap(<ProfilScreen />);
    await fireEvent.press(await screen.findByTestId('avatar-picker'));
    await fireEvent.press(screen.getByText('Foto auswählen'));
    // Seit dem Fehler vom 2026-08-13 liegt der Zuschnitt dazwischen: der
    // System-Editor musste raus, also wählt man den Ausschnitt in der App.
    await fireEvent.press(await screen.findByTestId('crop-apply'));
    await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
  });

  // Review-Fund (CRITICAL, Merge-Fixrunde): das Sheet hing im 44-px-Wrapper
  // des Avatar-Kreises, also IN der ScrollView, IN einer Karten-Zeile. Weil
  // `Sheet` kein `Modal` ist, sondern `StyleSheet.absoluteFill` über seinen
  // unmittelbaren Elternteil legt, war es damit auf dem Gerät ein 44 px
  // breiter, mitscrollender Streifen: «Foto auswählen» hätte bei 2 × 24 px
  // Innenabstand negative Restbreite gehabt.
  //
  // Jest führt kein Yoga-Layout aus, die Geometrie selbst ist hier also nicht
  // prüfbar. Die BAUMSTELLUNG ist es, und aus ihr folgt die Geometrie: das
  // Sheet muss ein Geschwister der ScrollView sein, so wie das Lösch-Sheet
  // darunter es immer war. Gegen die alte Fassung wird dieser Test rot.
  test('das Bild-Sheet haengt am Screen, nicht in der ScrollView', async () => {
    await wrap(<ProfilScreen />);
    await fireEvent.press(await screen.findByTestId('avatar-picker'));
    await screen.findByText('Foto auswählen');

    const inhalt = screen.getByTestId('profile-content');
    // Kontrolle zuerst: der Kreis liegt tatsächlich in dieser ScrollView.
    // Ohne sie wäre die Zusicherung darunter auch dann grün, wenn `within`
    // ins Leere griffe oder das testID nicht mehr passte.
    expect(within(inhalt).getByTestId('avatar-picker')).toBeTruthy();
    expect(within(inhalt).queryByTestId('sheet-root')).toBeNull();
    expect(screen.getByTestId('sheet-root')).toBeTruthy();
  });

  // Review-Fund: die ursprüngliche Fassung dieses Tests startete mit
  // avatar_key: null (Default-Mock) und prüfte nur den Fehlertext. Damit
  // liess sich "altes Bild korrekt erhalten" nicht von "altes Bild
  // fälschlich gelöscht" unterscheiden: in BEIDEN Fällen gibt es keinen
  // avatar-image-Knoten. Diese Fassung startet deshalb MIT einem gesetzten
  // avatar_key und prüft danach explizit, dass genau diese URL nach dem
  // Fehlschlag noch im Baum steht: bräche der Fehlerzweig fälschlich
  // `avatar_key: null` in den State (statt vorher zurückzukehren, wie
  // profil.tsx es tut), verschwände der Bild-Knoten, und `getByTestId`
  // würde hier werfen.
  test('ein Fehler beim Hochladen steht unter dem Kreis, das alte Bild bleibt stehen', async () => {
    (fetchOwnProfile as jest.Mock).mockResolvedValue({
      id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: 'profiles/u1/alt.jpg',
    });
    (setAvatar as jest.Mock).mockResolvedValue({
      avatarKey: null,
      error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.',
    });
    await wrap(<ProfilScreen />);
    await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
    const urlVorher = screen.getByTestId('avatar-image').props.source.uri;

    await fireEvent.press(screen.getByTestId('avatar-picker'));
    await fireEvent.press(screen.getByText('Foto auswählen'));
    await fireEvent.press(await screen.findByTestId('crop-apply'));

    await waitFor(() =>
      expect(
        screen.getByText('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.')
      ).toBeTruthy()
    );
    // Der eigentliche Kern der Zusicherung, nicht nur "irgendein Bild":
    // dieselbe URL wie vor dem fehlgeschlagenen Versuch.
    expect(screen.getByTestId('avatar-image').props.source.uri).toBe(urlVorher);
  });
});

// Der Benachrichtigungs-Schalter steuert die Geräte-Registrierung: aus löscht
// den Token, an registriert ihn. Nur die abgelehnte Systemberechtigung
// bekommt Rückmeldung; 'fehler'/'nicht-unterstuetzt' sind Alltag (Expo Go,
// Simulator, Task-4-Brief) und bleiben stumm.
describe('Benachrichtigungen', () => {
  test('zeigt den Schalter mit Erklärung, Standard an', async () => {
    await wrap(<ProfilScreen />);
    expect(await screen.findByText('Benachrichtigungen')).toBeTruthy();
    expect(
      screen.getByText('Sagt dir Bescheid, wenn in deinen Reisen etwas passiert.')
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(true)
    );
  });

  test('ein gespeichertes AUS zeigt sich beim Öffnen', async () => {
    mockNotificationsActive.mockResolvedValue(false);
    await wrap(<ProfilScreen />);
    await waitFor(() =>
      expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(false)
    );
  });

  test('Ausschalten speichert die Wahl und meldet das Gerät ab', async () => {
    await wrap(<ProfilScreen />);
    const schalter = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(schalter, 'valueChange', false);
    await waitFor(() => expect(mockSetzeBenachrichtigungen).toHaveBeenCalledWith(false));
    await waitFor(() => expect(mockDeregistrierePush).toHaveBeenCalledTimes(1));
    expect(mockRegistrierePush).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(false);
  });

  test('Einschalten speichert die Wahl und registriert das Gerät', async () => {
    mockNotificationsActive.mockResolvedValue(false);
    await wrap(<ProfilScreen />);
    const schalter = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(schalter, 'valueChange', true);
    await waitFor(() => expect(mockSetzeBenachrichtigungen).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mockRegistrierePush).toHaveBeenCalledWith('uid-1'));
    expect(mockDeregistrierePush).not.toHaveBeenCalled();
  });

  test('eine abgelehnte Berechtigung springt zurück und erklärt sich', async () => {
    mockNotificationsActive.mockResolvedValue(false);
    mockRegistrierePush.mockResolvedValue('keine-berechtigung');
    await wrap(<ProfilScreen />);
    const schalter = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(schalter, 'valueChange', true);
    expect(
      await screen.findByText(
        'Ohne Zugriff auf Mitteilungen geht es nicht. Du kannst das in den Einstellungen ändern.'
      )
    ).toBeTruthy();
    expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(false);
    // Auch gespeichert, nicht nur angezeigt: sonst käme der Schalter beim
    // nächsten Öffnen fälschlich als AN zurück.
    expect(mockSetzeBenachrichtigungen).toHaveBeenLastCalledWith(false);
  });

  test("ein stiller Fehlschlag ('fehler') lässt den Schalter an und zeigt nichts", async () => {
    mockNotificationsActive.mockResolvedValue(false);
    mockRegistrierePush.mockResolvedValue('fehler');
    await wrap(<ProfilScreen />);
    const schalter = await screen.findByLabelText('Benachrichtigungen');
    await fireEvent(schalter, 'valueChange', true);
    await waitFor(() => expect(mockRegistrierePush).toHaveBeenCalled());
    expect(screen.getByLabelText('Benachrichtigungen').props.value).toBe(true);
    expect(
      screen.queryByText(
        'Ohne Zugriff auf Mitteilungen geht es nicht. Du kannst das in den Einstellungen ändern.'
      )
    ).toBeNull();
  });
});

// «Anzeigename ändern»: die Namens-Karte ist das Tap-Ziel, ein Stift rechts
// zeigt die Bearbeitbarkeit an. Der Editor ist KEIN Bottom-Sheet, sondern
// ein Vollbild-Overlay wie der AvatarZuschnitt (Gerätefund + Entscheid
// 2026-08-13): in einem Sheet am unteren Rand sassen die Felder genau dort,
// wo die Tastatur steht. Der USERNAME ist bewusst NICHT dabei (Entscheid
// 2026-08-13): er soll später möglicherweise ein Login-Identifikator werden,
// ein freigewordener alter Name wäre dann ein Verwechslungs-Risiko.
describe('Anzeigename ändern', () => {
  test('die Namens-Karte trägt einen Stift als Bearbeiten-Hinweis', async () => {
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    const card = screen.getByTestId('name-edit-open');
    expect(within(card).getByTestId('name-edit-pencil')).toBeTruthy();
  });

  test('die Namens-Karte öffnet den Vollbild-Editor: Anzeigename vorbefüllt, KEIN Username-Feld', async () => {
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    // Vorbefüllt heisst: der GESPEICHERTE Wert steht im Feld (getByDisplayValue
    // trifft nur TextInputs, nicht den Kartentext daneben). Der Username hat
    // kein Eingabefeld, fest, bis es eine serverseitige Bremse gibt.
    expect(screen.getByDisplayValue('Lea')).toBeTruthy();
    expect(screen.queryByDisplayValue('lea')).toBeNull();
    // Vollbild-Overlay, kein Sheet: der Editor liegt wie der Zuschnitt als
    // Geschwister ÜBER dem Screen, nicht im Scroll-Inhalt (Baumstellung wie
    // beim Bild-Sheet-Test unten, aus ihr folgt die Geometrie).
    expect(screen.getByTestId('name-editor')).toBeTruthy();
    expect(screen.queryByTestId('sheet-root')).toBeNull();
    expect(within(screen.getByTestId('profile-content')).queryByTestId('name-editor')).toBeNull();
    // Statt Dekoration füllt eine Live-Vorschau die Seite: die Zeile, wie
    // Freunde einen sehen (Kreis, Name, Handle), mit dem GETIPPTEN Stand.
    // Sie steht ÜBER dem Eingabefeld (und damit vor den Knöpfen im Baum):
    // erst sehen, was man ändert, dann ändern.
    const preview = within(screen.getByTestId('name-editor')).getByTestId('name-preview');
    expect(within(preview).getByText('Lea')).toBeTruthy();
    expect(within(preview).getByText('@lea')).toBeTruthy();
    const baum = JSON.stringify(screen.toJSON());
    expect(baum.indexOf('name-preview')).toBeLessThan(baum.indexOf('Speichern'));
  });

  test('die Vorschau zieht beim Tippen live mit, ohne zu speichern', async () => {
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    const preview = within(screen.getByTestId('name-editor')).getByTestId('name-preview');
    expect(within(preview).getByText('Lea Neu')).toBeTruthy();
    // Nur die Vorschau, nicht der Screen dahinter: gespeichert ist nichts.
    expect(updateProfile).not.toHaveBeenCalled();
  });

  test('Speichern schreibt den Anzeigenamen und zeigt ihn sofort an, der Username bleibt', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({ error: null });
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Speichern'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith('uid-1', 'Lea Neu'));
    // Wie beim Profilbild: die Antwort IST der neue Stand, kein zweiter
    // fetchOwnProfile-Rundgang.
    expect(await screen.findByText('Lea Neu')).toBeTruthy();
    expect(screen.getByText('@lea')).toBeTruthy();
    expect((fetchOwnProfile as jest.Mock).mock.calls.length).toBe(1);
    // Der Editor schliesst sich NACH dem Speicher-Moment von selbst (Pop der
    // Vorschau + 250-ms-Abgang), deshalb waitFor statt sofortiger Zusicherung.
    await waitFor(() => expect(screen.queryByTestId('name-editor')).toBeNull(), { timeout: 3000 });
  });

  test('der Speicher-Moment: Häkchen auf dem Knopf und Haptik light, dann schliesst der Editor', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({ error: null });
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Speichern'));
    // Das Häkchen steht auf dem Knopf, BEVOR der Screen wechselt.
    await waitFor(() => expect(screen.getByTestId('button-success')).toBeTruthy());
    expect(screen.getByTestId('name-editor')).toBeTruthy();
    await waitFor(() => expect(mockHaptikLeicht).toHaveBeenCalledWith('light'));
    await waitFor(() => expect(screen.queryByTestId('name-editor')).toBeNull(), { timeout: 3000 });
  });

  test('ein Serverfehler steht im Editor, der bleibt offen, der alte Name bleibt stehen', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({ error: 'KAPUTT' });
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Speichern'));
    expect(await screen.findByText('KAPUTT')).toBeTruthy();
    expect(screen.getByTestId('name-editor')).toBeTruthy();
    expect(screen.getByText('Lea')).toBeTruthy();
    // Kein Fest ohne Erfolg: der Fehlerpfad bleibt stumm.
    expect(mockHaptikLeicht).not.toHaveBeenCalled();
  });

  test('«Abbrechen» schliesst den Editor, ohne zu speichern', async () => {
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), 'Lea Neu');
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(screen.queryByTestId('name-editor')).toBeNull();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Lea')).toBeTruthy();
  });

  test('ein leerer Anzeigename ruft die API gar nicht erst', async () => {
    await wrap(<ProfilScreen />);
    await screen.findByText('Lea');
    await fireEvent.press(screen.getByTestId('name-edit-open'));
    await fireEvent.changeText(screen.getByDisplayValue('Lea'), '   ');
    await fireEvent.press(screen.getByText('Speichern'));
    expect(await screen.findByText('NAME-REGEL')).toBeTruthy();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

// Task 9: Konto-Löschung. Fixzahlen, deckungsgleich mit dem Brief-Beispiel
// ("3 Reisen mit insgesamt 128 Momenten von 5 Personen").
const COUNTS_OK = {
  data: { own_trips: 3, moments_in_own_trips: 128, affected_people: 5, own_moments_elsewhere: 0 },
  error: null,
};
const EMPTY_COUNTS = {
  data: { own_trips: 0, moments_in_own_trips: 0, affected_people: 0, own_moments_elsewhere: 0 },
  error: null,
};

describe('Konto löschen (Task 9)', () => {
  test('steht unten, unter allem anderen, nach dem Abmelden-Knopf', async () => {
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await screen.findByText('Lea');
    expect(screen.getByTestId('delete-account-open')).toBeTruthy();
    expect(screen.getByText('Konto löschen')).toBeTruthy();
  });

  test('Tippen öffnet den Dialog und lädt sofort die Zahlen', async () => {
    mockFetchDeletionCounts.mockResolvedValue(COUNTS_OK);
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    expect(mockFetchDeletionCounts).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('ZAHLEN-TEXT (3 Reisen)')).toBeTruthy();
  });

  // Der Kern des Auftrags: "Ohne geladene Zahlen darf nicht bestätigt werden
  // können.", solange holeLoeschZahlen noch nicht geantwortet hat, gibt es
  // den Bestätigungsknopf im Baum schlicht nicht (kein blosses `disabled`).
  test('ohne geladene Zahlen gibt es KEINEN Bestätigungsknopf, nur einen Ladeindikator', async () => {
    mockFetchDeletionCounts.mockReturnValue(new Promise(() => {})); // hängt absichtlich
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    expect(await screen.findByTestId('delete-account-counts-loading')).toBeTruthy();
    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
  });

  test('ein Fehler beim Laden zeigt die Ursache mit Retry, keinen Bestätigungsknopf', async () => {
    mockFetchDeletionCounts.mockResolvedValue({ data: null, error: 'kaputt' });
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    expect(await screen.findByText('kaputt')).toBeTruthy();
    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
    expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
  });

  test('«Nochmal versuchen» lädt die Zahlen erneut, danach erscheint der Bestätigungsknopf', async () => {
    mockFetchDeletionCounts
      .mockResolvedValueOnce({ data: null, error: 'kaputt' })
      .mockResolvedValueOnce(EMPTY_COUNTS);
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await screen.findByText('kaputt');
    await fireEvent.press(screen.getByText('Nochmal versuchen'));
    expect(await screen.findByTestId('delete-account-confirm')).toBeTruthy();
    expect(mockFetchDeletionCounts).toHaveBeenCalledTimes(2);
  });

  test('Erfolg: löscht das Konto und meldet danach ab', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    mockDeleteAccount.mockResolvedValue({ error: null });
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await fireEvent.press(await screen.findByTestId('delete-account-confirm'));
    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });

  test('ein Fehlschlag beim Löschen zeigt die Ursache, meldet NICHT ab, der Dialog bleibt bedienbar', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    mockDeleteAccount.mockResolvedValue({
      error: 'Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.',
    });
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await fireEvent.press(await screen.findByTestId('delete-account-confirm'));
    expect(
      await screen.findByText('Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.')
    ).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-account-confirm').props.accessibilityState.disabled).toBe(false);
  });

  test('ein zweiter Tipp, während die Löschung noch läuft, löst KEINEN zweiten Aufruf aus', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    let aufloesen!: (wert: { error: null }) => void;
    mockDeleteAccount.mockReturnValue(new Promise((resolve) => { aufloesen = resolve; }));
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await fireEvent.press(await screen.findByTestId('delete-account-confirm'));
    expect(await screen.findByTestId('delete-account-loading')).toBeTruthy(); // Spinner statt Text
    await fireEvent.press(screen.getByTestId('delete-account-confirm'));
    await act(async () => {
      aufloesen({ error: null });
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  });

  test('«Abbrechen» schliesst den Dialog, ohne zu löschen oder abzumelden', async () => {
    mockFetchDeletionCounts.mockResolvedValue(EMPTY_COUNTS);
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('delete-account-open'));
    await screen.findByTestId('delete-account-confirm');
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
