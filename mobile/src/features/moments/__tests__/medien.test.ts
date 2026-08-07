// Achtung: expo-image-manipulator hat in SDK 54+ auf eine kontextbasierte API
// umgestellt (ImageManipulator.manipulate(uri).resize(...).renderAsync() dann
// .saveAsync()). Das alte manipulateAsync existiert nur noch als @deprecated
// Wrapper darüber. Dieser Mock bildet die echte, installierte Kontext-API nach,
// nicht die veraltete Form.
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-fest' }));

// Spione ausserhalb der Factory, damit die Tests Aufrufe über mehrere
// manipulate()-Instanzen hinweg prüfen können (Fix-Runde 1, Findings 1–3).
const mockResize = jest.fn();
const mockSaveAsync = jest.fn();
const mockRelease = jest.fn();
let mockWirftBeimSpeichern = false;

// Typen für den Mock-Kontext liegen bewusst ausserhalb der jest.mock-Factory:
// babel-plugin-jest-hoist behandelt eine lokal darin deklarierte `type`-Alias-
// Bindung nicht als Scope-Binding und wirft dann "out-of-scope variable",
// obwohl sie nur zur Compile-Zeit existiert.
type ResizeZiel = { width?: number; height?: number };
type MockErgebnis = {
  width: number;
  height: number;
  saveAsync: (optionen: { format?: string; compress?: number }) => Promise<{ uri: string }>;
  release: () => void;
};
type MockKontext = {
  resize: (ziel: ResizeZiel) => MockKontext;
  renderAsync: () => Promise<MockErgebnis>;
  release: () => void;
};

