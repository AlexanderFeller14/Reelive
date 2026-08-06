import { renderHook, waitFor } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';

// Jest-Hoisting: Variablen in jest.mock-Factories MÜSSEN mit "mock" beginnen
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockUnsubscribe = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle() }) }),
    }),
  },
}));

import { AuthProvider, useAuth } from '../AuthProvider';

const fakeSession = { user: { id: 'uid-1' } } as unknown as Session;

beforeEach(() => {
  jest.clearAllMocks();
  // Standard: onAuthStateChange liefert eine abbestellbare Subscription,
  // feuert in diesen Tests aber nicht von selbst (Verhalten wird über getSession gesteuert).
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mockUnsubscribe } } });
});

test('Session + Profil-Zeile vorhanden → signedIn', async () => {
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockMaybeSingle.mockResolvedValue({ data: { id: 'uid-1' }, error: null });

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).toBe('signedIn'));
});

test('Session + keine Zeile (kein Fehler) → needsProfile', async () => {
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).toBe('needsProfile'));
});

test('Session + Query-Fehler (z.B. RLS) → signedIn, NICHT needsProfile', async () => {
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'RLS-Verletzung' } });

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(result.current.status).not.toBe('needsProfile');
});

test('getSession() rejected → Status bleibt nicht auf loading hängen (signedOut ohne Session)', async () => {
  mockGetSession.mockRejectedValue(new Error('Netzwerkfehler'));

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).not.toBe('loading'));
  expect(result.current.status).toBe('signedOut');
});
