import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { RecapMoment } from '@/features/recap/types';

// expo-image ist ein natives View — im Test reicht ein Platzhalter, der alle
// Props (`source`, `testID`, `onLoad`, `onError`) durchreicht. Gleiches Muster
// wie in recap/__tests__/uebersicht.test.tsx und player.test.tsx; ein echter
// Import scheitert im Testlauf schon beim Laden des Moduls
// (expo-image/src/observe.ts erwartet eine native Umgebung).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { KartenNadel } from '../KartenNadel';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', autor_name: 'Lea',
    ...overrides,
  };
}

const fotoMoment = moment();
const videoMoment = moment({ id: 'p2', type: 'video', duration_s: 12 });

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('zeigt das Thumbnail des Moments', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-bild').props.source.uri).toBe('https://x/t.jpg');
});

test('ohne Thumbnail steht ein Skeleton-Kreis', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl={null} />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(screen.queryByTestId('nadel-bild')).toBeNull();
});

// Gegenprobe zum Test darüber: sobald das Bild da ist, hat der Skeleton nichts
// mehr zu suchen — sonst pulste er unter dem Thumbnail weiter und hielte die
// Nadel für immer in Bewegung (siehe onBereit-Tests unten).
test('mit Thumbnail steht kein Skeleton mehr', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.queryByTestId('nadel-skelett')).toBeNull();
});

test('ein Video traegt zusaetzlich das Play-Zeichen', async () => {
  await wrap(<KartenNadel moment={videoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-video')).toBeTruthy();
});

test('ein Foto traegt kein Play-Zeichen', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.queryByTestId('nadel-video')).toBeNull();
});

test('eine Gruppe zeigt ihre Anzahl', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" anzahl={4} />);
  expect(screen.getByText('4')).toBeTruthy();
});

test('eine Gruppe von einem zeigt keine Zahl', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" anzahl={1} />);
  expect(screen.queryByText('1')).toBeNull();
});

// Die Nadel steht in einem Marker, der sie nur so lange nachzeichnet, wie
// `tracksViewChanges` es erlaubt (karte.tsx). Sie ist die einzige Stelle, die
// weiss, WANN ihr Bild wirklich steht — darum meldet sie es.
test('meldet sich fertig, sobald das Bild geladen ist', async () => {
  const onBereit = jest.fn();
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" onBereit={onBereit} />);
  expect(onBereit).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(onBereit).toHaveBeenCalled();
});

// Ein Bild, das nicht kommt (abgelaufene URL, kein Netz), darf die Nadel nicht
// in ewiger Nachzeichnung stehen lassen — die kostet bei jeder Nadel jeden
// Frame. Nach dem Fehlschlag ändert sich am Aussehen nichts mehr, also ist die
// Nadel genauso fertig wie nach einem geladenen Bild.
test('meldet sich fertig, wenn das Bild scheitert', async () => {
  const onBereit = jest.fn();
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" onBereit={onBereit} />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'error');
  expect(onBereit).toHaveBeenCalled();
});

// Solange gar keine URL da ist, ist die Nadel NICHT fertig: der Skeleton pulst,
// und der Marker muss sie weiter nachzeichnen, sonst friert der pulsende Kreis
// im ersten Frame ein und wird nie zum Bild.
test('ohne Thumbnail meldet sie sich nicht fertig', async () => {
  const onBereit = jest.fn();
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl={null} onBereit={onBereit} />);
  expect(onBereit).not.toHaveBeenCalled();
});
