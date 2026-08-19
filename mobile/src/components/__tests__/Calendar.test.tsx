import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Calendar } from '../Calendar';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const TODAY = '2026-08-12';
const EMPTY = { start: null, end: null };

test('the weekday row shows Monday first', async () => {
  await wrap(<Calendar selection={EMPTY} onDayPress={jest.fn()} today={TODAY} />);
  expect(screen.getByTestId('kalender-wochentage')).toBeTruthy();
  expect(screen.getByText('Mo')).toBeTruthy();
  expect(screen.getByText('So')).toBeTruthy();
});

test('the current month shows with its days', async () => {
  await wrap(<Calendar selection={EMPTY} onDayPress={jest.fn()} today={TODAY} />);
  expect(screen.getByText('August 2026')).toBeTruthy();
  expect(screen.getByLabelText('14. August 2026')).toBeTruthy();
});

test('a tap reports the ISO day upward', async () => {
  const onDay = jest.fn();
  await wrap(<Calendar selection={EMPTY} onDayPress={onDay} today={TODAY} />);
  await fireEvent.press(screen.getByLabelText('14. August 2026'));
  expect(onDay).toHaveBeenCalledWith('2026-08-14');
});

test('chosen days are marked as selected', async () => {
  const selection = { start: '2026-08-05', end: '2026-08-14' };
  await wrap(<Calendar selection={selection} onDayPress={jest.fn()} today={TODAY} />);
  expect(screen.getByLabelText('5. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('14. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('20. August 2026').props.accessibilityState.selected).toBe(false);
});

// The calendar fills its parent instead of giving itself a height. That
// requires the parent to have a definite height, and is why `DateRangeField`
// puts it in a full-screen modal instead of a `Sheet`: its content has none
// (Sheet.tsx, styles.inhalt), and there the calendar stood zero tall in the
// tree twice, once with `flex: 1` and once with a bare `maxHeight`. The Jest
// suite doesn't see that, because it computes no layout, so this test checks
// the cause instead of the effect.
test('the calendar and its month list fill the available space', async () => {
  await wrap(<Calendar selection={EMPTY} onDayPress={jest.fn()} today={TODAY} />);
  expect(StyleSheet.flatten(screen.getByTestId('kalender').props.style).flex).toBe(1);
  const list = screen.getByTestId('kalender-monate');
  expect(list.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(list.props.style).flex).toBe(1);
});

// The span originally sat INSIDE PressScale. That passes its `style` on to
// the Pressable, but wraps the children in an Animated.View without a style
// (PressScale.tsx:39), and that shrinks to its content, i.e. to the circle.
// The span therefore measured 40 instead of the full cell width: a gap
// opened between two days of the span, and the half spans at start and end
// stopped at the circle's edge instead of reaching the neighboring cell.
test('the span sits in the cell, not in the press target', async () => {
  const selection = { start: '2026-08-12', end: '2026-08-15' };
  await wrap(<Calendar selection={selection} onDayPress={jest.fn()} today={TODAY} />);
  const between = screen.getByTestId('spanne-2026-08-13');
  const flat = StyleSheet.flatten(between.props.style);
  expect(flat.left).toBe(0);
  expect(flat.right).toBe(0);
  // The decisive part: not below the Pressable, otherwise it would be sized
  // by the circle instead of the cell.
  expect(within(screen.getByLabelText('13. August 2026')).queryByTestId('spanne-2026-08-13'))
    .toBeNull();
});

test('the start and end reach into the neighboring cell with their half span', async () => {
  const selection = { start: '2026-08-12', end: '2026-08-15' };
  await wrap(<Calendar selection={selection} onDayPress={jest.fn()} today={TODAY} />);
  const start = StyleSheet.flatten(screen.getByTestId('spanne-2026-08-12').props.style);
  expect(start.left).toBe('50%');
  expect(start.right).toBe(0);
  const end = StyleSheet.flatten(screen.getByTestId('spanne-2026-08-15').props.style);
  expect(end.left).toBe(0);
  expect(end.right).toBe('50%');
});

test('a day trip gets no span at all', async () => {
  const selection = { start: '2026-08-12', end: '2026-08-12' };
  await wrap(<Calendar selection={selection} onDayPress={jest.fn()} today={TODAY} />);
  expect(screen.queryByTestId('spanne-2026-08-12')).toBeNull();
});

test('the range starts at the first allowed day', async () => {
  await wrap(<Calendar selection={EMPTY} onDayPress={jest.fn()} today={TODAY} />);
  // The range starts on August 1st, 2025, the July before it isn't in the grid.
  expect(screen.queryByLabelText('31. Juli 2025')).toBeNull();
});
