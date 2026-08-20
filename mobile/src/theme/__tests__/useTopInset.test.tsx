import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { spacing } from '../tokens';
import { useTopInset, useBottomInset } from '../useTopInset';

// The other suites run via jest.setup.ts with insets at 0, i.e. on a
// device without a Dynamic Island. The interesting case is the other one,
// and this file checks it by giving the provider real metrics.
function Display({ basis }: { basis: number }) {
  return <Text testID="value">{String(useTopInset(basis))}</Text>;
}

const withInsets = async (top: number, basis: number) => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Display basis={basis} />
    </SafeAreaProvider>
  );
  return Number(screen.getByTestId('value').props.children);
};

test('without an inset the designed spacing stays unchanged', async () => {
  expect(await withInsets(0, spacing.xxl)).toBe(spacing.xxl);
});

// 20 pt status bar (iPhone SE): 20 + 16 = 36, less than the designed 48,
// the screen looks as designed.
test('a narrow status bar changes nothing', async () => {
  expect(await withInsets(20, spacing.xxl)).toBe(spacing.xxl);
});

// 59 pt Dynamic Island (iPhone 17 Pro): 59 + 16 = 75 > 48. This is exactly
// where "Schritt 1 von 2" used to stick to the clock.
test('under the Dynamic Island the content gives way', async () => {
  expect(await withInsets(59, spacing.xxl)).toBe(59 + spacing.base);
});

// The smaller base value of the list screens slips under the inset
// earlier; nothing may end up behind the clock there either.
test('the smaller list spacing gives way earlier', async () => {
  expect(await withInsets(47, spacing.xl)).toBe(47 + spacing.base);
});

// --- useBottomInset ---

function BottomDisplay({ basis }: { basis: number }) {
  return <Text testID="value">{String(useBottomInset(basis))}</Text>;
}

const withBottomInset = async (bottom: number, basis: number) => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top: 59, left: 0, right: 0, bottom },
      }}
    >
      <BottomDisplay basis={basis} />
    </SafeAreaProvider>
  );
  return Number(screen.getByTestId('value').props.children);
};

// Devices with a home button and the web export report 0 at the bottom;
// there the designed spacing stays exactly as designed.
test('without a bottom inset the designed spacing stays unchanged', async () => {
  expect(await withBottomInset(0, spacing.xl)).toBe(spacing.xl);
});

// 34 pt home indicator: 34 + 16 = 50 > 32. This is exactly where the
// player's reaction row used to sit on the indicator.
test('above the home indicator the content gives way', async () => {
  expect(await withBottomInset(34, spacing.xl)).toBe(34 + spacing.base);
});

// Cross-check against the top inset: the two hooks read different edges
// and must not get swapped. With top 59 and bottom 0 the bottom inset must
// stay at the designed value, even though there's plenty of inset at the
// top.
test('the bottom inset does not accidentally read the top inset', async () => {
  expect(await withBottomInset(0, spacing.xl)).toBe(spacing.xl);
});
