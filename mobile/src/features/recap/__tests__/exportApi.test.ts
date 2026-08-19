// Same basic mock pattern as moments/__tests__/media.test.ts: a tiny
// in-memory filesystem (`mockExisting`), so the tests can check actual
// creation/deletion, not just that a method was called at some point.
// Phase-5 lesson: a mock that replaces exactly the mechanism a test is
// supposed to check (here: whether an intermediate file REALLY disappears)
// checks nothing, hence a real, stateful fake instead of a plain
// jest.fn() stub.
const mockExisting = new Set<string>();
// Behaviour controllable per URL: 'ok' creates the target file and
// resolves, 'error' throws (simulates a network/HTTP failure WITHOUT a
// target file, the normal case per the expo-file-system docs for a non-2xx
// status), 'error-with-file' throws but creates the target file ANYWAY
// (the Android case from the docs: "a partially written file may remain"),
// 'hang' NEVER resolves on its own and only reacts to an AbortSignal, for
// tests that simulate an abort MID-download.
type DownloadPlan = 'ok' | 'error' | 'error-with-file' | 'hang';
const mockDownloadPlan: Record<string, DownloadPlan> = {};
const mockDownloadFileAsync = jest.fn(
  (url: string, destination: { uri: string }, options?: { signal?: AbortSignal }) => {
    const plan = mockDownloadPlan[url] ?? 'ok';
    return new Promise((resolve, reject) => {
      const abortError = () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (options?.signal) {
        if (options.signal.aborted) return abortError();
        options.signal.addEventListener('abort', abortError);
      }
      if (plan === 'hang') return; // only resolves via the AbortSignal
      if (plan === 'error') return reject(new Error('UnableToDownload: 500'));
      if (plan === 'error-with-file') {
        mockExisting.add(destination.uri);
        return reject(new Error('UnableToDownload: connection dropped'));
      }
      mockExisting.add(destination.uri);
      resolve(destination);
    });
  }
);

jest.mock('expo-file-system', () => {
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
    // A real filesystem has no notion of "the file exists but its parent
    // folder doesn't", so a folder with content necessarily EXISTS too,
    // even without an explicit .create() call of its own (e.g. an orphaned
    // remnant from a previous, crashed run that was never created through
    // THIS mock object). Without this second condition, `folder.exists`
    // would be stricter here than the real behaviour resetExportFolder()
    // is meant to defend against.
    get exists(): boolean {
      return mockExisting.has(this.uri) || [...mockExisting].some((p) => p.startsWith(`${this.uri}/`));
    }
    create() {
      mockExisting.add(this.uri);
    }
    delete() {
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
    delete() {
      if (!mockExisting.has(this.uri)) throw new Error('gibt es nicht');
      mockExisting.delete(this.uri);
    }
    static downloadFileAsync = (...args: Parameters<typeof mockDownloadFileAsync>) =>
      mockDownloadFileAsync(...args);
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: { uri: 'file:///cache' } },
  };
});

// expo-media-library/legacy (the comment in exportApi.ts explains why
// LEGACY instead of the modern Asset.create() entry point: only the legacy
// path has a real web shim that doesn't break 'expo export --platform web').
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockAssetCreate = jest.fn(async (uri: string) => ({ id: `asset-${uri}` }));
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  createAssetAsync: (...args: [string]) => mockAssetCreate(...args),
}));

