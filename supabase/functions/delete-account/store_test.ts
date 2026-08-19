// Docker-free unit tests for the S3 delete path from store.ts, in response
// to the final-review finding (point 1): `deleteObjects` used to run over
// the Supabase storage API, the only place in the repo that did not sign
// via `S3_ENDPOINT`. This file replaces no integration test, the claim
// "objects are REALLY gone after the deletion" can only be proven by a test
// against the real stack (delete_account_integration_test.ts, via the
// storage REST API, independent of the S3 path here). What is checked here
// with no Docker is the pure logic over it: blocking, short-circuit on a
// real error, AND, the actual trap from the review finding, that a
// "successful" response for an already-missing key does NOT get mistaken
// for proof that it existed before.

import { assert, assertEquals } from 'jsr:@std/assert';
import { createS3Deleter, type DeleteOneResult, deleteObjectsInBlocks } from './store.ts';

// --- deleteObjectsInBlocks: pure logic, fake deleteOne ----------------------

function alwaysOk(): (key: string) => Promise<DeleteOneResult> {
  return (_key: string) => Promise.resolve({ ok: true, status: 204 });
}

Deno.test('deleteObjectsInBlocks: an empty list triggers no call', async () => {
  let calls = 0;
  const deleteOne = (_k: string) => {
    calls++;
    return Promise.resolve({ ok: true, status: 204 });
  };
  const result = await deleteObjectsInBlocks([], deleteOne);
  assertEquals(result, { error: null });
  assertEquals(calls, 0);
});

Deno.test('deleteObjectsInBlocks: every key gets exactly one call', async () => {
  const seen: string[] = [];
  const deleteOne = (k: string) => {
    seen.push(k);
    return Promise.resolve({ ok: true, status: 204 });
  };
  const keys = Array.from({ length: 5 }, (_, i) => `trips/t/${i}/medium.jpg`);
  const result = await deleteObjectsInBlocks(keys, deleteOne);
  assertEquals(result, { error: null });
  assertEquals(seen.sort(), [...keys].sort());
});

Deno.test('deleteObjectsInBlocks: more keys than the block size run through in several blocks', async () => {
  const blocks: number[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const deleteOne = async (_k: string) => {
    inFlight++;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    await Promise.resolve();
    inFlight--;
    return { ok: true, status: 204 };
  };
  const keys = Array.from({ length: 12 }, (_, i) => `k-${i}`);
  await deleteObjectsInBlocks(keys, deleteOne, 5);
  // 12 keys, block size 5 -> three blocks (5/5/2). Within a block it runs
  // in parallel (Promise.all), between blocks in sequence, the maximum
  // concurrency must never exceed the block size.
  assert(maxConcurrent <= 5, `maxGleichzeitig war ${maxConcurrent}`);
  void blocks;
});

Deno.test('deleteObjectsInBlocks: a single failure in the block aborts immediately, with the error as the cause', async () => {
  const attempted: string[] = [];
  const deleteOne = (k: string) => {
    attempted.push(k);
    if (k === 'k-1') return Promise.resolve({ ok: false, status: 403, error: new Error('Zugriff verweigert') });
    return Promise.resolve({ ok: true, status: 204 });
  };
  const result = await deleteObjectsInBlocks(['k-0', 'k-1', 'k-2'], deleteOne, 10);
  assert(result.error instanceof Error);
  assertEquals((result.error as Error).message, 'Zugriff verweigert');
  // All three sit in the same block (block size 10) and run in parallel,
  // all three get attempted before the error is evaluated.
  assertEquals(attempted.sort(), ['k-0', 'k-1', 'k-2']);
});

Deno.test('deleteObjectsInBlocks: a failure in the FIRST block prevents the second block', async () => {
  const attempted: string[] = [];
  const deleteOne = (k: string) => {
    attempted.push(k);
    return Promise.resolve({ ok: false, status: 500 });
  };
  const keys = ['a', 'b', 'c', 'd'];
  const result = await deleteObjectsInBlocks(keys, deleteOne, 2);
  assert(result.error !== null);
  // Block 1 is ['a', 'b'], block 2 ('c', 'd') must not even start.
  assertEquals(attempted, ['a', 'b']);
});

Deno.test('deleteObjectsInBlocks: a failure with no error object of its own gets a fallback message with the HTTP status', async () => {
  const deleteOne = (_k: string) => Promise.resolve({ ok: false, status: 403 });
  const result = await deleteObjectsInBlocks(['x'], deleteOne);
  assert(result.error instanceof Error);
  assert((result.error as Error).message.includes('403'));
});

// --- createS3Deleter: the real signing, with an injected fetchImpl ---------
// No real network, no real SigV4 check (the integration test against the
// running storage service handles that), here only checked is THAT a
// DELETE request goes to the right path, with which method, and that the
// response gets translated correctly into {ok, status}.

function fakeAws(): { sign: (url: string, init: RequestInit & { aws?: unknown }) => Promise<Request> } {
  return {
    sign: (url: string, init: RequestInit & { aws?: unknown }) =>
      Promise.resolve(new Request(url, { method: init.method })),
  };
}

Deno.test('createS3Deleter: signs a DELETE request against endpoint/bucket/key', async () => {
  const seen: { url: string; method: string }[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const req = input as Request;
    seen.push({ url: req.url, method: req.method });
    return new Response(null, { status: 204 });
  };
  // deno-lint-ignore no-explicit-any
  const deleteOne = createS3Deleter(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const result = await deleteOne('trips/t-1/p-1/medium.jpg');
  assertEquals(result, { ok: true, status: 204 });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].method, 'DELETE');
  assertEquals(seen[0].url, 'https://s3.example.com/media/trips/t-1/p-1/medium.jpg');
});

