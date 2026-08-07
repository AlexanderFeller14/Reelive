// Achtung: expo-image-manipulator hat in SDK 54+ auf eine kontextbasierte API
// umgestellt (ImageManipulator.manipulate(uri).resize(...).renderAsync() dann
// .saveAsync()). Das alte manipulateAsync existiert nur noch als @deprecated
// Wrapper darüber. Dieser Mock bildet die echte, installierte Kontext-API nach,
// nicht die veraltete Form.
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-fest' }));

jest.mock('expo-image-manipulator', () => {
  type MockKontext = {
    resize: (groesse: { width?: number }) => MockKontext;
    renderAsync: () => Promise<{ saveAsync: () => Promise<{ uri: string }> }>;
  };
  function erzeugeKontext(_quelle: string): MockKontext {
    let letzteBreite: number | undefined;
    const kontext: MockKontext = {
      resize: jest.fn((groesse: { width?: number }) => {
        letzteBreite = groesse.width;
        return kontext;
      }),
      renderAsync: jest.fn(async () => ({
        saveAsync: jest.fn(async () => ({
          uri: `file:///bearbeitet-${letzteBreite ?? 0}.jpg`,
        })),
      })),
    };
    return kontext;
  }
  return {
    ImageManipulator: { manipulate: jest.fn((quelle: string) => erzeugeKontext(quelle)) },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(async () => ({ uri: 'file:///videobild.jpg' })),
}));

import { storageKey, thumbKey, neuePostId, fotoAufbereiten, videoAufbereiten } from '../medien';

test('storageKey folgt dem vereinbarten Muster', () => {
  expect(storageKey('t1', 'p1', 'photo')).toBe('trips/t1/p1.jpg');
  expect(storageKey('t1', 'p1', 'video')).toBe('trips/t1/p1.mp4');
});

test('thumbKey ist immer ein JPEG', () => {
  expect(thumbKey('t1', 'p1')).toBe('trips/t1/p1_t.jpg');
});

test('neuePostId liefert eine UUID', () => {
  expect(neuePostId()).toBe('uuid-fest');
});

test('fotoAufbereiten liefert Medium und Thumbnail', async () => {
  const { medium, thumb } = await fotoAufbereiten('file:///roh.jpg');
  expect(medium).toContain('1080');
  expect(thumb).toContain('320');
});

test('videoAufbereiten lässt das Video unangetastet und zieht ein Standbild', async () => {
  const { medium, thumb } = await videoAufbereiten('file:///roh.mp4');
  expect(medium).toBe('file:///roh.mp4');
  expect(thumb).toBe('file:///videobild.jpg');
});
