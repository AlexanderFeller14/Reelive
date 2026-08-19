import { render } from '@testing-library/react-native';
import * as React from 'react';

// Final-Review Phase 5, Punkt 5 (Kleinigkeit): der Segmentvergleich, der die
// Tab-Bar auf der Player-Route abschaltet, war die einzige Zusicherung auf
// diesem Branch ohne eigenen (Mutations-)Test. `Tabs` (expo-router) wird
// hier komplett gemockt, das Ziel ist ausschliesslich, welche
// `tabBarStyle` `TabsLayout` an `screenOptions` übergibt. Ein echtes
// Rendering des Tab-Navigators bräuchte @react-navigation intern (Bottom-
// Tabs-Renderer, Icon-Layout, Safe-Area) und würde hier nur Rauschen
// erzeugen, ohne die eigentliche Zusicherung (welcher `display`-Wert für
// welche Route) schärfer zu machen.
let letzteScreenOptions: unknown;
let letzteScreenListeners: { tabPress?: (e: { preventDefault: () => void }) => void } | undefined;
const mockUseSegments = jest.fn(() => ['(tabs)'] as string[]);
jest.mock('expo-router', () => {
  function Tabs(props: { screenOptions: unknown; screenListeners?: unknown; children: React.ReactNode }) {
    letzteScreenOptions = props.screenOptions;
    letzteScreenListeners = props.screenListeners as typeof letzteScreenListeners;
    return null;
  }
  Tabs.Screen = () => null;
  return {
    Tabs,
    useSegments: () => mockUseSegments(),
  };
});

// Seit die Kino-Leiste am GEWÄHLTEN Tab hängt, sind die screenOptions eine
// Funktion der Route (der Renderer nimmt die Options des fokussierten Tabs).
// Dieser Helfer löst beides auf, Objekt wie Funktion, und macht die Tests
// von der Form unabhängig.
type GeleseneOptions = {
  tabBarStyle?: { display?: string; position?: string; backgroundColor?: string; borderTopWidth?: number };
  tabBarBackground?: unknown;
};
function optionenFuer(routeName: string): GeleseneOptions | undefined {
  if (typeof letzteScreenOptions === 'function') {
    return (letzteScreenOptions as (ctx: { route: { name: string } }) => GeleseneOptions)({
      route: { name: routeName },
    });
  }
  return letzteScreenOptions as GeleseneOptions | undefined;
}

import TabsLayout from '../_layout';
import * as aufnahmeSperre from '@/features/kamera/aufnahmeSperre';
import * as kinoBuehne from '@/features/kamera/kinoBuehne';

beforeEach(() => {
  letzteScreenOptions = undefined;
  letzteScreenListeners = undefined;
  mockUseSegments.mockReturnValue(['(tabs)']);
  aufnahmeSperre.sperren(false);
  kinoBuehne.setzen(false);
});

test('auf einer beliebigen Nicht-Player-Route bleibt die Tab-Bar sichtbar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap']);
  await render(<TabsLayout />);
  expect(optionenFuer('recap')?.tabBarStyle?.display).not.toBe('none');
});

// Der eigentliche Final-Review-Fund: der Recap-Player ist laut Spec §8.2
// "Vollbild", keine Tab-Bar darunter.
test('auf der Player-Route (recap/[id]/player) wird die Tab-Bar abgeschaltet', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'player']);
  await render(<TabsLayout />);
  expect(optionenFuer('recap')?.tabBarStyle?.display).toBe('none');
});

// Mutationsschutz: ein zu grosszügiger Vergleich (z.B. nur segments[1] ===
// 'recap', ohne die tieferen Segmente zu prüfen) würde JEDE Route innerhalb
// des Recap-Tabs verstecken, nicht nur den Player, dieser Test verlangt,
// dass ein anderer, häufig aufgerufener Screen im selben Tab (die
// Tages-Übersicht) die Tab-Bar behält.
test('eine andere Route im selben Tab (recap/[id]/uebersicht) behält die Tab-Bar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'uebersicht']);
  await render(<TabsLayout />);
  expect(optionenFuer('recap')?.tabBarStyle?.display).not.toBe('none');
});

