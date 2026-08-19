// Jest hoisting: jest.mock moves above the imports, so the factory runs
// BEFORE the const assignments. Access to the mocks is therefore only
// possible at call time (same pattern as in momentsApi.test.ts/
// tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  fetchReactions,
  setReaction,
  removeReaction,
  fetchComments,
  writeComment,
} from '../socialApi';

const SESSION_OK = { data: { session: { user: { id: 'u1' } } }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION_OK);
});

// reactions: .select('post_id, user_id, emoji').in('post_id', […]).order('created_at', …)
function reactionsChain(result: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => result);
  const inFn = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ in: inFn }));
  mockFrom.mockReturnValue({ select });
  return { select, in: inFn, order };
}

// reactions: .upsert(values, options)
type UpsertOptions = { onConflict?: string; ignoreDuplicates?: boolean };
function upsertChain(result: { error: unknown }) {
  const upsert = jest.fn(async (_values: unknown, _options: UpsertOptions) => result);
  mockFrom.mockReturnValue({ upsert });
  return { upsert };
}

// reactions: .delete().eq('post_id', …).eq('user_id', …).eq('emoji', …)
function deleteChain(result: { error: unknown }) {
  const eq3 = jest.fn(async () => result);
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  const del = jest.fn(() => ({ eq: eq1 }));
  mockFrom.mockReturnValue({ delete: del });
  return { delete: del, eq1, eq2, eq3 };
}

// comments: .select(…).eq('post_id', …).order('created_at', …)
function commentsChain(result: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => result);
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq, order };
}

// comments: .insert(values)
function insertChain(result: { error: unknown }) {
  const insert = jest.fn(async () => result);
  mockFrom.mockReturnValue({ insert });
  return { insert };
}

