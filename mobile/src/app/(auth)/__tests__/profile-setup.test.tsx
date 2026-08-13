import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import ProfileSetupScreen from '../profile-setup';
import { createProfile } from '@/features/auth/profileApi';
import { setzeAvatar } from '@/features/auth/avatarApi';

// Scaffolding-Anpassung gegenüber dem Brief: `createProfile` wird per
// `jest.requireActual` aus dem echten Modul gezogen (validateUsername/
// validateDisplayName sollen ECHT bleiben, der Screen ruft sie direkt auf).
// Das echte profileApi.ts importiert am Kopf aber `@/lib/supabase`, und das
// wirft beim Import ohne EXPO_PUBLIC_SUPABASE_ANON_KEY ("Supabase-
// Konfiguration fehlt", siehe src/lib/supabase.ts) — dieser Wert ist in der
// Testumgebung nicht gesetzt (jest.setup.ts setzt nur die URL). Also wird
// `@/lib/supabase` hier zusätzlich gemockt, genau wie es profileApi.test.ts
// für denselben Import bereits tut.
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
  launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///gewaehlt.jpg' }] }),
  launchCameraAsync: async () => ({ canceled: true, assets: null }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));
// Scaffolding-Ergänzung gegenüber dem Brief: `AvatarWaehler` rendert ohne
// gewählte lokale URI weiterhin `Avatar` (Task 3), und das importiert
// `expo-image`. Ohne Mock scheitert schon der Import, siehe dieselbe
// Begründung in AvatarWaehler.test.tsx und profilTab.test.tsx.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Scaffolding-Korrektur gegenüber dem Brief: `Input` (floating label,
// src/components/Input.tsx) reicht `placeholder` an das native Feld erst
// durch, wenn es fokussiert ist ODER schon einen Wert trägt (`lifted`) —
// siehe Input.test.tsx, Test "placeholder erscheint erst mit Fokus". Ein
// leeres, unfokussiertes Feld hat also gar kein `placeholder`-Prop, und
// `getByPlaceholderText('lea_2026')` findet nichts. Jede andere Testdatei,
// die in ein `Input` tippt (formular.test.tsx, screens.test.tsx,
// vorschau.test.tsx), adressiert das Feld deshalb über seinen sichtbaren
// `label`-Text (`accessibilityLabel`), nicht über den Platzhalter. Dieselbe
// Abfrage hier statt der Platzhalter-Werte aus dem Brief-Snippet.
const usernameFeld = () => screen.getByLabelText('Username');
const anzeigenameFeld = () => screen.getByLabelText('Anzeigename');

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  (createProfile as jest.Mock).mockResolvedValue({ error: null, feld: null });
  (setzeAvatar as jest.Mock).mockResolvedValue({ avatarKey: 'profiles/u1/neu.jpg', error: null });
});

test('das Onboarding zeigt den Bildwaehler', async () => {
  await wrap(<ProfileSetupScreen />);
  expect(screen.getByTestId('avatar-waehler')).toBeTruthy();
});

// Review-Fund (CRITICAL, Merge-Fixrunde): das Sheet hing im Wrapper des
// Avatar-Kreises, der wiederum in der (zentrierten, ~72 px hohen) Bildzeile
// des Formulars sitzt. `Sheet` ist kein `Modal` — es legt `StyleSheet.
// absoluteFill` über seinen UNMITTELBAREN Elternteil, und Yoga löst sein
// `bottom:0`-Panel gegen ebendiesen auf. Auf dem Gerät war das ein kurzes Band
// mitten im Formular statt eines Sheets von unten.
//
// Der Onboarding-Screen hat keine ScrollView, deshalb steht das Formular jetzt
// als eigene Ebene unter einem reinen Rahmen (profile-setup.tsx), und das
// Sheet ist dessen Geschwister. Geometrie prüft Jest nicht (kein Yoga), die
// Baumstellung schon — und aus ihr folgt die Geometrie.
test('das Bild-Sheet haengt am Screen-Rahmen, nicht im Formular', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await screen.findByText('Foto auswählen');

  const formular = screen.getByTestId('onboarding-formular');
  // Kontrolle zuerst: der Kreis liegt wirklich im Formular. Ohne sie wäre die
  // Zusicherung darunter auch bei einem nicht mehr passenden testID grün.
  expect(within(formular).getByTestId('avatar-waehler')).toBeTruthy();
  expect(within(formular).queryByTestId('sheet-root')).toBeNull();
  expect(screen.getByTestId('sheet-root')).toBeTruthy();
});

