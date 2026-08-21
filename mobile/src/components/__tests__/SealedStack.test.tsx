import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SealedStack } from '../SealedStack';

// The stack hides itself from screen readers on purpose (see there), and
// RNTL skips hidden nodes by default. Without this the queries below
// would find nothing and say so in a way that sounds like a missing
// component.
const HIDDEN = { includeHiddenElements: true } as const;

function angles(): number[] {
  return screen.getAllByTestId('sealed-card', HIDDEN).map((card) => {
    const flat = StyleSheet.flatten(card.props.style) as { transform?: { rotate?: string }[] };
    const rotate = flat.transform?.find((t) => 'rotate' in t)?.rotate ?? '0deg';
    return Number.parseFloat(rotate);
  });
}

test('one card lies there per moment', async () => {
  await render(<SealedStack count={2} />);
  expect(screen.getAllByTestId('sealed-card', HIDDEN)).toHaveLength(2);
});

test('the stack stops at three, however many moments there are', async () => {
  await render(<SealedStack count={9} />);
  expect(screen.getAllByTestId('sealed-card', HIDDEN)).toHaveLength(3);
});

test('without a single moment nothing lies there', async () => {
  await render(<SealedStack count={0} />);
  expect(screen.queryAllByTestId('sealed-card', HIDDEN)).toHaveLength(0);
});

test('the cards lie fanned out: no two of them at the same angle', async () => {
  await render(<SealedStack count={3} />);
  const seen = angles();
  expect(new Set(seen).size).toBe(seen.length);
});

// The number next to it already says how many moments there are. A screen
// reader that walked through three empty cards afterwards would only be
// counting the same thing a second time, without ever saying so.
test('the stack stays silent for screen readers', async () => {
  await render(<SealedStack count={3} />);
  expect(screen.getByTestId('sealed-stack', HIDDEN).props.importantForAccessibility).toBe('no-hide-descendants');
});