// The actual trap from the review finding: "got back less than requested"
// (here: a success status for a key that has long been missing) must NOT
// count as a failure, S3-compatible object storages answer a DELETE
// against a non-(no longer)-existing key the same way as against an
// existing one.
Deno.test('createS3Deleter: a 204 for an (already) missing key is NOT an error', async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });
  // deno-lint-ignore no-explicit-any
  const deleteOne = createS3Deleter(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const result = await deleteOne('trips/t-1/schon-weg.jpg');
  assertEquals(result.ok, true);
});

Deno.test('createS3Deleter: a real error status (e.g. 403) is reported as a failure', async () => {
  const fetchImpl: typeof fetch = async () => new Response('Forbidden', { status: 403 });
  // deno-lint-ignore no-explicit-any
  const deleteOne = createS3Deleter(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const result = await deleteOne('trips/t-1/p-1/medium.jpg');
  assertEquals(result.ok, false);
  assertEquals(result.status, 403);
});

Deno.test('createS3Deleter: a network error does not throw, it returns {ok:false, error}', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError('Netzwerk nicht erreichbar');
  };
  // deno-lint-ignore no-explicit-any
  const deleteOne = createS3Deleter(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const result = await deleteOne('k');
  assertEquals(result.ok, false);
  assert(result.error instanceof TypeError);
});

// --- The two layers together: deleteObjectsInBlocks + createS3Deleter -----

Deno.test('deleteObjectsInBlocks + createS3Deleter: a second delete attempt on already-deleted keys stays error-free', async () => {
  const deleted = new Set<string>();
  const fetchImpl: typeof fetch = async (input) => {
    const req = input as Request;
    // Simulates real S3 behaviour: the first deletion really removes the
    // object, every further request against the same key still counts as
    // a success (204), not a 404, as described in the header comment of
    // createS3Deleter.
    deleted.add(req.url);
    return new Response(null, { status: 204 });
  };
  // deno-lint-ignore no-explicit-any
  const deleteOne = createS3Deleter(fakeAws() as any, 'https://s3.example.com', 'media', fetchImpl);
  const keys = ['trips/t/1/medium.jpg', 'trips/t/1/thumb.jpg'];

  const first = await deleteObjectsInBlocks(keys, deleteOne);
  assertEquals(first, { error: null });
  assertEquals(deleted.size, 2);

  // Second attempt against the SAME (now already deleted) keys, must also
  // run through error-free (idempotency, which process.ts relies on when a
  // second attempt starts after a partial abort).
  const second = await deleteObjectsInBlocks(keys, deleteOne);
  assertEquals(second, { error: null });
});
