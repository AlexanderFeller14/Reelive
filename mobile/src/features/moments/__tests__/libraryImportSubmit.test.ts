// The same doubles as preview.test.tsx: the file operations are native, the
// test checks what the module hands them and what it cleans up.
const mockNewMomentId = jest.fn();
const mockPreparePhoto = jest.fn();
const mockPrepareVideo = jest.fn();
const mockPersistDurably = jest.fn();
const mockRemoveMomentFiles = jest.fn();
const mockDiscardFile = jest.fn();
const mockDiscardIntermediates = jest.fn();
jest.mock('../media', () => ({
  newMomentId: () => mockNewMomentId(),
  preparePhoto: (uri: string) => mockPreparePhoto(uri),
  prepareVideo: (uri: string) => mockPrepareVideo(uri),
  persistDurably: (postId: string, files: unknown) => mockPersistDurably(postId, files),
  removeMomentFiles: (postId: string) => mockRemoveMomentFiles(postId),
  discardFile: (uri: string) => mockDiscardFile(uri),
  discardIntermediates: (raw: string, prepared: unknown) => mockDiscardIntermediates(raw, prepared),
  storageKey: (tripId: string, postId: string, extension: string) =>
    `trips/${tripId}/${postId}.${extension}`,
  mediaExtension: (mediaType: string, uri: string) =>
    mediaType === 'video' ? (uri.endsWith('.mov') ? 'mov' : 'mp4') : 'jpg',
  thumbKey: (tripId: string, postId: string) => `trips/${tripId}/${postId}_t.jpg`,
}));

const mockEnqueueJob = jest.fn();
jest.mock('../uploadWorker', () => ({ enqueueJob: (job: unknown) => mockEnqueueJob(job) }));

const mockDescribePlace = jest.fn();
jest.mock('../placeAndTime', () => ({
  describePlace: (lat: number, lng: number) => mockDescribePlace(lat, lng),
}));

import { discardRefused, submitImports } from '../libraryImportSubmit';
import type { AcceptedMedia } from '../libraryImport';

const TARGET = { tripId: 't1', authorId: 'u1' };

function acceptedPhoto(uri: string, over: Partial<AcceptedMedia> = {}): AcceptedMedia {
  return {
    accepted: true,
    media: { uri, kind: 'photo', durationMs: null, exif: null, creationTime: null, location: null },
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    duration_s: null,
    lat: null,
    lng: null,
    ...over,
  };
}

function acceptedVideo(uri: string): AcceptedMedia {
  return {
    ...acceptedPhoto(uri),
    media: { uri, kind: 'video', durationMs: 12_400, exif: null, creationTime: null, location: null },
    duration_s: 12,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  mockNewMomentId.mockImplementation(() => {
    n += 1;
    return `m${n}`;
  });
  mockPreparePhoto.mockImplementation(async (uri: string) => ({
    medium: `${uri}.medium.jpg`,
    thumb: `${uri}.thumb.jpg`,
  }));
  mockPrepareVideo.mockImplementation(async (uri: string) => ({ medium: uri, thumb: `${uri}.thumb.jpg` }));
  mockPersistDurably.mockImplementation(
    async (postId: string, files: { medium: string; thumb: string }) => ({
      medium: `file:///documents/momente/${postId}/medium.${files.medium.endsWith('.mov') ? 'mov' : 'jpg'}`,
      thumb: `file:///documents/momente/${postId}/thumb.jpg`,
    })
  );
  mockEnqueueJob.mockResolvedValue(undefined);
  mockDescribePlace.mockResolvedValue('Luzern');
});

