import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// Jest hoisting: the factory runs before this assignment, but `focus` is only
// read while rendering, and by then the variable stands.
let focus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
  useFocusEffect: (cb: () => void) => {
    focus = cb;
    cb();
  },
}));
jest.mock('@/features/trips/tripsApi', () => ({ fetchInviteCode: jest.fn() }));
jest.mock('@/features/trips/inviteLink', () => ({ createInviteUrl: (c: string) => `reelive://join/${c}` }));
jest.mock('react-native-qrcode-svg', () => 'QRCode');

import Invite from '../[id]/invite';
import { fetchInviteCode } from '@/features/trips/tripsApi';

const wrap = () => render(<ThemeProvider><Invite /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  focus = null;
  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: 'abc123', error: null });
});

test('says that friends can join at any time, even mid trip', async () => {
  await wrap();
  expect(await screen.findByText(/jederzeit dazukommen/)).toBeTruthy();
});

test('warns that removing someone renews the link', async () => {
  await wrap();
  expect(await screen.findByText(/Entfernst du jemanden aus der Reise, bekommt sie einen neuen Link/)).toBeTruthy();
});

test('shares the link through the system share sheet', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await wrap();
  await fireEvent.press(await screen.findByText('Link teilen'));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('reelive://join/abc123'),
    })
  );
});

test('reports a missing invite code and blocks sharing instead of sending nothing', async () => {
  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: null, error: null });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await wrap();
  expect(await screen.findByText(/Einladungslink konnte nicht geladen werden/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Link teilen'));
  expect(share).not.toHaveBeenCalled();
});

test('a read error is shown with its own message', async () => {
  const message = 'Du bist offline. Verbinde dich und probier es nochmal.';
  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: null, error: message });
  await wrap();
  expect(await screen.findByText(message)).toBeTruthy();
});

test('focusing again fetches a fresh code, an old one would share a dead QR code', async () => {
  await wrap();
  await screen.findByText('Link teilen');
  // The useFocusEffect mock fires on every render, so absolute call counts say
  // nothing here. What matters is that a focus run afterwards fetches the
  // fresh code and the screen takes it over.
  const before = (fetchInviteCode as jest.Mock).mock.calls.length;

  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: 'new999', error: null });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await act(async () => {
    focus?.();
  });
  expect((fetchInviteCode as jest.Mock).mock.calls.length).toBeGreaterThan(before);

  await fireEvent.press(screen.getByText('Link teilen'));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('reelive://join/new999') })
  );
});
