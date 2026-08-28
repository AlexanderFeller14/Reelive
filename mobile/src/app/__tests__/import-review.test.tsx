import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import type { AcceptedMedia, RefusedMedia } from '@/features/moments/libraryImport';
import { setImport, takeImport } from '@/features/moments/importHandoff';

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
const mockStackScreenOptions = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn(), canGoBack: () => mockCanGoBack }),
  Stack: {
    Screen: (props: { options?: object }) => {
      mockStackScreenOptions(props.options);
      return null;
    },
  },
}));

jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

const mockGetThumbnail = jest.fn();
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (uri: string, options: unknown) => mockGetThumbnail(uri, options),
}));

const mockSubmitImports = jest.fn();
const mockDiscardRefused = jest.fn();
jest.mock('@/features/moments/libraryImportSubmit', () => ({
  submitImports: (...args: unknown[]) => mockSubmitImports(...args),
  discardRefused: (refused: unknown[]) => mockDiscardRefused(refused),
}));

const mockDiscardFile = jest.fn();
jest.mock('@/features/moments/media', () => ({
  discardFile: (uri: string) => mockDiscardFile(uri),
}));

const mockAnimationProps = jest.fn();
let mockFinishAnimation: (() => void) | null = null;
jest.mock('@/components/MomentSubmissionAnimation', () => ({
  MomentSubmissionAnimation: (props: {
    visible: boolean;
    onFinished: () => void;
    counter?: number | null;
    added?: number;
  }) => {
    mockAnimationProps(props);
    mockFinishAnimation = props.visible ? props.onFinished : null;
    return null;
  },
}));

import ImportReviewScreen from '../import-review';

function accepted(uri: string, kind: 'photo' | 'video' = 'photo'): AcceptedMedia {
  return {
    accepted: true,
    media: { uri, kind, durationMs: kind === 'video' ? 12_000 : null, exif: null, creationTime: 1, location: null },
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    duration_s: kind === 'video' ? 12 : null,
    lat: null,
    lng: null,
  };
}

function refused(uri: string, reason: RefusedMedia['reason']): RefusedMedia {
  return {
    accepted: false,
    media: { uri, kind: 'photo', durationMs: null, exif: null, creationTime: null, location: null },
    reason,
  };
}

function handoff(over: Partial<Parameters<typeof setImport>[0]> = {}) {
  setImport({
    tripId: 't1',
    tripName: 'Norwegen mit dem Camper',
    authorId: 'u1',
    period: { start_date: '2026-08-01', end_date: '2026-08-14' },
    maxVideoSeconds: 90,
    accepted: [accepted('file:///a.jpg'), accepted('file:///b.mov', 'video'), accepted('file:///c.jpg')],
    refused: [refused('file:///old.jpg', 'outside_period')],
    counterBefore: 4,
    ...over,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  takeImport();
  mockCanGoBack = true;
  mockFinishAnimation = null;
  mockGetThumbnail.mockResolvedValue({ uri: 'file:///b.thumb.jpg', width: 100, height: 100 });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 0 });
});

test('without a handoff the screen hands back to the camera', async () => {
  await render(<ImportReviewScreen />);
  expect(mockReplace).toHaveBeenCalledWith('/capture');
});

test('shows every element, loads the video still frame, dims the refused one with its reason', async () => {
  handoff();
  await render(<ImportReviewScreen />);

  expect(screen.getByText('Einsenden?')).toBeTruthy();
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getAllByLabelText('Aus der Auswahl entfernen')).toHaveLength(3);
  expect(screen.getByText('Ausserhalb der Reise')).toBeTruthy();
  expect(screen.getByText('3 Momente passen in den Reisezeitraum')).toBeTruthy();
  expect(screen.getByLabelText('3 Momente einsenden')).toBeTruthy();
  // The refusal summary explains the refused element in the present tense.
  expect(
    screen.getByText('1 von 4 Momenten kommt nicht mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  await act(async () => {});
  expect(mockGetThumbnail).toHaveBeenCalledWith('file:///b.mov', { time: 0 });
  expect(screen.getByTestId('import-tile-1-image')).toBeTruthy();
});

test('the x drops an element, releases its copy, and the count follows', async () => {
  handoff();
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getAllByLabelText('Aus der Auswahl entfernen')[0]);
  });

  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  expect(screen.getAllByLabelText('Aus der Auswahl entfernen')).toHaveLength(2);
  expect(screen.getByText('2 Momente passen in den Reisezeitraum')).toBeTruthy();
  expect(screen.getByLabelText('2 Momente einsenden')).toBeTruthy();
});

