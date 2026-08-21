// Same mock shape as urlPool.test.ts: the factory creates its own jest.fn(),
// no outer variable to worry about hoisting order for.
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

import { supabase } from '@/lib/supabase';
import { fetchCovers } from '../coversApi';

beforeEach(() => jest.clearAllMocks());

test('turns the answer into a map from trip to url', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({
    data: { covers: [{ trip_id: 't1', thumb_url: 'https://x/1.jpg' }], valid_until: '2026-08-21T10:00:00Z' },
    error: null,
  });
  const covers = await fetchCovers(['t1']);
  expect(covers.get('t1')).toBe('https://x/1.jpg');
});

test('an error yields an empty map, never a throw: the list must not depend on covers', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'boom' } });
  expect((await fetchCovers(['t1'])).size).toBe(0);
});

test('a malformed answer yields an empty map as well', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { covers: 'nope' }, error: null });
  expect((await fetchCovers(['t1'])).size).toBe(0);
});

test('without trip ids no call goes out at all', async () => {
  (supabase.functions.invoke as jest.Mock).mockClear();
  expect((await fetchCovers([])).size).toBe(0);
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
});
