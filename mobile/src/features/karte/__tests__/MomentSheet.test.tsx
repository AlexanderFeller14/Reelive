import { readFileSync } from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { RecapMoment } from '@/features/recap/types';
import type { KartenPunkt } from '@/features/karte/typen';
import {
  brauchbareUrl,
  GruppenSheetInhalt,
  MomentSheetInhalt,
  nadelBild,
  sheetBild,
  type BildQuelle,
  type SheetForm,
} from '../MomentSheet';

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie in recap/__tests__/karte.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

const FORM: SheetForm = { knopfLabel: 'Im Recap ansehen', praefix: '' };
const TEILEN_FORM: SheetForm = { knopfLabel: 'Ab hier ansehen', praefix: 'teilen-' };

function moment(ueber: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'm1',
    trip_id: 't1',
    author_id: 'a1',
    type: 'photo',
    duration_s: null,
    caption: null,
    captured_at: '2026-05-08T12:32:00+00:00',
    captured_tz: 'Europe/Lisbon',
    place_name: null,
    lat: 38.7,
    lng: -9.1,
    upload_status: 'uploaded',
    autor_name: 'Mira',
    ...ueber,
  };
}

function punkt(ueber: Partial<RecapMoment> = {}, index = 0): KartenPunkt {
  const m = moment(ueber);
  return { moment: m, lat: m.lat as number, lng: m.lng as number, index };
}

function mitUrls(eintraege: Record<string, BildQuelle>): ReadonlyMap<string, BildQuelle> {
  return new Map(Object.entries(eintraege));
}

describe('welches Bild eine Nadel und welches ein Sheet bekommt', () => {
  // Die beiden Funktionen sehen sich zum Verwechseln ähnlich und unterscheiden
  // sich in genau einer Sache: der Reihenfolge. Deshalb prüfen die Tests
  // ausschliesslich Fälle, in denen die Reihenfolge auch etwas ausmacht, also
  // solche mit BEIDEN URLs. Ein Fall mit nur einer URL wäre für beide gleich
  // und liesse eine vertauschte Reihenfolge durch.
  const beide = mitUrls({ m1: { medium_url: 'gross.jpg', thumb_url: 'klein.jpg' } });

  test('die Nadel nimmt das kleine Bild, das Sheet das grosse', async () => {
    expect(nadelBild(beide, 'm1')).toBe('klein.jpg');
    expect(sheetBild(beide, 'm1')).toBe('gross.jpg');
  });

  test('ohne Thumbnail traegt das mittlere Bild auch die Nadel', async () => {
    const nurGross = mitUrls({ m1: { medium_url: 'gross.jpg', thumb_url: null } });
    expect(nadelBild(nurGross, 'm1')).toBe('gross.jpg');
  });

  test('ohne mittleres Bild traegt das Thumbnail auch das Sheet', async () => {
    const nurKlein = mitUrls({ m1: { medium_url: '', thumb_url: 'klein.jpg' } });
    expect(sheetBild(nurKlein, 'm1')).toBe('klein.jpg');
  });

  test('ein Moment ohne Eintrag im Vorrat hat kein Bild', async () => {
    expect(nadelBild(beide, 'unbekannt')).toBeNull();
    expect(sheetBild(beide, 'unbekannt')).toBeNull();
  });

  // Der Grund, aus dem es `brauchbareUrl` überhaupt gibt: der Typ sagt
  // `string`, die Function kann trotzdem nichts liefern. Ein leerer String ist
  // als Bildquelle wertlos und würde als «da ist was» durchgehen.
  test('ein leerer String zaehlt nicht als Bild, und beide Wege fallen darauf zurueck', async () => {
    expect(brauchbareUrl('')).toBeNull();
    expect(brauchbareUrl(undefined)).toBeNull();
    expect(brauchbareUrl('x')).toBe('x');
    const leereThumbs = mitUrls({ m1: { medium_url: 'gross.jpg', thumb_url: '' } });
    expect(nadelBild(leereThumbs, 'm1')).toBe('gross.jpg');
  });
});

