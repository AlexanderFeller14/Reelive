import { Text, View } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PressScale } from '@/components/PressScale';
import { useReiseGebunden } from '../useReiseGebunden';

// Ein Screen, wie es ihn unter `[id]` gibt: die Reise kommt als Prop, der
// Screen bleibt bei ihrem Wechsel gemountet.
function Screen({ tripId }: { tripId: string }) {
  const [offen, setOffen] = useReiseGebunden<string | null>(tripId, null);
  const [zaehler, setZaehler] = useReiseGebunden(tripId, 0);
  return (
    <View>
      <Text testID="offen">{offen ?? 'nichts'}</Text>
      <Text testID="zaehler">{String(zaehler)}</Text>
      <PressScale testID="oeffnen" onPress={() => setOffen(`sheet-${tripId}`)}>
        <Text>öffnen</Text>
      </PressScale>
      <PressScale testID="zaehlen" onPress={() => setZaehler(zaehler + 1)}>
        <Text>zählen</Text>
      </PressScale>
    </View>
  );
}

async function zeige(tripId: string) {
  return render(<Screen tripId={tripId} />);
}

test('ein gesetzter Wert bleibt, solange die Reise dieselbe ist', async () => {
  const { rerender } = await zeige('t1');
  await fireEvent.press(screen.getByTestId('oeffnen'));
  expect(screen.getByTestId('offen')).toHaveTextContent('sheet-t1');

  await rerender(<Screen tripId="t1" />);
  expect(screen.getByTestId('offen')).toHaveTextContent('sheet-t1');
});

// Der Fehler, um den es geht: der Screen bleibt gemountet, nur der Parameter
// wechselt. Ohne diesen Hook stand das Sheet der vorherigen Reise weiter da.
test('ein Wechsel der Reise verwirft den Wert', async () => {
  const { rerender } = await zeige('t1');
  await fireEvent.press(screen.getByTestId('oeffnen'));
  expect(screen.getByTestId('offen')).toHaveTextContent('sheet-t1');

  await rerender(<Screen tripId="t2" />);
  expect(screen.getByTestId('offen')).toHaveTextContent('nichts');
});

// Der Weg, auf dem das Verstecken (Wert stehen lassen, beim Ableiten
// vergleichen) scheitert: bei t1 → t2 → t1 passt die id wieder, und ein Sheet
// öffnete sich von selbst, das niemand angetippt hat, mit einem Index aus dem
// früheren Ladevorgang.
test('auch der Rueckweg zur ersten Reise bringt den Wert NICHT zurueck', async () => {
  const { rerender } = await zeige('t1');
  await fireEvent.press(screen.getByTestId('oeffnen'));

  await rerender(<Screen tripId="t2" />);
  await rerender(<Screen tripId="t1" />);
  expect(screen.getByTestId('offen')).toHaveTextContent('nichts');
});

test('jeder Zustand desselben Screens wird einzeln zurueckgesetzt', async () => {
  const { rerender } = await zeige('t1');
  await fireEvent.press(screen.getByTestId('oeffnen'));
  await fireEvent.press(screen.getByTestId('zaehlen'));
  expect(screen.getByTestId('zaehler')).toHaveTextContent('1');

  await rerender(<Screen tripId="t2" />);
  expect(screen.getByTestId('offen')).toHaveTextContent('nichts');
  expect(screen.getByTestId('zaehler')).toHaveTextContent('0');
});

// In der neuen Reise soll er sich normal benutzen lassen. Ein Hook, der nach
// dem Wechsel nichts mehr annimmt, wäre schlimmer als das Problem.
test('nach dem Wechsel laesst sich in der neuen Reise wieder setzen', async () => {
  const { rerender } = await zeige('t1');
  await fireEvent.press(screen.getByTestId('oeffnen'));
  await rerender(<Screen tripId="t2" />);

  await fireEvent.press(screen.getByTestId('oeffnen'));
  expect(screen.getByTestId('offen')).toHaveTextContent('sheet-t2');
});

// Zurueckgesetzt wird BEIM RENDERN, nicht in einem Effekt. Der Unterschied ist
// genau ein Frame, und in dem waere das fremde Sheet zu sehen. Geprueft wird
// er daran, dass der Wert schon im ERSTEN Durchlauf nach dem Wechsel der
// Anfangswert ist: die Testbibliothek laesst Effekte innerhalb von `rerender`
// laufen, ein Effekt-Reset waere hier also ebenfalls unsichtbar. Deshalb
// zaehlt dieser Test mit, was der Screen WAEHREND des Renderns gesehen hat.
test('der Anfangswert gilt bereits im Durchlauf des Wechsels, nicht erst danach', async () => {
  const gesehen: (string | null)[] = [];
  function Mitschrift({ tripId }: { tripId: string }) {
    const [offen, setOffen] = useReiseGebunden<string | null>(tripId, null);
    gesehen.push(offen);
    return (
      <PressScale testID="oeffnen" onPress={() => setOffen(`sheet-${tripId}`)}>
        <Text>{offen ?? 'nichts'}</Text>
      </PressScale>
    );
  }
  const { rerender } = await render(<Mitschrift tripId="t1" />);
  await fireEvent.press(screen.getByTestId('oeffnen'));
  gesehen.length = 0;

  await rerender(<Mitschrift tripId="t2" />);
  // KEIN Durchlauf hat den Wert der vorherigen Reise unter der neuen id
  // gesehen, auch nicht der erste.
  expect(gesehen).not.toContain('sheet-t1');
  expect(gesehen.length).toBeGreaterThan(0);
});
