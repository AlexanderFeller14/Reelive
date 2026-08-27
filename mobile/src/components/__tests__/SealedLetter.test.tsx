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

import {
  SealedLetter, CONTENT_OUT_MS, HANDOVER_MS, REDUCED_HANDOVER_MS,
  TICKET_ASPECT, TICKET_PERFORATION_Y,
} from '../SealedLetter';
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

  expect(screen.getByText('Dein Recap')).toBeTruthy();
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

  expect(screen.getByText('Dein Recap')).toBeTruthy();
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

// The day card underneath begins its own credits the moment the card starts
// withdrawing, and it is staged like this letter on purpose: two title cards
// crossfading in place read as doubled text. So the lines clear the stage
// ahead of the card, and only the empty surface keeps leaving with the seal.
test('the lines ride their own exit, ahead of the card', async () => {
  await render(letter());

  // ALL the lines live inside the inner stage: one straggler outside it
  // would stand through the whole handover.
  const inner = screen.getByTestId('letter-inner');
  expect(within(inner).getByText('Dein Recap')).toBeTruthy();
  expect(within(inner).getByTestId('letter-title')).toBeTruthy();
  expect(within(inner).getByTestId('letter-range')).toBeTruthy();
  expect(within(inner).getByTestId('letter-facts')).toBeTruthy();
  expect(within(inner).getByTestId('letter-faces')).toBeTruthy();

  // The inner stage carries its own opacity entry (resolved to its starting
  // value here; the run itself is invisible to Jest, native driver). Without
  // it the lines could only leave on the card's slower clock.
  expect(StyleSheet.flatten(inner.props.style).opacity).toBe(1);

  // And its exit is faster than the card's: the day card's staging starts
  // one `base` after the handover begins, and it must never meet standing
  // letter text.
  expect(CONTENT_OUT_MS).toBeLessThan(HANDOVER_MS);
});

// The letter left the cinema together with the day pages (Alex, 27.08.):
// a light card with dark text, the same look the day card carries now.
test('the letter stands on the ticket, in the light palette', async () => {
  await render(letter());

  // The card face IS the ticket asset, filling the card; the old bg-1
  // surface with its hairline is gone with it.
  const card = screen.getByTestId('letter-card');
  const ticket = within(card).getByTestId('letter-ticket');
  expect(StyleSheet.flatten(ticket.props.style)).toEqual(
    expect.objectContaining({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 })
  );
  expect(StyleSheet.flatten(card.props.style).backgroundColor).toBeUndefined();

  const chapter = screen.getByText('Dein Recap');
  expect(StyleSheet.flatten(chapter.props.style).color).toBe(palette['text-2']);
  expect(StyleSheet.flatten(screen.getByTestId('letter-title').props.style).color)
    .toBe(palette['text-1']);
  const faces = within(screen.getByTestId('letter-faces')).getAllByTestId('avatar-circle');
  expect(StyleSheet.flatten(faces[0].props.style).backgroundColor).toBe(palette['bg-1']);
});

// The seal seals the TEAR LINE, not the envelope's closing edge any more:
// the ticket asset brings a perforated stub, and peeling the wax off is
// tearing the ticket. Its centre therefore sits exactly on the perforation,
// whose position is measured from the PNG.
test('the wax sits on the ticket\'s perforation', async () => {
  const width = 280;
  await render(letter({ width }));

  const wax = StyleSheet.flatten(screen.getByTestId('letter-wax').props.style);
  const stage = StyleSheet.flatten(
    screen.getByRole('button', { name: 'Siegel abziehen' }).props.style
  ).width;
  const cardHeight = width / TICKET_ASPECT;
  expect(wax.top).toBeCloseTo(cardHeight * TICKET_PERFORATION_Y - stage / 2);
  expect(wax.bottom).toBeUndefined();
});

// The letter lies OVER the show once the seal is off, and the show is already
// rendering underneath it. Without a ground of its own the first moment shows
// through around the card from the very first frame, which on the device read
// as a flash of content between the seal and Tag 1.
test('the letter brings its own ground, which withdraws with the card', async () => {
  const { unmount } = await render(letter());

  const backdrop = screen.getByTestId('letter-backdrop');
  // The ground under the picture stays painted: an image needs a first
  // decode, and the show must not shine through around the card meanwhile.
  expect(StyleSheet.flatten(backdrop.props.style).backgroundColor).toBe(palette['bg-0']);

  // The ground itself is the cinema hall (Alex, 27.08., trial): full-bleed,
  // cropped to the screen, inside the withdrawing node so it leaves along.
  const hall = within(backdrop).getByTestId('letter-backdrop-image');
  expect(hall.props.contentFit).toBe('cover');
  expect(StyleSheet.flatten(hall.props.style)).toEqual(
    expect.objectContaining({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 })
  );

  // Same opacity as the card: they withdraw together, so the show fades in
  // rather than being uncovered in one cut.
  const card = screen.getByTestId('letter-card');
  const backdropOpacity = StyleSheet.flatten(backdrop.props.style).opacity;
  const cardOpacity = StyleSheet.flatten(card.props.style).opacity;
  expect(backdropOpacity).toBe(cardOpacity);
  await unmount();
});
