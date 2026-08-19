// Note: expo-image-manipulator switched to a context-based API in SDK 54+
// (ImageManipulator.manipulate(uri).resize(...).renderAsync() then
// .saveAsync()). The old manipulateAsync only still exists as a
// @deprecated wrapper around it. This mock mirrors the real, installed
// context API, not the outdated form.
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-fest' }));

// Spies outside the factory, so the tests can check calls across multiple
// manipulate() instances (Fix-Runde 1, Findings 1-3).
const mockResize = jest.fn();
const mockSaveAsync = jest.fn();
const mockRelease = jest.fn();
let mockThrowsOnSave = false;

// Types for the mock context deliberately live outside the jest.mock
// factory: babel-plugin-jest-hoist doesn't treat a locally declared `type`
// alias binding as a scope binding and then throws "out-of-scope
// variable", even though it only exists at compile time.
type ResizeTarget = { width?: number; height?: number };
type MockResult = {
  width: number;
  height: number;
  saveAsync: (options: { format?: string; compress?: number }) => Promise<{ uri: string }>;
  release: () => void;
};
type MockContext = {
  resize: (target: ResizeTarget) => MockContext;
  renderAsync: () => Promise<MockResult>;
  release: () => void;
};

jest.mock('expo-image-manipulator', () => {
  // Fixed test sources: landscape, portrait, and an already small image.
  const sourceSizes: Record<string, { width: number; height: number }> = {
    'file:///quer.jpg': { width: 4032, height: 3024 },
    'file:///hoch.jpg': { width: 3024, height: 4032 },
    'file:///klein.jpg': { width: 200, height: 150 },
  };

  function createContext(source: string): MockContext {
    const original = sourceSizes[source] ?? { width: 1000, height: 1000 };
    let requested: ResizeTarget | undefined;
    const context: MockContext = {
      resize: jest.fn((target: ResizeTarget) => {
        mockResize(target);
        requested = target;
        return context;
      }),
      renderAsync: jest.fn(async () => {
        // Deliberately frozen HERE, not read only at the saveAsync call:
        // otherwise a swapped order of resize()/renderAsync() in production
        // code wouldn't be caught.
        const frozen = requested;
        let width = original.width;
        let height = original.height;
        if (frozen?.width !== undefined) {
          width = frozen.width;
          height = Math.round((original.height / original.width) * width);
        } else if (frozen?.height !== undefined) {
          height = frozen.height;
          width = Math.round((original.width / original.height) * height);
        }
        return {
          width,
          height,
          saveAsync: jest.fn(async (options: { format?: string; compress?: number }) => {
            mockSaveAsync(options);
            if (mockThrowsOnSave) throw new Error('Speichern fehlgeschlagen');
            return { uri: `file:///bearbeitet-${width}x${height}.jpg` };
          }),
          release: jest.fn(() => mockRelease()),
        };
      }),
      release: jest.fn(() => mockRelease()),
    };
    return context;
  }

  return {
    ImageManipulator: { manipulate: jest.fn((source: string) => createContext(source)) },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(async () => ({ uri: 'file:///videobild.jpg' })),
}));

// A tiny in-memory file system instead of the native module: it tracks WHAT
// exists, so the tests can genuinely check the move and cleanup from
// Critical 2, not just that a method got called.
const mockExisting = new Set<string>();
const mockFolderCreated = jest.fn();

