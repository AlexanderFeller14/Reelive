import { useLayoutEffect, createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { motion, palette } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';
import type {
  Ausschnitt,
  Gruppe,
  KartenFlaecheHandle,
  KartenFlaecheProps,
  KartenPunkt,
} from '@/features/karte/typen';

// Geprüft wird die NATIVE Fassung: jest löst `.tsx` auf (die Plattformen des
// Testlaufs sind ios/android/native), `.web.tsx` kommt hier nie zum Zug. Das
// ist Absicht — hier steht der VERTRAG, nicht Leaflet. Die Browser-Fassung
// erfüllt denselben Vertrag mit eigener Technik und hat ihre eigene Testdatei
// (KartenFlaeche.web.test.tsx).

// Eigener react-native-maps-Mock statt des globalen aus jest.setup.ts, aus
// denselben zwei Gründen wie in recap/__tests__/karte.test.tsx: der globale
// baut sein imperatives Handle bei jedem Rendern neu und gibt es nicht nach
// aussen, und der Tipp jeder Nadel muss sich MERKEN lassen — der letzte Test
// unten tippt zwischen Commit und passivem Effekt, was über `fireEvent` nicht
// geht, weil dessen `act()` beides zusammen abspielt.
const mockAnimateToRegion = jest.fn();
const mockSetRegion = jest.fn();
const mockPressen = new Map<string, () => void>();
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Karte = ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({
      animateToRegion: mockAnimateToRegion,
      setRegion: mockSetRegion,
      fitToCoordinates: jest.fn(),
    }));
    return ReactActual.createElement(View, props, props.children);
  });
  return {
    __esModule: true,
    default: Karte,
    Marker: (props: Record<string, unknown>) => {
      if (typeof props.onPress === 'function') {
        mockPressen.set(String(props.testID), props.onPress as () => void);
      }
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});
// expo-image ist ein natives View — im Test reicht ein Platzhalter, der alle
// Props durchreicht. Gleiches Muster wie in karte.test.tsx; ohne den Mock
// scheitert schon das Laden des Moduls, seit die Nadel ein Bild trägt.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { KartenFlaeche } from '../KartenFlaeche';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', autor_name: 'Lea',
    ...overrides,
  };
}

function punkt(id: string, lat: number, lng: number, index: number): KartenPunkt {
  return { moment: moment({ id, lat, lng }), lat, lng, index };
}

const pA = punkt('p1', 38.71, -9.14, 0);
const pB = punkt('p2', 38.72, -9.13, 1);
const gruppeA: Gruppe = { anker: pA, punkte: [pA] };
const gruppeB: Gruppe = { anker: pB, punkte: [pB] };
// Beide Momente auf EXAKT derselben Koordinate: die eine Gruppe, die keine
// Zoomstufe trennt (features/karte/gruppierung.ts, `aufEinemFleck`).
const pAufFleck = punkt('p3', 38.71, -9.14, 2);
const aufEinemFleck: Gruppe = { anker: pA, punkte: [pA, pAufFleck] };
// Zwei verschiedene Koordinaten: eine Gruppe, die sich aufzoomen lässt.
const auseinander: Gruppe = { anker: pA, punkte: [pA, pB] };

const AUSSCHNITT: Ausschnitt = {
  latitude: 38.715, longitude: -9.135, latitudeDelta: 0.02, longitudeDelta: 0.02,
};

const basis: KartenFlaecheProps = {
  initialerAusschnitt: AUSSCHNITT,
  gruppen: [],
  linie: [],
  thumbFuer: () => null,
  aufGruppe: () => {},
  aufAusschnitt: () => {},
  reducedMotion: false,
};

function wrap(props: Partial<KartenFlaecheProps> = {}, ref?: React.Ref<KartenFlaecheHandle>) {
  return render(
    <ThemeProvider>
      <KartenFlaeche ref={ref} {...basis} {...props} />
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPressen.clear();
});

// ---------------------------------------------------------------------------
// Nadeln
// ---------------------------------------------------------------------------

test('setzt eine Nadel je Gruppe', async () => {
  await wrap({ gruppen: [gruppeA, gruppeB] });
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(2);
});

