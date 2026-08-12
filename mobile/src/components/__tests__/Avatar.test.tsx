import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';

import { Avatar, AvatarGroup } from '../Avatar';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Bis zum Bild-Upload trägt der Kreis die Initiale, die Tests lesen die
// Gruppe deshalb über die Anfangsbuchstaben.
const ACHT = ['Lea', 'Mira', 'Jonas', 'Sofia', 'Ben', 'Nora', 'Timo', 'Ida'];

test('ein Avatar trägt die Initiale seines Namens', async () => {
  await wrap(<Avatar name="lea" />);
  expect(screen.getByText('L')).toBeTruthy();
});

// Airbnb-Muster: drei Gesichter, dann wird gezählt. Die vierte Person ist
// bewusst NICHT mehr zu sehen, sie steckt im Rest-Kreis.
test('die Gruppe zeigt höchstens drei Gesichter', async () => {
  await wrap(<AvatarGroup names={ACHT} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

// Der Rest ist ein vierter KREIS, keine Textzeile daneben: genau das
// unterscheidet die Airbnb-Facepile von der bisherigen Darstellung.
test('der Rest steht als eigener Kreis in derselben Reihe', async () => {
  await wrap(<AvatarGroup names={ACHT} />);
  const rest = screen.getByTestId('avatar-rest');
  const stil = StyleSheet.flatten(rest.props.style);
  expect(screen.getByText('+5')).toBeTruthy();
  expect(stil.borderRadius).toBe(999);
  expect(stil.backgroundColor).toBe(palette['bg-1']);
  expect(stil.width).toBe(stil.height);
});

// DESIGN-LANGUAGE §4: «Gruppen −8 px überlappend». Der Rest-Kreis gehört zur
// Gruppe und wird nicht abgesetzt.
test('der Rest-Kreis überlappt wie die Gesichter davor', async () => {
  await wrap(<AvatarGroup names={ACHT} />);
  expect(StyleSheet.flatten(screen.getByTestId('avatar-rest').props.style).marginLeft).toBe(-spacing.s);
});

// Die Kante, an der ein Off-by-one am leichtesten passiert: vier Personen
// passten «fast» in drei Kreise.
test('genau vier Personen ergeben drei Gesichter und einen +1-Kreis', async () => {
  await wrap(<AvatarGroup names={['Lea', 'Mira', 'Jonas', 'Sofia']} />);
  expect(screen.getByText('+1')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

test('drei Personen passen ohne Rest-Kreis', async () => {
  await wrap(<AvatarGroup names={['Lea', 'Mira', 'Jonas']} />);
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

test('zwei Personen ergeben zwei Gesichter ohne Rest-Kreis', async () => {
  await wrap(<AvatarGroup names={['Lea', 'Jonas']} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

// Ein leerer Anzeigename darf keinen leeren Kreis ergeben, sondern zeigt das
// Fragezeichen aus Avatar. Kommt vor: profiles.display_name ist in
// fetchMembers auf '' zurückgefallen, wenn das Profil fehlt.
test('ein Name ohne Buchstaben zeigt ein Fragezeichen', async () => {
  await wrap(<AvatarGroup names={['']} />);
  expect(screen.getByText('?')).toBeTruthy();
});