import {
  ensurePermission,
  saveMomentToGallery,
  saveAllToGallery,
  NO_ACCESS_TEXT,
  type AllProgress,
} from '../exportApi';
import type { RecapMoment } from '../types';
import type { MediaUrl } from '../urlPool';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: null,
    lat: null, lng: null,
    upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
    ...overrides,
  };
}
function mediaUrl(id: string, overrides: Partial<MediaUrl> = {}): MediaUrl {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg`, ...overrides };
}

const GRANTED = { granted: true, canAskAgain: true };
const DENIED_CAN_ASK = { granted: false, canAskAgain: true };
const DENIED_CANT_ASK = { granted: false, canAskAgain: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  for (const key of Object.keys(mockDownloadPlan)) delete mockDownloadPlan[key];
  mockGetPermissionsAsync.mockResolvedValue(GRANTED);
});

describe('ensurePermission', () => {
  test('already granted: no additional request call', async () => {
    mockGetPermissionsAsync.mockResolvedValue(GRANTED);
    const result = await ensurePermission();
    expect(result).toEqual({ erlaubt: true });
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  // writeOnly=true (comment in the code): the app never reads existing
  // photos.
  test('asks for writeOnly ("add" only), not full read access', async () => {
    mockGetPermissionsAsync.mockResolvedValue(GRANTED);
    await ensurePermission();
    expect(mockGetPermissionsAsync).toHaveBeenCalledWith(true);
  });

  test('not yet granted, but askable again: asks again and reports success', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CAN_ASK);
    mockRequestPermissionsAsync.mockResolvedValue(GRANTED);
    const result = await ensurePermission();
    expect(result).toEqual({ erlaubt: true });
    expect(mockRequestPermissionsAsync).toHaveBeenCalledWith(true);
  });

  test('asked again, but denied again: NO_ACCESS_TEXT', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CAN_ASK);
    mockRequestPermissionsAsync.mockResolvedValue(DENIED_CAN_ASK);
    const result = await ensurePermission();
    expect(result).toEqual({ erlaubt: false, text: NO_ACCESS_TEXT });
  });

  // canAskAgain:false (person permanently chose "don't allow"), a repeated
  // request call would be a no-op on iOS/Android that just returns the old
  // value. Not a silent failure: the text still explains the path via
  // Settings.
  test('permanently denied (canAskAgain=false): doesn\'t even ask again, still reports the path to Settings', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CANT_ASK);
    const result = await ensurePermission();
    expect(result).toEqual({ erlaubt: false, text: NO_ACCESS_TEXT });
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('an error in the check itself is not a silent failure, but its own message', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    const result = await ensurePermission();
    expect(result.erlaubt).toBe(false);
    expect((result as { text: string }).text).toMatch(/nicht geprüft werden/);
  });
});

describe('saveMomentToGallery', () => {
  test('without permission: no download, no Asset.create, NO_ACCESS_TEXT', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CANT_ASK);
    const result = await saveMomentToGallery(moment(), mediaUrl('p1'));
    expect(result).toEqual({ ok: false, grund: 'keine_berechtigung', text: NO_ACCESS_TEXT });
    expect(mockDownloadFileAsync).not.toHaveBeenCalled();
    expect(mockAssetCreate).not.toHaveBeenCalled();
  });

  test('downloads medium_url (full resolution), NEVER thumb_url', async () => {
    const url = mediaUrl('p1');
    await saveMomentToGallery(moment({ id: 'p1' }), url);
    expect(mockDownloadFileAsync).toHaveBeenCalledWith(url.medium_url, expect.anything(), expect.anything());
    const loadedUrls = mockDownloadFileAsync.mock.calls.map((c) => c[0]);
    expect(loadedUrls).not.toContain(url.thumb_url);
  });

  test('hands the downloaded file to MediaLibrary.Asset.create and reports success', async () => {
    const result = await saveMomentToGallery(moment({ id: 'p1', type: 'photo' }), mediaUrl('p1'));
    expect(result).toEqual({ ok: true });
    expect(mockAssetCreate).toHaveBeenCalledTimes(1);
    expect(mockAssetCreate.mock.calls[0][0]).toContain('p1.jpg');
  });

  test('the intermediate file is gone again AFTER a successful save', async () => {
    await saveMomentToGallery(moment({ id: 'p1' }), mediaUrl('p1'));
    const remaining = [...mockExisting].filter((p) => p.includes('p1.jpg'));
    expect(remaining).toEqual([]);
  });

  test('a failed download reports an error, WITHOUT calling Asset.create', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'error';
    const result = await saveMomentToGallery(moment({ id: 'p1' }), mediaUrl('p1'));
    expect(result.ok).toBe(false);
    expect(mockAssetCreate).not.toHaveBeenCalled();
  });

  // Core case (requirement: "how you clean up on BOTH abort AND failure"):
  // per the expo-file-system docs, a failed download on Android can still
  // leave a PARTIALLY written file behind, which must disappear just like
  // in the success case.
  test('a partially written file left behind on failure (the Android case) is cleaned up anyway', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'error-with-file';
    await saveMomentToGallery(moment({ id: 'p1' }), mediaUrl('p1'));
    const remaining = [...mockExisting].filter((p) => p.includes('p1.jpg'));
    expect(remaining).toEqual([]);
  });

  // Core case: the download succeeds, BUT Asset.create (the second step)
  // fails, the intermediate file must be gone THEN too. A `finally` only
  // around the download call wouldn't cover that.
  test('if Asset.create fails, the already-downloaded intermediate file is still deleted', async () => {
    mockAssetCreate.mockRejectedValueOnce(new Error('Galerie-Fehler'));
    const result = await saveMomentToGallery(moment({ id: 'p1' }), mediaUrl('p1'));
    expect(result.ok).toBe(false);
    const remaining = [...mockExisting].filter((p) => p.includes('p1.jpg'));
    expect(remaining).toEqual([]);
  });

  // Phase-4 lesson (requirement text, verbatim): an orphaned remnant from a
  // CRASHED previous run must not stay behind until it becomes a storage
  // problem itself, a new export attempt clears the ENTIRE export folder
  // first, before it creates anything of its own.
  test('an orphaned remnant from an earlier (e.g. crashed) run is cleared before the next export', async () => {
    mockExisting.add('file:///cache/export/uralt-verwaist.jpg');
    await saveMomentToGallery(moment({ id: 'p1' }), mediaUrl('p1'));
    expect(mockExisting.has('file:///cache/export/uralt-verwaist.jpg')).toBe(false);
  });
});

describe('saveAllToGallery', () => {
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      moment: moment({ id: `p${i + 1}` }),
      url: mediaUrl(`p${i + 1}`),
    }));

  test('without permission: status "keine_berechtigung", not a single download', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CANT_ASK);
    const result = await saveAllToGallery(entries(5), jest.fn());
    expect(result).toEqual({ status: 'keine_berechtigung', text: NO_ACCESS_TEXT });
    expect(mockDownloadFileAsync).not.toHaveBeenCalled();
  });

  test('all succeed: an honest tally and progress "1 of 3" … "3 of 3"', async () => {
    const progressList: AllProgress[] = [];
    const result = await saveAllToGallery(entries(3), (progress) => progressList.push(progress));
    expect(result).toEqual({ status: 'fertig', gesichert: 3, gesamt: 3, fehlgeschlagen: 0, abgebrochen: false });
    expect(progressList).toEqual([
      { erledigt: 1, gesamt: 3 },
      { erledigt: 2, gesamt: 3 },
      { erledigt: 3, gesamt: 3 },
    ]);
  });

  // Core case from the requirement: "Not 'done' when three files are
  // missing", the tally must count failures HONESTLY, not sweep them under
  // the rug or fail the whole action as one.
  test('a failure in the middle does NOT abort the whole action, but counts honestly', async () => {
    mockDownloadPlan['https://cdn.example/p2-medium.jpg'] = 'error';
    const result = await saveAllToGallery(entries(3), jest.fn());
    expect(result).toEqual({ status: 'fertig', gesichert: 2, gesamt: 3, fehlgeschlagen: 1, abgebrochen: false });
    // p1 and p3 still got saved, no failure stops the remaining moments.
    expect(mockAssetCreate).toHaveBeenCalledTimes(2);
  });

  test('three out of five failures: the tally names exactly 3, not "done" without a number', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'error';
    mockDownloadPlan['https://cdn.example/p3-medium.jpg'] = 'error';
    mockDownloadPlan['https://cdn.example/p5-medium.jpg'] = 'error';
    const result = await saveAllToGallery(entries(5), jest.fn());
    expect(result).toEqual({ status: 'fertig', gesichert: 2, gesamt: 5, fehlgeschlagen: 3, abgebrochen: false });
  });

  test('abort BEFORE the next element: the remaining elements are never touched at all', async () => {
    const controller = new AbortController();
    const progressList: AllProgress[] = [];
    const run = saveAllToGallery(entries(5), (progress) => {
      progressList.push(progress);
      if (progress.erledigt === 2) controller.abort();
    }, controller.signal);
    const result = await run;
    expect(result).toEqual({ status: 'fertig', gesichert: 2, gesamt: 5, fehlgeschlagen: 0, abgebrochen: true });
    expect(mockDownloadFileAsync).toHaveBeenCalledTimes(2);
  });

  // Core case "abortable" (requirement, verbatim): an abort MID an ongoing
  // download must end that very download (not just prevent the NEXT one),
  // checked via a download that, without an abort, would never resolve on
  // its own ('hang').
  test('an abort MID an ongoing download ends it immediately, without counting it as a failure', async () => {
    mockDownloadPlan['https://cdn.example/p2-medium.jpg'] = 'hang';
    const controller = new AbortController();
    const run = saveAllToGallery(entries(3), jest.fn(), controller.signal);
    // p1 runs through synchronously enough (promise microtasks), p2 is
    // stuck in 'hang', now abort mid-download.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const result = await run;
    expect(result).toEqual({ status: 'fertig', gesichert: 1, gesamt: 3, fehlgeschlagen: 0, abgebrochen: true });
    // p3 was never touched.
    const loadedUrls = mockDownloadFileAsync.mock.calls.map((c) => c[0]);
    expect(loadedUrls).not.toContain('https://cdn.example/p3-medium.jpg');
  });

  // Cleanup also applies to a SINGLE element aborted mid-run, not just at
  // the end of the whole action.
  test('the intermediate file of an element aborted mid-download is also cleaned up', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'hang';
    const controller = new AbortController();
    const run = saveAllToGallery(entries(1), jest.fn(), controller.signal);
    await Promise.resolve();
    controller.abort();
    await run;
    const remaining = [...mockExisting].filter((p) => p.includes('p1.jpg'));
    expect(remaining).toEqual([]);
  });

  test('every intermediate file is gone right after its own element, not cleaned up all together at the end', async () => {
    const afterElement1: boolean[] = [];
    await saveAllToGallery(entries(3), (progress) => {
      if (progress.erledigt === 1) {
        afterElement1.push([...mockExisting].some((p) => p.includes('p1.jpg')));
      }
    });
    expect(afterElement1).toEqual([false]);
  });
});
