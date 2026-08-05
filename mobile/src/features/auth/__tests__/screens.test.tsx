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

// Pfad-Anpassung (Task-8-Kontext, Abweichung 2): Router-Root ist mobile/src/app/,
// nicht mobile/app/ — von __tests__/ drei Ebenen hoch zu src/, dann app/(auth)/...
import PhoneScreen from '../../../app/(auth)/phone';
import OtpScreen from '../../../app/(auth)/otp';
import { requestOtp } from '../authApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('phone: ungültige Nummer zeigt Fehler, ruft kein OTP an', async () => {
  await wrap(<PhoneScreen />);
  await fireEvent.changeText(screen.getByLabelText('Handynummer'), 'abc');
  await fireEvent.press(screen.getByText('Code senden'));
  expect(await screen.findByText(/keine gültige Handynummer/)).toBeTruthy();
  expect(requestOtp).not.toHaveBeenCalled();
});

test('phone: gültige Nummer fordert Code an und navigiert weiter', async () => {
  await wrap(<PhoneScreen />);
  await fireEvent.changeText(screen.getByLabelText('Handynummer'), '079 000 00 01');
  await fireEvent.press(screen.getByText('Code senden'));
  await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+41790000001'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/otp', params: { phone: '+41790000001' } });
});

test('otp: falscher Code zeigt die Fehlermeldung der API', async () => {
  await wrap(<OtpScreen />);
  await fireEvent.changeText(screen.getByLabelText('Code'), '000000');
  await fireEvent.press(screen.getByText('Bestätigen'));
  expect(await screen.findByText(/stimmt nicht oder ist abgelaufen/)).toBeTruthy();
});
