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

// Gerätefund vom 2026-08-14: auf dem Weg zum Schloss (rechts) wandert der
// Daumen zwangsläufig auch etwas vertikal — und die Aufnahme zoomte mit.
// Der Zug-Zoom greift darum erst, wenn die Bewegung KLAR vertikal dominiert;
// eine seitliche Bewegung bleibt, was sie ist: der Weg zur Sperre.
test('eine Bewegung zum Schloss zoomt nicht, auch wenn sie leicht vertikal driftet', async () => {
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

  // Deutlich nach rechts, leicht nach oben: die Hand auf dem Weg zum Schloss.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 160, pageY: 492 } });
  expect(onZoomZug).not.toHaveBeenCalled();
});

test('der Zug-Zoom greift bei klar vertikaler Bewegung und folgt danach auch seitwärts', async () => {
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

  // Klar vertikal: der Zug-Zoom übernimmt.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 104, pageY: 470 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(30);

  // Einmal übernommen, folgt er dem Finger auch bei seitlichem Drift —
  // mitten im Zoomen soll die Hand nicht plötzlich ins Leere greifen.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 150, pageY: 460 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(40);
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

// Gerätefund vom 2026-08-13: Der Zug-Zoom führt den Daumen weit über den
// Auslöser hinaus (nach oben bis ~40 % der Bildschirmhöhe, nach unten bis an
// den Rand). Pressable gibt den Druck ab, sobald die Berührung den
// Haltebereich verlässt — das Loslassen kam an und stoppte die Aufnahme
// mitten im Zoomen. Die Gesten-Tests oben feuern pressIn/touchMove
// synthetisch und sehen die native Geometrie nicht, deshalb nagelt dieser
// Test den Bereich selbst fest: er muss jede iPhone-Abmessung überdecken
// (Pro Max: 956 pt logische Höhe).
test('der Druck-Haltebereich überdeckt den ganzen Bildschirm, nicht nur den Weg zum Schloss', async () => {
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  // Pressable KONSUMIERT den Haltebereich (er geht in die Pressability-
  // Konfiguration, nicht ans Host-View), im Host-Baum der Testing Library
  // ist er darum unsichtbar. Das einzige Fenster ist der Fiber-Pfad nach
  // oben — gesucht wird nach dem Prop selbst statt nach einer Komponenten-
  // Identität, damit der Test React-Upgrades übersteht.
  let fiber = screen.getByLabelText('Auslöser').unstable_fiber;
  while (fiber && fiber.memoizedProps?.pressRetentionOffset === undefined) {
    fiber = fiber.return;
  }
  const bereich = fiber?.memoizedProps?.pressRetentionOffset;
  expect(bereich).toBeDefined();
  expect(bereich.top).toBeGreaterThanOrEqual(1000);
  expect(bereich.bottom).toBeGreaterThanOrEqual(1000);
  expect(bereich.left).toBeGreaterThanOrEqual(1000);
  expect(bereich.right).toBeGreaterThanOrEqual(1000);
});

// Gerätefund vom 2026-08-13: Ein Tipp irgendwo anders hin brach das Filmen
// ab. React Native kennt genau einen Responder; jedes andere Touchable (ein
// Tab-Bar-Knopf reicht) fordert ihn beim Antippen an, und Pressable gibt ihn
// per Default her (`cancelable ?? true`, Pressability.js). Das Abgeben feuert
// onPressOut, und der stoppt das Video. `cancelable: false` lehnt die
// Anforderung ab: der Druck überlebt, das fremde Touchable feuert gar nicht.
// Wie der Haltebereich ist das Prop nur über den Fiber-Pfad sichtbar.
test('der haltende Druck gibt den Responder nicht her (cancelable: false)', async () => {
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSekunden={30} />
  );
  let fiber = screen.getByLabelText('Auslöser').unstable_fiber;
  while (fiber && fiber.memoizedProps?.cancelable === undefined) {
    fiber = fiber.return;
  }
  expect(fiber?.memoizedProps?.cancelable).toBe(false);
});

// ——— Finger-Wächter ———
//
// Weil der Druck den Responder behält (cancelable: false), landen die
// Ereignisse ALLER Finger beim Auslöser. onTouchMove darf nur dem Finger
// folgen, der den Druck begonnen hat — sonst verstellt ein zweiter Tipp
// rechts im Bild die Sperr-Schwelle oder reisst den Zug-Zoom herum.
test('ein zweiter Finger jenseits der Schwelle sperrt nicht', async () => {
  const onVideoStop = jest.fn();
  await render(
    <Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Der fremde Finger tippt weit rechts auf — für den haltenden Finger wäre
  // das jenseits der Sperr-Schwelle.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 300, identifier: 2 } });
  await fireEvent(knopf(), 'pressOut');

  // Nicht gesperrt: das Loslassen beendet die Aufnahme wie immer.
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// Gerätefund vom 2026-08-14, der eigentliche Abbruch-Mechanismus: weil der
// Druck den Responder behält, feuert React Native onPressOut, sobald
// IRGENDEIN Finger endet — auch der tippende zweite. Das Ende des Drucks
// muss darum Finger-bewusst sein: fremde pressOuts sagen nichts, das echte
// Ende des Halte-Fingers kommt (auch nach einem verfrühten Responder-
// Release) zuverlässig über das rohe touchEnd.
test('das Loslassen eines zweiten Fingers beendet die Aufnahme nicht, das des Halte-Fingers schon', async () => {
  const onVideoStop = jest.fn();
  const onFoto = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Der zweite Finger tippt irgendwo und hebt: sein pressOut ist keins.
  await fireEvent(knopf(), 'pressOut', { nativeEvent: { identifier: 2, touches: [{ identifier: 1 }] } });
  expect(onVideoStop).not.toHaveBeenCalled();

  // Der Halte-Finger hebt: das echte Ende, als rohes touchEnd.
  await fireEvent(knopf(), 'touchEnd', { nativeEvent: { identifier: 1, touches: [] } });
  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onFoto).not.toHaveBeenCalled();
});

// Nach dem verfrühten Responder-Release kann ein weiterer Finger den
// Auslöser treffen: der Druck stoppt die Aufnahme (Stopp-Fläche, Test
// weiter unten) — und er darf die Zustandsmaschine dabei nicht auf 'haelt'
// zurückwerfen, sonst würde aus dem Loslassen des Halte-Fingers ein Foto.
test('nach einem Druck mitten in der Aufnahme macht das Loslassen des Halte-Fingers kein Foto', async () => {
  const onVideoStop = jest.fn();
  const onFoto = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 120, identifier: 2 } });
  await fireEvent(knopf(), 'touchEnd', { nativeEvent: { identifier: 1, touches: [] } });

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onFoto).not.toHaveBeenCalled();
});

