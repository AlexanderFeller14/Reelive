import * as kinoBuehne from '../kinoBuehne';

// Nach jedem Test zurück auf den Grundzustand, das Modul hält seinen Stand
// prozessweit (gleiches Holder-Muster wie aufnahmeSperre).
afterEach(() => {
  kinoBuehne.setzen(false);
});

test('der Stand beginnt bei false und folgt setzen()', () => {
  expect(kinoBuehne.lesen()).toBe(false);
  kinoBuehne.setzen(true);
  expect(kinoBuehne.lesen()).toBe(true);
});

test('ein Abo wird bei jedem Wechsel benachrichtigt', () => {
  const melden = jest.fn();
  const abbestellen = kinoBuehne.abonnieren(melden);
  kinoBuehne.setzen(true);
  kinoBuehne.setzen(false);
  expect(melden).toHaveBeenCalledTimes(2);
  abbestellen();
});

// useSyncExternalStore rendert bei jeder Meldung neu: ein unveränderter
// Stand darf deshalb still bleiben, sonst rendert die Tab-Bar bei jedem
// Fokus-Effekt des Kamera-Screens grundlos.
test('setzen mit unverändertem Stand meldet nichts', () => {
  const melden = jest.fn();
  const abbestellen = kinoBuehne.abonnieren(melden);
  kinoBuehne.setzen(false);
  expect(melden).not.toHaveBeenCalled();
  abbestellen();
});

test('ein abbestelltes Abo wird nicht mehr benachrichtigt', () => {
  const melden = jest.fn();
  const abbestellen = kinoBuehne.abonnieren(melden);
  abbestellen();
  kinoBuehne.setzen(true);
  expect(melden).not.toHaveBeenCalled();
});
