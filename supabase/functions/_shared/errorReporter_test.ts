// Docker-free, like process_test.ts/management_test.ts/reveal_test.ts: plain
// logic plus an injected `fetchImpl`, no real network, no `supabase start`
// needed. Covers exactly the two guarantees from the header comment of
// errorReporter.ts: (1) without a DSN nothing happens, (2) with a DSN it
// reports correctly and ONLY with the allowed fields, never the raw error
// object, never more than the passed-in primitives.

import { assert, assertEquals, assertExists } from 'jsr:@std/assert';
import { createErrorReporter } from './errorReporter.ts';

const VALID_DSN = 'https://public-key-abc@o123.ingest.example.com/456';

function fakeFetchFactory() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response('{"id":"abc"}', { status: 200 });
  };
  return { calls, fetchImpl };
}

// --- Without a DSN: complete no-op ------------------------------------------

Deno.test('createErrorReporter: without a DSN, fetchImpl is never called', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter('', 'test-function', fetchImpl);
  await report(new Error('should never arrive'));
  assertEquals(calls.length, 0);
});

Deno.test('createErrorReporter: a broken but set DSN becomes a silent no-op (no throw)', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter('not-a-url', 'test-function', fetchImpl);
  await report(new Error('x'));
  assertEquals(calls.length, 0);
});

Deno.test('createErrorReporter: a DSN without a public key becomes a silent no-op', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter('https://o123.ingest.example.com/456', 'test-function', fetchImpl);
  await report(new Error('x'));
  assertEquals(calls.length, 0);
});

// --- With a DSN: correct request ---------------------------------------------

Deno.test('createErrorReporter: with a DSN it posts to the Store API exactly once', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter(VALID_DSN, 'delete-account', fetchImpl);
  await report(new Error('deletion aborted'), { user_id: 'u-1', step: 'storage' });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://o123.ingest.example.com/api/456/store/');
  const headers = new Headers(calls[0].init.headers);
  assertEquals(headers.get('content-type'), 'application/json');
  const auth = headers.get('X-Sentry-Auth') ?? '';
  assert(auth.includes('sentry_key=public-key-abc'), auth);
  assert(auth.includes('sentry_version=7'), auth);

  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.message.message, 'deletion aborted');
  assertEquals(body.tags, { function: 'delete-account' });
  assertEquals(body.extra, { user_id: 'u-1', step: 'storage' });
  assertExists(body.event_id);
  // 32 hex characters, no hyphens, Sentry's Store API requires exactly this
  // shape.
  assertEquals(body.event_id.length, 32);
  assert(!body.event_id.includes('-'));
});

Deno.test('createErrorReporter: a path prefix in the DSN (self-hosted) survives before /api/', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter(
    'https://key@sentry.example.com/prefix/789',
    'share-link',
    fetchImpl,
  );
  await report(new Error('x'));
  assertEquals(calls[0].url, 'https://sentry.example.com/prefix/api/789/store/');
});

Deno.test('createErrorReporter: without context, extra stays empty but the call still succeeds', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter(VALID_DSN, 'media-urls', fetchImpl);
  await report(new Error('x'));
  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.extra, undefined);
});

// --- The privacy rule: never the raw error object, only .message -----------

Deno.test('createErrorReporter: a Postgres-like error object forwards ONLY .message, no other fields', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter(VALID_DSN, 'media-urls', fetchImpl);
  const pgError = {
    message: 'duplicate key value violates unique constraint',
    detail: 'Key (id)=(11111111-1111-4111-8111-111111111111) already exists.',
    hint: 'secret internal hint',
    code: '23505',
  };
  await report(pgError);
  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.message.message, 'duplicate key value violates unique constraint');
  const raw = String(calls[0].init.body);
  assert(!raw.includes('secret internal hint'));
  assert(!raw.includes('23505'));
  assert(!raw.includes('already exists'));
});

Deno.test('createErrorReporter: an error object with no message at all is rendered via String()', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter(VALID_DSN, 'media-urls', fetchImpl);
  await report('just a string');
  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.message.message, 'just a string');
});

// --- Never a throw, no matter what happens ----------------------------------

Deno.test('createErrorReporter: a network error in fetchImpl is swallowed, report() does not throw', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError('network unreachable');
  };
  const report = createErrorReporter(VALID_DSN, 'reveal-trip', fetchImpl);
  await report(new Error('x'));
  // No assertion needed beyond: the line above returned at all.
});

Deno.test('createErrorReporter: a 500 response from Sentry itself is not treated as a crash', async () => {
  const fetchImpl: typeof fetch = async () => new Response('broken', { status: 500 });
  const report = createErrorReporter(VALID_DSN, 'reveal-trip', fetchImpl);
  await report(new Error('x'));
});

Deno.test('createErrorReporter: sends an AbortSignal along, so a hanging Sentry cannot hold up the response', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const report = createErrorReporter(VALID_DSN, 'media-urls', fetchImpl);
  await report(new Error('x'));
  assert(calls[0].init.signal instanceof AbortSignal);
});