test('enqueues one job per element with the assessed time, no caption, and reports progress', async () => {
  const progress = jest.fn();
  const outcome = await submitImports(
    [acceptedPhoto('file:///a.jpg', { lat: 47.05, lng: 8.31 }), acceptedVideo('file:///b.mov')],
    TARGET,
    progress
  );

  expect(outcome).toEqual({ submitted: 2, failed: 0 });
  expect(progress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(mockEnqueueJob).toHaveBeenCalledTimes(2);
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({
    id: 'm1',
    post_id: 'm1',
    trip_id: 't1',
    author_id: 'u1',
    typ: 'photo',
    medium_uri: 'file:///documents/momente/m1/medium.jpg',
    thumb_uri: 'file:///documents/momente/m1/thumb.jpg',
    storage_key: 'trips/t1/m1.jpg',
    thumb_key: 'trips/t1/m1_t.jpg',
    caption: null,
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    lat: 47.05,
    lng: 8.31,
    place_name: 'Luzern',
    duration_s: null,
    zustand: 'wartet',
    versuche: 0,
    zeile_angelegt: false,
    medium_geladen: false,
    thumb_geladen: false,
  });
  expect(mockEnqueueJob.mock.calls[1][0]).toMatchObject({
    id: 'm2',
    typ: 'video',
    medium_uri: 'file:///documents/momente/m2/medium.mov',
    storage_key: 'trips/t1/m2.mov',
    duration_s: 12,
    lat: null,
    lng: null,
    place_name: null,
  });
  // Only the element with coordinates asks for a place name.
  expect(mockDescribePlace).toHaveBeenCalledTimes(1);
  expect(mockDescribePlace).toHaveBeenCalledWith(47.05, 8.31);
});

test('the elements run strictly one after the other', async () => {
  const order: string[] = [];
  mockPreparePhoto.mockImplementation(async (uri: string) => {
    order.push(`prepare ${uri}`);
    return { medium: `${uri}.medium.jpg`, thumb: `${uri}.thumb.jpg` };
  });
  mockEnqueueJob.mockImplementation(async (job: { medium_uri: string }) => {
    order.push(`enqueue ${job.medium_uri}`);
  });

  await submitImports([acceptedPhoto('file:///a.jpg'), acceptedPhoto('file:///b.jpg')], TARGET, jest.fn());

  expect(order).toEqual([
    'prepare file:///a.jpg',
    'enqueue file:///documents/momente/m1/medium.jpg',
    'prepare file:///b.jpg',
    'enqueue file:///documents/momente/m2/medium.jpg',
  ]);
});

test('releases the picker copy and the intermediates after enqueuing', async () => {
  await submitImports([acceptedPhoto('file:///a.jpg')], TARGET, jest.fn());
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file:///a.jpg', {
    medium: 'file:///a.jpg.medium.jpg',
    thumb: 'file:///a.jpg.thumb.jpg',
  });
  expect(mockRemoveMomentFiles).not.toHaveBeenCalled();
});

test('a failing element is cleaned up and counted, the others still go through', async () => {
  mockPersistDurably.mockRejectedValueOnce(new Error('disk full'));
  const progress = jest.fn();

  const outcome = await submitImports(
    [acceptedPhoto('file:///a.jpg'), acceptedPhoto('file:///b.jpg')],
    TARGET,
    progress
  );

  expect(outcome).toEqual({ submitted: 1, failed: 1 });
  expect(progress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(mockRemoveMomentFiles).toHaveBeenCalledWith('m1');
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file:///a.jpg', {
    medium: 'file:///a.jpg.medium.jpg',
    thumb: 'file:///a.jpg.thumb.jpg',
  });
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({ id: 'm2' });
});

test('a failing prepare is cleaned up without intermediates', async () => {
  mockPreparePhoto.mockRejectedValueOnce(new Error('broken'));

  const outcome = await submitImports([acceptedPhoto('file:///a.jpg')], TARGET, jest.fn());

  expect(outcome).toEqual({ submitted: 0, failed: 1 });
  expect(mockRemoveMomentFiles).toHaveBeenCalledWith('m1');
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  // A rejecting prepare never produces intermediates to discard.
  expect(mockDiscardIntermediates).not.toHaveBeenCalled();
  expect(mockEnqueueJob).not.toHaveBeenCalled();
});

test('a failing place lookup does not cost the element', async () => {
  mockDescribePlace.mockResolvedValue(null);
  const outcome = await submitImports([acceptedPhoto('file:///a.jpg', { lat: 1, lng: 2 })], TARGET, jest.fn());
  expect(outcome).toEqual({ submitted: 1, failed: 0 });
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({ lat: 1, lng: 2, place_name: null });
});

test('an empty list submits nothing and reports no progress', async () => {
  const progress = jest.fn();
  await expect(submitImports([], TARGET, progress)).resolves.toEqual({ submitted: 0, failed: 0 });
  expect(progress).not.toHaveBeenCalled();
  expect(mockEnqueueJob).not.toHaveBeenCalled();
});

test('discardRefused releases every refused picker copy', () => {
  discardRefused([acceptedPhoto('file:///x.jpg').media, acceptedPhoto('file:///y.jpg').media]);
  expect(mockDiscardFile.mock.calls.map(([uri]) => uri)).toEqual(['file:///x.jpg', 'file:///y.jpg']);
});
