import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, palette, spacing, type } from '@/theme/tokens';

// expo-image is a native view, in the test a placeholder that passes all
// props through is enough (same pattern as TripCard.test.tsx). Without the
// mock, even the import fails, expo-image/src/observe.ts expects a native
// environment.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { Avatar, AvatarGroup, type Face } from '../Avatar';
import { avatarUrl } from '@/features/auth/avatar';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// The existing tests work with names; this bridge keeps them readable
// unchanged, instead of padding every call out with `{ name: ..., avatarKey: null }`.
const withoutImage = (names: string[]): Face[] =>
  names.map((name) => ({ name, avatarKey: null }));

const KEY = 'profiles/11111111-2222-3333-4444-555555555555/abc.jpg';

// Until the image upload, the circle carries the initial, so the tests
// read the group via the first letters.
const EIGHT = ['Lea', 'Mira', 'Jonas', 'Sofia', 'Ben', 'Nora', 'Timo', 'Ida'];

test('an avatar carries the initial of its name', async () => {
  await wrap(<Avatar name="lea" />);
  expect(screen.getByText('L')).toBeTruthy();
});

// Hero size of the profile tab (image swap 2026-08-13): §4 ends at 44 px,
// anything above that is the large header image. There the 12 px label
// initial would be lost, it switches to the display format, the only size
// on the scale (§2: don't invent new ones) that can carry a 160 px circle.
test('above card size, the initial carries the display format', async () => {
  await wrap(<Avatar name="Lea" size={160} />);
  const initial = StyleSheet.flatten(screen.getByText('L').props.style);
  expect(initial.fontSize).toBe(type.display.fontSize);
});

test('up to 44 px, the initial stays in label format', async () => {
  await wrap(<Avatar name="Lea" size={44} />);
  const initial = StyleSheet.flatten(screen.getByText('L').props.style);
  expect(initial.fontSize).toBe(type.label.fontSize);
});

