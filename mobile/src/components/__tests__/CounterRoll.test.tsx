import { render } from '@testing-library/react-native';
import * as React from 'react';
import { Animated } from 'react-native';
import { CounterRoll } from '../CounterRoll';

// The digit roll (DESIGN-LANGUAGE §5: "counter = digit roll") relies on the
// old and new digit both standing in the tree AT THE SAME TIME: the old one
// slides out upward, the new one comes in from below, both over the same
// `progress`. What is NOT tested here: the interpolation visuals themselves,
// those only a device can see (same boundary as SealAnimation.test.tsx).

function sequence() {
  return new Animated.Value(0);
}

test('the old and new digit stand in the tree at the same time', async () => {
  const { getByText } = await render(
    <CounterRoll from={7} to={8} progress={sequence()} progressWindow={[0.7, 0.95]} />
  );
  expect(getByText('7')).toBeTruthy();
  expect(getByText('8')).toBeTruthy();
});

test('unchanged digits stand still, only the changed one rolls', async () => {
  const { getByTestId, queryByTestId } = await render(
    <CounterRoll from={12} to={13} progress={sequence()} progressWindow={[0.7, 0.95]} />
  );
  // The tens digit "1" doesn't change: a fixed text, no roll pair.
  expect(getByTestId('counter-digit-fixed-0').props.children).toBe('1');
  expect(queryByTestId('counter-digit-old-0')).toBeNull();
  // The ones digit rolls: 2 out, 3 in.
  expect(getByTestId('counter-digit-old-1').props.children).toBe('2');
  expect(getByTestId('counter-digit-new-1').props.children).toBe('3');
});

test('on the digit-count change 9 → 10 the new tens digit rolls in without an old counterpart', async () => {
  const { getByTestId, queryByTestId } = await render(
    <CounterRoll from={9} to={10} progress={sequence()} progressWindow={[0.7, 0.95]} />
  );
  // There was no tens digit before: no old character, and certainly no
  // rendered space, the "1" rolls in alone.
  expect(queryByTestId('counter-digit-old-0')).toBeNull();
  expect(queryByTestId('counter-digit-fixed-0')).toBeNull();
  expect(getByTestId('counter-digit-new-0').props.children).toBe('1');
  // The ones digit rolls normally: 9 out, 0 in.
  expect(getByTestId('counter-digit-old-1').props.children).toBe('9');
  expect(getByTestId('counter-digit-new-1').props.children).toBe('0');
});
