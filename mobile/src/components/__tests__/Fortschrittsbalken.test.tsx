import { Animated, Easing, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Fortschrittsbalken } from '../Fortschrittsbalken';

// jest-expo mockt das native Animated-Modul — Animated.timing läuft trotzdem
// als echte Funktion, wir spionieren nur ihre Aufrufe aus. So lässt sich
// beweisen, DASS und WOMIT sie aufgerufen wurde, ohne die interne Animation
// selbst laufen zu lassen (kein `jest.useFakeTimers()` nötig — anders als in
// Ausloeser.test.tsx, das über Callbacks statt Aufrufparameter prüft).
let timingSpy: jest.SpiedFunction<typeof Animated.timing>;

beforeEach(() => {
  timingSpy = jest.spyOn(Animated, 'timing');
});

afterEach(() => {
  timingSpy.mockRestore();
});

test('rendert genau ein Segment pro Moment (anzahl)', async () => {
  await render(<Fortschrittsbalken anzahl={7} aktivIndex={0} dauerMs={5000} vergangenMs={0} pausiert={false} />);
  expect(screen.getAllByTestId(/^fortschritt-segment-/)).toHaveLength(7);
});

test('Segmente vor dem aktiven Index sind voll, das aktive trägt die Animation, keins danach', async () => {
  await render(<Fortschrittsbalken anzahl={5} aktivIndex={2} dauerMs={5000} vergangenMs={0} pausiert={false} />);
  // Genau die Segmente 0 und 1 sind "voll" — nicht 2 (das ist "aktiv"), nicht
  // 3/4 (noch nicht dran). Ein Mutant, der `<` durch `<=` ersetzt, markierte
  // Segment 2 fälschlich zusätzlich als "voll".
  expect(screen.getByTestId('fortschritt-voll-0')).toBeTruthy();
  expect(screen.getByTestId('fortschritt-voll-1')).toBeTruthy();
  expect(screen.queryByTestId('fortschritt-voll-2')).toBeNull();
  expect(screen.queryByTestId('fortschritt-voll-3')).toBeNull();
  expect(screen.queryByTestId('fortschritt-voll-4')).toBeNull();
  expect(screen.getByTestId('fortschritt-aktiv')).toBeTruthy();
});

test('am allerersten Moment (Index 0) ist kein Segment "voll"', async () => {
  await render(<Fortschrittsbalken anzahl={3} aktivIndex={0} dauerMs={5000} vergangenMs={0} pausiert={false} />);
  expect(screen.queryByTestId(/^fortschritt-voll-/)).toBeNull();
  expect(screen.getByTestId('fortschritt-aktiv')).toBeTruthy();
});

test('animiert das aktive Segment mit Easing.linear (DESIGN-LANGUAGE §5, erlaubte Ausnahme)', async () => {
  await render(<Fortschrittsbalken anzahl={3} aktivIndex={1} dauerMs={5000} vergangenMs={0} pausiert={false} />);
  expect(timingSpy).toHaveBeenCalledTimes(1);
  const [, config] = timingSpy.mock.calls[0];
  expect(config.easing).toBe(Easing.linear);
  expect(config.toValue).toBe(1);
  expect(config.useNativeDriver).toBe(true);
});

test('die Restdauer der Animation ist dauerMs minus vergangenMs, nicht die volle Dauer', async () => {
  await render(<Fortschrittsbalken anzahl={2} aktivIndex={0} dauerMs={5000} vergangenMs={2000} pausiert={false} />);
  expect(timingSpy).toHaveBeenCalledTimes(1);
  const [, config] = timingSpy.mock.calls[0];
  expect(config.duration).toBe(3000);
});

test('pausiert: die Animation startet nicht (der Balken bleibt beim eingefrorenen Stand stehen)', async () => {
  await render(<Fortschrittsbalken anzahl={2} aktivIndex={0} dauerMs={5000} vergangenMs={2000} pausiert />);
  expect(timingSpy).not.toHaveBeenCalled();
});

test('bereits vollständig vergangen (vergangenMs >= dauerMs): keine Animation mehr nötig', async () => {
  await render(<Fortschrittsbalken anzahl={2} aktivIndex={0} dauerMs={5000} vergangenMs={5000} pausiert={false} />);
  expect(timingSpy).not.toHaveBeenCalled();
});

test('eine dauerMs von 0 (Verteidigungsfall) wirft nicht und animiert nicht', async () => {
  await expect(
    render(<Fortschrittsbalken anzahl={1} aktivIndex={0} dauerMs={0} vergangenMs={0} pausiert={false} />)
  ).resolves.toBeTruthy();
  expect(timingSpy).not.toHaveBeenCalled();
});

test('ein Wechsel des aktiven Index startet eine neue Animation für das neue Segment', async () => {
  const { rerender } = await render(
    <Fortschrittsbalken anzahl={3} aktivIndex={0} dauerMs={5000} vergangenMs={0} pausiert={false} />
  );
  expect(timingSpy).toHaveBeenCalledTimes(1);
  await rerender(<Fortschrittsbalken anzahl={3} aktivIndex={1} dauerMs={5000} vergangenMs={0} pausiert={false} />);
  expect(timingSpy).toHaveBeenCalledTimes(2);
  // Nach dem Wechsel ist Segment 0 "voll", nicht mehr aktiv.
  expect(screen.getByTestId('fortschritt-voll-0')).toBeTruthy();
});

// M8 (Review-Fund): weder der Startwert der Animation noch die Füllrichtung
// hatten einen eigenen Test — beides liess sich löschen, ohne dass etwas fiel.
test('setzt den Startwert der Animation auf den korrekten Anteil (vergangenMs/dauerMs), bevor sie startet', async () => {
  const setValueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  await render(<Fortschrittsbalken anzahl={2} aktivIndex={0} dauerMs={4000} vergangenMs={1000} pausiert={false} />);
  expect(setValueSpy).toHaveBeenCalledWith(0.25);
  setValueSpy.mockRestore();
});

test('ein Start-Anteil ausserhalb [0,1] (Verteidigungsfall) wird geklemmt', async () => {
  const setValueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  await render(<Fortschrittsbalken anzahl={2} aktivIndex={0} dauerMs={1000} vergangenMs={5000} pausiert={false} />);
  expect(setValueSpy).toHaveBeenCalledWith(1);
  setValueSpy.mockRestore();
});

test('das aktive Segment füllt von links (transformOrigin: left), nicht mittig oder rechts', async () => {
  await render(<Fortschrittsbalken anzahl={2} aktivIndex={0} dauerMs={4000} vergangenMs={0} pausiert={false} />);
  const stil = StyleSheet.flatten(screen.getByTestId('fortschritt-aktiv').props.style);
  expect(stil.transformOrigin).toBe('left');
});
