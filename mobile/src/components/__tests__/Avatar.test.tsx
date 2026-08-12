import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, palette, spacing } from '@/theme/tokens';

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie TripCard.test.tsx). Ohne Mock
// scheitert schon der Import, expo-image/src/observe.ts erwartet eine
// native Umgebung.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { Avatar, AvatarGroup, type Gesicht } from '../Avatar';
import { avatarUrl } from '@/features/auth/avatar';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Die bestehenden Tests arbeiten mit Namen; diese Brücke hält sie unverändert
// lesbar, statt jeden Aufruf mit `{ name: …, avatarKey: null }` aufzublähen.
const ohneBild = (namen: string[]): Gesicht[] =>
  namen.map((name) => ({ name, avatarKey: null }));

const SCHLUESSEL = 'profiles/11111111-2222-3333-4444-555555555555/abc.jpg';

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
  await wrap(<AvatarGroup gesichter={ohneBild(ACHT)} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

// Der Rest ist ein vierter KREIS, keine Textzeile daneben: genau das
// unterscheidet die Airbnb-Facepile von der bisherigen Darstellung.
test('der Rest steht als eigener Kreis in derselben Reihe', async () => {
  await wrap(<AvatarGroup gesichter={ohneBild(ACHT)} />);
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
  await wrap(<AvatarGroup gesichter={ohneBild(ACHT)} />);
  expect(StyleSheet.flatten(screen.getByTestId('avatar-rest').props.style).marginLeft).toBe(-spacing.s);
});

// Die Kante, an der ein Off-by-one am leichtesten passiert: vier Personen
// passten «fast» in drei Kreise.
test('genau vier Personen ergeben drei Gesichter und einen +1-Kreis', async () => {
  await wrap(<AvatarGroup gesichter={ohneBild(['Lea', 'Mira', 'Jonas', 'Sofia'])} />);
  expect(screen.getByText('+1')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

test('drei Personen passen ohne Rest-Kreis', async () => {
  await wrap(<AvatarGroup gesichter={ohneBild(['Lea', 'Mira', 'Jonas'])} />);
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

test('zwei Personen ergeben zwei Gesichter ohne Rest-Kreis', async () => {
  await wrap(<AvatarGroup gesichter={ohneBild(['Lea', 'Jonas'])} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

// Ein leerer Anzeigename darf keinen leeren Kreis ergeben, sondern zeigt das
// Fragezeichen aus Avatar. Kommt vor: profiles.display_name ist in
// fetchMembers auf '' zurückgefallen, wenn das Profil fehlt.
test('ein Name ohne Buchstaben zeigt ein Fragezeichen', async () => {
  await wrap(<AvatarGroup gesichter={ohneBild([''])} />);
  expect(screen.getByText('?')).toBeTruthy();
});

test('ohne Schluessel bleibt die Initiale stehen', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.queryByTestId('avatar-bild')).toBeNull();
});

test('mit Schluessel zeigt der Kreis das Bild', async () => {
  await wrap(<Avatar name="Lea" avatarKey={SCHLUESSEL} />);
  const bild = screen.getByTestId('avatar-bild');
  expect(bild.props.source).toEqual({ uri: avatarUrl(SCHLUESSEL) });
});

// Der Kreis muss randlos gefüllt sein, sonst steht das Bild als Rechteck im
// Rund (DESIGN-LANGUAGE §4: Avatare sind rund).
test('das Bild fuellt den Kreis', async () => {
  await wrap(<Avatar name="Lea" avatarKey={SCHLUESSEL} />);
  expect(screen.getByTestId('avatar-bild').props.contentFit).toBe('cover');
});

// Solange das Bild lädt, steht die Initiale da. Ohne sie blitzt ein leerer
// Kreis auf, und in einer Facepile springt dabei die ganze Reihe.
test('waehrend des Ladens traegt der Kreis weiter die Initiale', async () => {
  await wrap(<Avatar name="Lea" avatarKey={SCHLUESSEL} />);
  expect(screen.getByText('L')).toBeTruthy();
});

test('die Gruppe zeigt Bilder und Initialen nebeneinander', async () => {
  await wrap(
    <AvatarGroup
      gesichter={[
        { name: 'Lea', avatarKey: SCHLUESSEL },
        { name: 'Mira', avatarKey: null },
      ]}
    />
  );
  expect(screen.getByTestId('avatar-bild')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
});

// Die Kino-Variante ersetzt in Task 9/10 zwei handkopierte AvatarInitiale-
// Komponenten. Sie muss die dunkle Palette benutzen, nicht die des Providers.
test('die Kino-Variante nimmt die dunkle Palette', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} kino />);
  const kreis = screen.getByTestId('avatar-kreis');
  expect(StyleSheet.flatten(kreis.props.style).backgroundColor).toBe(cinema['bg-1']);
});

// Fix-Runde 1 (Review-Fund, Important): dieser Test prüfte bislang NUR die
// Füllfarbe. Genau dadurch fiel unbemerkt durch, dass Ring UND Initiale-Text
// versehentlich `cinema['bg-0']`/`cinema['text-2']` erbten (dieselbe
// Ternary-Form wie die Fläche, aber die FALSCHE Kino-Farbe) — auf dem
// dunklen `bg-1`-Kreis liegt ein fast-schwarzer `bg-0`-Ring praktisch
// unsichtbar, wo DESIGN-LANGUAGE §4 wörtlich einen «2 px weisser Ring»
// verlangt. Ring und Text müssen `cinema['text-1']` sein (die hellste
// Kino-Farbe, der einzige verfügbare Ersatz für Weiss), NICHT `bg-0`/
// `text-2`, damit ein künftiger Rückfall auf die falsche Ternary sofort rot
// wird, nicht erst auf einem echten Screen auffällt.
test('die Kino-Variante zeichnet Ring und Initiale in der hellsten Kino-Farbe, nicht im Facepile-Separator-Ton', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} kino />);
  const kreis = StyleSheet.flatten(screen.getByTestId('avatar-kreis').props.style);
  expect(kreis.borderColor).toBe(cinema['text-1']);
  expect(kreis.borderColor).not.toBe(cinema['bg-0']);
  const initiale = StyleSheet.flatten(screen.getByText('L').props.style);
  expect(initiale.color).toBe(cinema['text-1']);
  expect(initiale.color).not.toBe(cinema['text-2']);
});