jest.mock('expo-file-system', () => {
  // Joins the parts like the real API into a path, without touching the
  // leading `file:///`.
  const join = (parts: unknown[]): string =>
    parts
      .map((t) => (typeof t === 'string' ? t : (t as { uri: string }).uri))
      .map((t, i) => (i === 0 ? t.replace(/\/+$/, '') : t.replace(/^\/+|\/+$/g, '')))
      .join('/');

  class MockDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return mockExisting.has(this.uri);
    }
    create(options?: unknown) {
      mockFolderCreated(this.uri, options);
      mockExisting.add(this.uri);
    }
    delete() {
      if (!mockExisting.has(this.uri)) throw new Error('gibt es nicht');
      for (const path of [...mockExisting]) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) mockExisting.delete(path);
      }
    }
  }

  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return mockExisting.has(this.uri);
    }
    async move(target: { uri: string }) {
      if (!mockExisting.has(this.uri)) throw new Error(`gibt es nicht: ${this.uri}`);
      mockExisting.delete(this.uri);
      mockExisting.add(target.uri);
      this.uri = target.uri;
    }
    async copy(target: { uri: string }) {
      if (!mockExisting.has(this.uri)) throw new Error(`gibt es nicht: ${this.uri}`);
      mockExisting.add(target.uri);
    }
    delete() {
      if (!mockExisting.has(this.uri)) throw new Error('gibt es nicht');
      mockExisting.delete(this.uri);
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
  newMomentId,
  preparePhoto,
  prepareVideo,
  extensionFrom,
  mediaExtension,
  contentTypeForKey,
  momentFolder,
  persistDurably,
  removeMomentFiles,
  discardFile,
  discardIntermediates,
} from '../media';

beforeEach(() => {
  jest.clearAllMocks();
  mockThrowsOnSave = false;
  mockExisting.clear();
});

test('storageKey follows the agreed pattern', () => {
  expect(storageKey('t1', 'p1', 'jpg')).toBe('trips/t1/p1.jpg');
  expect(storageKey('t1', 'p1', 'mp4')).toBe('trips/t1/p1.mp4');
});

// === Final-Review, Important 5: iOS captures .mov, the key said .mp4 ===
// expo-camera produces a QuickTime file on iOS. The earlier version
// uploaded these bytes under ….mp4 with Content-Type video/mp4; the bucket
// accepted it because it checks the DECLARED type. Because the key is
// immutable per moment, that wasn't fixable afterwards.
test('mediaExtension reads the capture’s actual extension', () => {
  expect(mediaExtension('video', 'file:///Caches/aufnahme.mov')).toBe('mov');
  expect(mediaExtension('video', 'file:///Caches/aufnahme.MOV')).toBe('mov');
  expect(mediaExtension('video', 'file:///Caches/aufnahme.mp4')).toBe('mp4');
});

test('mediaExtension falls back to the default instead of passing unknown extensions through', () => {
  expect(mediaExtension('video', 'file:///Caches/aufnahme.avi')).toBe('mp4');
  expect(mediaExtension('video', 'file:///Caches/ohne-endung')).toBe('mp4');
  // Photos get re-encoded as JPEG by preparePhoto regardless.
  expect(mediaExtension('photo', 'file:///Caches/bild.heic')).toBe('jpg');
  expect(mediaExtension('photo', 'file:///Caches/bild.png')).toBe('jpg');
});

test('the content type comes from the storage key, not from the capture type', () => {
  expect(contentTypeForKey('trips/t1/p1.mov')).toBe('video/quicktime');
  expect(contentTypeForKey('trips/t1/p1.mp4')).toBe('video/mp4');
  expect(contentTypeForKey('trips/t1/p1.jpg')).toBe('image/jpeg');
  expect(contentTypeForKey('trips/t1/p1')).toBe('application/octet-stream');
});

test('thumbKey is always a JPEG', () => {
  expect(thumbKey('t1', 'p1')).toBe('trips/t1/p1_t.jpg');
});

test('newMomentId returns a UUID', () => {
  expect(newMomentId()).toBe('uuid-fest');
});

// Long edge 1920 instead of 1080 (request 2026-08-18): photos shouldn't
// look noticeably softer than the 1080×1920 videos next to them.
test('preparePhoto scales the width to the long edge for landscape', async () => {
  const { medium, thumb } = await preparePhoto('file:///quer.jpg');
  expect(mockResize).toHaveBeenNthCalledWith(1, { width: 1920 });
  expect(mockResize).toHaveBeenNthCalledWith(2, { width: 320 });
  expect(medium).toBe('file:///bearbeitet-1920x1440.jpg');
  expect(thumb).toBe('file:///bearbeitet-320x240.jpg');
});

