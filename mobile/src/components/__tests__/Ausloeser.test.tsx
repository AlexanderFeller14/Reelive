import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { cinema, palette } from '@/theme/tokens';
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

// ——— Sperren (Spec 2026-08-12-aufnahme-sperren-design.md) ———
//
// Dreissig Sekunden Dauerdruck sind unbequem, und jede Bewegung des Geräts
// geht durch genau den Finger, der das Bild ruhig halten soll. Der Daumen
// wischt darum nach rechts, rastet ein und ist frei.
//
// Die Schwelle liegt bei 48 px, gemessen ab dem Punkt, an dem der Druck
// begann: +60 ist jenseits, +30 diesseits.
const HALT = { nativeEvent: { pageX: 100 } };
const JENSEITS = { nativeEvent: { pageX: 160 } };
const DIESSEITS = { nativeEvent: { pageX: 130 } };

const knopf = () => screen.getByLabelText('Auslöser');

// Bringt den Auslöser in die laufende Aufnahme, den Zustand vor jedem Wisch.
async function videoLaeuft() {
  await fireEvent(knopf(), 'pressIn', HALT);
  await act(() => {
    jest.advanceTimersByTime(600);
  });
}

test('ein Wisch über die Schwelle sperrt: das Loslassen beendet die Aufnahme nicht', async () => {
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await videoLaeuft();

  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  expect(onVideoStop).not.toHaveBeenCalled();
});

