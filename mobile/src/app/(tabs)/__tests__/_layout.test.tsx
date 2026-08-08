import { render } from '@testing-library/react-native';
import * as React from 'react';

// Final-Review Phase 5, Punkt 5 (Kleinigkeit): der Segmentvergleich, der die
// Tab-Bar auf der Player-Route abschaltet, war die einzige Zusicherung auf
// diesem Branch ohne eigenen (Mutations-)Test. `Tabs` (expo-router) wird
// hier komplett gemockt — das Ziel ist ausschliesslich, welche
// `tabBarStyle` `TabsLayout` an `screenOptions` übergibt. Ein echtes
// Rendering des Tab-Navigators bräuchte @react-navigation intern (Bottom-
// Tabs-Renderer, Icon-Layout, Safe-Area) und würde hier nur Rauschen
// erzeugen, ohne die eigentliche Zusicherung (welcher `display`-Wert für
// welche Route) schärfer zu machen.
let letzteScreenOptions: { tabBarStyle?: { display?: string } } | undefined;
const mockUseSegments = jest.fn(() => ['(tabs)'] as string[]);
jest.mock('expo-router', () => {
  function Tabs(props: { screenOptions: unknown; children: React.ReactNode }) {
    letzteScreenOptions = props.screenOptions as typeof letzteScreenOptions;
    return null;
  }
  Tabs.Screen = () => null;
  return {
    Tabs,
    useSegments: () => mockUseSegments(),
  };
});

import TabsLayout from '../_layout';

beforeEach(() => {
  letzteScreenOptions = undefined;
  mockUseSegments.mockReturnValue(['(tabs)']);
});

test('auf einer beliebigen Nicht-Player-Route bleibt die Tab-Bar sichtbar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap']);
  await render(<TabsLayout />);
  expect(letzteScreenOptions?.tabBarStyle?.display).not.toBe('none');
});

// Der eigentliche Final-Review-Fund: der Recap-Player ist laut Spec §8.2
// "Vollbild" — keine Tab-Bar darunter.
test('auf der Player-Route (recap/[id]/player) wird die Tab-Bar abgeschaltet', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'player']);
  await render(<TabsLayout />);
  expect(letzteScreenOptions?.tabBarStyle?.display).toBe('none');
});

// Mutationsschutz: ein zu grosszügiger Vergleich (z.B. nur segments[1] ===
// 'recap', ohne die tieferen Segmente zu prüfen) würde JEDE Route innerhalb
// des Recap-Tabs verstecken, nicht nur den Player — dieser Test verlangt,
// dass ein anderer, häufig aufgerufener Screen im selben Tab (die
// Tages-Übersicht) die Tab-Bar behält.
test('eine andere Route im selben Tab (recap/[id]/uebersicht) behält die Tab-Bar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'uebersicht']);
  await render(<TabsLayout />);
  expect(letzteScreenOptions?.tabBarStyle?.display).not.toBe('none');
});

// Gegenprobe in die andere Richtung: ein "player"-Segment ausserhalb von
// recap/[id]/ (z.B. läge zufällig ein gleichnamiges Segment in einem
// anderen Tab) darf die Tab-Bar NICHT abschalten — der Vergleich prüft alle
// drei Segmente gemeinsam, nicht nur das letzte.
test('ein "player"-Segment ausserhalb von recap/[id]/ schaltet die Tab-Bar NICHT ab', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'aufnehmen', 'player']);
  await render(<TabsLayout />);
  expect(letzteScreenOptions?.tabBarStyle?.display).not.toBe('none');
});
