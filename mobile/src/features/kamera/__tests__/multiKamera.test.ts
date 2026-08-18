// Der Zugriffspunkt kapselt das native MultiCam-Modul: fehlt es (Android,
// Simulator, alter Build) oder scheitert der Aufbau zweimal in Folge,
// antworten die Helfer mit false/null statt zu werfen, der Screen fällt
// dann auf expo-camera zurück (Laufzeit-Fallback, Spec §8/§9).
const mockRemove = jest.fn();
const mockModul = {
  istVerfuegbar: jest.fn(() => true),
  starten: jest.fn(async () => {}),
  stoppen: jest.fn(async () => {}),
  wechsleKamera: jest.fn(async () => 'front' as 'front' | 'back'),
  zoomSetzen: jest.fn((_kamera: string, _faktor: number, _sanft: boolean) => {}),
  fokussiere: jest.fn(async (_x: number, _y: number) => {}),
  addListener: jest.fn((_ereignis: string, _hoerer: (nutzlast: unknown) => void) => ({
    remove: mockRemove,
  })),
};
let mockVorhanden = true;

// Nur die eine Funktion ersetzen, der Rest bleibt echt: `requireNativeViewManager`
// bleibt das originale expo-modules-core, damit der Guard von MultiKameraSucher
// gegen die echte Implementierung geprüft wird.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => (mockVorhanden ? mockModul : null),
}));

// Das Modul merkt sich den nativen Zugang und den Fehlschlag-Zähler beim
// ersten Zugriff, deshalb muss jeder Test mit frischem Registrierungsstand
// beginnen.
function multiKamera() {
  return require('../multiKamera') as typeof import('../multiKamera');
}

beforeEach(() => {
  jest.resetModules();
  // `resetAllMocks` statt `clearAllMocks`: eine in einem Fall gesetzte
  // dauerhafte Ablehnung (siehe unten, `mockRejectedValue` ohne `Once`)
  // bliebe sonst über den nächsten Fall hinweg bestehen, weil Löschen nur
  // die Aufrufliste leert, nicht die hinterlegte Implementierung.
  jest.resetAllMocks();
  mockVorhanden = true;
  mockModul.istVerfuegbar.mockReturnValue(true);
  mockModul.starten.mockResolvedValue(undefined);
  mockModul.stoppen.mockResolvedValue(undefined);
  mockModul.wechsleKamera.mockResolvedValue('front');
  mockModul.zoomSetzen.mockImplementation(() => {});
  mockModul.fokussiere.mockResolvedValue(undefined);
  mockModul.addListener.mockImplementation(() => ({ remove: mockRemove }));
});

describe('multiKamera: der Zugang zum MultiCam-Modul', () => {
  it('verfuegbar ist false, wenn das Modul fehlt', () => {
    mockVorhanden = false;
    expect(multiKamera().verfuegbar()).toBe(false);
  });

  it('verfuegbar fragt das Modul (istVerfuegbar)', () => {
    const mk = multiKamera();
    mockModul.istVerfuegbar.mockReturnValueOnce(false);
    expect(mk.verfuegbar()).toBe(false);
    mockModul.istVerfuegbar.mockReturnValueOnce(true);
    expect(mk.verfuegbar()).toBe(true);
    expect(mockModul.istVerfuegbar).toHaveBeenCalledTimes(2);
  });

  it('starten liefert true bei Erfolg', async () => {
    await expect(multiKamera().starten()).resolves.toBe(true);
    expect(mockModul.starten).toHaveBeenCalledTimes(1);
  });

  it('starten liefert false bei Ablehnung und schaltet nach dem zweiten Fehlschlag dauerhaft ab', async () => {
    mockModul.starten.mockRejectedValue(new Error('aufbau_gescheitert'));
    const mk = multiKamera();

    await expect(mk.starten()).resolves.toBe(false);
    await expect(mk.starten()).resolves.toBe(false);
    expect(mockModul.starten).toHaveBeenCalledTimes(2);

    // Dritter Aufruf: kein weiterer Versuch mehr, sofort false.
    await expect(mk.starten()).resolves.toBe(false);
    expect(mockModul.starten).toHaveBeenCalledTimes(2);
    expect(mk.verfuegbar()).toBe(false);
  });

  it('ein Erfolg setzt den Fehlschlag-Zähler zurück', async () => {
    const mk = multiKamera();
    mockModul.starten.mockRejectedValueOnce(new Error('aufbau_gescheitert'));

    await expect(mk.starten()).resolves.toBe(false);
    await expect(mk.starten()).resolves.toBe(true);

    mockModul.starten.mockRejectedValueOnce(new Error('aufbau_gescheitert'));
    await expect(mk.starten()).resolves.toBe(false);
    await expect(mk.starten()).resolves.toBe(true);

    // Alle vier Versuche kamen tatsächlich beim Modul an, keiner wurde
    // wegen eines vermeintlich dauerhaften Fehlschlags übersprungen.
    expect(mockModul.starten).toHaveBeenCalledTimes(4);
  });

  it('zoomSetzen reicht Kamera, Faktor und sanft ans Modul durch', () => {
    multiKamera().zoomSetzen({ kamera: 'weit', faktor: 2.5 }, true);
    expect(mockModul.zoomSetzen).toHaveBeenCalledWith('weit', 2.5, true);
  });

  it('wechsleKamera liefert die neue Richtung, null ohne Modul', async () => {
    mockModul.wechsleKamera.mockResolvedValueOnce('back');
    await expect(multiKamera().wechsleKamera()).resolves.toBe('back');

    // Frischer Registrierungsstand: der Modul-Zugang ist modul-lokal
    // gecacht, ein blosses Umschalten von `mockVorhanden` erreicht eine
    // schon geladene Instanz nicht mehr.
    jest.resetModules();
    mockVorhanden = false;
    await expect(multiKamera().wechsleKamera()).resolves.toBeNull();
  });

  it('aufDruck meldet Ereignisse und die Abmeldung räumt auf', () => {
    const hoerer = jest.fn();
    const mk = multiKamera();
    const abmelden = mk.aufDruck(hoerer);

    expect(mockModul.addListener).toHaveBeenCalledWith('druckGeaendert', expect.any(Function));
    const weitergeben = mockModul.addListener.mock.calls[0][1] as (nutzlast: {
      stufe: 'nominal' | 'ernst' | 'kritisch';
    }) => void;
    weitergeben({ stufe: 'ernst' });
    expect(hoerer).toHaveBeenCalledWith('ernst');

    abmelden();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