// Gegenprobe: ohne sie belegte der Test darüber nur, dass irgendein Wisch das
// Stoppen unterdrückt, auch ein winziger. Dann wäre jedes Abrutschen eine
// ungewollte Sperre.
test('ein Wisch diesseits der Schwelle sperrt nicht, das Loslassen beendet die Aufnahme', async () => {
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await videoLaeuft();

  await fireEvent(knopf(), 'touchMove', DIESSEITS);
  await fireEvent(knopf(), 'pressOut');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

test('ein Daumen, der zurückkehrt, sperrt nicht', async () => {
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await videoLaeuft();

  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'touchMove', DIESSEITS);
  await fireEvent(knopf(), 'pressOut');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

test('im gesperrten Zustand beendet ein Tipp die Aufnahme', async () => {
  const onFoto = jest.fn();
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await videoLaeuft();
  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  await fireEvent(screen.getByLabelText('Aufnahme beenden'), 'pressIn');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  // Der Tipp beendet, er nimmt kein Foto auf.
  expect(onFoto).not.toHaveBeenCalled();
});

test('die Höchstdauer beendet auch die gesperrte Aufnahme', async () => {
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await videoLaeuft();
  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  await act(() => {
    jest.advanceTimersByTime(31_000);
  });

  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// VoiceOver soll keinen Auslöser ansagen, wo ein Stopp-Knopf steht.
test('der Vorlese-Name wechselt im gesperrten Zustand', async () => {
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  await videoLaeuft();
  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  expect(screen.getByLabelText('Aufnahme beenden')).toBeTruthy();
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
});

// Das Ziel der Geste muss sichtbar sein, sonst rät man daran vorbei.
test('die Schloss-Pille steht nur, solange ein Video läuft und noch nicht gesperrt ist', async () => {
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  expect(screen.queryByLabelText('Aufnahme sperren')).toBeNull();

  await videoLaeuft();
  expect(screen.getByLabelText('Aufnahme sperren')).toBeTruthy();

  // Eingerastet hat sie ihren Zweck erfüllt.
  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');
  expect(screen.queryByLabelText('Aufnahme sperren')).toBeNull();
});

// Der Kern zeigt, woran man ist: rund heisst «nimmt auf», eckig heisst
// «beendet die Aufnahme». Ohne das wäre der gesperrte Zustand unsichtbar,
// die Schloss-Pille ist dann ja weg.
test('im gesperrten Zustand wird der runde Kern zum Quadrat', async () => {
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  await videoLaeuft();
  const rund = StyleSheet.flatten(screen.getByTestId('ausloeser-kern').props.style) as ViewStyle;

  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');
  const eckig = StyleSheet.flatten(screen.getByTestId('ausloeser-kern').props.style) as ViewStyle;

  expect(rund.borderRadius).toBeGreaterThan(eckig.borderRadius as number);
});

// Vor dem Videostart gibt es nichts zu sperren, und die Pille steht noch
// nicht. Ein Wisch in dieser Zeit darf das Tippen nicht verschlucken.
test('ein Wisch vor dem Videostart bleibt ein Foto', async () => {
  const onFoto = jest.fn();
  const onVideoStart = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={onVideoStart} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  await fireEvent(knopf(), 'pressIn', HALT);

  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  expect(onFoto).toHaveBeenCalledTimes(1);
  expect(onVideoStart).not.toHaveBeenCalled();
});

// ——— Farbe der laufenden Aufnahme ———
//
// DESIGN-LANGUAGE §1: «accent = Interaktion, seal = Versiegelungs-Symbolik.
// Nie mischen.» Eine laufende Aufnahme ist Interaktion; Gold gehoert dem
// Siegel und dem Reveal, wo die Phase-4-Spec es auch als Einziges nennt.
// Bis hierher trugen Ring und Kern die Siegel-Farbe.
function farbenImBaum(): string[] {
  const treffer: string[] = [];
  const gehe = (knoten: unknown): void => {
    if (!knoten || typeof knoten !== 'object') return;
    if (Array.isArray(knoten)) {
      knoten.forEach(gehe);
      return;
    }
    const { props, children } = knoten as {
      props?: Record<string, unknown>;
      children?: unknown[] | null;
    };
    const stil = StyleSheet.flatten(props?.style as ViewStyle) as ViewStyle | undefined;
    for (const wert of [props?.stroke, props?.color, stil?.backgroundColor]) {
      if (typeof wert === 'string') treffer.push(wert);
    }
    (children ?? []).forEach(gehe);
  };
  gehe(screen.toJSON());
  return treffer;
}

test('die laufende Aufnahme traegt den Akzent, nicht die Siegel-Farbe', async () => {
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  await videoLaeuft();

  const farben = farbenImBaum();
  expect(farben).toContain(palette.accent);
  expect(farben).not.toContain(cinema['seal-glow']);
});

// ——— Meldung der Sperre (Spec 2026-08-12-kamera-zoom-design.md) ———
//
// Nur im gesperrten Zustand ist die Hand frei, und nur dann lässt sich neben
// der laufenden Aufnahme noch etwas anderes bedienen. Ein zweiter Finger auf
// einem anderen Bedienelement würde dem haltenden Druck sonst die Berührung
// entziehen (React Native kennt genau einen Responder) — das Loslassen käme
// an, und die Aufnahme endete mitten im Zoomen. Der Sucher blendet die
// Zoom-Reihe deshalb genau dann ein, wenn diese Meldung `true` sagt.
test('meldet die greifende Sperre', async () => {
  const onSperre = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSekunden={30}
      onSperre={onSperre}
    />
  );
  await videoLaeuft();
  expect(onSperre).not.toHaveBeenCalledWith(true);

  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  expect(onSperre).toHaveBeenLastCalledWith(true);
});

test('meldet das Ende der Sperre, wenn die Aufnahme endet', async () => {
  const onSperre = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSekunden={30}
      onSperre={onSperre}
    />
  );
  await videoLaeuft();
  await fireEvent(knopf(), 'touchMove', JENSEITS);
  await fireEvent(knopf(), 'pressOut');

  await fireEvent(screen.getByLabelText('Aufnahme beenden'), 'pressIn');

  expect(onSperre).toHaveBeenLastCalledWith(false);
});

// ——— Zug-Zoom (Spec 2026-08-13-aufnahme-tempo-design.md §7) ———
//
// Der Auslöser meldet nur die Bewegung; was sie am Zoom bewirkt, entscheidet
// der Screen (zugFaktor in zoom.ts). Gemessen wird gegen den Aufsetzpunkt,
// wie bei der Sperr-Geste — ein Daumen setzt selten mittig auf.
test('während der Aufnahme meldet der Auslöser den Hub nach oben', async () => {
  const onZoomZug = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSekunden={30}
      onZoomZug={onZoomZug}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(200);

  // Unter den Aufsetzpunkt gezogen: negativ, der Screen zoomt dann raus.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 560 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(-60);
});

test('vor der Halte-Schwelle meldet der Auslöser keinen Hub', async () => {
  const onZoomZug = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSekunden={30}
      onZoomZug={onZoomZug}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  // Schwelle (500 ms) bewusst NICHT erreicht: das hier wird ein Foto-Tipp.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300 } });
  expect(onZoomZug).not.toHaveBeenCalled();
});

test('die Sperr-Geste funktioniert auch mit gleichzeitigem Hub', async () => {
  const onZoomZug = jest.fn();
  const onVideoStop = jest.fn();
  const onSperre = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={onVideoStop}
      maxSekunden={30}
      onSperre={onSperre}
      onZoomZug={onZoomZug}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Diagonal: 60 pt nach rechts (jenseits der Sperr-Schwelle 48) und 100 pt
  // nach oben — beide Achsen melden, keine verdrängt die andere.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 160, pageY: 400 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(100);

  await fireEvent(knopf(), 'pressOut');
  expect(onSperre).toHaveBeenCalledWith(true);
  expect(onVideoStop).not.toHaveBeenCalled();
});