// Die Nadel steht auf dem ANKER der Gruppe, nicht auf einem Mittelwert: der
// Anker ist ein echter Moment mit echter Koordinate (gruppierung.ts).
test('die Nadel sitzt auf der Koordinate des Ankers', async () => {
  await wrap({ gruppen: [auseinander] });
  expect(screen.getByTestId('karte-nadel-p1').props.coordinate).toEqual({
    latitude: 38.71, longitude: -9.14,
  });
});

test('die Nadel einer Gruppe zeigt deren Anzahl', async () => {
  await wrap({ gruppen: [auseinander] });
  expect(screen.getByText('2')).toBeTruthy();
});

// `thumbFuer` wird für den ANKER gefragt — die Nadel trägt sein Bild, nicht
// das irgendeines Mitglieds.
test('die Nadel traegt das Bild ihres Ankers', async () => {
  const thumbFuer = jest.fn((postId: string) => `https://cdn.example/${postId}.jpg`);
  await wrap({ gruppen: [auseinander], thumbFuer });
  expect(thumbFuer).toHaveBeenCalledWith('p1');
  expect(screen.getByTestId('nadel-bild').props.source.uri).toBe('https://cdn.example/p1.jpg');
});

// Die Beschriftung muss dieselbe Weiche kennen wie der Tipp: eine Gruppe auf
// einem Fleck öffnet ein Sheet, eine aufzoombare zoomt. Verspricht das Label
// das Falsche, bekommt es ausgerechnet der zu hören, der nur das Label hat.
test('die Nadel einer Gruppe auf einem Fleck kuendigt das Ansehen an', async () => {
  await wrap({ gruppen: [aufEinemFleck] });
  expect(screen.getByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
});

test('die Nadel einer aufzoombaren Gruppe kuendigt den Zoom an', async () => {
  await wrap({ gruppen: [auseinander] });
  expect(screen.getByLabelText('Auf 2 Momente heranzoomen')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Was die Fläche nach oben meldet
// ---------------------------------------------------------------------------

test('meldet den Tipp auf eine Gruppe nach oben', async () => {
  const aufGruppe = jest.fn();
  await wrap({ gruppen: [gruppeA], aufGruppe });
  await fireEvent.press(screen.getByTestId(`karte-nadel-${gruppeA.anker.moment.id}`));
  expect(aufGruppe).toHaveBeenCalledWith(gruppeA);
});

// Nicht bloss «irgendeine Gruppe»: gemeldet wird die, zu der die getippte
// Nadel gehört. Bei zwei Nadeln fiele eine Verwechslung sonst nicht auf.
test('meldet die Gruppe, deren Nadel getippt wurde', async () => {
  const aufGruppe = jest.fn();
  await wrap({ gruppen: [gruppeA, gruppeB], aufGruppe });
  await fireEvent.press(screen.getByTestId('karte-nadel-p2'));
  expect(aufGruppe).toHaveBeenCalledTimes(1);
  expect(aufGruppe).toHaveBeenCalledWith(gruppeB);
});

// Der Screen gruppiert nach Abständen in BILDSCHIRMpunkten und braucht dafür
// den Ausschnitt, den die Karte gerade zeigt — nicht den, mit dem sie öffnete.
test('meldet den sichtbaren Ausschnitt nach jeder Kartenbewegung', async () => {
  const aufAusschnitt = jest.fn();
  await wrap({ gruppen: [gruppeA], aufAusschnitt });
  const eng = { latitude: 38.71, longitude: -9.14, latitudeDelta: 0.002, longitudeDelta: 0.002 };
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', eng);
  expect(aufAusschnitt).toHaveBeenCalledWith(eng);
});

test('oeffnet mit dem uebergebenen Ausschnitt', async () => {
  await wrap({ gruppen: [gruppeA] });
  expect(screen.getByTestId('karte-flaeche').props.initialRegion).toEqual(AUSSCHNITT);
});

// ---------------------------------------------------------------------------
// Die Linie
// ---------------------------------------------------------------------------

test('zeichnet die Linie in der uebergebenen Reihenfolge', async () => {
  const linie = [
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ];
  await wrap({ gruppen: [gruppeA, gruppeB], linie });
  expect(screen.getByTestId('karte-linie').props.coordinates).toEqual(linie);
});

test('die Linie ist der Akzent in Breite 3', async () => {
  const linie = [
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ];
  await wrap({ linie });
  expect(screen.getByTestId('karte-linie').props.strokeColor).toBe(palette.accent);
  expect(screen.getByTestId('karte-linie').props.strokeWidth).toBe(3);
});

// Eine Linie braucht zwei Punkte — sonst stünde ein Overlay auf der Karte,
// das nichts verbindet.
test('ein einzelner Punkt ergibt keine Linie', async () => {
  await wrap({ gruppen: [gruppeA], linie: [{ latitude: 38.71, longitude: -9.14 }] });
  expect(screen.queryByTestId('karte-linie')).toBeNull();
});

// ---------------------------------------------------------------------------
// Die Kamera
// ---------------------------------------------------------------------------

const ZIEL: Ausschnitt = {
  latitude: 38.71, longitude: -9.14, latitudeDelta: 0.004, longitudeDelta: 0.004,
};

test('zeige() faehrt die Karte auf das Ziel', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  await wrap({ gruppen: [gruppeA] }, handle);
  handle.current?.zeige(ZIEL);
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  expect(mockAnimateToRegion).toHaveBeenCalledWith(ZIEL, motion.duration.base);
});

// DESIGN-LANGUAGE §5 / Spec K12: mit Reduced Motion wird gesprungen statt
// gefahren. `setRegion` ist der Sprung.
test('mit Reduced Motion springt zeige(), statt zu fahren', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  await wrap({ gruppen: [gruppeA], reducedMotion: true }, handle);
  handle.current?.zeige(ZIEL);
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).toHaveBeenCalledTimes(1);
});

// «Springt» allein ist keine Zusicherung: ein Sprung nach 0/0 wäre auch einer.
// Der Sprung muss dasselbe Ziel treffen wie die Fahrt.
test('der Sprung trifft dasselbe Ziel wie die Fahrt', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  await wrap({ gruppen: [gruppeA], reducedMotion: true }, handle);
  handle.current?.zeige(ZIEL);
  expect(mockSetRegion).toHaveBeenCalledWith(ZIEL);
});