// Airbnb pattern: three faces, then it counts. The fourth person is
// deliberately NOT visible anymore, it's tucked into the rest circle.
test('the group shows at most three faces', async () => {
  await wrap(<AvatarGroup faces={withoutImage(EIGHT)} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

// The rest is a fourth CIRCLE, not a text line next to it: that's exactly
// what distinguishes the Airbnb facepile from the previous display.
test('the rest stands as its own circle in the same row', async () => {
  await wrap(<AvatarGroup faces={withoutImage(EIGHT)} />);
  const rest = screen.getByTestId('avatar-rest');
  const style = StyleSheet.flatten(rest.props.style);
  expect(screen.getByText('+5')).toBeTruthy();
  expect(style.borderRadius).toBe(999);
  expect(style.backgroundColor).toBe(palette['bg-1']);
  expect(style.width).toBe(style.height);
});

// DESIGN-LANGUAGE §4: "groups overlapping by -8 px". The rest circle
// belongs to the group and isn't set apart.
test('the rest circle overlaps like the faces before it', async () => {
  await wrap(<AvatarGroup faces={withoutImage(EIGHT)} />);
  expect(StyleSheet.flatten(screen.getByTestId('avatar-rest').props.style).marginLeft).toBe(-spacing.s);
});

// The edge where an off-by-one happens most easily: four people "almost"
// fit into three circles.
test('exactly four people yield three faces and a +1 circle', async () => {
  await wrap(<AvatarGroup faces={withoutImage(['Lea', 'Mira', 'Jonas', 'Sofia'])} />);
  expect(screen.getByText('+1')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

test('three people fit without a rest circle', async () => {
  await wrap(<AvatarGroup faces={withoutImage(['Lea', 'Mira', 'Jonas'])} />);
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

test('two people yield two faces without a rest circle', async () => {
  await wrap(<AvatarGroup faces={withoutImage(['Lea', 'Jonas'])} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

// An empty display name must not produce an empty circle, it shows the
// question mark from Avatar instead. This happens: profiles.display_name
// fell back to '' in fetchMembers when the profile is missing.
test('a name without letters shows a question mark', async () => {
  await wrap(<AvatarGroup faces={withoutImage([''])} />);
  expect(screen.getByText('?')).toBeTruthy();
});

test('without a key, the initial stays', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} />);
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.queryByTestId('avatar-image')).toBeNull();
});

test('with a key, the circle shows the image', async () => {
  await wrap(<Avatar name="Lea" avatarKey={KEY} />);
  const image = screen.getByTestId('avatar-image');
  expect(image.props.source).toEqual({ uri: avatarUrl(KEY) });
});

// The circle must be filled edge to edge, otherwise the image stands as a
// rectangle in the round (DESIGN-LANGUAGE §4: avatars are round).
test('the image fills the circle', async () => {
  await wrap(<Avatar name="Lea" avatarKey={KEY} />);
  expect(screen.getByTestId('avatar-image').props.contentFit).toBe('cover');
});

// While the image is loading, the initial stays there. Without it, an
// empty circle would flash, and in a facepile the whole row would jump.
test('while loading, the circle keeps carrying the initial', async () => {
  await wrap(<Avatar name="Lea" avatarKey={KEY} />);
  expect(screen.getByText('L')).toBeTruthy();
});

test('the group shows images and initials side by side', async () => {
  await wrap(
    <AvatarGroup
      faces={[
        { name: 'Lea', avatarKey: KEY },
        { name: 'Mira', avatarKey: null },
      ]}
    />
  );
  expect(screen.getByTestId('avatar-image')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
});

// The cinema variant replaces two hand-copied AvatarInitiale components in
// Task 9/10. It must use the dark palette, not the provider's.
test('the cinema variant takes the dark palette', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} cinemaMode />);
  const circle = screen.getByTestId('avatar-circle');
  expect(StyleSheet.flatten(circle.props.style).backgroundColor).toBe(cinema['bg-1']);
});

// Fix round 1 (review finding, Important): this test previously checked
// ONLY the fill color. Precisely because of that, it went unnoticed that
// ring AND initial text accidentally inherited
// `cinema['bg-0']`/`cinema['text-2']` (the same ternary shape as the
// surface, but the WRONG cinema color): on the dark `bg-1` circle, a
// near-black `bg-0` ring sits practically invisible, where
// DESIGN-LANGUAGE §4 literally demands a "2 px white ring". Ring and text
// must be `cinema['text-1']` (the lightest cinema color, the only
// available substitute for white), NOT `bg-0`/`text-2`, so that a future
// regression to the wrong ternary turns red immediately, instead of only
// showing up on a real screen.
test('the cinema variant draws the ring and initial in the lightest cinema color, not the facepile-separator tone', async () => {
  await wrap(<Avatar name="Lea" avatarKey={null} cinemaMode />);
  const circle = StyleSheet.flatten(screen.getByTestId('avatar-circle').props.style);
  expect(circle.borderColor).toBe(cinema['text-1']);
  expect(circle.borderColor).not.toBe(cinema['bg-0']);
  const initial = StyleSheet.flatten(screen.getByText('L').props.style);
  expect(initial.color).toBe(cinema['text-1']);
  expect(initial.color).not.toBe(cinema['text-2']);
});

// Merge fix round (review finding, minor): fix round 1 only corrected
// `Avatar`, the group's "+N" circle kept `cinema['bg-0']`/`cinema['text-2']`.
// In ONE overlapping row, that would have been two different rings. The
// test therefore doesn't compare against a hardcoded token, but against
// the ring the faces NEXT TO IT actually carry: this way it stays valid if
// the cinema group is ever switched to the separator reading, as long as
// both spots are switched together, which is the only guarantee this test
// is about.
test('in the cinema group, the rest circle carries the same ring as the faces next to it', async () => {
  await wrap(<AvatarGroup faces={withoutImage(EIGHT)} cinemaMode />);
  const face = StyleSheet.flatten(screen.getAllByTestId('avatar-circle')[0].props.style);
  const rest = StyleSheet.flatten(screen.getByTestId('avatar-rest').props.style);
  expect(rest.borderColor).toBe(face.borderColor);
  expect(StyleSheet.flatten(screen.getByText('+5').props.style).color)
    .toBe(StyleSheet.flatten(screen.getByText('L').props.style).color);
});
