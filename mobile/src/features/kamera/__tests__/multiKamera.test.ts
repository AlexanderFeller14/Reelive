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
  aufnahmeStarten: jest.fn(async (_maxSekunden: number) => {}),
  aufnahmeStoppen: jest.fn(async () => ({ uri: 'file://multicam.mov', dauerS: 5.6 })),
  fotoAufnehmen: jest.fn(async (_blitz: boolean) => ({
    uri: 'file:///tmp/reelive-foto-1.jpg',
    breite: 1080,
    hoehe: 1920,
  })),
  blitz: jest.fn((_an: boolean) => {}),
  addListener: jest.fn((_ereignis: string, _hoerer: (nutzlast: unknown) => void) => ({
    remove: mockRemove,
  })),
};
let mockVorhanden = true;

// Zählt die Aufrufe von `requireNativeViewManager` mit, reicht sie aber an
// die echte expo-modules-core-Implementierung durch: der Guard von
// MultiKameraSucher wird damit gegen das echte Verhalten geprüft, und der
// Fall ohne Modul kann trotzdem belegen, dass der Aufruf unterbleibt.
const mockRequireNativeViewManagerAufrufe = jest.fn();

jest.mock('expo-modules-core', () => {
  const echt = jest.requireActual('expo-modules-core') as typeof import('expo-modules-core');
  return {
    ...echt,
    requireOptionalNativeModule: () => (mockVorhanden ? mockModul : null),
    requireNativeViewManager: (...args: Parameters<typeof echt.requireNativeViewManager>) => {
      mockRequireNativeViewManagerAufrufe(...args);
      return echt.requireNativeViewManager(...args);
    },
  };
});

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
  mockModul.aufnahmeStarten.mockResolvedValue(undefined);
  mockModul.aufnahmeStoppen.mockResolvedValue({ uri: 'file://multicam.mov', dauerS: 5.6 });
  mockModul.fotoAufnehmen.mockResolvedValue({
    uri: 'file:///tmp/reelive-foto-1.jpg',
    breite: 1080,
    hoehe: 1920,
  });
  mockModul.blitz.mockImplementation(() => {});
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

  it('aufDruck liefert ohne Modul eine wirkungslose Abmeldung, addListener wird nie gerufen', () => {
    mockVorhanden = false;
    const hoerer = jest.fn();
    const abmelden = multiKamera().aufDruck(hoerer);

    expect(() => abmelden()).not.toThrow();
    expect(mockModul.addListener).not.toHaveBeenCalled();
  });

  // Die Video-Aufnahme des MultiCam-Pfads (Task 5). Sie erzeugt nativ dieselbe
  // Aufnahme wie das KameraAufnahme-Modul, nur ohne dessen Suche nach dem
  // expo-camera-Sucher; hier oben ist davon allein die Durchreichung zu sehen.
  it('aufnahmeStarten reicht die Höchstdauer durch und meldet Erfolg', async () => {
    await expect(multiKamera().aufnahmeStarten(90)).resolves.toBe(true);
    expect(mockModul.aufnahmeStarten).toHaveBeenCalledWith(90);
  });

  it('aufnahmeStarten liefert false bei Ablehnung und ohne Modul', async () => {
    // «laeuft_schon» oder «keine_session»: der Screen soll die Fehlerpille
    // zeigen, nicht an einer Ablehnung zerbrechen.
    mockModul.aufnahmeStarten.mockRejectedValueOnce(new Error('keine_session'));
    await expect(multiKamera().aufnahmeStarten(90)).resolves.toBe(false);

    jest.resetModules();
    mockVorhanden = false;
    await expect(multiKamera().aufnahmeStarten(90)).resolves.toBe(false);
  });

  it('aufnahmeStoppen liefert Datei und Dauer, null bei Ablehnung und ohne Modul', async () => {
    const mk = multiKamera();
    await expect(mk.aufnahmeStoppen()).resolves.toEqual({
      uri: 'file://multicam.mov',
      dauerS: 5.6,
    });

    mockModul.aufnahmeStoppen.mockRejectedValueOnce(new Error('keine_aufnahme'));
    await expect(mk.aufnahmeStoppen()).resolves.toBeNull();

    jest.resetModules();
    mockVorhanden = false;
    await expect(multiKamera().aufnahmeStoppen()).resolves.toBeNull();
  });

  // Das Foto des MultiCam-Pfads (Task 6). Es entsteht nativ als Griff in den
  // laufenden Strom (kein zweiter Foto-Ausgang, Spec §6): der nächste Frame
  // der aktiven Kamera wird JPEG und landet im tmp. Hier oben ist davon allein
  // die Durchreichung zu sehen, samt Blitz-Wunsch.
  it('fotoAufnehmen reicht den Blitz-Wunsch durch und liefert Datei und Masse', async () => {
    await expect(multiKamera().fotoAufnehmen(true)).resolves.toEqual({
      uri: 'file:///tmp/reelive-foto-1.jpg',
      breite: 1080,
      hoehe: 1920,
    });
    expect(mockModul.fotoAufnehmen).toHaveBeenCalledWith(true);
  });

  it('fotoAufnehmen liefert null bei Ablehnung und ohne Modul', async () => {
    // «kein_frame» (die Session liefert nichts mehr) oder «keine_session»:
    // der Screen soll seine Fehlerpille zeigen, nicht an einer Ablehnung
    // zerbrechen.
    mockModul.fotoAufnehmen.mockRejectedValueOnce(new Error('kein_frame'));
    await expect(multiKamera().fotoAufnehmen(false)).resolves.toBeNull();

    jest.resetModules();
    mockVorhanden = false;
    await expect(multiKamera().fotoAufnehmen(false)).resolves.toBeNull();
  });

  it('blitz reicht den Schalter durch; ohne Modul passiert schlicht nichts', () => {
    const mk = multiKamera();
    mk.blitz(true);
    expect(mockModul.blitz).toHaveBeenCalledWith(true);
    mk.blitz(false);
    expect(mockModul.blitz).toHaveBeenLastCalledWith(false);

    jest.resetModules();
    mockVorhanden = false;
    expect(() => multiKamera().blitz(true)).not.toThrow();
    expect(mockModul.blitz).toHaveBeenCalledTimes(2);
  });

  it('MultiKameraSucher ist ohne Modul die leere Fallback-View, requireNativeViewManager wird nie gerufen', () => {
    mockVorhanden = false;
    // Derselbe frische Registrierungsstand wie beim Modul-Zugang: `View`
    // muss aus demselben `require`-Durchlauf wie `multiKamera` stammen,
    // sonst vergleicht `toBe` zwei verschiedene Modul-Instanzen von
    // react-native miteinander.
    const rnView = (require('react-native') as typeof import('react-native')).View;
    const mk = multiKamera();

    expect(mk.MultiKameraSucher).toBe(rnView);
    expect(mockRequireNativeViewManagerAufrufe).not.toHaveBeenCalled();
  });
});
