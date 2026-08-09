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

// Task 11 (Phase 7): die Karte bekommt die Ausnahme des Players ausdrücklich
// NICHT. Spec §5.3 «Die Karte füllt den Screen» meint den fehlenden eigenen
// Kopf («Darüber liegen genau drei Dinge»), nicht die Navigation der App —
// derselbe Absatz stellt die Karte ausdrücklich neben den Player: «Der Screen
// ist hell, nicht Kino: er zeigt keine Medien im Vollbild, sondern ist ein
// Werkzeug zum Finden.» Und Spec §5.1 nennt sie «eine Sicht auf DIESEN Recap,
// kein eigener Bereich der App» — genau das, was die stehende Tab-Bar zeigt.
//
// Der handfeste Teil: karte.tsx setzt seine untere Leiste («N Momente ohne
// Ort») auf `bottom: spacing.screen` und begründet den Wert dort damit, dass
// die Tab-Leiste NICHT zu dieser Fläche gehört. Ein `useUnterkante` gibt es im
// Projekt nicht (nur `useOberkante`) — ohne Tab-Bar rutschte die Pille auf
// Geräten mit Home-Indikator in dessen Streifen.
//
// Dieser Test hält die Entscheidung fest, statt sie stumm zu lassen: wer sie
// umdreht, muss hier vorbei und die Unterkante der Karte mitnehmen.
test('die Karte (recap/[id]/karte) behält die Tab-Bar — sie ist kein Vollbild-Medienscreen', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'karte']);
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
