import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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

// Der Kalender füllt seinen Elternteil, statt sich selbst eine Höhe zu geben.
// Das setzt voraus, dass dieser Elternteil eine definite Höhe hat, und ist der
// Grund, warum `Zeitraumfeld` ihn in ein Vollbild-Modal setzt und nicht in ein
// `Sheet`: dessen Inhalt hat keine (Sheet.tsx, styles.inhalt), und dort stand
// der Kalender zweimal null hoch im Baum, einmal mit `flex: 1` und einmal mit
// blossem `maxHeight`. Die Jest-Suite sieht das nicht, weil sie kein Layout
// rechnet, deshalb prüft dieser Test die Ursache statt der Wirkung.
test('Kalender und Monatsliste füllen den verfügbaren Raum', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  expect(StyleSheet.flatten(screen.getByTestId('kalender').props.style).flex).toBe(1);
  const liste = screen.getByTestId('kalender-monate');
  expect(liste.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(liste.props.style).flex).toBe(1);
});

// Die Spanne lag zuerst INNERHALB von PressScale. Das reicht sein `style` an
// das Pressable weiter, wickelt die Kinder aber in einen Animated.View ohne
// Style (PressScale.tsx:39), und der schrumpft auf seinen Inhalt, also auf den
// Kreis. Die Fläche mass dadurch 40 statt der vollen Zellbreite: zwischen zwei
// Tagen der Spanne klaffte eine Lücke, und die halbseitigen Flächen an Beginn
// und Ende endeten am Kreisrand, statt die Nachbarzelle zu erreichen.
test('die Spannen-Fläche liegt in der Zelle, nicht im Druckziel', async () => {
  const auswahl = { start: '2026-08-12', end: '2026-08-15' };
  await wrap(<Kalender auswahl={auswahl} onTag={jest.fn()} heute={HEUTE} />);
  const dazwischen = screen.getByTestId('spanne-2026-08-13');
  const flach = StyleSheet.flatten(dazwischen.props.style);
  expect(flach.left).toBe(0);
  expect(flach.right).toBe(0);
  // Der entscheidende Teil: nicht unterhalb des Pressable, sonst bemisst sie
  // sich am Kreis statt an der Zelle.
  expect(within(screen.getByLabelText('13. August 2026')).queryByTestId('spanne-2026-08-13'))
    .toBeNull();
});

test('Beginn und Ende reichen mit ihrer halben Fläche zur Nachbarzelle', async () => {
  const auswahl = { start: '2026-08-12', end: '2026-08-15' };
  await wrap(<Kalender auswahl={auswahl} onTag={jest.fn()} heute={HEUTE} />);
  const beginn = StyleSheet.flatten(screen.getByTestId('spanne-2026-08-12').props.style);
  expect(beginn.left).toBe('50%');
  expect(beginn.right).toBe(0);
  const ende = StyleSheet.flatten(screen.getByTestId('spanne-2026-08-15').props.style);
  expect(ende.left).toBe(0);
  expect(ende.right).toBe('50%');
});

test('eine Tagesreise bekommt gar keine Fläche', async () => {
  const auswahl = { start: '2026-08-12', end: '2026-08-12' };
  await wrap(<Kalender auswahl={auswahl} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.queryByTestId('spanne-2026-08-12')).toBeNull();
});

test('der Bereich beginnt beim ersten erlaubten Tag', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  // Der Bereich beginnt am 1. August 2025, der Juli davor ist nicht im Raster.
  expect(screen.queryByLabelText('31. Juli 2025')).toBeNull();
});