test('with everything dropped the button is disabled and the text says so', async () => {
  handoff({ accepted: [accepted('file:///a.jpg')], refused: [] });
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Aus der Auswahl entfernen'));
  });

  expect(screen.getByText('Nichts zum Einsenden')).toBeTruthy();
  // The inert button carries a plain label so the footer text stays the only 'Nichts zum Einsenden' on screen.
  const button = screen.getByLabelText('Einsenden');
  expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  fireEvent.press(button);
  expect(mockSubmitImports).not.toHaveBeenCalled();
});

test('Abbrechen releases every remaining copy and goes back', async () => {
  handoff();
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  expect(mockDiscardFile.mock.calls.map(([uri]) => uri).sort()).toEqual(
    ['file:///a.jpg', 'file:///b.mov', 'file:///c.jpg'].sort()
  );
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('Einsenden runs the batch with progress per tile, locks the way back, then celebrates and returns', async () => {
  handoff();
  let finish: (outcome: { submitted: number; failed: number }) => void = () => {};
  let onItem: (index: number, event: unknown) => void = () => {};
  let onProgress: (done: number, total: number) => void = () => {};
  mockSubmitImports.mockImplementation(
    (_accepted: unknown, _target: unknown, progress: typeof onProgress, item: typeof onItem) =>
      new Promise((resolve) => {
        onProgress = progress;
        onItem = item;
        finish = resolve;
      })
  );
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('3 Momente einsenden'));
  });

  expect(mockSubmitImports).toHaveBeenCalledWith(
    [
      expect.objectContaining({ media: expect.objectContaining({ uri: 'file:///a.jpg' }) }),
      expect.objectContaining({ media: expect.objectContaining({ uri: 'file:///b.mov' }) }),
      expect.objectContaining({ media: expect.objectContaining({ uri: 'file:///c.jpg' }) }),
    ],
    { tripId: 't1', authorId: 'u1' },
    expect.any(Function),
    expect.any(Function)
  );
  expect(screen.queryByLabelText('Abbrechen')).toBeNull();
  expect(screen.queryAllByLabelText('Aus der Auswahl entfernen')).toHaveLength(0);
  expect(mockStackScreenOptions).toHaveBeenLastCalledWith(expect.objectContaining({ gestureEnabled: false }));

  await act(async () => {
    onItem(1, { stage: 'converting', progress: 0.42 });
  });
  expect(screen.getByText('42 %')).toBeTruthy();

  await act(async () => {
    onItem(1, { stage: 'done' });
    onProgress(1, 3);
  });
  expect(screen.getByText('1 von 3 Momenten')).toBeTruthy();
  expect(screen.getByLabelText('Eingesendet')).toBeTruthy();

  await act(async () => {
    onItem(2, { stage: 'failed' });
    onProgress(2, 3);
    finish({ submitted: 2, failed: 1 });
  });

  expect(screen.getByText('Nicht gesichert')).toBeTruthy();
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ visible: true, counter: 4, added: 2 })
  );

  await act(async () => {
    mockFinishAnimation?.();
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('when nothing was submitted the screen stays with an explanation and a way back', async () => {
  handoff({ accepted: [accepted('file:///a.jpg')], refused: [] });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 1 });
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.getByText('Keiner der Momente liess sich sichern.')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Zurück'));
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('without a way back the screen replaces itself with the camera', async () => {
  handoff({ accepted: [accepted('file:///a.jpg')], refused: [] });
  mockCanGoBack = false;
  await render(<ImportReviewScreen />);
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });
  expect(mockReplace).toHaveBeenCalledWith('/capture');
});
