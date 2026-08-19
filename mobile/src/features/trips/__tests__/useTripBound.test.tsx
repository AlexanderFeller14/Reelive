import { Text, View } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PressScale } from '@/components/PressScale';
import { useTripBound } from '../useTripBound';

// A screen as it exists under `[id]`: the trip arrives as a prop, the screen
// stays mounted while it changes.
function Screen({ tripId }: { tripId: string }) {
  const [open, setOpen] = useTripBound<string | null>(tripId, null);
  const [count, setCount] = useTripBound(tripId, 0);
  return (
    <View>
      <Text testID="open">{open ?? 'none'}</Text>
      <Text testID="count">{String(count)}</Text>
      <PressScale testID="open-button" onPress={() => setOpen(`sheet-${tripId}`)}>
        <Text>open</Text>
      </PressScale>
      <PressScale testID="count-button" onPress={() => setCount(count + 1)}>
        <Text>count</Text>
      </PressScale>
    </View>
  );
}

async function show(tripId: string) {
  return render(<Screen tripId={tripId} />);
}

test('a set value stays as long as the trip stays the same', async () => {
  const { rerender } = await show('t1');
  await fireEvent.press(screen.getByTestId('open-button'));
  expect(screen.getByTestId('open')).toHaveTextContent('sheet-t1');

  await rerender(<Screen tripId="t1" />);
  expect(screen.getByTestId('open')).toHaveTextContent('sheet-t1');
});

// The bug this is about: the screen stays mounted, only the parameter
// changes. Without this hook, the previous trip's sheet kept standing.
test('a change of trip discards the value', async () => {
  const { rerender } = await show('t1');
  await fireEvent.press(screen.getByTestId('open-button'));
  expect(screen.getByTestId('open')).toHaveTextContent('sheet-t1');

  await rerender(<Screen tripId="t2" />);
  expect(screen.getByTestId('open')).toHaveTextContent('none');
});

// The path on which hiding (leave the value standing, compare while
// deriving) fails: at t1 → t2 → t1 the id matches again, and a sheet would
// open on its own that nobody tapped, with an index from the earlier load.
test('even the way back to the first trip does NOT bring the value back', async () => {
  const { rerender } = await show('t1');
  await fireEvent.press(screen.getByTestId('open-button'));

  await rerender(<Screen tripId="t2" />);
  await rerender(<Screen tripId="t1" />);
  expect(screen.getByTestId('open')).toHaveTextContent('none');
});

test('every state of the same screen is reset independently', async () => {
  const { rerender } = await show('t1');
  await fireEvent.press(screen.getByTestId('open-button'));
  await fireEvent.press(screen.getByTestId('count-button'));
  expect(screen.getByTestId('count')).toHaveTextContent('1');

  await rerender(<Screen tripId="t2" />);
  expect(screen.getByTestId('open')).toHaveTextContent('none');
  expect(screen.getByTestId('count')).toHaveTextContent('0');
});

// In the new trip it should be usable normally. A hook that accepts nothing
// anymore after the change would be worse than the problem.
test('after the change, setting again works in the new trip', async () => {
  const { rerender } = await show('t1');
  await fireEvent.press(screen.getByTestId('open-button'));
  await rerender(<Screen tripId="t2" />);

  await fireEvent.press(screen.getByTestId('open-button'));
  expect(screen.getByTestId('open')).toHaveTextContent('sheet-t2');
});

// Reset WHILE RENDERING, not in an effect. The difference is exactly one
// frame, and the foreign sheet would be visible in it. Checked by verifying
// that the value is already the initial value in the FIRST pass after the
// change: the testing library runs effects inside `rerender`, so an
// effect-based reset would be invisible here too. That's why this test
// records what the screen saw WHILE rendering.
test('the initial value already holds during the pass of the change, not only afterwards', async () => {
  const seen: (string | null)[] = [];
  function Recorder({ tripId }: { tripId: string }) {
    const [open, setOpen] = useTripBound<string | null>(tripId, null);
    seen.push(open);
    return (
      <PressScale testID="open-button" onPress={() => setOpen(`sheet-${tripId}`)}>
        <Text>{open ?? 'none'}</Text>
      </PressScale>
    );
  }
  const { rerender } = await render(<Recorder tripId="t1" />);
  await fireEvent.press(screen.getByTestId('open-button'));
  seen.length = 0;

  await rerender(<Recorder tripId="t2" />);
  // NO pass has seen the previous trip's value under the new id, not even
  // the first one.
  expect(seen).not.toContain('sheet-t1');
  expect(seen.length).toBeGreaterThan(0);
});
