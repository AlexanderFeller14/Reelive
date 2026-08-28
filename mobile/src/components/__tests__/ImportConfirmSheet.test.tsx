import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { AcceptedMedia } from '@/features/moments/libraryImport';
import { ImportConfirmSheet } from '../ImportConfirmSheet';

// expo-image is a native view; the stand-in passes the source through so
// the test can check which uri lands in which tile.
const mockImageProps = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImageProps(props);
      return ReactActual.createElement(View, props);
    },
  };
});

function accepted(uri: string, kind: 'photo' | 'video'): AcceptedMedia {
  return {
    accepted: true,
    media: { uri, kind, durationMs: kind === 'video' ? 12_000 : null, exif: null, creationTime: null, location: null },
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    duration_s: kind === 'video' ? 12 : null,
    lat: null,
    lng: null,
  };
}

async function renderSheet(over: Partial<React.ComponentProps<typeof ImportConfirmSheet>> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  await render(
    <ThemeProvider>
      <ImportConfirmSheet
        visible
        accepted={[accepted('file:///a.jpg', 'photo'), accepted('file:///b.mov', 'video'), accepted('file:///c.jpg', 'photo')]}
        summary={null}
        onConfirm={onConfirm}
        onClose={onClose}
        {...over}
      />
    </ThemeProvider>
  );
  return { onConfirm, onClose };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('previews the accepted elements, photos as images and videos as film tiles, and counts them', async () => {
  await renderSheet();
  expect(screen.getByText('Einsenden?')).toBeTruthy();
  expect(screen.getAllByTestId('import-thumb-photo')).toHaveLength(2);
  expect(screen.getAllByTestId('import-thumb-video')).toHaveLength(1);
  expect(mockImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: { uri: 'file:///a.jpg' } }));
  expect(mockImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: { uri: 'file:///c.jpg' } }));
  expect(screen.getByText('3 Momente passen in den Reisezeitraum.')).toBeTruthy();
  expect(screen.getByLabelText('3 Momente einsenden')).toBeTruthy();
});

test('shows what stays out, in the present tense, above the buttons', async () => {
  await renderSheet({
    summary: '1 von 4 Momenten kommt nicht mit: Video länger als 90 Sekunden.',
  });
  expect(screen.getByText('1 von 4 Momenten kommt nicht mit: Video länger als 90 Sekunden.')).toBeTruthy();
});

test('a single element speaks in the singular', async () => {
  await renderSheet({ accepted: [accepted('file:///a.jpg', 'photo')] });
  expect(screen.getByText('1 Moment passt in den Reisezeitraum.')).toBeTruthy();
  expect(screen.getByLabelText('1 Moment einsenden')).toBeTruthy();
});

test('confirming and cancelling report to the caller', async () => {
  const { onConfirm, onClose } = await renderSheet();
  await fireEvent.press(screen.getByLabelText('3 Momente einsenden'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText('Abbrechen'));
  expect(onClose).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('with nothing accepted there is only the explanation and "Verstanden"', async () => {
  const { onConfirm, onClose } = await renderSheet({
    accepted: [],
    summary: 'Keiner der 2 Momente kommt mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).',
  });
  expect(screen.getByText('Nichts zum Einsenden')).toBeTruthy();
  expect(
    screen.getByText('Keiner der 2 Momente kommt mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  expect(screen.queryByLabelText(/einsenden$/)).toBeNull();
  expect(screen.queryByLabelText('Abbrechen')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Verstanden'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('invisible renders nothing', async () => {
  await renderSheet({ visible: false });
  expect(screen.queryByText('Einsenden?')).toBeNull();
});
