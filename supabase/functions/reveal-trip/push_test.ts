import { assertEquals } from 'jsr:@std/assert';
import { inBloecke, sende, tokensZumLoeschen, type PushNachricht } from './push.ts';

function nachricht(token: string): PushNachricht {
  return { to: token, title: 't', body: 'b', data: {} };
}

// --- inBloecke -------------------------------------------------------------

Deno.test('inBloecke: leere Liste liefert keine Blöcke', () => {
  assertEquals(inBloecke([], 100), []);
});

Deno.test('inBloecke: ein Eintrag liefert einen Block mit einem Eintrag', () => {
  assertEquals(inBloecke([1], 100), [[1]]);
});

Deno.test('inBloecke: genau 100 Einträge liefern genau einen Block', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const bloecke = inBloecke(items, 100);
  assertEquals(bloecke.length, 1);
  assertEquals(bloecke[0].length, 100);
});

Deno.test('inBloecke: 101 Einträge liefern zwei Blöcke, letzter mit einem Eintrag', () => {
  const items = Array.from({ length: 101 }, (_, i) => i);
  const bloecke = inBloecke(items, 100);
  assertEquals(bloecke.length, 2);
  assertEquals(bloecke[0].length, 100);
  assertEquals(bloecke[1].length, 1);
});

Deno.test('inBloecke: 250 Einträge liefern drei Blöcke (100/100/50)', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const bloecke = inBloecke(items, 100);
  assertEquals(bloecke.length, 3);
  assertEquals(bloecke.map((b) => b.length), [100, 100, 50]);
});

// --- tokensZumLoeschen -------------------------------------------------------

Deno.test('tokensZumLoeschen: erkennt genau die DeviceNotRegistered-Tickets', () => {
  const tokens = ['tok-ok', 'tok-tot', 'tok-anderer-fehler'];
  const tickets = [
    { status: 'ok', id: 'xyz' },
    { status: 'error', message: 'weg', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'zu gross', details: { error: 'MessageTooBig' } },
  ];
  assertEquals(tokensZumLoeschen(tickets, tokens), ['tok-tot']);
});

Deno.test('tokensZumLoeschen: ignoriert Fehler ohne details.error', () => {
  const tokens = ['tok-a', 'tok-b'];
  const tickets = [
    { status: 'error' },
    { status: 'error', details: {} },
  ];
  assertEquals(tokensZumLoeschen(tickets, tokens), []);
});

Deno.test('tokensZumLoeschen: unbrauchbare Formen werfen nicht und liefern []', () => {
  assertEquals(tokensZumLoeschen(null, ['a']), []);
  assertEquals(tokensZumLoeschen(undefined, ['a']), []);
  assertEquals(tokensZumLoeschen('kaputt', ['a']), []);
  assertEquals(tokensZumLoeschen([{ status: 'error', details: null }], ['a']), []);
});

Deno.test('tokensZumLoeschen: mehr Tickets als Tokens liest nicht über das Ende hinaus', () => {
  const tokens = ['tok-a'];
  const tickets = [
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
  ];
  assertEquals(tokensZumLoeschen(tickets, tokens), ['tok-a']);
});

// --- sende -------------------------------------------------------------------

Deno.test('sende: 150 Nachrichten lösen genau zwei Anfragen aus', async () => {
  const nachrichten = Array.from({ length: 150 }, (_, i) => nachricht(`tok-${i}`));
  let aufrufe = 0;
  const groessen: number[] = [];

  const fakeFetch: typeof fetch = async (_input, init) => {
    aufrufe++;
    const body = JSON.parse(String(init?.body)) as PushNachricht[];
    groessen.push(body.length);
    return new Response(JSON.stringify({ data: body.map(() => ({ status: 'ok' })), errors: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const zuLoeschen = await sende(nachrichten, fakeFetch);
  assertEquals(aufrufe, 2);
  assertEquals(groessen, [100, 50]);
  assertEquals(zuLoeschen, []);
});

Deno.test('sende: sammelt DeviceNotRegistered-Tokens über mehrere Blöcke hinweg', async () => {
  const nachrichten = Array.from({ length: 101 }, (_, i) => nachricht(`tok-${i}`));

  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as PushNachricht[];
    const data = body.map((n, i) => {
      // Erster Block: allererste Nachricht "tot". Zweiter Block: die einzige
      // Nachricht "tot".
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

  const zuLoeschen = await sende(nachrichten, fakeFetch);
  assertEquals(zuLoeschen, ['tok-0', 'tok-100']);
});

Deno.test('sende: schickt richtige Header und Zielpfad', async () => {
  const gesehen: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    gesehen.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify({ data: [{ status: 'ok' }], errors: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await sende([nachricht('tok-0')], fakeFetch);
  assertEquals(gesehen.length, 1);
  assertEquals(gesehen[0].url, 'https://exp.host/--/api/v2/push/send');
  assertEquals(gesehen[0].headers['accept'], 'application/json');
  assertEquals(gesehen[0].headers['content-type'], 'application/json');
});

Deno.test('sende: ein Netzfehler in einem Block wirft nicht und liefert für ihn keine Treffer', async () => {
  let aufrufe = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    aufrufe++;
    const body = JSON.parse(String(init?.body)) as PushNachricht[];
    if (body[0].to.startsWith('block1')) {
      throw new TypeError('Netzwerk nicht erreichbar');
    }
    return new Response(
      JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }], errors: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const nachrichten = [
    ...Array.from({ length: 100 }, (_, i) => nachricht(`block1-${i}`)),
    nachricht('block2-0'),
  ];
  const zuLoeschen = await sende(nachrichten, fakeFetch);
  assertEquals(aufrufe, 2);
  assertEquals(zuLoeschen, ['block2-0']);
});

Deno.test('sende: leere Nachrichtenliste löst keine Anfrage aus', async () => {
  let aufrufe = 0;
  const fakeFetch: typeof fetch = async () => {
    aufrufe++;
    return new Response('{}', { status: 200 });
  };
  const zuLoeschen = await sende([], fakeFetch);
  assertEquals(aufrufe, 0);
  assertEquals(zuLoeschen, []);
});
