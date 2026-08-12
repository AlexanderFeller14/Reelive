import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, palette, type } from '@/theme/tokens';
import { Input } from '../Input';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('reicht Eingaben durch und zeigt Fehler', async () => {
  const onChangeText = jest.fn();
  await wrap(<Input label="Username" value="" onChangeText={onChangeText} error="Dieser Username ist vergeben, probier einen anderen." />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'lea');
  expect(onChangeText).toHaveBeenCalledWith('lea');
  expect(screen.getByText(/vergeben/)).toBeTruthy();
});

test('placeholder erscheint erst mit Fokus (Floating Label)', async () => {
  await wrap(
    <Input label="Handynummer" value="" onChangeText={() => {}} placeholder="+41 79 123 45 67" />
  );
  expect(screen.queryByPlaceholderText('+41 79 123 45 67')).toBeNull();
  // await nötig: fireEvent ist in dieser RNTL-Version async und flusht den
  // State-Update erst nach dem await (React 19 + RNTL v14).
  await fireEvent(screen.getByLabelText('Handynummer'), 'focus');
  expect(screen.getByPlaceholderText('+41 79 123 45 67')).toBeTruthy();
});

// Phase-5-Final-Review, Punkt 4: ohne den `kino`-Schalter zog dieses Input
// über `useTheme()` zwingend die Licht-Palette, eine weisse Box mit
// `#222222`-Text mitten im Kinosaal (Kommentar-Sheet des Recap-Players).
// Gleiches Testmuster wie Sheet.test.tsx ("ohne/mit `kino`").
test('ohne `kino` nutzt das Feld die Licht-Palette', async () => {
  await wrap(<Input label="Kommentar" value="" onChangeText={() => {}} />);
  const box = screen.getByLabelText('Kommentar').parent;
  expect(StyleSheet.flatten(box!.props.style).backgroundColor).toBe(palette['bg-0']);
  expect(StyleSheet.flatten(screen.getByLabelText('Kommentar').props.style).color).toBe(palette['text-1']);
});

test('mit `kino` nutzt das Feld die feste Kino-Palette statt useTheme()', async () => {
  await wrap(<Input label="Kommentar" value="" onChangeText={() => {}} kino />);
  const box = screen.getByLabelText('Kommentar').parent;
  expect(StyleSheet.flatten(box!.props.style).backgroundColor).toBe(cinema['bg-1']);
  expect(StyleSheet.flatten(screen.getByLabelText('Kommentar').props.style).color).toBe(cinema['text-1']);
});

// Die Animation hing vorher nur an onFocus/onBlur. Ein programmatisch
// gesetzter `value`, Prefill des Bearbeiten-Formulars, wiederhergestellter
// Entwurf, Autofill, hob das Label deshalb nie an, und die Beschriftung lag
// mitten im bereits ausgefüllten Feld.
//
// Geprüft wird über den Reduced-Motion-Pfad, weil der den Zielwert synchron
// setzt statt ihn über 150 ms zu interpolieren: die Aussage ist dieselbe
// («das Label folgt dem Wert»), nur ohne Timer im Test.
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => true }));

// `includeHiddenElements`, weil das Label seit dem a11y-Fix bewusst nicht mehr
// im Accessibility-Baum steht, sichtbar ist es weiterhin.
const labelVerschiebung = (labelText: string) => {
  const label = screen.getByText(labelText, { includeHiddenElements: true });
  const transform = StyleSheet.flatten(label.props.style).transform as { translateY: number }[];
  return transform[0].translateY;
};

test('ein vorbefülltes Feld hebt sein Label sofort an', async () => {
  await wrap(<Input label="Name der Reise" value="Norwegen" onChangeText={() => {}} />);
  expect(labelVerschiebung('Name der Reise')).toBe(-9);
});

test('ein leeres Feld lässt sein Label in der Mitte stehen', async () => {
  await wrap(<Input label="Name der Reise" value="" onChangeText={() => {}} />);
  expect(labelVerschiebung('Name der Reise')).toBe(0);
});

// Sichtbares Label und accessibilityLabel am Feld tragen denselben Text,
// VoiceOver las ihn zweimal vor.
test('das sichtbare Label bleibt für VoiceOver stumm', async () => {
  await wrap(<Input label="Beginn" value="" onChangeText={() => {}} />);
  expect(screen.queryByText('Beginn')).toBeNull();
  expect(screen.getByText('Beginn', { includeHiddenElements: true })).toBeTruthy();
});

// Der TextInput hatte keine eigene Höhe und sass per justifyContent 'flex-end'
// am unteren Rand seines 56er-Rahmens. Er war damit nur rund 28 px hoch, und
// die obere Hälfte des Feldes, genau dort wo das Label steht, gehörte zu keinem
// Touch-Ziel: der umgebende View hat keinen Handler. Mit der Maus trifft man
// das untere Drittel pixelgenau, mit dem Daumen landet man oft oben, und dann
// passiert nichts. Genau dieses «das Reinklicken ist nicht direkt».
//
// Die Jest-Suite sieht das nicht, weil sie kein Layout rechnet: `fireEvent`
// spricht das Element direkt an, unabhängig davon, wie gross es gerendert wird.
// Deshalb prüft dieser Test die Ursache, nämlich dass das Feld den Rahmen füllt.
test('das Eingabefeld füllt den ganzen Rahmen, damit jeder Tipp ankommt', async () => {
  await wrap(<Input label="Name der Reise" value="" onChangeText={() => {}} />);
  const feld = StyleSheet.flatten(screen.getByLabelText('Name der Reise').props.style);
  expect(feld.flex).toBe(1);
  const rahmen = StyleSheet.flatten(screen.getByTestId('input-rahmen').props.style);
  // Kein 'flex-end' mehr: das drückte das Feld an die Unterkante, statt es den
  // Raum füllen zu lassen.
  expect(rahmen.justifyContent).toBeUndefined();
  expect(rahmen.height).toBe(56);
});

// Der Text muss unter dem angehobenen Label sitzen, nicht darauf. Das Label
// liegt gehoben bei top 8 und misst dann 12 px, endet also bei 20.
test('der Text beginnt unterhalb des angehobenen Labels', async () => {
  await wrap(<Input label="Name der Reise" value="Norwegen" onChangeText={() => {}} />);
  const feld = StyleSheet.flatten(screen.getByLabelText('Name der Reise').props.style);
  expect(feld.paddingTop).toBeGreaterThanOrEqual(20);
});

// `type.body` bringt `lineHeight: 24` mit, sinnvoll für Fliesstext, schädlich
// im einzeiligen TextInput: iOS legt die Glyphen an den unteren Rand der
// Zeilenbox statt in ihre Mitte, der Text hängt dadurch sichtbar zu tief im
// Feld. Deshalb übernimmt das Feld aus `type.body` nur Familie, Grösse und
// Ziffernvariante, nicht die Zeilenhöhe.
test('das Feld erbt keine lineHeight, die den Text nach unten drückt', async () => {
  await wrap(<Input label="Name der Reise" value="Abc" onChangeText={() => {}} />);
  const feld = StyleSheet.flatten(screen.getByLabelText('Name der Reise').props.style);
  expect(feld.lineHeight).toBeUndefined();
  // Familie und Grösse müssen aber ankommen, sonst fällt das Feld auf die
  // Systemschrift zurück (DESIGN-LANGUAGE §2: eine Familie, Figtree).
  expect(feld.fontFamily).toBe(type.body.fontFamily);
  expect(feld.fontSize).toBe(type.body.fontSize);
});