// Task 11 (Phase 7): die Karte bekommt die Ausnahme des Players ausdrücklich
// NICHT. Spec §5.3 «Die Karte füllt den Screen» meint den fehlenden eigenen
// Kopf («Darüber liegen genau drei Dinge»), nicht die Navigation der App,
// derselbe Absatz stellt die Karte ausdrücklich neben den Player: «Der Screen
// ist hell, nicht Kino: er zeigt keine Medien im Vollbild, sondern ist ein
// Werkzeug zum Finden.» Und Spec §5.1 nennt sie «eine Sicht auf DIESEN Recap,
// kein eigener Bereich der App», genau das, was die stehende Tab-Bar zeigt.
//
// Der handfeste Teil: karte.tsx setzt seine untere Leiste («N Momente ohne
// Ort») auf `bottom: spacing.screen` und begründet den Wert dort damit, dass
// die Tab-Leiste NICHT zu dieser Fläche gehört. Ein `useUnterkante` gibt es im
// Projekt nicht (nur `useOberkante`), ohne Tab-Bar rutschte die Pille auf
// Geräten mit Home-Indikator in dessen Streifen.
//
// Dieser Test hält die Entscheidung fest, statt sie stumm zu lassen: wer sie
// umdreht, muss hier vorbei und die Unterkante der Karte mitnehmen.
test('die Karte (recap/[id]/karte) behält die Tab-Bar, sie ist kein Vollbild-Medienscreen', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'karte']);
  await render(<TabsLayout />);
  expect(optionenFuer('recap')?.tabBarStyle?.display).not.toBe('none');
});

// Gegenprobe in die andere Richtung: ein "player"-Segment ausserhalb von
// recap/[id]/ (z.B. läge zufällig ein gleichnamiges Segment in einem
// anderen Tab) darf die Tab-Bar NICHT abschalten, der Vergleich prüft alle
// drei Segmente gemeinsam, nicht nur das letzte.
test('ein "player"-Segment ausserhalb von recap/[id]/ schaltet die Tab-Bar NICHT ab', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'aufnehmen', 'player']);
  await render(<TabsLayout />);
  expect(optionenFuer('aufnehmen')?.tabBarStyle?.display).not.toBe('none');
});

// Der Kamera-Screen behält die Leiste: Er ist der Tab, von dem aus man in die
// anderen wechselt.
//
// Die Aufnahme-Vorschau braucht hier bewusst KEINE Ausnahme, obwohl auch sie
// ein Vollbild-Medienscreen ist. Sie liegt gar nicht mehr im Tab-Navigator,
// sondern daneben (app/vorschau.tsx). Eine Ausnahme an dieser Stelle wirkt
// erst, wenn der Navigator nach dem Routenwechsel neu rendert, und die Leiste
// blieb dadurch nach dem Auslösen noch sichtbar stehen, während die Vorschau
// schon da war. Die Begründung für den Umzug steht in guard.ts bei
// istFlaecheFuerAngemeldete().
test('der Kamera-Screen (aufnehmen) behält die Tab-Bar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'aufnehmen']);
  await render(<TabsLayout />);
  expect(optionenFuer('aufnehmen')?.tabBarStyle?.display).not.toBe('none');
});

// === Kino-Leiste über dem Sucher (Gerätefund 2026-08-18) ===
// Sucher und Vorschau zeichnen beide mit `cover`, aber in verschieden hohe
// Flächen: die Vorschau (Vollbild) zeigte ~10 % weniger Bildbreite als der
// Sucher (Vollbild minus Leiste) — «mehr gecropt als bevor ich auslöse».
// Zeigt der Kamera-Screen den Sucher (kinoBuehne), legt sich die Leiste
// deshalb ALS durchscheinende Fläche ÜBER das Kamerabild (position
// absolute), statt ihm Platz wegzunehmen: beide Flächen sind dann gleich
// gross, was man sieht, ist was man bekommt.
test('zeigt der Sucher (kinoBuehne), liegt die Leiste durchscheinend über dem Bild', async () => {
  kinoBuehne.setzen(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'aufnehmen']);
  await render(<TabsLayout />);
  const optionen = optionenFuer('aufnehmen');
  expect(optionen?.tabBarStyle?.position).toBe('absolute');
  expect(optionen?.tabBarStyle?.backgroundColor).toBe('transparent');
  expect(optionen?.tabBarStyle?.borderTopWidth).toBe(0);
  // Die Tönung+Blur kommt als eigener Hintergrund (Pille-Rezept, §1).
  expect(optionen?.tabBarBackground).toBeDefined();
});

