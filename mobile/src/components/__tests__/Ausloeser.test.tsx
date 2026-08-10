import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Ausloeser } from '../Ausloeser';

jest.useFakeTimers();

test('Tippen löst ein Foto aus, kein Video', async () => {
  const onFoto = jest.fn();
  const onVideoStart = jest.fn();
  await render(<Ausloeser onFoto={onFoto} onVideoStart={onVideoStart} onVideoStop={jest.fn()} maxSekunden={30} />);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(onFoto).toHaveBeenCalledTimes(1);
  expect(onVideoStart).not.toHaveBeenCalled();
});

test('Halten startet ein Video und stoppt es beim Loslassen', async () => {
  const onFoto = jest.fn();
  const onVideoStart = jest.fn();
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={onVideoStart} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(onVideoStart).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onFoto).not.toHaveBeenCalled();
});

test('das Video stoppt nach der Höchstdauer von selbst', async () => {
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// Nicht im Brief vorgegeben, aber von der Aufgabenstellung explizit verlangt:
// "Beide Timer müssen beim Loslassen UND beim Unmount aufgeräumt werden."
// Ohne diesen Test wäre ein hängender Timer (der nach dem Verlassen des Screens
// noch onVideoStart/onVideoStop feuert) unbemerkt geblieben.
test('ein Unmount während des Haltens räumt den Schwellen-Timer auf', async () => {
  const onFoto = jest.fn();
  const onVideoStart = jest.fn();
  const onVideoStop = jest.fn();
  const { unmount } = await render(
    <Ausloeser onFoto={onFoto} onVideoStart={onVideoStart} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await unmount();
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStart).not.toHaveBeenCalled();
  expect(onVideoStop).not.toHaveBeenCalled();
  expect(onFoto).not.toHaveBeenCalled();
});

test('ein Unmount während der Aufnahme räumt auch den Höchstdauer-Timer auf', async () => {
  const onVideoStop = jest.fn();
  const { unmount } = await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(600);
  });
  await unmount();
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStop).not.toHaveBeenCalled();
});

// Aus dem Fix-Runde-1-Review: ohne diesen Test liess sich der
// "phase === 'ruhe'"-Schutz in onPressOut (verspätetes Loslassen NACH dem
// automatischen Stopp löst nichts mehr aus) wegmutieren, ohne dass ein Test
// bricht, der Finger liegt real oft noch einen Moment auf dem Auslöser,
// nachdem der Ring bei maxSekunden bereits selbst gestoppt hat.
test('ein Loslassen nach dem automatischen Stopp löst kein zweites onVideoStop und kein onFoto aus', async () => {
  const onFoto = jest.fn();
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStop).toHaveBeenCalledTimes(1);

  // Der Finger liegt real noch auf dem Knopf und wird erst jetzt gehoben.
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onFoto).not.toHaveBeenCalled();
});
