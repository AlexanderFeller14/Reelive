import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { DateRangeField } from '../DateRangeField';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const TODAY = '2026-08-12';
const EMPTY = { start: null, end: null };

test('shows only the label when the selection is empty', async () => {
  await wrap(<DateRangeField value={EMPTY} onChange={jest.fn()} today={TODAY} />);
  expect(screen.getByText('Zeitraum')).toBeTruthy();
  expect(screen.queryByTestId('zeitraum-modal')).toBeNull();
});

test('shows a set date range in short form', async () => {
  const value = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<DateRangeField value={value} onChange={jest.fn()} today={TODAY} />);
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('reads aloud with months spelled out', async () => {
  const value = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<DateRangeField value={value} onChange={jest.fn()} today={TODAY} />);
  expect(screen.getByLabelText('Zeitraum, 1. August 2026 bis 14. August 2026')).toBeTruthy();
});

// A Modal, not a `Sheet`: `Sheet` positions itself with absoluteFill relative
// to its parent, and this field sits in the middle of the form. The sheet
// therefore appeared at the field's position instead of over the whole
// screen and covered the status bar. A Modal always sits on top, no matter
// how deep the field hangs in the tree, and covers the whole page at once.
test('a tap opens the modal covering the whole page', async () => {
  await wrap(<DateRangeField value={EMPTY} onChange={jest.fn()} today={TODAY} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  const modal = screen.getByTestId('zeitraum-modal');
  expect(modal).toBeTruthy();
  expect(StyleSheet.flatten(modal.props.style).flex).toBe(1);
});

// The modal covers the whole page, so it touches BOTH system areas: the
// status bar and Dynamic Island above, the home indicator with roughly 34
// points below. A fixed bottom spacing would leave "Übernehmen" stranded
// underneath it. The other suites run through jest.setup.ts with insets 0,
// the interesting case is the other one, hence a provider with real metrics
// here.
test('the modal keeps both system edges clear', async () => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top: 59, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider>
        <DateRangeField value={EMPTY} onChange={jest.fn()} today={TODAY} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  const flat = StyleSheet.flatten(screen.getByTestId('zeitraum-modal').props.style);
  expect(flat.paddingTop).toBe(59 + spacing.base);
  expect(flat.paddingBottom).toBe(34 + spacing.base);
});

test('on a device without system edges the designed spacing stays in place', async () => {
  await wrap(<DateRangeField value={EMPTY} onChange={jest.fn()} today={TODAY} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  const flat = StyleSheet.flatten(screen.getByTestId('zeitraum-modal').props.style);
  expect(flat.paddingTop).toBe(spacing.l);
  expect(flat.paddingBottom).toBe(spacing.l);
});

test('two taps in the calendar plus Übernehmen report ISO values upward', async () => {
  const onChange = jest.fn();
  await wrap(<DateRangeField value={EMPTY} onChange={onChange} today={TODAY} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText('5. August 2026'));
  await fireEvent.press(screen.getByLabelText('14. August 2026'));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
  expect(onChange).toHaveBeenCalledWith({ start: '2026-08-05', end: '2026-08-14' });
});

test('Übernehmen has no effect on a half-made selection', async () => {
  const onChange = jest.fn();
  await wrap(<DateRangeField value={EMPTY} onChange={onChange} today={TODAY} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText('5. August 2026'));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
  expect(onChange).not.toHaveBeenCalled();
});

test('Schliessen without Übernehmen leaves the old value standing', async () => {
  const onChange = jest.fn();
  const value = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<DateRangeField value={value} onChange={onChange} today={TODAY} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, 1. August 2026 bis 14. August 2026'));
  await fireEvent.press(screen.getByLabelText('3. August 2026'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('a discarded draft is gone the next time it opens', async () => {
  const value = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<DateRangeField value={value} onChange={jest.fn()} today={TODAY} />);
  const field = 'Zeitraum, 1. August 2026 bis 14. August 2026';
  await fireEvent.press(screen.getByLabelText(field));
  await fireEvent.press(screen.getByLabelText('3. August 2026'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));
  await fireEvent.press(screen.getByLabelText(field));
  // The 3rd was only chosen in the discarded draft; the sheet shows the
  // previously applied range again.
  expect(screen.getByLabelText('1. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('3. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('20. August 2026').props.accessibilityState.selected).toBe(false);
});

test('shows an error beneath the field', async () => {
  await wrap(
    <DateRangeField value={EMPTY} onChange={jest.fn()} error="Trag den Zeitraum ein." today={TODAY} />
  );
  expect(screen.getByText('Trag den Zeitraum ein.')).toBeTruthy();
});