describe('fetchReactions', () => {
  test('fetches reactions for several moments in ONE call and groups them by post_id', async () => {
    const chain = reactionsChain({
      data: [
        { post_id: 'p1', user_id: 'u1', emoji: '❤️' },
        { post_id: 'p1', user_id: 'u2', emoji: '😂' },
        { post_id: 'p2', user_id: 'u1', emoji: '👏' },
      ],
      error: null,
    });
    const result = await fetchReactions(['p1', 'p2']);
    expect(mockFrom).toHaveBeenCalledTimes(1); // ONE call for both moments, not two
    // Phase-5 final review, point 8 (review finding): mockFrom was until now
    // never checked against the TABLE NAME anywhere in this file, only
    // against the call count (toHaveBeenCalledTimes/not.toHaveBeenCalled).
    // Wrongly reading/writing reactions in `comments` would leave the whole
    // file green. Same pattern as recapApi.test.ts:56
    // (`toHaveBeenCalledWith('posts')`).
    expect(mockFrom).toHaveBeenCalledWith('reactions');
    expect(chain.select).toHaveBeenCalledWith('post_id, user_id, emoji');
    expect(chain.in).toHaveBeenCalledWith('post_id', ['p1', 'p2']);
    // Review finding (Minor 4B/4C from fix round 1): unchecked, both the
    // queried column list and the ordering could be silently removed, no
    // other test in this file watches fetchReactions' `select`/`order` call
    // closely.
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      p1: [
        { post_id: 'p1', user_id: 'u1', emoji: '❤️' },
        { post_id: 'p1', user_id: 'u2', emoji: '😂' },
      ],
      p2: [{ post_id: 'p2', user_id: 'u1', emoji: '👏' }],
    });
  });

  test('a moment with no reactions at all gets no key (no empty-array noise)', async () => {
    reactionsChain({ data: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }], error: null });
    const result = await fetchReactions(['p1', 'p2']);
    expect(result.data).toEqual({ p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] });
    expect('p2' in result.data).toBe(false);
  });

  test('an empty list does not call Supabase at all', async () => {
    const result = await fetchReactions([]);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result).toEqual({ data: {}, error: null });
  });

  test('network error → offline hint', async () => {
    reactionsChain({ data: null, error: { message: 'Network request failed' } });
    const result = await fetchReactions(['p1']);
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(result.data).toEqual({});
  });

  test('another error → generic German message', async () => {
    reactionsChain({ data: null, error: { message: 'kaputt' } });
    const result = await fetchReactions(['p1']);
    expect(result.error).toBe('Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});

describe('setReaction', () => {
  test('success: upsert with ignoreDuplicates instead of a raw insert', async () => {
    const chain = upsertChain({ error: null });
    const result = await setReaction('p1', '❤️');
    expect(result).toEqual({ error: null });
    // Phase-5 final review, point 8: see the comment at fetchReactions above.
    expect(mockFrom).toHaveBeenCalledWith('reactions');
    expect(chain.upsert).toHaveBeenCalledWith(
      { post_id: 'p1', user_id: 'u1', emoji: '❤️' },
      { onConflict: 'post_id,user_id,emoji', ignoreDuplicates: true }
    );
  });

  // A mutant that sets ignoreDuplicates to false (or removes it) would
  // produce a server-side ON-CONFLICT-DO-UPDATE, which would fail on the
  // missing UPDATE grant (see the comment in socialApi.ts). This exact
  // object check catches such a silent regression from the very first run,
  // not only at the (in tests invisible) DB grant.
  test('ignoreDuplicates is literally true, not just truthy', async () => {
    const chain = upsertChain({ error: null });
    await setReaction('p1', '❤️');
    const [, options] = chain.upsert.mock.calls[0];
    expect(options.ignoreDuplicates).toBe(true);
  });

  test('without a session: no call, a clear German message', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await setReaction('p1', '❤️');
    expect(result.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('network error → offline hint', async () => {
    upsertChain({ error: { message: 'Network request failed' } });
    const result = await setReaction('p1', '❤️');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('another error → generic German message', async () => {
    upsertChain({ error: { message: 'kaputt' } });
    const result = await setReaction('p1', '❤️');
    expect(result.error).toBe('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.');
  });
});

describe('removeReaction', () => {
  test('success: deletes exactly post_id + own user_id + emoji, in that order', async () => {
    const chain = deleteChain({ error: null });
    const result = await removeReaction('p1', '❤️');
    expect(result).toEqual({ error: null });
    // Phase-5 final review, point 8: see the comment at fetchReactions above.
    expect(mockFrom).toHaveBeenCalledWith('reactions');
    expect(chain.eq1).toHaveBeenCalledWith('post_id', 'p1');
    expect(chain.eq2).toHaveBeenCalledWith('user_id', 'u1');
    expect(chain.eq3).toHaveBeenCalledWith('emoji', '❤️');
  });

  test('without a session: no call, a clear German message', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await removeReaction('p1', '❤️');
    expect(result.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('network error → offline hint', async () => {
    deleteChain({ error: { message: 'Network request failed' } });
    const result = await removeReaction('p1', '❤️');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('another error → generic German message', async () => {
    deleteChain({ error: { message: 'kaputt' } });
    const result = await removeReaction('p1', '❤️');
    expect(result.error).toBe('Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.');
  });
});

describe('fetchComments', () => {
  test('success: author name comes from the profiles join', async () => {
    commentsChain({
      data: [
        {
          id: 'c1', post_id: 'p1', user_id: 'u1', text: 'Schön hier!',
          created_at: '2026-08-10T09:05:00.000Z', profiles: { display_name: 'Lea' },
        },
      ],
      error: null,
    });
    const result = await fetchComments('p1');
    expect(result.error).toBeNull();
    // Phase-5 final review, point 8: see the comment at fetchReactions
    // above, here for `comments` instead of `reactions`.
    expect(mockFrom).toHaveBeenCalledWith('comments');
    expect(result.data).toEqual([
      {
        id: 'c1', post_id: 'p1', user_id: 'u1', text: 'Schön hier!',
        created_at: '2026-08-10T09:05:00.000Z', authorName: 'Lea',
      },
    ]);
  });

  test('a missing profile → an empty author name instead of a crash', async () => {
    commentsChain({
      data: [{ id: 'c1', post_id: 'p1', user_id: 'u1', text: 'x', created_at: 't', profiles: null }],
      error: null,
    });
    const result = await fetchComments('p1');
    expect(result.data[0].authorName).toBe('');
  });

  test('queries exactly the one given moment, in chronological order', async () => {
    const chain = commentsChain({ data: [], error: null });
    await fetchComments('p7');
    expect(chain.eq).toHaveBeenCalledWith('post_id', 'p7');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  // Review finding (Minor 4B from fix round 1): the success test above feeds
  // `profiles` into the mock response independently of the column list
  // actually queried, removing `profiles(display_name)` from the real
  // `select()` call would stay unnoticed and green, even though every
  // author name would be empty in production. This check watches the call
  // itself closely.
  test('also queries the author name via the profiles join', async () => {
    const chain = commentsChain({ data: [], error: null });
    await fetchComments('p1');
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('profiles(display_name)'));
  });

  test('network error → offline hint, an empty list instead of throwing', async () => {
    commentsChain({ data: null, error: { message: 'Network request failed' } });
    const result = await fetchComments('p1');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(result.data).toEqual([]);
  });
});

describe('writeComment', () => {
  test('success: sends the trimmed text with the caller\'s own user_id', async () => {
    const chain = insertChain({ error: null });
    const result = await writeComment('p1', '  Toller Moment!  ');
    expect(result).toEqual({ error: null });
    // Phase-5 final review, point 8: see the comment at fetchReactions above.
    expect(mockFrom).toHaveBeenCalledWith('comments');
    expect(chain.insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', text: 'Toller Moment!' });
  });

  test('empty text is rejected BEFORE any call, no session needed, no insert', async () => {
    const result = await writeComment('p1', '');
    expect(result.error).toBe('Schreib etwas, bevor du sendest.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('whitespace only counts as empty', async () => {
    const result = await writeComment('p1', '    ');
    expect(result.error).toBe('Schreib etwas, bevor du sendest.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // The database check allows exactly 1–500 characters, 500 must go
  // through, 501 must be rejected BEFORE the network call. A mutant
  // replacing `>` with `>=` would fail the first test; one that removes the
  // check entirely would fail the second (insert would get called).
  test('exactly 500 characters is allowed', async () => {
    const chain = insertChain({ error: null });
    const text = 'a'.repeat(500);
    const result = await writeComment('p1', text);
    expect(result).toEqual({ error: null });
    expect(chain.insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', text });
  });

  test('501 characters is rejected BEFORE sending, no call to Supabase', async () => {
    const result = await writeComment('p1', 'a'.repeat(501));
    expect(result.error).toBe('Kommentare dürfen höchstens 500 Zeichen haben.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('without a session: no insert, a clear German message', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await writeComment('p1', 'Hallo');
    expect(result.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('network error on insert → offline hint', async () => {
    insertChain({ error: { message: 'Network request failed' } });
    const result = await writeComment('p1', 'Hallo');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('another error on insert → generic German message', async () => {
    insertChain({ error: { message: 'kaputt' } });
    const result = await writeComment('p1', 'Hallo');
    expect(result.error).toBe('Dein Kommentar konnte nicht gesendet werden. Probier es gleich nochmal.');
  });
});
