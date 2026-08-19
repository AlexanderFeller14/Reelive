import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

// Alert only shows a dialog in the test, without anyone tapping, the
// confirming (destructive) button fires automatically by default (same
// pattern as reise/__tests__/detail.test.tsx), individual tests override
// that for the cancel path.
type AlertButton = { text?: string; style?: string; onPress?: () => void };
const mockAlertTrigger = jest.fn((_title: string, _text: string, buttons?: AlertButton[]) => {
  buttons?.find((b) => b.style === 'destructive')?.onPress?.();
});
jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) =>
  mockAlertTrigger(args[0] as string, args[1] as string, args[2] as AlertButton[] | undefined)
);

const mockSetStringAsync = jest.fn((..._args: unknown[]) => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args) }));

// react-native exports `Share` as `require('./Libraries/Share/Share').default`
// (index.js), the class itself, with `share` as a STATIC method. The mock
// must have the same shape (`default.share`), otherwise `RN.Share` would
// be `undefined` in the component code and `Share.share(...)` would throw
// instead of the call being caught.
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve({ action: 'sharedAction' }));
jest.mock('react-native/Libraries/Share/Share', () => ({
  default: { share: (...args: unknown[]) => mockShare(...args) },
}));

jest.mock('../linkManagementApi', () => ({
  fetchActiveLink: jest.fn(),
  createLink: jest.fn(),
  revokeLink: jest.fn(),
}));

import { ShareSheetContent } from '../ShareSheetContent';
import { fetchActiveLink, createLink, revokeLink } from '../linkManagementApi';

const ACTIVE_LINK = { token: 'tok123', url: 'http://127.0.0.1:8081/teilen/tok123', expiresAt: null };

