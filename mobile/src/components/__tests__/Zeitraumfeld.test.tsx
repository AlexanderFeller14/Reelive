import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { Zeitraumfeld } from '../Zeitraumfeld';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const HEUTE = '2026-08-12';
const LEER = { start: null, end: null };

test('zeigt bei leerer Auswahl nur das Label', async () => {
  await wrap(<Zeitraumfeld wert={LEER} onAendern={jest.fn()} heute={HEUTE} />);
  expect(screen.getByText('Zeitraum')).toBeTruthy();
  expect(screen.queryByTestId('zeitraum-modal')).toBeNull();
});

test('zeigt einen gesetzten Zeitraum in Kurzform', async () => {
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={jest.fn()} heute={HEUTE} />);
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('liest sich vor mit ausgeschriebenen Monaten', async () => {
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={jest.fn()} heute={HEUTE} />);
  expect(screen.getByLabelText('Zeitraum, 1. August 2026 bis 14. August 2026')).toBeTruthy();
});

// Ein Modal, kein `Sheet`: `Sheet` positioniert sich mit absoluteFill relativ
// zu seinem Elternteil, und dieses Feld sitzt mitten im Formular. Das Sheet
// erschien dadurch an der Stelle des Feldes statt über dem Screen und
// überlagerte die Statusleiste. Ein Modal liegt immer oben, unabhängig davon,
// wie tief das Feld im Baum hängt, und deckt zugleich die ganze Seite ab.
test('ein Tipp öffnet das Modal über die ganze Seite', async () => {
  await wrap(<Zeitraumfeld wert={LEER} onAendern={jest.fn()} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  const modal = screen.getByTestId('zeitraum-modal');
  expect(modal).toBeTruthy();
  expect(StyleSheet.flatten(modal.props.style).flex).toBe(1);
});

// Das Modal deckt die ganze Seite ab, also stösst es an BEIDE Systembereiche:
// oben Statusleiste und Dynamic Island, unten den Home-Indicator mit rund 34
// Punkten. Ein fester Abstand nach unten liesse «Übernehmen» darunter geraten.
// Die übrigen Suiten laufen über jest.setup.ts mit Insets 0, der interessante
// Fall ist der andere, deshalb hier ein Provider mit echten Metriken.
test('das Modal hält beide Systemkanten frei', async () => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top: 59, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider>
        <Zeitraumfeld wert={LEER} onAendern={jest.fn()} heute={HEUTE} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  const flach = StyleSheet.flatten(screen.getByTestId('zeitraum-modal').props.style);
  expect(flach.paddingTop).toBe(59 + spacing.base);
  expect(flach.paddingBottom).toBe(34 + spacing.base);
});

test('auf einem Gerät ohne Systemkanten bleiben die gestalteten Abstände stehen', async () => {
  await wrap(<Zeitraumfeld wert={LEER} onAendern={jest.fn()} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  const flach = StyleSheet.flatten(screen.getByTestId('zeitraum-modal').props.style);
  expect(flach.paddingTop).toBe(spacing.l);
  expect(flach.paddingBottom).toBe(spacing.l);
});

test('zwei Tipps im Kalender und Übernehmen melden ISO-Werte nach oben', async () => {
  const onAendern = jest.fn();
  await wrap(<Zeitraumfeld wert={LEER} onAendern={onAendern} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText('5. August 2026'));
  await fireEvent.press(screen.getByLabelText('14. August 2026'));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
  expect(onAendern).toHaveBeenCalledWith({ start: '2026-08-05', end: '2026-08-14' });
});

test('Übernehmen bleibt bei halber Auswahl wirkungslos', async () => {
  const onAendern = jest.fn();
  await wrap(<Zeitraumfeld wert={LEER} onAendern={onAendern} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText('5. August 2026'));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
  expect(onAendern).not.toHaveBeenCalled();
});

test('Schliessen ohne Übernehmen lässt den alten Wert stehen', async () => {
  const onAendern = jest.fn();
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={onAendern} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, 1. August 2026 bis 14. August 2026'));
  await fireEvent.press(screen.getByLabelText('3. August 2026'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));
  expect(onAendern).not.toHaveBeenCalled();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('ein verworfener Entwurf ist beim naechsten Oeffnen weg', async () => {
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={jest.fn()} heute={HEUTE} />);
  const feld = 'Zeitraum, 1. August 2026 bis 14. August 2026';
  await fireEvent.press(screen.getByLabelText(feld));
  await fireEvent.press(screen.getByLabelText('3. August 2026'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));
  await fireEvent.press(screen.getByLabelText(feld));
  // Der 3. war nur im verworfenen Entwurf gewählt, das Sheet zeigt wieder den
  // übernommenen Zeitraum.
  expect(screen.getByLabelText('1. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('3. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('20. August 2026').props.accessibilityState.selected).toBe(false);
});

test('zeigt einen Fehler unter dem Feld', async () => {
  await wrap(
    <Zeitraumfeld wert={LEER} onAendern={jest.fn()} fehler="Trag den Zeitraum ein." heute={HEUTE} />
  );
  expect(screen.getByText('Trag den Zeitraum ein.')).toBeTruthy();
});
