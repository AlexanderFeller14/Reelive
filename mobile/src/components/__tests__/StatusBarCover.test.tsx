import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { StatusBarCover } from '../StatusBarCover';

const wrap = () => render(
  <ThemeProvider>
    <StatusBarCover />
  </ThemeProvider>
);

// The global mock from jest.setup.ts reports insets of 0, so device
// measurements are set per test via the spy pattern from player.test.tsx.
let insetSpy: jest.SpyInstance | undefined;

const setTopInset = (top: number) => {
  const safeAreaModule = require('react-native-safe-area-context');
  insetSpy = jest
    .spyOn(safeAreaModule, 'useSafeAreaInsets')
    .mockReturnValue({ top, bottom: 0, left: 0, right: 0 });
};

afterEach(() => {
  insetSpy?.mockRestore();
  insetSpy = undefined;
});

test('covers exactly the area the device occupies at the top', async () => {
  setTopInset(59);
  await wrap();

  const style = StyleSheet.flatten(screen.getByTestId('status-bar-cover').props.style);
  expect(style.height).toBe(59);
  expect(style.position).toBe('absolute');
  expect(style.top).toBe(0);
  expect(style.left).toBe(0);
  expect(style.right).toBe(0);
});

// Pinned against the literal, not against the token read the same way the
// component reads it: that would assert nothing. Swapping to `bg-1` (the
// off-white of set-off surfaces) has to fail here.
test('paints opaquely in the app background colour', async () => {
  setTopInset(59);
  await wrap();

  const style = StyleSheet.flatten(screen.getByTestId('status-bar-cover').props.style);
  expect(style.backgroundColor).toBe('#FFFFFF');
});

test('lets touches pass through to the content beneath', async () => {
  setTopInset(59);
  await wrap();

  expect(screen.getByTestId('status-bar-cover').props.pointerEvents).toBe('none');
});

test('renders nothing where the device occupies no top area (web)', async () => {
  setTopInset(0);
  await wrap();

  expect(screen.queryByTestId('status-bar-cover')).toBeNull();
});
