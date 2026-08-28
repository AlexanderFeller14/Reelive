import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { cinema } from '@/theme/tokens';
import { CinemaButton, CinemaTextLink } from '../CinemaButton';

test('the button shows its label on a light surface and reports the press', async () => {
  const onPress = jest.fn();
  await render(<CinemaButton label="Fotos auswählen" onPress={onPress} testID="cinema-button" />);
  expect(screen.getByLabelText('Fotos auswählen')).toBeTruthy();
  expect(screen.getByText('Fotos auswählen')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Fotos auswählen'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('the text link is underlined in the cinema text color and reports the press', async () => {
  const onPress = jest.fn();
  await render(<CinemaTextLink label="Abbrechen" onPress={onPress} />);
  const text = screen.getByText('Abbrechen');
  const flat = Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean));
  expect(flat.textDecorationLine).toBe('underline');
  expect(flat.color).toBe(cinema['text-1']);
  fireEvent.press(screen.getByLabelText('Abbrechen'));
  expect(onPress).toHaveBeenCalledTimes(1);
  // Final-Review Minor 6: the label text is shorter than the 44 pt minimum
  // touch target, hitSlop grows the tappable area past the visible text.
  expect(screen.getByLabelText('Abbrechen').props.hitSlop).toEqual({
    top: 12,
    bottom: 12,
    left: 12,
    right: 12,
  });
});
