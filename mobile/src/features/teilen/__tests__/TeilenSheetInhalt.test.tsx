import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

// Alert zeigt im Test nur einen Dialog an, ohne dass jemand tippt — der
// bestätigende (destruktive) Knopf wird per Default automatisch ausgelöst
// (gleiches Muster wie reise/__tests__/detail.test.tsx), einzelne Tests
// überschreiben das für den Abbrechen-Pfad.
type AlertKnopf = { text?: string; style?: string; onPress?: () => void };
const mockAlertAuslösen = jest.fn((_titel: string, _text: string, knoepfe?: AlertKnopf[]) => {
  knoepfe?.find((k) => k.style === 'destructive')?.onPress?.();
});
jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) =>
  mockAlertAuslösen(args[0] as string, args[1] as string, args[2] as AlertKnopf[] | undefined)
);

const mockSetStringAsync = jest.fn((..._args: unknown[]) => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args) }));

// react-native exportiert `Share` als `require('./Libraries/Share/Share').default`
// (index.js) — die Klasse selbst, mit `share` als STATISCHER Methode. Der Mock
// muss dieselbe Form haben (`default.share`), sonst wäre `RN.Share` im
// Component-Code `undefined` und `Share.share(...)` würfe, statt den
// Aufruf abzufangen.
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve({ action: 'sharedAction' }));
jest.mock('react-native/Libraries/Share/Share', () => ({
  default: { share: (...args: unknown[]) => mockShare(...args) },
}));

jest.mock('../linkVerwaltenApi', () => ({
  holeAktivenLink: jest.fn(),
  erstelleLink: jest.fn(),
  widerrufeLink: jest.fn(),
}));

import { TeilenSheetInhalt } from '../TeilenSheetInhalt';
import { holeAktivenLink, erstelleLink, widerrufeLink } from '../linkVerwaltenApi';

const AKTIVER_LINK = { token: 'tok123', url: 'http://127.0.0.1:8081/teilen/tok123', expiresAt: null };

// @testing-library/react-native v14 ist vollständig async — render() selbst
// liefert ein Promise (Muster wie player.test.tsx: `await render(...)`).
async function wrap(tripId = 't1') {
  return render(<TeilenSheetInhalt tripId={tripId} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertAuslösen.mockImplementation((_titel: string, _text: string, knoepfe?: AlertKnopf[]) => {
    knoepfe?.find((k) => k.style === 'destructive')?.onPress?.();
  });
});

describe('Laden', () => {
  test('zeigt einen Ladeindikator, während holeAktivenLink noch läuft', async () => {
    (holeAktivenLink as jest.Mock).mockReturnValue(new Promise(() => {}));
    await wrap();
    expect(screen.getByTestId('teilen-sheet-laedt')).toBeTruthy();
  });

  test('ein Ladefehler zeigt die Ursache und einen Wiederholen-Knopf', async () => {
    (holeAktivenLink as jest.Mock).mockResolvedValue({ data: null, error: 'Du bist offline. Verbinde dich und probier es nochmal.' });
    await wrap();
    expect(await screen.findByText('Du bist offline. Verbinde dich und probier es nochmal.')).toBeTruthy();
    expect(screen.getByTestId('teilen-nochmal')).toBeTruthy();
  });

  test('"Nochmal versuchen" ruft holeAktivenLink erneut auf', async () => {
    (holeAktivenLink as jest.Mock)
      .mockResolvedValueOnce({ data: null, error: 'Fehler' })
      .mockResolvedValueOnce({ data: AKTIVER_LINK, error: null });
    await wrap();
    await screen.findByTestId('teilen-nochmal');
    await fireEvent.press(screen.getByTestId('teilen-nochmal'));
    expect(await screen.findByTestId('teilen-link-text')).toBeTruthy();
    expect(holeAktivenLink).toHaveBeenCalledTimes(2);
  });
});