describe('was die beiden Screens am Sheet unterschiedlich machen', () => {
  test('der Knopf traegt die Beschriftung, die der Screen mitgibt', async () => {
    await render(
      <ThemeProvider>
        <MomentSheetInhalt punkt={punkt()} bildUrl={null} form={FORM} onAnsehen={jest.fn()} />
      </ThemeProvider>
    );
    expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

    await screen.rerender(
      <ThemeProvider>
        <MomentSheetInhalt punkt={punkt()} bildUrl={null} form={TEILEN_FORM} onAnsehen={jest.fn()} />
      </ThemeProvider>
    );
    expect(screen.getByText('Ab hier ansehen')).toBeTruthy();
    expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  });

  // Der Präfix ist kein Schönheitsmerkmal: die Tests beider Screens greifen
  // ihre Sheets darüber. Käme er nicht durch, prüften sie am Ende dieselben IDs.
  test('der testID-Praefix steht vor jeder ID des Sheets', async () => {
    await render(
      <ThemeProvider>
        <MomentSheetInhalt
          punkt={punkt()}
          bildUrl="gross.jpg"
          form={TEILEN_FORM}
          onAnsehen={jest.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId('teilen-moment-inhalt')).toBeTruthy();
    expect(screen.getByTestId('teilen-sheet-bild')).toBeTruthy();
    expect(screen.queryByTestId('moment-inhalt')).toBeNull();
  });

  test('ein leerer Praefix laesst die IDs unveraendert', async () => {
    await render(
      <ThemeProvider>
        <GruppenSheetInhalt
          punkte={[punkt({ id: 'm1' }, 0), punkt({ id: 'm2' }, 1)]}
          urls={mitUrls({})}
          form={FORM}
          onAnsehen={jest.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId('gruppe-liste')).toBeTruthy();
    expect(screen.getByTestId('gruppe-eintrag-m1')).toBeTruthy();
    expect(screen.getByTestId('gruppe-eintrag-m2')).toBeTruthy();
  });
});

describe('was ein Tipp im Sheet zurueckgibt', () => {
  // Der Punkt trägt `index`, und genau der geht später als `start` an den
  // Player. Gäbe der Eintrag seine Stelle IN DER LISTE zurück statt den Punkt,
  // sässe der Sprung beim falschen Moment, sobald eine Gruppe nicht bei 0
  // beginnt.
  test('der Eintrag reicht seinen Punkt samt Spiellisten-Index zurueck, nicht seine Stelle in der Liste', async () => {
    const angesehen = jest.fn();
    const ersterPunkt = punkt({ id: 'm1' }, 7);
    const zweiterPunkt = punkt({ id: 'm2' }, 9);
    await render(
      <ThemeProvider>
        <GruppenSheetInhalt
          punkte={[ersterPunkt, zweiterPunkt]}
          urls={mitUrls({})}
          form={FORM}
          onAnsehen={angesehen}
        />
      </ThemeProvider>
    );
    await fireEvent.press(screen.getByTestId('gruppe-eintrag-m2'));
    expect(angesehen).toHaveBeenCalledWith(zweiterPunkt);
    expect(angesehen.mock.calls[0][0].index).toBe(9);
  });

  test('VoiceOver sagt an jedem Eintrag, was der Tipp tut', async () => {
    await render(
      <ThemeProvider>
        <GruppenSheetInhalt
          punkte={[punkt({ id: 'm1', autor_name: 'Mira' })]}
          urls={mitUrls({})}
          form={FORM}
          onAnsehen={jest.fn()}
        />
      </ThemeProvider>
    );
    // Dieselbe Formulierung wie an der Nadel, sie kommt aus derselben Funktion
    // (features/karte/nadel.ts). Die Uhrzeit ist die VON DAMALS VOR ORT:
    // 12:32 UTC sind in Europe/Lisbon 13:32.
    expect(screen.getByLabelText('Moment von Mira um 13:32 öffnen')).toBeTruthy();
  });
});

// Der Test, der die Zusammenführung festhält. Ohne ihn ist nichts daran
// hinderlich, in einem der beiden Screens wieder eine eigene Fassung
// anzulegen, und der Zustand, aus dem diese Datei entstanden ist, kehrt
// unbemerkt zurück: zwei Kopien, die sich langsam auseinander entwickeln.
describe('die Sheet-Bausteine stehen an genau einer Stelle', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const SCREENS = [
    path.join(SRC, 'app', '(tabs)', 'recap', '[id]', 'karte.tsx'),
    path.join(SRC, 'app', 'teilen', '[token].tsx'),
  ];
  const BAUSTEINE = [
    'MomentSheetInhalt',
    'GruppenSheetInhalt',
    'GruppenEintrag',
    'SheetScroll',
    'Einblendung',
    'nadelBild',
    'sheetBild',
    'brauchbareUrl',
    'autorUndZeit',
  ];

  // Gegenprobe zuerst: findet die Erkennung in der geteilten Datei nichts,
  // ist auch jede Zusicherung unten wertlos.
  test('Testaufbau: die geteilte Datei definiert sie alle', async () => {
    const quelle = readFileSync(path.join(__dirname, '..', 'MomentSheet.tsx'), 'utf8');
    for (const name of BAUSTEINE) {
      expect(quelle).toMatch(new RegExp(`export function ${name}\\b`));
    }
  });

  // Beide Schreibweisen, in denen eine Kopie entstehen könnte: als
  // Funktionsdeklaration (so standen sie vorher da) und als Konstante mit
  // Pfeilfunktion. Nur die erste zu prüfen hiesse, die Rückkehr genau dort zu
  // erlauben, wo jemand die Datei anders schreibt.
  function definiertSelbst(quelle: string, name: string): boolean {
    return (
      new RegExp(`^(export )?function ${name}\\b`, 'm').test(quelle) ||
      new RegExp(`^(export )?const ${name}\\s*=`, 'm').test(quelle)
    );
  }

  test('Testaufbau: die Erkennung findet beide Schreibweisen und nichts sonst', async () => {
    expect(definiertSelbst('function SheetScroll({ testID }) {}', 'SheetScroll')).toBe(true);
    expect(definiertSelbst('const SheetScroll = () => null;', 'SheetScroll')).toBe(true);
    expect(definiertSelbst('import { SheetScroll } from "x";', 'SheetScroll')).toBe(false);
    expect(definiertSelbst('  <SheetScroll testID="a" />', 'SheetScroll')).toBe(false);
  });

  test.each(SCREENS)('%s definiert keinen davon selbst', async (screenPfad) => {
    const quelle = readFileSync(screenPfad, 'utf8');
    expect(BAUSTEINE.filter((name) => definiertSelbst(quelle, name))).toEqual([]);
  });
});
