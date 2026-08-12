import { render, screen, fireEvent } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { SHEET_SCROLL_ANTEIL } from '@/components/Sheet';
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

// Der Kalender war im Sheet zweimal unsichtbar, erst mit `flex: 1`, dann mit
// blossem `maxHeight`. Beide Male stand er im Baum, war aber null hoch, und das
// Sheet zeigte nur Titel und Knopf. `Sheet` gibt seinem Inhalt keine definite
// Höhe (styles.inhalt), und eine virtualisierte FlatList leitet sich keine ab.
// Die Jest-Suite sieht das nicht, weil sie kein Layout rechnet, deshalb prüft
// dieser Test die Ursache: eine ausgerechnete Höhe, nicht bloss einen Deckel.
test('die Monatsliste hat eine ausgerechnete Höhe, nicht nur einen Deckel', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  const liste = screen.getByTestId('kalender-monate');
  expect(liste.type).toBe('RCTScrollView');
  const flach = StyleSheet.flatten(liste.props.style);
  expect(flach.height).toBe(Dimensions.get('window').height * SHEET_SCROLL_ANTEIL);
  expect(flach.flex).toBeUndefined();
});

test('der Bereich beginnt beim ersten erlaubten Tag', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  // Der Bereich beginnt am 1. August 2025, der Juli davor ist nicht im Raster.
  expect(screen.queryByLabelText('31. Juli 2025')).toBeNull();
});
