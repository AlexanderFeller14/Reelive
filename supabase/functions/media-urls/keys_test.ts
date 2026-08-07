import { assertEquals } from 'jsr:@std/assert';
import { erwarteteSchluessel } from './keys.ts';

Deno.test('Foto-Schlüssel', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'photo', 'jpg'), {
    storage_key: 'trips/t1/p1.jpg',
    thumb_key: 'trips/t1/p1_t.jpg',
  });
});

Deno.test('Video-Schlüssel folgt der tatsächlichen Endung', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video', 'mp4').storage_key, 'trips/t1/p1.mp4');
  // iOS nimmt QuickTime auf — Important 5. Vor dem Fix lag das unter .mp4.
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video', 'mov').storage_key, 'trips/t1/p1.mov');
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video', 'MOV').storage_key, 'trips/t1/p1.mov');
});

// Die Function leitet den Schlüssel selbst her und lässt sich auch von einer
// unsinnigen Spalte keinen fremden Pfadbestandteil unterschieben.
Deno.test('unbekannte oder fehlende Endung fällt auf den Standard der Aufnahmeart zurück', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video', null).storage_key, 'trips/t1/p1.mp4');
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video', '../../geheim').storage_key, 'trips/t1/p1.mp4');
  assertEquals(erwarteteSchluessel('t1', 'p1', 'photo', 'mov').storage_key, 'trips/t1/p1.jpg');
});

Deno.test('Thumbnail bleibt immer JPEG', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video', 'mov').thumb_key, 'trips/t1/p1_t.jpg');
});