describe('Kein Link: Ehrlichkeits-Hinweis, Ablauf-Auswahl, Erstellen', () => {
  beforeEach(() => {
    (holeAktivenLink as jest.Mock).mockResolvedValue({ data: null, error: null });
  });

  test('der Ehrlichkeits-Hinweis steht VOR dem Erstellen, nicht erst danach', async () => {
    await wrap();
    expect(
      await screen.findByText(
        'Wer diesen Link hat, sieht den ganzen Recap — alle Momente aller Mitreisenden, auch ohne eigenes Konto.'
      )
    ).toBeTruthy();
    // Noch kein Link erstellt — die Erstellen-Aktion selbst ist sichtbar,
    // "teilen-link-text" (die Anzeige EINES bestehenden Links) dagegen nicht.
    expect(screen.getByTestId('teilen-erstellen')).toBeTruthy();
    expect(screen.queryByTestId('teilen-link-text')).toBeNull();
  });

  test('7 Tage ist voreingestellt', async () => {
    await wrap();
    await screen.findByTestId('teilen-erstellen');
    // Kein direkter "ist ausgewählt"-Text — die Auswahl wird über den an
    // erstelleLink übergebenen Wert geprüft (nächster Test), hier nur, dass
    // alle drei Optionen angeboten werden.
    expect(screen.getByTestId('teilen-ablauf-7')).toBeTruthy();
    expect(screen.getByTestId('teilen-ablauf-30')).toBeTruthy();
    expect(screen.getByTestId('teilen-ablauf-unbegrenzt')).toBeTruthy();
  });

  test('"Link erstellen" ruft erstelleLink mit der voreingestellten Auswahl (7 Tage) auf und zeigt danach den Link', async () => {
    (erstelleLink as jest.Mock).mockResolvedValue({ data: AKTIVER_LINK, error: null });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-erstellen'));
    await waitFor(() => expect(erstelleLink).toHaveBeenCalledWith('t1', 7));
    expect(await screen.findByTestId('teilen-link-text')).toBeTruthy();
  });

  test('eine andere Ablauf-Auswahl (unbegrenzt) wird an erstelleLink weitergegeben', async () => {
    (erstelleLink as jest.Mock).mockResolvedValue({ data: AKTIVER_LINK, error: null });
    await wrap();
    await screen.findByTestId('teilen-erstellen');
    await fireEvent.press(screen.getByTestId('teilen-ablauf-unbegrenzt'));
    await fireEvent.press(screen.getByTestId('teilen-erstellen'));
    await waitFor(() => expect(erstelleLink).toHaveBeenCalledWith('t1', null));
  });

  test('30 Tage wird an erstelleLink weitergegeben', async () => {
    (erstelleLink as jest.Mock).mockResolvedValue({ data: AKTIVER_LINK, error: null });
    await wrap();
    await screen.findByTestId('teilen-erstellen');
    await fireEvent.press(screen.getByTestId('teilen-ablauf-30'));
    await fireEvent.press(screen.getByTestId('teilen-erstellen'));
    await waitFor(() => expect(erstelleLink).toHaveBeenCalledWith('t1', 30));
  });

  test('ein Fehler beim Erstellen bleibt in der "kein Link"-Phase mit sichtbarer Ursache', async () => {
    (erstelleLink as jest.Mock).mockResolvedValue({ data: null, error: 'Diese Reise ist noch versiegelt.' });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-erstellen'));
    expect(await screen.findByText('Diese Reise ist noch versiegelt.')).toBeTruthy();
    expect(screen.queryByTestId('teilen-link-text')).toBeNull();
    // Der Erstellen-Knopf bleibt bedienbar (kein Deadlock im Ladezustand).
    expect(screen.getByTestId('teilen-erstellen')).toBeTruthy();
  });
});

describe('Bestehender Link: anzeigen statt neu erzeugen', () => {
  beforeEach(() => {
    (holeAktivenLink as jest.Mock).mockResolvedValue({ data: AKTIVER_LINK, error: null });
  });

  test('zeigt den bestehenden Link, OHNE erstelleLink aufzurufen', async () => {
    await wrap();
    expect(await screen.findByTestId('teilen-link-text')).toHaveTextContent(AKTIVER_LINK.url);
    expect(erstelleLink).not.toHaveBeenCalled();
    expect(screen.queryByTestId('teilen-erstellen')).toBeNull();
  });

  test('der Ehrlichkeits-Hinweis steht auch hier, bevor "Teilen" gedrückt wird', async () => {
    await wrap();
    expect(
      await screen.findByText(
        'Wer diesen Link hat, sieht den ganzen Recap — alle Momente aller Mitreisenden, auch ohne eigenes Konto.'
      )
    ).toBeTruthy();
  });

  test('"Kopieren" schreibt die URL in die Zwischenablage', async () => {
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-kopieren'));
    await waitFor(() => expect(mockSetStringAsync).toHaveBeenCalledWith(AKTIVER_LINK.url));
  });

  test('"Teilen" öffnet den System-Teilen-Dialog mit der URL', async () => {
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-teilen'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith({ message: AKTIVER_LINK.url }));
  });

  test('"Link deaktivieren" fragt nach, ruft bei Bestätigung widerrufeLink auf und zeigt danach die Erstellen-Ansicht', async () => {
    (widerrufeLink as jest.Mock).mockResolvedValue({ error: null });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-deaktivieren'));
    expect(mockAlertAuslösen).toHaveBeenCalled();
    await waitFor(() => expect(widerrufeLink).toHaveBeenCalledWith('tok123'));
    expect(await screen.findByTestId('teilen-erstellen')).toBeTruthy();
    expect(screen.queryByTestId('teilen-link-text')).toBeNull();
  });

  // Kernfall aus dem Auftrag: der Dialog muss WIRKLICH nachfragen, nicht nur
  // pro forma einen Alert zeigen — ein Abbrechen darf widerrufeLink NIE rufen.
  test('"Abbrechen" im Bestätigungsdialog widerruft NICHTS', async () => {
    mockAlertAuslösen.mockImplementation((_t: string, _m: string, knoepfe?: AlertKnopf[]) => {
      knoepfe?.find((k) => k.style === 'cancel')?.onPress?.();
    });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-deaktivieren'));
    expect(widerrufeLink).not.toHaveBeenCalled();
    expect(screen.getByTestId('teilen-link-text')).toBeTruthy();
  });

  test('ein Fehler beim Widerrufen bleibt beim bestehenden Link, zeigt die Ursache', async () => {
    (widerrufeLink as jest.Mock).mockResolvedValue({ error: 'Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.' });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-deaktivieren'));
    expect(await screen.findByText('Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.')).toBeTruthy();
    expect(screen.getByTestId('teilen-link-text')).toBeTruthy();
  });
});