test('ohne Sucher (helle Zustände des Tabs) bleibt die Leiste die normale helle', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'aufnehmen']);
  await render(<TabsLayout />);
  const optionen = optionenFuer('aufnehmen');
  expect(optionen?.tabBarStyle?.position).not.toBe('absolute');
  expect(optionen?.tabBarBackground).toBeUndefined();
});

// Der Instant-Rückweg aus der Vorschau (Nutzer-Entscheid 2026-08-18): die
// Vorschau überdeckt den Tab, dessen Blur-Cleanup das Sucher-Zeichen früher
// zurücknahm — die Leiste fiel unsichtbar in die helle Form und sprang beim
// Zurückkommen im ersten Frame sichtbar um. Die Kino-Form hängt deshalb am
// GEWÄHLTEN Tab (route.name), nicht am Fokus: solange aufnehmen der gewählte
// Tab ist, bleibt sie stehen, auch mit einer Vorschau darüber.
test('mit stehendem Sucher-Zeichen bleibt die Kino-Leiste, solange aufnehmen der gewählte Tab ist', async () => {
  kinoBuehne.setzen(true);
  // Fokus liegt auf der Vorschau (Root-Stack), nicht im Tab-Navigator.
  mockUseSegments.mockReturnValue(['vorschau']);
  await render(<TabsLayout />);
  expect(optionenFuer('aufnehmen')?.tabBarStyle?.position).toBe('absolute');
});

test('auf einem ANDEREN gewählten Tab gilt trotz Sucher-Zeichen die normale Leiste', async () => {
  kinoBuehne.setzen(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'reise']);
  await render(<TabsLayout />);
  const optionen = optionenFuer('reise');
  expect(optionen?.tabBarStyle?.position).not.toBe('absolute');
  expect(optionen?.tabBarBackground).toBeUndefined();
});

// Die Player-Ausnahme schlägt die Kino-Leiste: Vollbild heisst keine Leiste,
// auch wenn das Sucher-Zeichen (etwa durch eine liegen gebliebene Meldung)
// noch stünde.
test('auf der Player-Route bleibt die Leiste auch mit gesetztem Sucher-Zeichen abgeschaltet', async () => {
  kinoBuehne.setzen(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'player']);
  await render(<TabsLayout />);
  expect(optionenFuer('recap')?.tabBarStyle?.display).toBe('none');
});

// Während einer laufenden Aufnahme (Foto-Zyklus oder Video, der Kamera-Screen
// setzt die Sperre, siehe aufnehmen/__tests__/kamera.test.tsx) darf ein Tipp
// auf einen Tab NICHT wechseln: das Fokus-Cleanup feuerte sonst mitten in die
// laufende Session. Die Leiste bleibt stehen (kein display:'none': das nähme
// der Szene mitten in der Aufnahme die Höhe, der Sucher spränge) — der Tipp
// läuft per preventDefault ins Leere.
test('während einer laufenden Aufnahme läuft ein Tab-Tipp ins Leere', async () => {
  await render(<TabsLayout />);
  aufnahmeSperre.sperren(true);
  const ereignis = { preventDefault: jest.fn() };
  letzteScreenListeners?.tabPress?.(ereignis);
  expect(ereignis.preventDefault).toHaveBeenCalled();
});

// Gegenprobe: ohne Sperre bleibt der Tab-Wechsel unangetastet. Der Listener
// liest zum Ereignis-Zeitpunkt (kein Re-Render nötig), deshalb genügt es,
// die Sperre nach dem Rendern umzulegen.
test('ohne laufende Aufnahme wechselt der Tab-Tipp wie immer', async () => {
  await render(<TabsLayout />);
  const ereignis = { preventDefault: jest.fn() };
  letzteScreenListeners?.tabPress?.(ereignis);
  expect(ereignis.preventDefault).not.toHaveBeenCalled();
});
