import { assertEquals } from 'jsr:@std/assert';
import { toBlocks, send, tokensToDelete, type PushMessage } from './push.ts';

function message(token: string): PushMessage {
  return { to: token, title: 't', body: 'b', data: {} };
}

// --- toBlocks ----------------------------------------------------------------

Deno.test('toBlocks: an empty list yields no blocks', () => {
  assertEquals(toBlocks([], 100), []);
});

Deno.test('toBlocks: one entry yields one block with one entry', () => {
  assertEquals(toBlocks([1], 100), [[1]]);
});

Deno.test('toBlocks: exactly 100 entries yield exactly one block', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const blocks = toBlocks(items, 100);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].length, 100);
});

Deno.test('toBlocks: 101 entries yield two blocks, the last with one entry', () => {
  const items = Array.from({ length: 101 }, (_, i) => i);
  const blocks = toBlocks(items, 100);
  assertEquals(blocks.length, 2);
  assertEquals(blocks[0].length, 100);
  assertEquals(blocks[1].length, 1);
});

Deno.test('toBlocks: 250 entries yield three blocks (100/100/50)', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const blocks = toBlocks(items, 100);
  assertEquals(blocks.length, 3);
  assertEquals(blocks.map((b) => b.length), [100, 100, 50]);
});

// --- tokensToDelete ------------------------------------------------------------

Deno.test('tokensToDelete: recognizes exactly the DeviceNotRegistered tickets', () => {
  const tokens = ['tok-ok', 'tok-tot', 'tok-anderer-fehler'];
  const tickets = [
    { status: 'ok', id: 'xyz' },
    { status: 'error', message: 'weg', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'zu gross', details: { error: 'MessageTooBig' } },
  ];
  assertEquals(tokensToDelete(tickets, tokens), ['tok-tot']);
});

Deno.test('tokensToDelete: ignores errors with no details.error', () => {
  const tokens = ['tok-a', 'tok-b'];
  const tickets = [
    { status: 'error' },
    { status: 'error', details: {} },
  ];
  assertEquals(tokensToDelete(tickets, tokens), []);
});

Deno.test('tokensToDelete: unusable shapes do not throw and yield []', () => {
  assertEquals(tokensToDelete(null, ['a']), []);
  assertEquals(tokensToDelete(undefined, ['a']), []);
  assertEquals(tokensToDelete('kaputt', ['a']), []);
  assertEquals(tokensToDelete([{ status: 'error', details: null }], ['a']), []);
});

Deno.test('tokensToDelete: more tickets than tokens does not read past the end', () => {
  const tokens = ['tok-a'];
  const tickets = [
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
  ];
  assertEquals(tokensToDelete(tickets, tokens), ['tok-a']);
});

// --- send ----------------------------------------------------------------------

Deno.test('send: 150 messages trigger exactly two requests', async () => {
  const messages = Array.from({ length: 150 }, (_, i) => message(`tok-${i}`));
  let calls = 0;
  const sizes: number[] = [];

  const fakeFetch: typeof fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body)) as PushMessage[];
    sizes.push(body.length);
    return new Response(JSON.stringify({ data: body.map(() => ({ status: 'ok' })), errors: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const toDelete = await send(messages, fakeFetch);
  assertEquals(calls, 2);
  assertEquals(sizes, [100, 50]);
  assertEquals(toDelete, []);
});

Deno.test('send: collects DeviceNotRegistered tokens across multiple blocks', async () => {
  const messages = Array.from({ length: 101 }, (_, i) => message(`tok-${i}`));

  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as PushMessage[];
    const data = body.map((n, i) => {
      // First block: the very first message "dead". Second block: the only
      // message "dead".
      if (body.length === 100 && i === 0) {
        return { status: 'error', details: { error: 'DeviceNotRegistered' } };
      }
      if (body.length === 1) {
        return { status: 'error', details: { error: 'DeviceNotRegistered' } };
      }
      return { status: 'ok' };
    });
    return new Response(JSON.stringify({ data, errors: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const toDelete = await send(messages, fakeFetch);
  assertEquals(toDelete, ['tok-0', 'tok-100']);
});

Deno.test('send: sends the correct headers and target path', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify({ data: [{ status: 'ok' }], errors: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await send([message('tok-0')], fakeFetch);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, 'https://exp.host/--/api/v2/push/send');
  assertEquals(seen[0].headers['accept'], 'application/json');
  assertEquals(seen[0].headers['content-type'], 'application/json');
});

Deno.test('send: a network error in one block does not throw and yields no hits for it', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body)) as PushMessage[];
    if (body[0].to.startsWith('block1')) {
      throw new TypeError('Netzwerk nicht erreichbar');
    }
    return new Response(
      JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }], errors: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const messages = [
    ...Array.from({ length: 100 }, (_, i) => message(`block1-${i}`)),
    message('block2-0'),
  ];
  const toDelete = await send(messages, fakeFetch);
  assertEquals(calls, 2);
  assertEquals(toDelete, ['block2-0']);
});

Deno.test('send: an empty message list triggers no request', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    return new Response('{}', { status: 200 });
  };
  const toDelete = await send([], fakeFetch);
  assertEquals(calls, 0);
  assertEquals(toDelete, []);
});
