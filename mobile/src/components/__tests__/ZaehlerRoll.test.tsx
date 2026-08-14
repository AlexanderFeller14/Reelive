import { render } from '@testing-library/react-native';
import * as React from 'react';
import { Animated } from 'react-native';
import { ZaehlerRoll } from '../ZaehlerRoll';

// Der Digit-Roll (DESIGN-LANGUAGE §5: «Zähler = Digit-Roll») lebt davon, dass
// alte und neue Ziffer GLEICHZEITIG im Baum stehen: die alte schiebt nach
// oben hinaus, die neue kommt von unten herein, beide über denselben
// `fortschritt`. Was hier NICHT getestet wird: die Interpolations-Optik
// selbst, die sieht nur ein Gerät (gleiche Grenze wie Versiegelung.test.tsx).

function inszenierung() {
  return new Animated.Value(0);
}

test('alte und neue Ziffer stehen gleichzeitig im Baum', async () => {
  const { getByText } = await render(
    <ZaehlerRoll von={7} nach={8} fortschritt={inszenierung()} fenster={[0.7, 0.95]} />
  );
  expect(getByText('7')).toBeTruthy();
  expect(getByText('8')).toBeTruthy();
});

test('unveränderte Ziffern stehen fest, nur die veränderte rollt', async () => {
  const { getByTestId, queryByTestId } = await render(
    <ZaehlerRoll von={12} nach={13} fortschritt={inszenierung()} fenster={[0.7, 0.95]} />
  );
  // Die Zehnerstelle «1» ändert sich nicht: ein fester Text, kein Roll-Paar.
  expect(getByTestId('zaehler-ziffer-fest-0').props.children).toBe('1');
  expect(queryByTestId('zaehler-ziffer-alt-0')).toBeNull();
  // Die Einerstelle rollt: 2 hinaus, 3 herein.
  expect(getByTestId('zaehler-ziffer-alt-1').props.children).toBe('2');
  expect(getByTestId('zaehler-ziffer-neu-1').props.children).toBe('3');
});

test('beim Stellenwechsel 9 → 10 rollt die neue Zehnerstelle ohne altes Pendant herein', async () => {
  const { getByTestId, queryByTestId } = await render(
    <ZaehlerRoll von={9} nach={10} fortschritt={inszenierung()} fenster={[0.7, 0.95]} />
  );
  // Vorher gab es keine Zehnerstelle: kein altes Zeichen, erst recht kein
  // gerendertes Leerzeichen, die «1» rollt allein herein.
  expect(queryByTestId('zaehler-ziffer-alt-0')).toBeNull();
  expect(queryByTestId('zaehler-ziffer-fest-0')).toBeNull();
  expect(getByTestId('zaehler-ziffer-neu-0').props.children).toBe('1');
  // Die Einerstelle rollt normal: 9 hinaus, 0 herein.
  expect(getByTestId('zaehler-ziffer-alt-1').props.children).toBe('9');
  expect(getByTestId('zaehler-ziffer-neu-1').props.children).toBe('0');
});
