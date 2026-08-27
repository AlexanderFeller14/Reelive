import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';

// expo-image is a native view; in the test a placeholder passing its props
// through is enough (same pattern as Avatar.test.tsx, which the facepile
// below pulls in). Without the mock even the import fails.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// SealPeel brings Skia, Reanimated and haptics along and has its own test
// file. Here only the letter around it matters, so it is a plain button that
// reports its two moments on press: the seal COMES OFF at once, and is GONE
// a while later. The exact clock lives in SealPeel's own tests.
const MOCK_DISSOLVE_MS = 650;
jest.mock('@/components/SealPeel', () => {
  const ReactActual = require('react');
  const { Pressable } = require('react-native');
  return {
    SealPeel: ({
      size, onLiftOff, onPeeled, testID,
    }: {
      size: number; onLiftOff?: () => void; onPeeled: () => void; testID?: string;
    }) => {
      // Mirrors the real one where it matters to the letter: it runs ONCE and
      // tears its timer down on unmount. 650 is the mock's own clock, kept in
      // step with MOCK_DISSOLVE_MS below (a jest.mock factory cannot reach
      // outer bindings).
      const [running, setRunning] = ReactActual.useState(false);
      ReactActual.useEffect(() => {
        if (!running) return undefined;
        onLiftOff?.();
        const t = setTimeout(() => onPeeled(), 650);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [running]);
      return ReactActual.createElement(Pressable, {
        testID,
        accessibilityRole: 'button',
        accessibilityLabel: 'Siegel abziehen',
        accessibilityState: { disabled: running },
        disabled: running,
        onPress: () => setRunning(true),
        style: { width: size, height: size },
      });
    },
  };
});

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

import { SealedLetter, HANDOVER_MS, REDUCED_HANDOVER_MS } from '../SealedLetter';
import { DISSOLVE_MS } from '@/features/recap/sealPeel';

jest.useFakeTimers();

const FACES = [
  { name: 'Marco', avatarKey: null },
  { name: 'Lena', avatarKey: null },
];

function letter(props: Partial<React.ComponentProps<typeof SealedLetter>> = {}) {
  return (
    <ThemeProvider>
      <SealedLetter
        width={280}
        title="Portugal"
        range="1.–14. Aug 2026"
        facts="48 Momente · zu dritt"
        faces={FACES}
        onOpening={() => {}}
        onOpened={() => {}}
        testID="letter"
        {...props}
      />
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('the letter carries the chapter line, the trip and the faces of its senders', async () => {
  await render(letter());

  expect(screen.getByText('Deine Filmrolle')).toBeTruthy();
  expect(screen.getByText('Portugal')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('48 Momente · zu dritt')).toBeTruthy();
  expect(screen.getByTestId('letter-faces')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Siegel abziehen' })).toBeTruthy();
});

// The letter is also the loading window for the trip behind it: it stands
// before the data arrives, and must not stand there with empty lines.
test('while the trip is still loading only the chapter line stands, no empty lines', async () => {
  await render(letter({ title: null, range: null, facts: null, faces: [] }));

  expect(screen.getByText('Deine Filmrolle')).toBeTruthy();
  expect(screen.queryByTestId('letter-title')).toBeNull();
  expect(screen.queryByTestId('letter-range')).toBeNull();
  expect(screen.queryByTestId('letter-facts')).toBeNull();
  expect(screen.queryByTestId('letter-faces')).toBeNull();
});

// The point of the overlap: Tag 1 has to arrive WHILE the seal is still
// falling apart, not after it (Alex, 27.08.). So the letter reports itself
// opening the moment the seal comes off, and only reports itself gone once
// the seal has finished dissolving.
//
// Every test that starts a handover unmounts at the end: a still-running
// animation would otherwise tick into the next test and collide with its
// act() scope (the same reason RevealSequence.test.tsx unmounts).
test('the card makes room the moment the seal comes off, long before it is gone', async () => {
  const onOpening = jest.fn();
  const onOpened = jest.fn();
  const { unmount } = await render(letter({ onOpening, onOpened }));

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Siegel abziehen' }));
  });
  // The show may begin right away, behind a card that is only now withdrawing.
  expect(onOpening).toHaveBeenCalledTimes(1);
  expect(onOpened).not.toHaveBeenCalled();

  // Not gone until the seal has finished dissolving over it.
  await act(async () => {
    jest.advanceTimersByTime(MOCK_DISSOLVE_MS - 1);
  });
  expect(onOpened).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onOpened).toHaveBeenCalledTimes(1);

  // And the card withdraws over exactly the stretch the seal spends falling
  // apart, so the two leave together rather than one after the other. That
  // coupling is the whole reason HANDOVER_MS is not a motion token.
  expect(HANDOVER_MS).toBe(DISSOLVE_MS);
  await unmount();
});

test('the peel reports only once, however often the seal is pressed', async () => {
  const onOpened = jest.fn();
  const { unmount } = await render(letter({ onOpened }));
  const seal = screen.getByRole('button', { name: 'Siegel abziehen' });

  await act(async () => {
    fireEvent.press(seal);
  });
  await act(async () => {
    fireEvent.press(seal);
  });
  await act(async () => {
    jest.advanceTimersByTime(MOCK_DISSOLVE_MS + HANDOVER_MS + 1000);
  });
  expect(onOpened).toHaveBeenCalledTimes(1);
  await unmount();
});

test('reduced motion: the card withdraws in one short fade', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onOpening = jest.fn();
  const { unmount } = await render(letter({ onOpening }));

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Siegel abziehen' }));
  });
  expect(onOpening).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(REDUCED_HANDOVER_MS);
  });
  await unmount();
});

