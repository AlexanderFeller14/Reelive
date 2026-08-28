import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ImportIntroSheet } from '../ImportIntroSheet';

const PERIOD = { start_date: '2026-08-01', end_date: '2026-08-14' };

async function renderSheet(over: Partial<React.ComponentProps<typeof ImportIntroSheet>> = {}) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  await render(
    <ThemeProvider>
      <ImportIntroSheet
        visible
        period={PERIOD}
        maxVideoSeconds={90}
        selectionLimit={20}
        onPick={onPick}
        onClose={onClose}
        {...over}
      />
    </ThemeProvider>
  );
  return { onPick, onClose };
}

test('explains the three rules with the trip period, the video limit, and the selection limit', async () => {
  await renderSheet();
  expect(screen.getByText('Momente aus Fotos')).toBeTruthy();
  expect(
    screen.getByText(
      'Reelive holt Fotos und Videos aus deiner Fotomediathek in die Reise. Es gelten dieselben Regeln wie beim Aufnehmen:'
    )
  ).toBeTruthy();
  expect(screen.getByText('Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)')).toBeTruthy();
  expect(screen.getByText('Videos bis 90 Sekunden')).toBeTruthy();
  expect(screen.getByText('Ohne Caption, bis zum Recap versiegelt, höchstens 20 auf einmal')).toBeTruthy();
});

test('"Fotos auswählen" hands over to the picker, "Abbrechen" closes', async () => {
  const { onPick, onClose } = await renderSheet();
  await fireEvent.press(screen.getByLabelText('Fotos auswählen'));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Abbrechen'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the backdrop closes like "Abbrechen"', async () => {
  const { onClose } = await renderSheet();
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('invisible renders nothing', async () => {
  await renderSheet({ visible: false });
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
});