jest.mock('expo-image-manipulator', () => {
  // Feste Testquellen: Querformat, Hochformat und ein bereits kleines Bild.
  const quellmasse: Record<string, { width: number; height: number }> = {
    'file:///quer.jpg': { width: 4032, height: 3024 },
    'file:///hoch.jpg': { width: 3024, height: 4032 },
    'file:///klein.jpg': { width: 200, height: 150 },
  };

  function erzeugeKontext(quelle: string): MockKontext {
    const original = quellmasse[quelle] ?? { width: 1000, height: 1000 };
    let angefordert: ResizeZiel | undefined;
    const kontext: MockKontext = {
      resize: jest.fn((ziel: ResizeZiel) => {
        mockResize(ziel);
        angefordert = ziel;
        return kontext;
      }),
      renderAsync: jest.fn(async () => {
        // Bewusst HIER eingefroren, nicht erst beim saveAsync-Aufruf gelesen:
        // sonst würde eine vertauschte Reihenfolge von resize()/renderAsync()
        // im Produktionscode nicht aufgedeckt.
        const eingefroren = angefordert;
        let breite = original.width;
        let hoehe = original.height;
        if (eingefroren?.width !== undefined) {
          breite = eingefroren.width;
          hoehe = Math.round((original.height / original.width) * breite);
        } else if (eingefroren?.height !== undefined) {
          hoehe = eingefroren.height;
          breite = Math.round((original.width / original.height) * hoehe);
        }
        return {
          width: breite,
          height: hoehe,
          saveAsync: jest.fn(async (optionen: { format?: string; compress?: number }) => {
            mockSaveAsync(optionen);
            if (mockWirftBeimSpeichern) throw new Error('Speichern fehlgeschlagen');
            return { uri: `file:///bearbeitet-${breite}x${hoehe}.jpg` };
          }),
          release: jest.fn(() => mockRelease()),
        };
      }),
      release: jest.fn(() => mockRelease()),
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

// Ein winziges Dateisystem im Speicher statt des nativen Moduls: es hält fest,
// WAS existiert, damit die Tests das Verschieben und Aufräumen aus Critical 2
// wirklich prüfen können — nicht bloss, dass eine Methode aufgerufen wurde.
const mockVorhanden = new Set<string>();
const mockOrdnerAngelegt = jest.fn();

jest.mock('expo-file-system', () => {
  // Fügt die Teile wie die echte API zu einem Pfad zusammen, ohne das
  // führende `file:///` anzutasten.
  const verbinden = (teile: unknown[]): string =>
    teile
      .map((t) => (typeof t === 'string' ? t : (t as { uri: string }).uri))
      .map((t, i) => (i === 0 ? t.replace(/\/+$/, '') : t.replace(/^\/+|\/+$/g, '')))
      .join('/');

  class MockDirectory {
    uri: string;
    constructor(...teile: unknown[]) {
      this.uri = verbinden(teile);
    }
    get exists(): boolean {
      return mockVorhanden.has(this.uri);
    }
    create(optionen?: unknown) {
      mockOrdnerAngelegt(this.uri, optionen);
      mockVorhanden.add(this.uri);
    }
    delete() {
      if (!mockVorhanden.has(this.uri)) throw new Error('gibt es nicht');
      for (const pfad of [...mockVorhanden]) {
        if (pfad === this.uri || pfad.startsWith(`${this.uri}/`)) mockVorhanden.delete(pfad);
      }
    }
  }

  class MockFile {
    uri: string;
    constructor(...teile: unknown[]) {
      this.uri = verbinden(teile);
    }
    get exists(): boolean {
      return mockVorhanden.has(this.uri);
    }
    async move(ziel: { uri: string }) {
      if (!mockVorhanden.has(this.uri)) throw new Error(`gibt es nicht: ${this.uri}`);
      mockVorhanden.delete(this.uri);
      mockVorhanden.add(ziel.uri);
      this.uri = ziel.uri;
    }
    async copy(ziel: { uri: string }) {
      if (!mockVorhanden.has(this.uri)) throw new Error(`gibt es nicht: ${this.uri}`);
      mockVorhanden.add(ziel.uri);
    }
    delete() {
      if (!mockVorhanden.has(this.uri)) throw new Error('gibt es nicht');
      mockVorhanden.delete(this.uri);
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: { uri: 'file:///dokumente' } },
  };
});

import {
  storageKey,
  thumbKey,
  neuePostId,
  fotoAufbereiten,
  videoAufbereiten,
  endungAus,
  medienEndung,
  contentTypeFuerSchluessel,
  momentOrdner,
  dauerhaftSichern,
  momentDateienEntfernen,
  dateiVerwerfen,
  zwischenfassungenVerwerfen,
} from '../medien';

beforeEach(() => {
  jest.clearAllMocks();
  mockWirftBeimSpeichern = false;
  mockVorhanden.clear();
});

test('storageKey folgt dem vereinbarten Muster', () => {
  expect(storageKey('t1', 'p1', 'jpg')).toBe('trips/t1/p1.jpg');
  expect(storageKey('t1', 'p1', 'mp4')).toBe('trips/t1/p1.mp4');
});

// === Final-Review, Important 5: iOS nimmt .mov auf, der Schlüssel sagte .mp4 ===
// expo-camera erzeugt auf iOS eine QuickTime-Datei. Die Vorfassung lud diese
// Bytes unter ….mp4 mit Content-Type video/mp4 hoch; der Bucket nahm es an,
// weil er den DEKLARIERTEN Typ prüft. Weil der Schlüssel pro Moment
// unveränderlich ist, war das nachträglich nicht mehr zu heilen.
test('medienEndung liest die tatsächliche Endung der Aufnahme', () => {
  expect(medienEndung('video', 'file:///Caches/aufnahme.mov')).toBe('mov');
  expect(medienEndung('video', 'file:///Caches/aufnahme.MOV')).toBe('mov');
  expect(medienEndung('video', 'file:///Caches/aufnahme.mp4')).toBe('mp4');
});

test('medienEndung fällt auf den Standard zurück, statt Unbekanntes durchzureichen', () => {
  expect(medienEndung('video', 'file:///Caches/aufnahme.avi')).toBe('mp4');
  expect(medienEndung('video', 'file:///Caches/ohne-endung')).toBe('mp4');
  // Fotos werden von fotoAufbereiten ohnehin als JPEG neu kodiert.
  expect(medienEndung('photo', 'file:///Caches/bild.heic')).toBe('jpg');
  expect(medienEndung('photo', 'file:///Caches/bild.png')).toBe('jpg');
});

test('der Content-Type kommt aus dem Speicherschlüssel, nicht aus der Aufnahmeart', () => {
  expect(contentTypeFuerSchluessel('trips/t1/p1.mov')).toBe('video/quicktime');
  expect(contentTypeFuerSchluessel('trips/t1/p1.mp4')).toBe('video/mp4');
  expect(contentTypeFuerSchluessel('trips/t1/p1.jpg')).toBe('image/jpeg');
  expect(contentTypeFuerSchluessel('trips/t1/p1')).toBe('application/octet-stream');
});

test('thumbKey ist immer ein JPEG', () => {
  expect(thumbKey('t1', 'p1')).toBe('trips/t1/p1_t.jpg');
});

test('neuePostId liefert eine UUID', () => {
  expect(neuePostId()).toBe('uuid-fest');
});

test('fotoAufbereiten skaliert bei Querformat die Breite auf die lange Kante', async () => {
  const { medium, thumb } = await fotoAufbereiten('file:///quer.jpg');
  expect(mockResize).toHaveBeenNthCalledWith(1, { width: 1080 });
  expect(mockResize).toHaveBeenNthCalledWith(2, { width: 320 });
  expect(medium).toBe('file:///bearbeitet-1080x810.jpg');
  expect(thumb).toBe('file:///bearbeitet-320x240.jpg');
});

// Regressionsschutz gegen den ursprünglichen Fehler: ein Rückfall auf
// "immer resize({ width })" würde hier die Höhe (1440 statt 1080) und damit
// die lange Kante überschreiten lassen, statt sie zu deckeln.
test('fotoAufbereiten skaliert bei Hochformat die Höhe auf die lange Kante', async () => {
  const { medium, thumb } = await fotoAufbereiten('file:///hoch.jpg');
  expect(mockResize).toHaveBeenNthCalledWith(1, { height: 1080 });
  expect(mockResize).toHaveBeenNthCalledWith(2, { height: 320 });
  expect(medium).toBe('file:///bearbeitet-810x1080.jpg');
  expect(thumb).toBe('file:///bearbeitet-240x320.jpg');

  const [breiteStr, hoeheStr] = medium.replace('file:///bearbeitet-', '').replace('.jpg', '').split('x');
  expect(Math.max(Number(breiteStr), Number(hoeheStr))).toBeLessThanOrEqual(1080);
});

test('fotoAufbereiten skaliert ein bereits kleineres Bild nicht hoch', async () => {
  const { medium, thumb } = await fotoAufbereiten('file:///klein.jpg');
  expect(mockResize).not.toHaveBeenCalled();
  expect(medium).toBe('file:///bearbeitet-200x150.jpg');
  expect(thumb).toBe('file:///bearbeitet-200x150.jpg');
});

test('fotoAufbereiten speichert Medium und Thumbnail als JPEG mit Qualität 0.8', async () => {
  await fotoAufbereiten('file:///quer.jpg');
  expect(mockSaveAsync).toHaveBeenNthCalledWith(1, { format: 'jpeg', compress: 0.8 });
  expect(mockSaveAsync).toHaveBeenNthCalledWith(2, { format: 'jpeg', compress: 0.8 });
});

test('fotoAufbereiten gibt Kontext und gerendertes Bild wieder frei (Sondierung + Medium + Thumbnail)', async () => {
  await fotoAufbereiten('file:///quer.jpg');
  // Sondierung der Quellmasse (Kontext + Bild) + Medium (Kontext + Bild) +
  // Thumbnail (Kontext + Bild) = 6 Freigaben.
  expect(mockRelease).toHaveBeenCalledTimes(6);
});

test('fotoAufbereiten gibt auch dann frei, wenn das Speichern wirft', async () => {
  mockWirftBeimSpeichern = true;
  await expect(fotoAufbereiten('file:///quer.jpg')).rejects.toThrow('Speichern fehlgeschlagen');
  // Sondierung lief durch (2 Freigaben); der erste Speicherversuch (Medium)
  // wirft, gibt Kontext und Bild aber trotzdem frei (weitere 2). Das
  // Thumbnail wird wegen des geworfenen Fehlers gar nicht mehr versucht.
  expect(mockRelease).toHaveBeenCalledTimes(4);
});

test('videoAufbereiten lässt das Video unangetastet und zieht ein Standbild', async () => {
  const { medium, thumb } = await videoAufbereiten('file:///roh.mp4');
  expect(medium).toBe('file:///roh.mp4');
  expect(thumb).toBe('file:///videobild.jpg');
});

// === Final-Review, Critical 2: dauerhafte Ablage statt flüchtiger Cache ===
// Alle vier Erzeuger (takePictureAsync, recordAsync, saveAsync,
// getThumbnailAsync) schreiben nach Library/Caches — ein Verzeichnis, das iOS
// unter Speicherdruck leeren darf. Die Warteschlange soll Momente tagelang
// halten, hielt aber nur Zeiger dorthin.

test.each([
  ['file:///Caches/aufnahme.MOV', 'mov'],
  ['file:///Caches/aufnahme.mp4', 'mp4'],
  ['file:///Caches/bild.jpg?x=1', 'jpg'],
  ['file:///Caches/ohne-endung', ''],
  ['file:///Caches/.versteckt', ''],
])('endungAus(%s) → "%s"', (uri, erwartet) => {
  expect(endungAus(uri)).toBe(erwartet);
});

test('dauerhaftSichern legt Medium und Thumbnail unter dem Dokumentenverzeichnis ab', async () => {
  mockVorhanden.add('file:///Caches/medium.jpg');
  mockVorhanden.add('file:///Caches/thumb.jpg');

  const { medium, thumb } = await dauerhaftSichern('p1', {
    medium: 'file:///Caches/medium.jpg',
    thumb: 'file:///Caches/thumb.jpg',
  });

  expect(momentOrdner('p1').uri).toBe('file:///dokumente/momente/p1');
  expect(medium).toBe('file:///dokumente/momente/p1/medium.jpg');
  expect(thumb).toBe('file:///dokumente/momente/p1/thumb.jpg');
  expect(mockOrdnerAngelegt).toHaveBeenCalledWith('file:///dokumente/momente/p1', {
    intermediates: true,
    idempotent: true,
  });

  // Re-Review: KOPIERT, nicht verschoben. Die Quellen bleiben unangetastet,
  // bis der Job den Moment besitzt — bei einem Video ist die Quelle die
  // einzige Kopie, und der Fehlerpfad räumt den Zielordner ab.
  expect(mockVorhanden.has('file:///Caches/medium.jpg')).toBe(true);
  expect(mockVorhanden.has('file:///Caches/thumb.jpg')).toBe(true);
  expect(mockVorhanden.has('file:///dokumente/momente/p1/medium.jpg')).toBe(true);
  expect(mockVorhanden.has('file:///dokumente/momente/p1/thumb.jpg')).toBe(true);
});

// Der Kern des Re-Review-Befunds, auf der Ebene, auf der er entstand:
// videoAufbereiten gibt die Rohaufnahme SELBST als Medium zurück. Räumt danach
// der Fehlerpfad den Moment-Ordner ab, darf die Aufnahme davon nicht betroffen
// sein.
test('die Quelle überlebt es, wenn der Moment-Ordner danach wieder abgeräumt wird', async () => {
  mockVorhanden.add('file:///Caches/aufnahme.mov');
  mockVorhanden.add('file:///Caches/standbild.jpg');

  await dauerhaftSichern('p3', {
    medium: 'file:///Caches/aufnahme.mov',
    thumb: 'file:///Caches/standbild.jpg',
  });
  momentDateienEntfernen('p3');

  expect(mockVorhanden.has('file:///dokumente/momente/p3/medium.mov')).toBe(false);
  expect(mockVorhanden.has('file:///Caches/aufnahme.mov')).toBe(true);
});

test('dauerhaftSichern behält die Endung der Aufnahme (iOS liefert .mov)', async () => {
  mockVorhanden.add('file:///Caches/aufnahme.mov');
  mockVorhanden.add('file:///Caches/standbild.jpg');

  const { medium } = await dauerhaftSichern('p2', {
    medium: 'file:///Caches/aufnahme.mov',
    thumb: 'file:///Caches/standbild.jpg',
  });

  expect(medium).toBe('file:///dokumente/momente/p2/medium.mov');
});

test('momentDateienEntfernen räumt den ganzen Moment-Ordner ab', async () => {
  mockVorhanden.add('file:///Caches/m.jpg');
  mockVorhanden.add('file:///Caches/t.jpg');
  await dauerhaftSichern('p1', { medium: 'file:///Caches/m.jpg', thumb: 'file:///Caches/t.jpg' });

  momentDateienEntfernen('p1');

  expect(mockVorhanden.has('file:///dokumente/momente/p1/medium.jpg')).toBe(false);
  expect(mockVorhanden.has('file:///dokumente/momente/p1/thumb.jpg')).toBe(false);
  expect(mockVorhanden.has('file:///dokumente/momente/p1')).toBe(false);
});

// Aufräumen darf nie werfen: es läuft im Worker direkt nach dem Entfernen des
// Jobs. Ein daran scheiternder Durchlauf würde den Job endlos wiederholen
// lassen — teurer als eine liegen gebliebene Datei.
test('Aufräumen wirft nie, auch wenn es nichts (mehr) zu löschen gibt', () => {
  expect(() => momentDateienEntfernen('gibt-es-nicht')).not.toThrow();
  expect(() => dateiVerwerfen('file:///Caches/weg.jpg')).not.toThrow();
});

test('dateiVerwerfen löscht die Kamera-Datei', () => {
  mockVorhanden.add('file:///Caches/roh.jpg');
  dateiVerwerfen('file:///Caches/roh.jpg');
  expect(mockVorhanden.has('file:///Caches/roh.jpg')).toBe(false);
});

// Die Unterscheidung, die im Fehlerpfad den Unterschied macht: alles
// Abgeleitete darf weg, die Rohaufnahme nie — auch dann nicht, wenn sie
// zufällig zugleich das Medium ist (Video).
test('zwischenfassungenVerwerfen lässt die Rohaufnahme in Ruhe', () => {
  mockVorhanden.add('file:///Caches/roh.mov');
  mockVorhanden.add('file:///Caches/standbild.jpg');

  zwischenfassungenVerwerfen('file:///Caches/roh.mov', {
    medium: 'file:///Caches/roh.mov',
    thumb: 'file:///Caches/standbild.jpg',
  });

  expect(mockVorhanden.has('file:///Caches/roh.mov')).toBe(true);
  expect(mockVorhanden.has('file:///Caches/standbild.jpg')).toBe(false);
});

test('zwischenfassungenVerwerfen räumt beim Foto beide Zwischenfassungen ab', () => {
  mockVorhanden.add('file:///Caches/roh.jpg');
  mockVorhanden.add('file:///Caches/medium.jpg');
  mockVorhanden.add('file:///Caches/thumb.jpg');

  zwischenfassungenVerwerfen('file:///Caches/roh.jpg', {
    medium: 'file:///Caches/medium.jpg',
    thumb: 'file:///Caches/thumb.jpg',
  });

  expect(mockVorhanden.has('file:///Caches/roh.jpg')).toBe(true);
  expect(mockVorhanden.has('file:///Caches/medium.jpg')).toBe(false);
  expect(mockVorhanden.has('file:///Caches/thumb.jpg')).toBe(false);
});
