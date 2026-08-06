// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen. Die Mocks dürfen deshalb nicht als direkte Werte
// im Objektliteral stehen (sie wären dort für immer undefined) — der Zugriff
// muss erst zur Aufrufzeit passieren. Gleiches Prinzip wie in
// mobile/src/lib/__tests__/secureSessionStorage.test.ts.
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { fetchTrips, createTrip, redeemInvite, peekInvite, removeMember } from '../tripsApi';

beforeEach(() => jest.clearAllMocks());

test('fetchTrips führt Mitglieder und eigenen Zähler zusammen', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [
          {
            id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
            status: 'active', owner_id: 'u1',
            trip_members: [
              { profiles: { display_name: 'Lea' } },
              { profiles: { display_name: 'Jonas' } },
            ],
          },
        ],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [{ trip_id: 't1', count: 7 }], error: null });

  const trips = await fetchTrips();
  expect(trips).toEqual([
    {
      id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', owner_id: 'u1',
      member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 7,
    },
  ]);
});

test('fetchTrips setzt den Zähler auf 0, wenn die Reise nicht in my_post_counts steht', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [{
          id: 't2', name: 'Neu', start_date: '2026-09-01', end_date: '2026-09-05',
          status: 'active', owner_id: 'u1', trip_members: [{ profiles: { display_name: 'Lea' } }],
        }],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [], error: null });

  const trips = await fetchTrips();
  expect(trips[0].my_post_count).toBe(0);
});

test('fetchTrips liefert bei einem Fehler eine leere Liste', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ order: async () => ({ data: null, error: { message: 'kaputt' } }) }),
  });
  await expect(fetchTrips()).resolves.toEqual([]);
});

test('createTrip gibt die neue id zurück', async () => {
  mockFrom.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'neu-1' }, error: null }) }) }),
  });
  const { id, error } = await createTrip({
    name: 'Sardinien', startDate: '2026-09-06', endDate: '2026-09-20', ownerId: 'u1',
  });
  expect(id).toBe('neu-1');
  expect(error).toBeNull();
});

test('createTrip meldet einen Fehler in deutscher Sprache', async () => {
  mockFrom.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }) }),
  });
  const { id, error } = await createTrip({
    name: 'X', startDate: '2026-09-06', endDate: '2026-09-20', ownerId: 'u1',
  });
  expect(id).toBeNull();
  expect(error).toBe('Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.');
});

test('peekInvite liefert die Vorschau', async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{
      trip_id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', member_count: 4, owner_display_name: 'Lea',
    }],
    error: null,
  });
  const preview = await peekInvite('abc');
  expect(preview?.owner_display_name).toBe('Lea');
  expect(mockRpc).toHaveBeenCalledWith('peek_invite', { p_code: 'abc' });
});

test('peekInvite liefert null bei unbekanntem Code', async () => {
  mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(peekInvite('weg')).resolves.toBeNull();
});

test('redeemInvite reicht den Status durch', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ status: 'joined', trip_id: 't1' }], error: null });
  await expect(redeemInvite('abc')).resolves.toEqual({ status: 'joined', trip_id: 't1' });
});

test('redeemInvite wertet einen Netzwerkfehler als not_found', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await expect(redeemInvite('abc')).resolves.toEqual({ status: 'not_found', trip_id: null });
});

test('removeMember löscht genau eine Mitgliedschaft', async () => {
  const eqUser = jest.fn(async () => ({ error: null }));
  const eqTrip = jest.fn(() => ({ eq: eqUser }));
  mockFrom.mockReturnValue({ delete: () => ({ eq: eqTrip }) });

  const { error } = await removeMember('t1', 'u2');
  expect(error).toBeNull();
  expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
  expect(eqUser).toHaveBeenCalledWith('user_id', 'u2');
});