// Gerätefund vom 2026-08-14, zweite Runde: nach einem fremden Finger-Ende
// CANCELT iOS die Berührung des Halte-Fingers — sie liefert nie mehr ein
// Ereignis, das Loslassen kommt also nie an. Stoppen wäre wieder der alte
// Abbruch, Ignorieren machte die Aufnahme unbeendbar (beides am Gerät
// beobachtet). Der Ausweg: die Aufnahme sperrt sich selbst, läuft
// freihändig weiter, und der Auslöser wird zum Stopp-Knopf.
test('ein touchCancel des Halte-Fingers sperrt die Aufnahme, statt sie zu beenden', async () => {
  const onVideoStop = jest.fn();
  const onSperre = jest.fn();
  await render(
    <Ausloeser
      onFoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={onVideoStop}
      maxSekunden={30}
      onSperre={onSperre}
    />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(knopf(), 'touchCancel', { nativeEvent: { identifier: 1 } });

  expect(onVideoStop).not.toHaveBeenCalled();
  expect(onSperre).toHaveBeenCalledWith(true);

  // Gesperrt heisst: der Auslöser beendet die Aufnahme mit einem Tipp.
  await fireEvent(screen.getByLabelText('Aufnahme beenden'), 'pressIn');
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// Der Gegenpol zum Sperren per Cancel: die Aufnahme muss in JEDEM Zustand
// beendbar bleiben. Feuert ein pressIn, während sie läuft (nur möglich,
// wenn Pressability nach einem fremden Ende neu armiert ist), ist das ein
// bewusster Tipp auf den Auslöser — und der ist die Stopp-Fläche.
test('ein Druck auf den Auslöser mitten in laufender Aufnahme beendet sie', async () => {
  const onVideoStop = jest.fn();
  const onFoto = jest.fn();
  await render(
    <Ausloeser onFoto={onFoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />
  );
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 2 } });

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onFoto).not.toHaveBeenCalled();
});

test('ein zweiter Finger bewegt den Zug-Zoom nicht', async () => {
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
  await fireEvent(knopf(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 100, identifier: 2 } });
  expect(onZoomZug).not.toHaveBeenCalled();

  // Der eigene Finger meldet weiter: der Wächter filtert, er verstummt nicht.
  await fireEvent(knopf(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300, identifier: 1 } });
  expect(onZoomZug).toHaveBeenLastCalledWith(200);
});
