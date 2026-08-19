import { assertEquals } from 'jsr:@std/assert';
import { expectedKeys } from './keys.ts';

Deno.test('photo key', () => {
  assertEquals(expectedKeys('t1', 'p1', 'photo', 'jpg'), {
    storage_key: 'trips/t1/p1.jpg',
    thumb_key: 'trips/t1/p1_t.jpg',
  });
});

Deno.test('video key follows the actual extension', () => {
  assertEquals(expectedKeys('t1', 'p1', 'video', 'mp4').storage_key, 'trips/t1/p1.mp4');
  // iOS records QuickTime, Important 5. Before the fix this sat under .mp4.
  assertEquals(expectedKeys('t1', 'p1', 'video', 'mov').storage_key, 'trips/t1/p1.mov');
  assertEquals(expectedKeys('t1', 'p1', 'video', 'MOV').storage_key, 'trips/t1/p1.mov');
});

// The function derives the key itself and does not let even a nonsense
// column value smuggle in a foreign path component.
Deno.test('unknown or missing extension falls back to the default for the capture type', () => {
  assertEquals(expectedKeys('t1', 'p1', 'video', null).storage_key, 'trips/t1/p1.mp4');
  assertEquals(expectedKeys('t1', 'p1', 'video', '../../secret').storage_key, 'trips/t1/p1.mp4');
  assertEquals(expectedKeys('t1', 'p1', 'photo', 'mov').storage_key, 'trips/t1/p1.jpg');
});

Deno.test('thumbnail is always JPEG', () => {
  assertEquals(expectedKeys('t1', 'p1', 'video', 'mov').thumb_key, 'trips/t1/p1_t.jpg');
});