// Überspringbar heisst: ohne Bild kommt man durch, und createProfile bekommt
// null, keinen leeren String (Leerstrings waren in diesem Schema schon einmal
// ein Problem, siehe 20260808150000_leerstrings_und_profil_grants.sql).
//
// Scaffolding-Korrektur gegenüber dem Brief: alle drei folgenden Tests
// `await`en jetzt JEDES `fireEvent` (nicht nur die aus dem Brief bereits
// awaiteten Presses auf `avatar-waehler`/"Foto auswählen"). Ohne das await
// committet React den State-Update aus `changeText` nicht vor dem
// nachfolgenden `fireEvent.press("Los geht's")`, `submit()` liest dann noch
// die leeren Anfangswerte aus dem Closure, `validateUsername`/
// `validateDisplayName` schlagen fehl, und `createProfile` wird nie
// aufgerufen — sichtbar am `screen.debug()`-Output beim Debuggen dieses
// Tests: die Felder zeigten zwar den neuen `value`, aber BEIDE
// Fehlertexte standen noch da. Derselbe React-19-/RNTL-v14-Stolperstein
// wie in Input.test.tsx dokumentiert ("await nötig: fireEvent ist in
// dieser RNTL-Version async").
test('ohne Bild geht es weiter, avatar_key bleibt null', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.changeText(usernameFeld(), 'lea_2026');
  await fireEvent.changeText(anzeigenameFeld(), 'Lea');
  await fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() => expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', null));
  expect(setzeAvatar).not.toHaveBeenCalled();
});

// Erst hochladen, dann die Zeile anlegen: createProfile schreibt avatar_key
// direkt mit, ein nachgelagertes Update wäre ein zweiter Schreibvorgang, der
// scheitern kann, nachdem das Profil schon steht.
test('ein gewaehltes Bild wird vor dem Anlegen hochgeladen', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(screen.getByTestId('avatar-bild')).toBeTruthy());
  await fireEvent.changeText(usernameFeld(), 'lea_2026');
  await fireEvent.changeText(anzeigenameFeld(), 'Lea');
  await fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() =>
    expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', 'profiles/u1/neu.jpg')
  );
});

// Review-Fund (Fix Runde 1): `avatarKey` ist im Onboarding strukturell IMMER
// null (profile-setup.tsx übergibt ihn fest verdrahtet), ein frisch
// gewähltes, nur lokal vorliegendes Bild liess sich vorher deshalb NICHT
// wieder entfernen — der «Bild entfernen»-Eintrag im Sheet hing allein an
// `avatarKey`. Dieser Test wählt ein Bild, öffnet den Wähler erneut, prüft,
// dass der Eintrag jetzt dasteht, entfernt darüber das Bild und prüft am
// gerenderten Baum (nicht am internen State), dass es wirklich weg ist:
// `avatar-bild` (das lokale Vorschaubild) darf danach nicht mehr existieren.
test('ein gewaehltes Bild laesst sich vor dem Absenden wieder entfernen', async () => {
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(screen.getByTestId('avatar-bild')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await waitFor(() => expect(screen.getByText('Bild entfernen')).toBeTruthy());
  await fireEvent.press(screen.getByText('Bild entfernen'));

  await waitFor(() => expect(screen.queryByTestId('avatar-bild')).toBeNull());
});

// Ein gescheiterter Upload darf das Onboarding nicht blockieren — der Name ist
// das Pflichtfeld, das Bild ist die Zugabe.
test('ein gescheiterter Upload legt das Profil trotzdem an', async () => {
  (setzeAvatar as jest.Mock).mockResolvedValue({ avatarKey: null, error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.' });
  await wrap(<ProfileSetupScreen />);
  await fireEvent.press(screen.getByTestId('avatar-waehler'));
  await fireEvent.press(screen.getByText('Foto auswählen'));
  await waitFor(() => expect(screen.getByTestId('avatar-bild')).toBeTruthy());
  await fireEvent.changeText(usernameFeld(), 'lea_2026');
  await fireEvent.changeText(anzeigenameFeld(), 'Lea');
  await fireEvent.press(screen.getByText("Los geht's"));
  await waitFor(() => expect(createProfile).toHaveBeenCalledWith('u1', 'lea_2026', 'Lea', null));
});
