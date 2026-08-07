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

import {
  fetchTrips, fetchTrip, fetchMembers, fetchInviteCode,
  createTrip, updateTrip, deleteTrip, removeMember,
  redeemInvite, peekInvite,
} from '../tripsApi';

beforeEach(() => jest.clearAllMocks());

// Schreib-Ketten enden seit dem Zeilen-Nachweis auf .select(...): PostgREST
// meldet einen von der Policy verworfenen Schreibvorgang nicht als Fehler,
// sondern als leeres Ergebnis.
type Antwort = { data: unknown; error: unknown };

// trips: .update(...)/.delete().eq('id', …).select('id')
const tripKette = (verb: 'update' | 'delete', ergebnis: Antwort) => {
  const select = jest.fn(async () => ergebnis);
  const eq = jest.fn(() => ({ select }));
  mockFrom.mockReturnValue({ [verb]: () => ({ eq }) });
  return { eq, select };
};

// trip_members: .delete().eq('trip_id', …).eq('user_id', …).select('user_id')
const mitgliedKette = (ergebnis: Antwort) => {
  const select = jest.fn(async () => ergebnis);
  const eqUser = jest.fn(() => ({ select }));
  const eqTrip = jest.fn(() => ({ eq: eqUser }));
  mockFrom.mockReturnValue({ delete: () => ({ eq: eqTrip }) });
  return { eqTrip, eqUser, select };
};

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

  const { data, error } = await fetchTrips();
  expect(error).toBeNull();
  expect(data).toEqual([
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

  const { data } = await fetchTrips();
  expect(data[0].my_post_count).toBe(0);
});

test('fetchTrips unterscheidet einen Ladefehler von einer leeren Liste', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ order: async () => ({ data: null, error: { message: 'kaputt' } }) }),
  });
  const { data, error } = await fetchTrips();
  expect(data).toEqual([]);
  // Ohne diese Meldung behauptet die Liste «Noch keine Reise» — eine falsche
  // Aussage über die Daten des Nutzers.
  expect(error).toBe('Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchTrips benennt den Offline-Fall statt nur «probier es nochmal»', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({ data: null, error: { message: 'TypeError: Network request failed' } }),
    }),
  });
  const { error } = await fetchTrips();
  expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
});

test('fetchTrip trennt «gibt es nicht» von «konnte nicht geladen werden»', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  });
  await expect(fetchTrip('t1')).resolves.toEqual({ data: null, error: null });

  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'kaputt' } }) }) }),
  });
  const { error } = await fetchTrip('t1');
  expect(error).toBe('Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchMembers meldet einen Lesefehler statt einer leeren Liste', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: 'kaputt' } }) }) }),
  });
  const { data, error } = await fetchMembers('t1');
  expect(data).toEqual([]);
  expect(error).toBe('Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchInviteCode meldet einen Lesefehler und liefert sonst den Code', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { invite_code: 'abc' }, error: null }) }) }),
  });
  await expect(fetchInviteCode('t1')).resolves.toEqual({ data: 'abc', error: null });

  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'kaputt' } }) }) }),
  });
  const { error } = await fetchInviteCode('t1');
  expect(error).toBe('Der Einladungslink konnte nicht geladen werden. Probier es gleich nochmal.');
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

// === Vertrag «0 betroffene Zeilen = Fehlschlag» ===
// Verwirft eine RLS-Policy den Schreibvorgang, liefert Postgres keinen Fehler,
// sondern UPDATE 0 / DELETE 0. Ohne diesen Vertrag meldeten die Funktionen
// Erfolg und der Detailscreen navigierte weg, als wäre die Reise gelöscht.

test('updateTrip meldet Erfolg, wenn eine Zeile betroffen war', async () => {
  const { eq, select } = tripKette('update', { data: [{ id: 't1' }], error: null });
  await expect(
    updateTrip('t1', { name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14' })
  ).resolves.toEqual({ error: null });
  expect(eq).toHaveBeenCalledWith('id', 't1');
  expect(select).toHaveBeenCalledWith('id');
});

test('updateTrip wertet null betroffene Zeilen als Fehlschlag', async () => {
  tripKette('update', { data: [], error: null });
  const { error } = await updateTrip('t1', {
    name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14',
  });
  expect(error).toBe('Die Änderung wurde nicht gespeichert. Die Reise gibt es nicht mehr, oder sie gehört dir nicht.');
});

test('updateTrip benennt den Offline-Fall', async () => {
  tripKette('update', { data: null, error: { message: 'TypeError: Network request failed' } });
  const { error } = await updateTrip('t1', {
    name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14',
  });
  expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
});

test('deleteTrip meldet Erfolg, wenn eine Zeile betroffen war', async () => {
  const { eq, select } = tripKette('delete', { data: [{ id: 't1' }], error: null });
  await expect(deleteTrip('t1')).resolves.toEqual({ error: null });
  expect(eq).toHaveBeenCalledWith('id', 't1');
  expect(select).toHaveBeenCalledWith('id');
});

test('deleteTrip wertet null betroffene Zeilen als Fehlschlag', async () => {
  tripKette('delete', { data: [], error: null });
  const { error } = await deleteTrip('t1');
  expect(error).toBe('Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.');
});

test('removeMember löscht genau eine Mitgliedschaft', async () => {
  const { eqTrip, eqUser, select } = mitgliedKette({ data: [{ user_id: 'u2' }], error: null });

  const { error } = await removeMember('t1', 'u2');
  expect(error).toBeNull();
  expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
  expect(eqUser).toHaveBeenCalledWith('user_id', 'u2');
  expect(select).toHaveBeenCalledWith('user_id');
});

test('removeMember wertet null betroffene Zeilen als Fehlschlag', async () => {
  mitgliedKette({ data: [], error: null });
  const { error } = await removeMember('t1', 'u2');
  expect(error).toBe('Das hat nicht geklappt. Die Mitgliedschaft gibt es nicht mehr, oder du darfst sie nicht beenden.');
});