// Regression guard against the original bug: falling back to "always
// resize({ width })" would let the height (2560 instead of 1920), and
// therefore the long edge, overshoot here instead of capping it.
test('preparePhoto scales the height to the long edge for portrait', async () => {
  const { medium, thumb } = await preparePhoto('file:///hoch.jpg');
  expect(mockResize).toHaveBeenNthCalledWith(1, { height: 1920 });
  expect(mockResize).toHaveBeenNthCalledWith(2, { height: 320 });
  expect(medium).toBe('file:///bearbeitet-1440x1920.jpg');
  expect(thumb).toBe('file:///bearbeitet-240x320.jpg');

  const [widthStr, heightStr] = medium.replace('file:///bearbeitet-', '').replace('.jpg', '').split('x');
  expect(Math.max(Number(widthStr), Number(heightStr))).toBeLessThanOrEqual(1920);
});

test('preparePhoto does not scale up an already smaller image', async () => {
  const { medium, thumb } = await preparePhoto('file:///klein.jpg');
  expect(mockResize).not.toHaveBeenCalled();
  expect(medium).toBe('file:///bearbeitet-200x150.jpg');
  expect(thumb).toBe('file:///bearbeitet-200x150.jpg');
});

test('preparePhoto saves medium and thumbnail as JPEG with quality 0.8', async () => {
  await preparePhoto('file:///quer.jpg');
  expect(mockSaveAsync).toHaveBeenNthCalledWith(1, { format: 'jpeg', compress: 0.8 });
  expect(mockSaveAsync).toHaveBeenNthCalledWith(2, { format: 'jpeg', compress: 0.8 });
});

test('preparePhoto releases context and rendered image again (probe + medium + thumbnail)', async () => {
  await preparePhoto('file:///quer.jpg');
  // Probing the source dimensions (context + image) + medium (context +
  // image) + thumbnail (context + image) = 6 releases.
  expect(mockRelease).toHaveBeenCalledTimes(6);
});

test('preparePhoto releases even when saving throws', async () => {
  mockThrowsOnSave = true;
  await expect(preparePhoto('file:///quer.jpg')).rejects.toThrow('Speichern fehlgeschlagen');
  // The probe ran through (2 releases); the first save attempt (medium)
  // throws, but still releases context and image (2 more). The thumbnail
  // never gets attempted at all because of the thrown error.
  expect(mockRelease).toHaveBeenCalledTimes(4);
});

test('prepareVideo leaves the video untouched and pulls a still frame', async () => {
  const { medium, thumb } = await prepareVideo('file:///roh.mp4');
  expect(medium).toBe('file:///roh.mp4');
  expect(thumb).toBe('file:///videobild.jpg');
});

// === Final-Review, Critical 2: durable storage instead of a volatile cache ===
// All four producers (takePictureAsync, recordAsync, saveAsync,
// getThumbnailAsync) write to Library/Caches, a directory iOS is allowed to
// clear under memory pressure. The queue is supposed to hold moments for
// days, but used to hold only pointers there.

test.each([
  ['file:///Caches/aufnahme.MOV', 'mov'],
  ['file:///Caches/aufnahme.mp4', 'mp4'],
  ['file:///Caches/bild.jpg?x=1', 'jpg'],
  ['file:///Caches/ohne-endung', ''],
  ['file:///Caches/.versteckt', ''],
])('extensionFrom(%s) → "%s"', (uri, expected) => {
  expect(extensionFrom(uri)).toBe(expected);
});

test('persistDurably stores medium and thumbnail under the documents directory', async () => {
  mockExisting.add('file:///Caches/medium.jpg');
  mockExisting.add('file:///Caches/thumb.jpg');

  const { medium, thumb } = await persistDurably('p1', {
    medium: 'file:///Caches/medium.jpg',
    thumb: 'file:///Caches/thumb.jpg',
  });

  expect(momentFolder('p1').uri).toBe('file:///dokumente/momente/p1');
  expect(medium).toBe('file:///dokumente/momente/p1/medium.jpg');
  expect(thumb).toBe('file:///dokumente/momente/p1/thumb.jpg');
  expect(mockFolderCreated).toHaveBeenCalledWith('file:///dokumente/momente/p1', {
    intermediates: true,
    idempotent: true,
  });

  // Re-Review: COPIED, not moved. The sources stay untouched until the job
  // owns the moment, for a video the source is the only copy, and the error
  // path clears out the target folder.
  expect(mockExisting.has('file:///Caches/medium.jpg')).toBe(true);
  expect(mockExisting.has('file:///Caches/thumb.jpg')).toBe(true);
  expect(mockExisting.has('file:///dokumente/momente/p1/medium.jpg')).toBe(true);
  expect(mockExisting.has('file:///dokumente/momente/p1/thumb.jpg')).toBe(true);
});

