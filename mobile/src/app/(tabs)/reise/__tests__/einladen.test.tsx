import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/trips/tripsApi', () => ({ fetchInviteCode: jest.fn() }));
jest.mock('@/features/trips/inviteLink', () => ({ createInviteUrl: (c: string) => `reelive://join/${c}` }));
jest.mock('react-native-qrcode-svg', () => 'QRCode');

import Einladen from '../[id]/einladen';
import { fetchInviteCode } from '@/features/trips/tripsApi';

const wrap = () => render(<ThemeProvider><Einladen /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: 'abc123', error: null });
});

test('zeigt den Hinweis, dass man jederzeit dazukommen kann', async () => {
  await wrap();
  expect(await screen.findByText(/jederzeit dazukommen/)).toBeTruthy();
});

test('teilt den Link über das System-Share-Sheet', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await wrap();
  await fireEvent.press(await screen.findByText('Link teilen'));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('reelive://join/abc123'),
    })
  );
});

test('meldet, wenn kein Einladungscode kommt, und blockiert das Teilen', async () => {
  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: null, error: null });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await wrap();
  expect(await screen.findByText(/Einladungslink konnte nicht geladen werden/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Link teilen'));
  expect(share).not.toHaveBeenCalled();
});

test('ein Lesefehler wird mit seiner eigenen Meldung gezeigt', async () => {
  const meldung = 'Du bist offline. Verbinde dich und probier es nochmal.';
  (fetchInviteCode as jest.Mock).mockResolvedValue({ data: null, error: meldung });
  await wrap();
  expect(await screen.findByText(meldung)).toBeTruthy();
});
