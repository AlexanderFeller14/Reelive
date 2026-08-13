// Der Zugang zum nativen Modul (modules/kamera-zoom). Geprüft wird hier NICHT
// das Swift — das gibt es im Test nicht und am Simulator ebenso wenig, weil
// dort keine Kamera steckt. Geprüft wird, dass die App genau dann nichts
// behauptet, wenn es nichts zu behaupten gibt: ohne natives Modul keine
// Linsen, keine Grenzen, und ein Zoom-Aufruf, der nichts umwirft.
const mockLinsen = jest.fn();
const mockZoomGrenzen = jest.fn();
const mockSetzeZoom = jest.fn();
let mockVorhanden = true;

// Nur die eine Funktion ersetzen, der Rest bleibt echt: `jest.resetModules()`
// unten stösst Expos Winter-Runtime an (der `fetch`-Global wird faul
// nachgeladen), und die braucht `requireNativeModule` aus demselben Paket.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () =>
    mockVorhanden
      ? { linsen: mockLinsen, zoomGrenzen: mockZoomGrenzen, setzeZoom: mockSetzeZoom }
      : null,
}));

// Das Modul merkt sich den nativen Zugang beim ersten Zugriff, deshalb muss
// jeder Test mit frischem Registrierungsstand beginnen.
function nativeZoom() {
  return require('../nativeZoom') as typeof import('../nativeZoom');
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockVorhanden = true;
});

test('meldet die Linsen des Geräts', () => {
  mockLinsen.mockReturnValue([
    { name: 'Rückseitige Dreifach-Kamera', typ: 'triple', bestandteile: ['ultraWide', 'wide', 'telephoto'], umschaltpunkte: [2, 8] },
  ]);
  expect(nativeZoom().linsen('back')).toEqual([
    { name: 'Rückseitige Dreifach-Kamera', typ: 'triple', bestandteile: ['ultraWide', 'wide', 'telephoto'], umschaltpunkte: [2, 8] },
  ]);
  expect(mockLinsen).toHaveBeenCalledWith('back');
});

test('ein Linsentyp, den diese App nicht kennt, heisst «unbekannt»', () => {
  // Apple kann jederzeit einen Gerätetyp ergänzen. Der darf hier ankommen,
  // ohne dass eine unbekannte Zeichenkette als Typ durch den Code wandert.
  mockLinsen.mockReturnValue([{ name: 'Neue Kamera', typ: 'builtInIrgendwas', bestandteile: ['wide', 'nochNeuer'], umschaltpunkte: [] }]);
  expect(nativeZoom().linsen('back')).toEqual([
    { name: 'Neue Kamera', typ: 'unbekannt', bestandteile: ['wide', 'unbekannt'], umschaltpunkte: [] },
  ]);
});

test('ohne natives Modul — Android, Simulator — gibt es keine Linsen', () => {
  mockVorhanden = false;
  expect(nativeZoom().linsen('back')).toEqual([]);
});

test('ohne natives Modul gibt es keine Zoom-Grenzen', () => {
  mockVorhanden = false;
  expect(nativeZoom().zoomGrenzen('Rückkamera')).toBeNull();
});

test('ohne natives Modul geht ein Zoom-Aufruf ins Leere, statt zu werfen', () => {
  mockVorhanden = false;
  expect(() => nativeZoom().setzeZoom('Rückkamera', 4, true)).not.toThrow();
  expect(mockSetzeZoom).not.toHaveBeenCalled();
});

test('reicht den Zoom mit Faktor und Rampe ans Gerät weiter', () => {
  nativeZoom().setzeZoom('Rückseitige Dreifach-Kamera', 8, true);
  expect(mockSetzeZoom).toHaveBeenCalledWith('Rückseitige Dreifach-Kamera', 8, true);
});