// The core of the Re-Review finding, at the level where it originated:
// prepareVideo returns the raw capture ITSELF as the medium. If the error
// path clears out the moment folder afterwards, the capture must not be
// affected by that.
test('the source survives when the moment folder gets cleared out again afterwards', async () => {
  mockExisting.add('file:///Caches/aufnahme.mov');
  mockExisting.add('file:///Caches/standbild.jpg');

  await persistDurably('p3', {
    medium: 'file:///Caches/aufnahme.mov',
    thumb: 'file:///Caches/standbild.jpg',
  });
  removeMomentFiles('p3');

  expect(mockExisting.has('file:///dokumente/momente/p3/medium.mov')).toBe(false);
  expect(mockExisting.has('file:///Caches/aufnahme.mov')).toBe(true);
});

test('persistDurably keeps the capture’s extension (iOS delivers .mov)', async () => {
  mockExisting.add('file:///Caches/aufnahme.mov');
  mockExisting.add('file:///Caches/standbild.jpg');

  const { medium } = await persistDurably('p2', {
    medium: 'file:///Caches/aufnahme.mov',
    thumb: 'file:///Caches/standbild.jpg',
  });

  expect(medium).toBe('file:///dokumente/momente/p2/medium.mov');
});

test('removeMomentFiles clears out the whole moment folder', async () => {
  mockExisting.add('file:///Caches/m.jpg');
  mockExisting.add('file:///Caches/t.jpg');
  await persistDurably('p1', { medium: 'file:///Caches/m.jpg', thumb: 'file:///Caches/t.jpg' });

  removeMomentFiles('p1');

  expect(mockExisting.has('file:///dokumente/momente/p1/medium.jpg')).toBe(false);
  expect(mockExisting.has('file:///dokumente/momente/p1/thumb.jpg')).toBe(false);
  expect(mockExisting.has('file:///dokumente/momente/p1')).toBe(false);
});

// Cleanup must never throw: it runs in the worker right after removing the
// job. A run that fails on it would repeat the job forever, more expensive
// than a file left behind.
test('cleanup never throws, even when there is nothing (left) to delete', () => {
  expect(() => removeMomentFiles('gibt-es-nicht')).not.toThrow();
  expect(() => discardFile('file:///Caches/weg.jpg')).not.toThrow();
});

test('discardFile deletes the camera file', () => {
  mockExisting.add('file:///Caches/roh.jpg');
  discardFile('file:///Caches/roh.jpg');
  expect(mockExisting.has('file:///Caches/roh.jpg')).toBe(false);
});

// The distinction that makes the difference in the error path: everything
// derived may go, the raw capture never, even when it happens to be the
// medium at the same time (video).
test('discardIntermediates leaves the raw capture alone', () => {
  mockExisting.add('file:///Caches/roh.mov');
  mockExisting.add('file:///Caches/standbild.jpg');

  discardIntermediates('file:///Caches/roh.mov', {
    medium: 'file:///Caches/roh.mov',
    thumb: 'file:///Caches/standbild.jpg',
  });

  expect(mockExisting.has('file:///Caches/roh.mov')).toBe(true);
  expect(mockExisting.has('file:///Caches/standbild.jpg')).toBe(false);
});

test('discardIntermediates clears out both intermediates for a photo', () => {
  mockExisting.add('file:///Caches/roh.jpg');
  mockExisting.add('file:///Caches/medium.jpg');
  mockExisting.add('file:///Caches/thumb.jpg');

  discardIntermediates('file:///Caches/roh.jpg', {
    medium: 'file:///Caches/medium.jpg',
    thumb: 'file:///Caches/thumb.jpg',
  });

  expect(mockExisting.has('file:///Caches/roh.jpg')).toBe(true);
  expect(mockExisting.has('file:///Caches/medium.jpg')).toBe(false);
  expect(mockExisting.has('file:///Caches/thumb.jpg')).toBe(false);
});
