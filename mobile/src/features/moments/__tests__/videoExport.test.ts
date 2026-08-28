// The native module is dispatched by name (VideoExportModule.swift); this
// test replaces it with a scripted double and checks what the bridge does
// around it: skip, export with progress, fallbacks.
let mockModule: Record<string, unknown> | null = null;
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mockModule,
}));

function loadBridge(): typeof import('../videoExport') {
  let bridge: typeof import('../videoExport') | undefined;
  jest.isolateModules(() => {
    bridge = require('../videoExport');
  });
  if (!bridge) throw new Error('bridge did not load');
  return bridge;
}

type Listener = (event: { exportId: string; progress: number }) => void;

function scriptedModule(codec: string | null) {
  const listeners: Listener[] = [];
  const remove = jest.fn();
  const mod = {
    videoCodec: jest.fn(async () => codec),
    exportH264: jest.fn(async (_uri: string, exportId: string) => {
      listeners.forEach((l) => l({ exportId, progress: 0.4 }));
      listeners.forEach((l) => l({ exportId: 'someone-else', progress: 0.9 }));
      return { uri: `file:///tmp/reelive-export-${exportId}.mp4` };
    }),
    addListener: jest.fn((_name: string, listener: Listener) => {
      listeners.push(listener);
      return { remove };
    }),
  };
  return { mod, remove };
}

beforeEach(() => {
  jest.resetModules();
  mockModule = null;
});

test('without the native module the video passes through unchanged', async () => {
  const { available, ensureH264 } = loadBridge();
  const onProgress = jest.fn();
  expect(available()).toBe(false);
  await expect(ensureH264('file:///a.mov', onProgress)).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
  expect(onProgress).not.toHaveBeenCalled();
});

test('an H.264 video is left alone', async () => {
  const { ensureH264 } = loadBridge();
  const { mod } = scriptedModule('avc1');
  mockModule = mod;
  const onProgress = jest.fn();
  await expect(ensureH264('file:///a.mov', onProgress)).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
  expect(mod.exportH264).not.toHaveBeenCalled();
  expect(onProgress).not.toHaveBeenCalled();
});

test('an unreadable codec is left alone rather than exported blindly', async () => {
  const { ensureH264 } = loadBridge();
  const { mod } = scriptedModule(null);
  mockModule = mod;
  await expect(ensureH264('file:///a.mov', jest.fn())).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
  expect(mod.exportH264).not.toHaveBeenCalled();
});

test('an HEVC video is exported, only its own progress events are forwarded, and the listener is removed', async () => {
  const { ensureH264 } = loadBridge();
  const { mod, remove } = scriptedModule('hvc1');
  mockModule = mod;
  const onProgress = jest.fn();
  const result = await ensureH264('file:///a.mov', onProgress);
  expect(result.converted).toBe(true);
  expect(result.uri).toMatch(/^file:\/\/\/tmp\/reelive-export-.*\.mp4$/);
  expect(mod.exportH264).toHaveBeenCalledWith('file:///a.mov', expect.any(String));
  expect(onProgress.mock.calls.map(([p]) => p)).toEqual([0.4, 1]);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a failing export rejects and still removes the listener', async () => {
  const { ensureH264 } = loadBridge();
  const { mod, remove } = scriptedModule('hvc1');
  (mod.exportH264 as jest.Mock).mockRejectedValue(new Error('export failed'));
  mockModule = mod;
  await expect(ensureH264('file:///a.mov', jest.fn())).rejects.toThrow('export failed');
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a failing codec lookup passes the video through', async () => {
  const { ensureH264 } = loadBridge();
  const { mod } = scriptedModule('hvc1');
  (mod.videoCodec as jest.Mock).mockRejectedValue(new Error('no track'));
  mockModule = mod;
  await expect(ensureH264('file:///a.mov', jest.fn())).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
});
