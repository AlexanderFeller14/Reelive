import { render } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';

// Am Geraet gefunden (2026-08-11): ein Tippen auf den Recap-Tab oeffnete den
// Player statt der Liste. Sobald ein Stack ueberhaupt <Stack.Screen>-Kinder
// hat, legt deren Reihenfolge fest, welche Route zuerst registriert wird, und
// die erste ist die Startroute des Stacks. Hier stand `[id]/player` allein,
// also wurde der Player zur Startroute, und zwar ohne `id` im Pfad
// (`/recap/player`). `useLocalSearchParams` lieferte `undefined`, fetchTrip
// fragte die Datenbank nach der UUID «undefined» und bekam Postgres 22P02,
// der Screen zeigte einen Ladefehler statt der leeren Liste.
//
// Die 1316 Tests dieser Suite haben das nicht bemerkt, weil sie jeden Screen
// einzeln rendern und nie die Navigation dazwischen. Dieser Test prueft
// deshalb genau das, was ein Screen-Test nicht sehen kann: die Reihenfolge,
// in der das Layout seine Routen anmeldet.
//
// `Stack` wird komplett gemockt, wie in (tabs)/__tests__/_layout.test.tsx.
// Ein echtes Rendern braeuchte den Stack-Navigator von @react-navigation und
// wuerde die eigentliche Zusicherung (welche Route steht vorn) nur verrauschen.
let letzteKinder: React.ReactNode;
jest.mock('expo-router', () => {
  function Stack(props: { children?: React.ReactNode }) {
    letzteKinder = props.children;
    return null;
  }
  Stack.Screen = () => null;
  return { Stack };
});

import RecapStackLayout from '../_layout';

// Die Kommentar-Knoten im Layout zaehlen nicht mit, gefiltert wird auf das,
// was tatsaechlich eine Route anmeldet: ein Element mit `name`.
function routenNamen(): string[] {
  return React.Children.toArray(letzteKinder)
    .filter(
      (k): k is React.ReactElement<{ name: string }> =>
        React.isValidElement(k) && typeof (k.props as { name?: unknown }).name === 'string'
    )
    .map((k) => k.props.name);
}

beforeEach(() => {
  letzteKinder = undefined;
});

const rendern = async () => {
  await render(
    <ThemeProvider>
      <RecapStackLayout />
    </ThemeProvider>
  );
};

test('der Recap-Stack meldet die Liste als erste Route an, nicht den Player', async () => {
  await rendern();
  expect(routenNamen()[0]).toBe('index');
});

// Der eigentliche Fund, als Zusicherung formuliert: der Player darf nie
// vorne stehen. Ohne diesen Test faellt ein spaeteres Umsortieren der Kinder
// wieder in denselben Fehler, und zwar unbemerkt bis zum naechsten
// Geraetetest.
test('der Player steht nicht an erster Stelle', async () => {
  await rendern();
  expect(routenNamen()[0]).not.toBe('[id]/player');
});

// Der Player braucht seine eigenen Optionen (Fade durch Dunkel, Kino-Grund,
// DESIGN-LANGUAGE §5), er muss also deklariert BLEIBEN. Wer den Bug oben
// dadurch «loest», dass er das Kind einfach loescht, nimmt dem Wechsel in den
// Saal seine Inszenierung.
test('der Player bleibt mit eigenen Optionen deklariert', async () => {
  await rendern();
  expect(routenNamen()).toContain('[id]/player');
});
