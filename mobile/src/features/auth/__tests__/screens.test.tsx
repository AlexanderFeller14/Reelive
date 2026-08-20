import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({ phone: '+41790000001' }),
}));
jest.mock('../authApi', () => ({
  requestOtp: jest.fn(async () => ({ error: null })),
  verifyOtp: jest.fn(async () => ({ error: 'Der Code stimmt nicht oder ist abgelaufen. Fordere einen neuen an.' })),
}));

// Path adjustment (Task-8 context, deviation 2): the router root is mobile/src/app/,
// not mobile/app/, three levels up from __tests__/ to src/, then app/(auth)/...
import PhoneScreen from '../../../app/(auth)/phone';
import OtpScreen from '../../../app/(auth)/otp';
import { requestOtp } from '../authApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('phone: an invalid number shows an error, does not call for an OTP', async () => {
  await wrap(<PhoneScreen />);
  await fireEvent.changeText(screen.getByLabelText('Handynummer'), 'abc');
  await fireEvent.press(screen.getByText('Code senden'));
  expect(await screen.findByText(/keine gültige Handynummer/)).toBeTruthy();
  expect(requestOtp).not.toHaveBeenCalled();
});

test('phone: a valid number requests a code and navigates onward', async () => {
  await wrap(<PhoneScreen />);
  await fireEvent.changeText(screen.getByLabelText('Handynummer'), '079 000 00 01');
  await fireEvent.press(screen.getByText('Code senden'));
  await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+41790000001'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/otp', params: { phone: '+41790000001' } });
});

test("otp: a wrong code shows the API's error message", async () => {
  await wrap(<OtpScreen />);
  await fireEvent.changeText(screen.getByLabelText('Code'), '000000');
  await fireEvent.press(screen.getByText('Bestätigen'));
  expect(await screen.findByText(/stimmt nicht oder ist abgelaufen/)).toBeTruthy();
});

// «Resend code» used to discard the result of requestOtp: whether a new code
// was on its way or Supabase had rejected it with 429 looked the same.
test('otp: resending confirms visibly', async () => {
  (requestOtp as jest.Mock).mockResolvedValueOnce({ error: null });
  await wrap(<OtpScreen />);
  await fireEvent.press(screen.getByText('Code erneut senden'));
  expect(await screen.findByText('Neuer Code ist unterwegs.')).toBeTruthy();
});

test('otp: a rejected resend names the reason', async () => {
  (requestOtp as jest.Mock).mockResolvedValueOnce({
    error: 'Zu viele Versuche. Warte kurz und fordere dann einen neuen Code an.',
  });
  await wrap(<OtpScreen />);
  await fireEvent.press(screen.getByText('Code erneut senden'));
  expect(await screen.findByText(/Zu viele Versuche/)).toBeTruthy();
});
