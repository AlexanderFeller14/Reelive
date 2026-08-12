import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { spacing } from '../tokens';
import { useOberkante, useUnterkante } from '../useOberkante';

// Die übrigen Suiten laufen über jest.setup.ts mit Insets 0, also auf einem
// Gerät ohne Dynamic Island. Der interessante Fall ist der andere, und den
// prüft diese Datei, indem sie dem Provider echte Metriken mitgibt.
function Anzeige({ basis }: { basis: number }) {
  return <Text testID="wert">{String(useOberkante(basis))}</Text>;
}

const mitInsets = async (top: number, basis: number) => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Anzeige basis={basis} />
    </SafeAreaProvider>
  );
  return Number(screen.getByTestId('wert').props.children);
};

test('ohne Inset bleibt der gestaltete Abstand unverändert', async () => {
  expect(await mitInsets(0, spacing.xxl)).toBe(spacing.xxl);
});

// 20 pt Statusleiste (iPhone SE): 20 + 16 = 36, weniger als die gestalteten
// 48, der Screen sieht aus wie entworfen.
test('eine schmale Statusleiste ändert nichts', async () => {
  expect(await mitInsets(20, spacing.xxl)).toBe(spacing.xxl);
});

// 59 pt Dynamic Island (iPhone 17 Pro): 59 + 16 = 75 > 48. Genau hier klebte
// «Schritt 1 von 2» vorher an der Uhr.
test('unter der Dynamic Island weicht der Inhalt aus', async () => {
  expect(await mitInsets(59, spacing.xxl)).toBe(59 + spacing.base);
});

// Der kleinere Basiswert der Listen-Screens rutscht schon früher unter das
// Inset, auch dort darf nichts hinter die Uhr geraten.
test('der kleinere Listen-Abstand weicht früher aus', async () => {
  expect(await mitInsets(47, spacing.xl)).toBe(47 + spacing.base);
});

// ——— useUnterkante ———

function UntenAnzeige({ basis }: { basis: number }) {
  return <Text testID="wert">{String(useUnterkante(basis))}</Text>;
}

const mitUnterInset = async (bottom: number, basis: number) => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top: 59, left: 0, right: 0, bottom },
      }}
    >
      <UntenAnzeige basis={basis} />
    </SafeAreaProvider>
  );
  return Number(screen.getByTestId('wert').props.children);
};

// Geräte mit Home-Knopf und der Web-Export melden unten 0, dort bleibt der
// gestaltete Abstand exakt so, wie er entworfen wurde.
test('ohne unteres Inset bleibt der gestaltete Abstand unverändert', async () => {
  expect(await mitUnterInset(0, spacing.xl)).toBe(spacing.xl);
});

// 34 pt Home-Indicator: 34 + 16 = 50 > 32. Genau hier lag die Reaktionsreihe
// des Players vorher auf dem Indikator.
test('über dem Home-Indicator weicht der Inhalt aus', async () => {
  expect(await mitUnterInset(34, spacing.xl)).toBe(34 + spacing.base);
});

// Gegenprobe zur Oberkante: die beiden Hooks lesen verschiedene Kanten und
// dürfen sich nicht vertauschen. Mit top 59 und bottom 0 muss die Unterkante
// beim gestalteten Wert bleiben, obwohl oben reichlich Inset anliegt.
test('die Unterkante liest nicht versehentlich das obere Inset', async () => {
  expect(await mitUnterInset(0, spacing.xl)).toBe(spacing.xl);
});
