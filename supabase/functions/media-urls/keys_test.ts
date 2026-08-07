import { assertEquals } from 'jsr:@std/assert';
import { erwarteteSchluessel } from './keys.ts';

Deno.test('Foto-Schlüssel', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'photo'), {
    storage_key: 'trips/t1/p1.jpg',
    thumb_key: 'trips/t1/p1_t.jpg',
  });
});

Deno.test('Video-Schlüssel', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video').storage_key, 'trips/t1/p1.mp4');
});