// Die Fläche bewegt ihre Kamera NUR auf Zuruf. Ein Nachziehen an den
// `initialerAusschnitt`-Prop führte der eigenen Meldung hinterher: jede
// Bewegung meldet einen neuen Ausschnitt nach oben, der von dort zurückkäme —
// und die Karte führe endlos hinter sich her. Genau deshalb heisst der Prop
// so, wie er heisst.
test('ein neuer Ausschnitt-Prop bewegt die Kamera nicht von selbst', async () => {
  const { rerender } = await wrap({ gruppen: [gruppeA] });
  await rerender(
    <ThemeProvider>
      <KartenFlaeche {...basis} gruppen={[gruppeA]} initialerAusschnitt={ZIEL} />
    </ThemeProvider>
  );
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
});

// Ein `zeige` aus dem Layout-Effekt des Aufrufers, unmittelbar nach dem
// Mounten. Genau so wird der geteilte Player (Task 15) die Fläche benutzen: er
// springt beim Öffnen auf den Moment aus dem Link, ohne auf eine Nutzeraktion
// zu warten.
//
// Nativ ist das Ref des MapView bereits im Commit gesetzt, der Befehl kommt
// also durch. Die Browser-Fassung baut ihre Karte in einem PASSIVEN Effekt auf
// und verschluckte den Befehl ohne Vorkehrung — dieselbe Zusicherung steht
// deshalb wortgleich in KartenFlaeche.web.test.tsx.
function FruehesZiel({ handle }: { handle: React.RefObject<KartenFlaecheHandle | null> }) {
  useLayoutEffect(() => {
    handle.current?.zeige(ZIEL);
  }, [handle]);
  return null;
}

