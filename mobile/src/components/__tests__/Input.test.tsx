import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, palette, type } from '@/theme/tokens';
import { Input } from '../Input';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('passes input through and shows an error', async () => {
  const onChangeText = jest.fn();
  await wrap(<Input label="Username" value="" onChangeText={onChangeText} error="Dieser Username ist vergeben, probier einen anderen." />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'lea');
  expect(onChangeText).toHaveBeenCalledWith('lea');
  expect(screen.getByText(/vergeben/)).toBeTruthy();
});

test('the placeholder only appears on focus (floating label)', async () => {
  await wrap(
    <Input label="Handynummer" value="" onChangeText={() => {}} placeholder="+41 79 123 45 67" />
  );
  expect(screen.queryByPlaceholderText('+41 79 123 45 67')).toBeNull();
  // await needed: fireEvent is async in this RNTL version and only
  // flushes the state update after the await (React 19 + RNTL v14).
  await fireEvent(screen.getByLabelText('Handynummer'), 'focus');
  expect(screen.getByPlaceholderText('+41 79 123 45 67')).toBeTruthy();
});

// Phase-5 final review, point 4: without the `cinemaMode` switch, this
// input unconditionally pulled the light palette via `useTheme()`, a
// white box with `#222222` text in the middle of the cinema (the recap
// player's comment sheet). Same test pattern as Sheet.test.tsx
// ("without/with `cinemaMode`").
test('without `cinemaMode` the field uses the light palette', async () => {
  await wrap(<Input label="Kommentar" value="" onChangeText={() => {}} />);
  const box = screen.getByLabelText('Kommentar').parent;
  expect(StyleSheet.flatten(box!.props.style).backgroundColor).toBe(palette['bg-0']);
  expect(StyleSheet.flatten(screen.getByLabelText('Kommentar').props.style).color).toBe(palette['text-1']);
});

test('with `cinemaMode` the field uses the fixed cinema palette instead of useTheme()', async () => {
  await wrap(<Input label="Kommentar" value="" onChangeText={() => {}} cinemaMode />);
  const box = screen.getByLabelText('Kommentar').parent;
  expect(StyleSheet.flatten(box!.props.style).backgroundColor).toBe(cinema['bg-1']);
  expect(StyleSheet.flatten(screen.getByLabelText('Kommentar').props.style).color).toBe(cinema['text-1']);
});

// The animation used to be tied only to onFocus/onBlur. A
// programmatically set `value`, prefill of the edit form, a restored
// draft, autofill, therefore never lifted the label, and the caption sat
// in the middle of an already-filled field.
//
// Checked via the reduced-motion path, because that sets the target
// value synchronously instead of interpolating it over 150 ms: the claim
// is the same ("the label follows the value"), just without a timer in
// the test.
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => true }));

// `includeHiddenElements`, because since the a11y fix the label is
// deliberately no longer in the accessibility tree, it stays visible
// though.
const labelShift = (labelText: string) => {
  const label = screen.getByText(labelText, { includeHiddenElements: true });
  const transform = StyleSheet.flatten(label.props.style).transform as { translateY: number }[];
  return transform[0].translateY;
};

test('a prefilled field lifts its label immediately', async () => {
  await wrap(<Input label="Name der Reise" value="Norwegen" onChangeText={() => {}} />);
  expect(labelShift('Name der Reise')).toBe(-9);
});

test('an empty field leaves its label centered', async () => {
  await wrap(<Input label="Name der Reise" value="" onChangeText={() => {}} />);
  expect(labelShift('Name der Reise')).toBe(0);
});

// The visible label and the field's accessibilityLabel carry the same
// text, VoiceOver used to read it out twice.
test('the visible label stays silent for VoiceOver', async () => {
  await wrap(<Input label="Beginn" value="" onChangeText={() => {}} />);
  expect(screen.queryByText('Beginn')).toBeNull();
  expect(screen.getByText('Beginn', { includeHiddenElements: true })).toBeTruthy();
});

// The TextInput had no height of its own and sat, via justifyContent
// 'flex-end', at the bottom edge of its 56 px frame. It was thus only
// about 28 px tall, and the top half of the field, exactly where the
// label sits, belonged to no touch target: the surrounding view has no
// handler. With a mouse you hit the bottom third pixel-precisely, with a
// thumb you often land at the top, and then nothing happens. Exactly the
// case of "tapping in isn't direct".
//
// The Jest suite doesn't see this, because it doesn't compute layout:
// `fireEvent` addresses the element directly, independent of how large it
// is actually rendered. So this test checks the cause instead, namely
// that the field fills the frame.
test('the input field fills the whole frame, so every tap lands', async () => {
  await wrap(<Input label="Name der Reise" value="" onChangeText={() => {}} />);
  const field = StyleSheet.flatten(screen.getByLabelText('Name der Reise').props.style);
  expect(field.flex).toBe(1);
  const frame = StyleSheet.flatten(screen.getByTestId('input-rahmen').props.style);
  // No more 'flex-end': that pushed the field to the bottom edge instead
  // of letting it fill the space.
  expect(frame.justifyContent).toBeUndefined();
  expect(frame.height).toBe(56);
});

// The text must sit below the lifted label, not on top of it. The lifted
// label sits at top 8 and then measures 12 px, so it ends at 20.
test('the text starts below the lifted label', async () => {
  await wrap(<Input label="Name der Reise" value="Norwegen" onChangeText={() => {}} />);
  const field = StyleSheet.flatten(screen.getByLabelText('Name der Reise').props.style);
  expect(field.paddingTop).toBeGreaterThanOrEqual(20);
});

// `type.body` brings `lineHeight: 24` along, sensible for flowing text,
// harmful in the single-line TextInput: iOS places the glyphs at the
// bottom edge of the line box instead of centering them, the text
// visibly hangs too low in the field because of it. That's why the field
// only takes family, size, and figure variant from `type.body`, not the
// line height.
test('the field does not inherit a lineHeight that pushes the text down', async () => {
  await wrap(<Input label="Name der Reise" value="Abc" onChangeText={() => {}} />);
  const field = StyleSheet.flatten(screen.getByLabelText('Name der Reise').props.style);
  expect(field.lineHeight).toBeUndefined();
  // Family and size must still come through, otherwise the field falls
  // back to the system font (DESIGN-LANGUAGE §2: one family, Figtree).
  expect(field.fontFamily).toBe(type.body.fontFamily);
  expect(field.fontSize).toBe(type.body.fontSize);
});