// @testing-library/react-native v14 is fully async, render() itself
// returns a Promise (pattern as in player.test.tsx: `await render(...)`).
async function wrap(tripId = 't1') {
  return render(<ShareSheetContent tripId={tripId} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertTrigger.mockImplementation((_title: string, _text: string, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
});

describe('Laden', () => {
  test('shows a loading indicator while fetchActiveLink is still running', async () => {
    (fetchActiveLink as jest.Mock).mockReturnValue(new Promise(() => {}));
    await wrap();
    expect(screen.getByTestId('teilen-sheet-laedt')).toBeTruthy();
  });

  test('a load error shows the cause and a retry button', async () => {
    (fetchActiveLink as jest.Mock).mockResolvedValue({ data: null, error: 'Du bist offline. Verbinde dich und probier es nochmal.' });
    await wrap();
    expect(await screen.findByText('Du bist offline. Verbinde dich und probier es nochmal.')).toBeTruthy();
    expect(screen.getByTestId('teilen-nochmal')).toBeTruthy();
  });

  test('"Nochmal versuchen" calls fetchActiveLink again', async () => {
    (fetchActiveLink as jest.Mock)
      .mockResolvedValueOnce({ data: null, error: 'Fehler' })
      .mockResolvedValueOnce({ data: ACTIVE_LINK, error: null });
    await wrap();
    await screen.findByTestId('teilen-nochmal');
    await fireEvent.press(screen.getByTestId('teilen-nochmal'));
    expect(await screen.findByTestId('teilen-link-text')).toBeTruthy();
    expect(fetchActiveLink).toHaveBeenCalledTimes(2);
  });
});

describe('No link: honesty hint, expiry choice, create', () => {
  beforeEach(() => {
    (fetchActiveLink as jest.Mock).mockResolvedValue({ data: null, error: null });
  });

  test('the honesty hint stands BEFORE creating, not only after', async () => {
    await wrap();
    expect(
      await screen.findByText(
        'Wer diesen Link hat, sieht den ganzen Recap: alle Momente aller Mitreisenden samt den Orten, an denen sie entstanden sind, auch ohne eigenes Konto.'
      )
    ).toBeTruthy();
    // No link created yet, the create action itself is visible,
    // "teilen-link-text" (the display of AN existing link) is not.
    expect(screen.getByTestId('teilen-erstellen')).toBeTruthy();
    expect(screen.queryByTestId('teilen-link-text')).toBeNull();
  });

  test('7 days is preselected', async () => {
    await wrap();
    await screen.findByTestId('teilen-erstellen');
    // No direct "is selected" text, the choice is checked via the value
    // passed to createLink (next test), here only that all three options
    // are offered.
    expect(screen.getByTestId('teilen-ablauf-7')).toBeTruthy();
    expect(screen.getByTestId('teilen-ablauf-30')).toBeTruthy();
    expect(screen.getByTestId('teilen-ablauf-unbegrenzt')).toBeTruthy();
  });

  test('"Link erstellen" calls createLink with the preselected choice (7 days) and then shows the link', async () => {
    (createLink as jest.Mock).mockResolvedValue({ data: ACTIVE_LINK, error: null });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-erstellen'));
    await waitFor(() => expect(createLink).toHaveBeenCalledWith('t1', 7));
    expect(await screen.findByTestId('teilen-link-text')).toBeTruthy();
  });

  test('a different expiry choice (unlimited) is passed on to createLink', async () => {
    (createLink as jest.Mock).mockResolvedValue({ data: ACTIVE_LINK, error: null });
    await wrap();
    await screen.findByTestId('teilen-erstellen');
    await fireEvent.press(screen.getByTestId('teilen-ablauf-unbegrenzt'));
    await fireEvent.press(screen.getByTestId('teilen-erstellen'));
    await waitFor(() => expect(createLink).toHaveBeenCalledWith('t1', null));
  });

  test('30 days is passed on to createLink', async () => {
    (createLink as jest.Mock).mockResolvedValue({ data: ACTIVE_LINK, error: null });
    await wrap();
    await screen.findByTestId('teilen-erstellen');
    await fireEvent.press(screen.getByTestId('teilen-ablauf-30'));
    await fireEvent.press(screen.getByTestId('teilen-erstellen'));
    await waitFor(() => expect(createLink).toHaveBeenCalledWith('t1', 30));
  });

  test('an error while creating stays in the "no link" phase with a visible cause', async () => {
    (createLink as jest.Mock).mockResolvedValue({ data: null, error: 'Diese Reise ist noch versiegelt.' });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-erstellen'));
    expect(await screen.findByText('Diese Reise ist noch versiegelt.')).toBeTruthy();
    expect(screen.queryByTestId('teilen-link-text')).toBeNull();
    // The create button stays operable (no deadlock in the loading state).
    expect(screen.getByTestId('teilen-erstellen')).toBeTruthy();
  });
});

describe('Existing link: display instead of creating a new one', () => {
  beforeEach(() => {
    (fetchActiveLink as jest.Mock).mockResolvedValue({ data: ACTIVE_LINK, error: null });
  });

  test('shows the existing link, WITHOUT calling createLink', async () => {
    await wrap();
    expect(await screen.findByTestId('teilen-link-text')).toHaveTextContent(ACTIVE_LINK.url);
    expect(createLink).not.toHaveBeenCalled();
    expect(screen.queryByTestId('teilen-erstellen')).toBeNull();
  });

  test('the honesty hint stands here too, before "Teilen" is pressed', async () => {
    await wrap();
    expect(
      await screen.findByText(
        'Wer diesen Link hat, sieht den ganzen Recap: alle Momente aller Mitreisenden samt den Orten, an denen sie entstanden sind, auch ohne eigenes Konto.'
      )
    ).toBeTruthy();
  });

  test('"Kopieren" writes the URL to the clipboard', async () => {
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-kopieren'));
    await waitFor(() => expect(mockSetStringAsync).toHaveBeenCalledWith(ACTIVE_LINK.url));
  });

  test('"Teilen" opens the system share dialog with the URL', async () => {
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-teilen'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith({ message: ACTIVE_LINK.url }));
  });

  test('"Link deaktivieren" asks first, calls revokeLink on confirmation, and then shows the create view', async () => {
    (revokeLink as jest.Mock).mockResolvedValue({ error: null });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-deaktivieren'));
    expect(mockAlertTrigger).toHaveBeenCalled();
    await waitFor(() => expect(revokeLink).toHaveBeenCalledWith('tok123'));
    expect(await screen.findByTestId('teilen-erstellen')).toBeTruthy();
    expect(screen.queryByTestId('teilen-link-text')).toBeNull();
  });

  // Core case from the brief: the dialog must REALLY ask, not just show an
  // Alert pro forma, canceling must NEVER call revokeLink.
  test('"Abbrechen" in the confirmation dialog revokes NOTHING', async () => {
    mockAlertTrigger.mockImplementation((_t: string, _m: string, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-deaktivieren'));
    expect(revokeLink).not.toHaveBeenCalled();
    expect(screen.getByTestId('teilen-link-text')).toBeTruthy();
  });

  test('an error while revoking stays on the existing link, shows the cause', async () => {
    (revokeLink as jest.Mock).mockResolvedValue({ error: 'Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.' });
    await wrap();
    await fireEvent.press(await screen.findByTestId('teilen-deaktivieren'));
    expect(await screen.findByText('Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.')).toBeTruthy();
    expect(screen.getByTestId('teilen-link-text')).toBeTruthy();
  });
});
