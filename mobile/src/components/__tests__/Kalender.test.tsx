import { render, screen, fireEvent } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Kalender } from '../Kalender';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const HEUTE = '2026-08-12';
const LEER = { start: null, end: null };

test('zeigt die Wochentagszeile mit Montag zuerst', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.getByTestId('kalender-wochentage')).toBeTruthy();
  expect(screen.getByText('Mo')).toBeTruthy();
  expect(screen.getByText('So')).toBeTruthy();
});

test('zeigt den aktuellen Monat mit seinen Tagen', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.getByText('August 2026')).toBeTruthy();
  expect(screen.getByLabelText('14. August 2026')).toBeTruthy();
});

test('ein Tipp meldet den ISO-Tag nach oben', async () => {
  const onTag = jest.fn();
  await wrap(<Kalender auswahl={LEER} onTag={onTag} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('14. August 2026'));
  expect(onTag).toHaveBeenCalledWith('2026-08-14');
});

test('gewählte Tage sind als selected ausgezeichnet', async () => {
  const auswahl = { start: '2026-08-05', end: '2026-08-14' };
  await wrap(<Kalender auswahl={auswahl} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.getByLabelText('5. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('14. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('20. August 2026').props.accessibilityState.selected).toBe(false);
});

test('der Bereich beginnt beim ersten erlaubten Tag', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  // Der Bereich beginnt am 1. August 2025, der Juli davor ist nicht im Raster.
  expect(screen.queryByLabelText('31. Juli 2025')).toBeNull();
});