test('an unmount during the handover: onOpened no longer arrives', async () => {
  const onOpened = jest.fn();
  const { unmount } = await render(letter({ onOpened }));

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Siegel abziehen' }));
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(MOCK_DISSOLVE_MS + HANDOVER_MS + 1000);
  });
  expect(onOpened).not.toHaveBeenCalled();
});

// The letter left the cinema together with the day pages (Alex, 27.08.):
// a light card with dark text, the same look the day card carries now.
test('the letter stands in the light look, not the cinema', async () => {
  await render(letter());

  const chapter = screen.getByText('Deine Filmrolle');
  const card = StyleSheet.flatten(chapter.parent?.props.style);
  expect(card.backgroundColor).toBe(palette['bg-1']);
  expect(StyleSheet.flatten(chapter.props.style).color).toBe(palette['text-2']);
  expect(StyleSheet.flatten(screen.getByTestId('letter-title').props.style).color)
    .toBe(palette['text-1']);
  const faces = within(screen.getByTestId('letter-faces')).getAllByTestId('avatar-circle');
  expect(StyleSheet.flatten(faces[0].props.style).backgroundColor).toBe(palette['bg-1']);
});

// The letter lies OVER the show once the seal is off, and the show is already
// rendering underneath it. Without a ground of its own the first moment shows
// through around the card from the very first frame, which on the device read
// as a flash of content between the seal and Tag 1.
test('the letter brings its own ground, which withdraws with the card', async () => {
  const { unmount } = await render(letter());

  const backdrop = screen.getByTestId('letter-backdrop');
  expect(StyleSheet.flatten(backdrop.props.style).backgroundColor).toBe(palette['bg-0']);

  // Same opacity as the card: they withdraw together, so the show fades in
  // rather than being uncovered in one cut.
  const card = screen.getByTestId('letter-card');
  const backdropOpacity = StyleSheet.flatten(backdrop.props.style).opacity;
  const cardOpacity = StyleSheet.flatten(card.props.style).opacity;
  expect(backdropOpacity).toBe(cardOpacity);
  await unmount();
});
