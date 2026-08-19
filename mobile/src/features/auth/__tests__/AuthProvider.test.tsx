import { renderHook, waitFor } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';

// Jest hoisting: variables in jest.mock factories MUST start with "mock".
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
  // Default: onAuthStateChange returns an unsubscribable subscription, but
  // does not fire on its own in these tests (behavior is steered via
  // getSession).
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mockUnsubscribe } } });
});

test('session + profile row present → signedIn', async () => {
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockMaybeSingle.mockResolvedValue({ data: { id: 'uid-1' }, error: null });

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).toBe('signedIn'));
});

test('session + no row (no error) → needsProfile', async () => {
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).toBe('needsProfile'));
});

test('session + query error (e.g. RLS) → signedIn, NOT needsProfile', async () => {
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'RLS-Verletzung' } });

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(result.current.status).not.toBe('needsProfile');
});

test('getSession() rejected → status does not stay stuck on loading (signedOut without a session)', async () => {
  mockGetSession.mockRejectedValue(new Error('Netzwerkfehler'));

  const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.status).not.toBe('loading'));
  expect(result.current.status).toBe('signedOut');
});
