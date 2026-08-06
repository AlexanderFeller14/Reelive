import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/trips/tripsApi', () => ({ fetchInviteCode: jest.fn(async () => 'abc123') }));
jest.mock('@/features/trips/inviteLink', () => ({ createInviteUrl: (c: string) => `reelive://join/${c}` }));
jest.mock('react-native-qrcode-svg', () => 'QRCode');

import Einladen from '../[id]/einladen';
import { fetchInviteCode } from '@/features/trips/tripsApi';

const wrap = () => render(<ThemeProvider><Einladen /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

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
  (fetchInviteCode as jest.Mock).mockResolvedValueOnce(null);
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await wrap();
  expect(await screen.findByText(/Einladungslink konnte nicht geladen werden/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Link teilen'));
  expect(share).not.toHaveBeenCalled();
});
