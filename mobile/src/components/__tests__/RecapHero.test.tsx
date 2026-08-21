import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image is a native view; a plain placeholder passing all props through
// (incl. `source`, `testID`) is enough to check WHICH source the hero
// actually pulled (same pattern as TripCard.test.tsx and overview.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { RecapHero } from '../RecapHero';

const props = {
  title: 'Sommer in Lissabon', subtitle: '1.–14. Aug 2026 · 42 Momente · zu dritt',
  coverUrl: 'https://x/1.jpg', onBack: jest.fn(), onPlay: jest.fn(),
};

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('carries title, subtitle and the trip photo', async () => {
  await wrap(<RecapHero {...props} />);
  expect(screen.getByText('Sommer in Lissabon')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026 · 42 Momente · zu dritt')).toBeTruthy();
  expect(screen.getByTestId('recap-hero-image').props.source).toEqual({ uri: 'https://x/1.jpg' });
});

test('without a cover url the placeholder holds the surface', async () => {
  await wrap(<RecapHero {...props} coverUrl={null} />);
  expect(screen.getByTestId('recap-hero-image').props.source).not.toEqual({ uri: expect.any(String) });
});

test('the play pill starts the show again', async () => {
  const onPlay = jest.fn();
  await wrap(<RecapHero {...props} onPlay={onPlay} />);
  fireEvent.press(screen.getByTestId('recap-hero-play'));
  expect(onPlay).toHaveBeenCalled();
});

test('the back chevron reports back', async () => {
  const onBack = jest.fn();
  await wrap(<RecapHero {...props} onBack={onBack} />);
  fireEvent.press(screen.getByLabelText('Zurück'));
  expect(onBack).toHaveBeenCalled();
});

test('a long trip name stays inside the scrim, capped at two lines', async () => {
  await wrap(<RecapHero {...props} title={'Sehr lange Reise '.repeat(10)} />);
  expect(screen.getByTestId('recap-hero-title').props.numberOfLines).toBe(2);
});
