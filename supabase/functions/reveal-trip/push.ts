// Pure send building block for the reveal notification: knows only the Expo
// push API, no database. `index.ts` reads push_tokens/trip_members and only
// calls in here with finished messages.
//
// Why an injectable `fetchImpl`: `push_test.ts` should work with no running
// stack and no real network (model: keys_test.ts in media-urls, which also
// tests pure logic with no I/O). Production code calls `send(messages)`
// with no second argument and gets the global `fetch`.
//
// Error handling is deliberately generous: a network error or a
// broken/unexpected response shape does NOT abort `send` (no throw), it
// gets logged and skipped, the failing block then simply yields no tokens
// to delete. `index.ts` additionally wraps the whole send in a try/catch
// (defense in depth), but push.ts itself should already not let a single
// failed push ticket cost the remaining blocks.

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo accepts at most 100 messages per request.
const EXPO_BLOCK_SIZE = 100;

// Splits a list into fixed-size blocks, the last block may be smaller. An
// empty list produces an empty list of blocks (no empty block).
export function toBlocks<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new RangeError('size must be greater than 0.');
  }
  const blocks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    blocks.push(items.slice(i, i + size));
  }
  return blocks;
}

type ExpoTicket = {
  status?: unknown;
  details?: { error?: unknown } | null;
};

function isDeviceNotRegistered(ticket: unknown): boolean {
  if (!ticket || typeof ticket !== 'object') return false;
  const t = ticket as ExpoTicket;
  if (t.status !== 'error') return false;
  const details = t.details;
  if (!details || typeof details !== 'object') return false;
  return (details as { error?: unknown }).error === 'DeviceNotRegistered';
}

// `tickets` is the `data` list from the Expo response, one ticket per
// message, in the same order as the request, hence interleaved with
// `tokens` here by index. `tickets` is `unknown`, because the response
// comes from an external service: an unexpected shape (not an array, too
// short, a ticket with no "status") must never throw, only yield fewer
// hits.
export function tokensToDelete(tickets: unknown, tokens: string[]): string[] {
  if (!Array.isArray(tickets)) return [];
  const toDelete: string[] = [];
  for (let i = 0; i < tickets.length && i < tokens.length; i++) {
    if (isDeviceNotRegistered(tickets[i])) {
      toDelete.push(tokens[i]);
    }
  }
  return toDelete;
}

// Sends all messages in blocks of at most 100 to Expo and returns the
// tokens whose ticket reports "DeviceNotRegistered", which `index.ts` then
// calls to delete. Never throws: every failure (network, HTTP status,
// response shape) ends up in console.error, the affected block then simply
// yields no hits.
export async function send(
  messages: PushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const toDelete: string[] = [];

  for (const block of toBlocks(messages, EXPO_BLOCK_SIZE)) {
    if (block.length === 0) continue;
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(block),
      });

      if (!response.ok) {
        console.error(
          'reveal-trip/push: Expo answered with status',
          response.status,
          await response.text().catch(() => ''),
        );
        continue;
      }

      const payload: unknown = await response.json();
      const responseData = (payload as { data?: unknown } | null)?.data;
      const errors = (payload as { errors?: unknown } | null)?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        console.error('reveal-trip/push: Expo reported errors', errors);
      }
      toDelete.push(...tokensToDelete(responseData, block.map((n) => n.to)));
    } catch (err) {
      console.error('reveal-trip/push: request to Expo failed', err);
    }
  }

  return toDelete;
}