test('ein zeige() aus dem Layout-Effekt des Aufrufers geht nicht verloren', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  await render(
    <ThemeProvider>
      <KartenFlaeche {...basis} gruppen={[gruppeA]} ref={handle} />
      <FruehesZiel handle={handle} />
    </ThemeProvider>
  );
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  expect(mockAnimateToRegion).toHaveBeenCalledWith(ZIEL, motion.duration.base);
});

// ---------------------------------------------------------------------------
// Der Tipp direkt nach einer Kamerafahrt
// ---------------------------------------------------------------------------
//
// Die Fläche merkt sich den Gruppen-Stand für den nächsten Tipp in einem Ref.
// Geschrieben wird es in einem LAYOUT-Effekt, nicht in einem passiven: ein
// passiver läuft erst nach dem Commit, und in dem Fenster dazwischen liest ein
// Tipp noch den alten Stand. Genau das passiert nach einer Kamerafahrt — die
// Gruppe ist zerfallen, die neue Nadel steht schon da, und wer sie sofort
// antippt, wird im alten Stand nicht gefunden.
//
// `fireEvent` trifft das Fenster nicht, weil sein `act()` Render und Effekte
// zusammen abspielt. Es existiert aber in der Reihenfolge der Layout-Effekte:
// React spielt sie in Baumreihenfolge ab, Geschwister von links nach rechts,
// und ALLE vor dem ersten passiven Effekt. Ein Nachbar RECHTS der Fläche, der
// selbst in einem Layout-Effekt tippt, trifft damit exakt den Augenblick, in
// dem die Fläche committet hat und ihr passiver Effekt noch aussteht.
function Stichler({ runde, nadel }: { runde: number; nadel: string }) {
  useLayoutEffect(() => {
    // Beim ersten Rendern gibt es die neue Nadel noch gar nicht.
    if (runde === 0) return;
    mockPressen.get(nadel)?.();
  }, [runde, nadel]);
  return null;
}

test('ein Tipp unmittelbar nach dem Zerfall einer Gruppe wird nicht verschluckt', async () => {
  const aufGruppe = jest.fn();
  const baum = (runde: number, gruppen: Gruppe[]) => (
    <ThemeProvider>
      <KartenFlaeche {...basis} gruppen={gruppen} aufGruppe={aufGruppe} />
      <Stichler runde={runde} nadel="karte-nadel-p2" />
    </ThemeProvider>
  );
  // Vorbedingung: p2 ist Mitglied der Gruppe um p1, hat also keine eigene
  // Nadel — der Tipp unten gilt einer, die es beim Rendern davor nicht gab.
  const { rerender } = await render(baum(0, [auseinander]));
  expect(screen.queryByTestId('karte-nadel-p2')).toBeNull();

  await rerender(baum(1, [gruppeA, gruppeB]));

  expect(aufGruppe).toHaveBeenCalledTimes(1);
  expect(aufGruppe).toHaveBeenCalledWith(gruppeB);
});

// Und die Kehrseite desselben Refs: weil der Gruppen-Stand NICHT in den
// Abhängigkeiten des Tipp-Handlers steht, bekommt keine Nadel bei einer
// Kartenbewegung ein neues `onPress`. Sonst wäre das `memo` am Marker
// (KartenNadel.tsx) wirkungslos und jede Nadel schickte ihre Koordinate erneut
// über die Brücke, obwohl sich an ihr nichts geändert hat.
test('neue Gruppen geben den Nadeln kein neues onPress', async () => {
  const aufGruppe = jest.fn();
  const { rerender } = await wrap({ gruppen: [gruppeA], aufGruppe });
  const vorher = screen.getByTestId('karte-nadel-p1').props.onPress;

  // Ein neues Array mit demselben Inhalt: genau das, was jede Kartenbewegung
  // erzeugt (der Screen gruppiert bei jedem gemeldeten Ausschnitt neu).
  await rerender(
    <ThemeProvider>
      <KartenFlaeche {...basis} gruppen={[gruppeA]} aufGruppe={aufGruppe} />
    </ThemeProvider>
  );
  expect(screen.getByTestId('karte-nadel-p1').props.onPress).toBe(vorher);
});
