import { assertEquals } from 'jsr:@std/assert@1';
import { darfEntfernen, type PostZeile, type TripZeile } from './zugriff.ts';

const AUTORIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OWNER = 'bbbbbbbb-0000-4000-8000-000000000002';
const FREMDE = 'cccccccc-0000-4000-8000-000000000003';

function post(ueber: Partial<PostZeile> = {}): PostZeile {
  return {
    id: 'p1',
    trip_id: 't1',
    author_id: AUTORIN,
    type: 'photo',
    media_ext: 'jpg',
    ...ueber,
  };
}

function trip(ueber: Partial<TripZeile> = {}): TripZeile {
  return { status: 'revealed', owner_id: OWNER, ...ueber };
}

Deno.test('die Autorin darf ihren eigenen Moment entfernen', () => {
  assertEquals(darfEntfernen(post(), trip(), AUTORIN), true);
});

Deno.test('die Owner-Person darf jeden Moment ihrer Reise entfernen (Moderation)', () => {
  assertEquals(darfEntfernen(post(), trip(), OWNER), true);
});

// Der Fall, um den es bei dieser Function wirklich geht: eine dritte Person
// darf nichts entfernen. Ginge das durch, waeren die Medien geloescht, bevor
// irgendeine Datenbankregel zu Wort kaeme.
Deno.test('eine dritte Person darf nicht, auch nicht in einer Reise, in der sie Mitglied ist', () => {
  assertEquals(darfEntfernen(post(), trip(), FREMDE), false);
});

// Vor dem Reveal sieht niemand die Momente der anderen, es gibt nichts zu
// moderieren, und ein offener Loeschweg waere ein Kanal, ueber den sich die
// Versiegelung ausprobieren liesse.
Deno.test('vor dem Reveal darf niemand entfernen, auch die Autorin nicht', () => {
  assertEquals(darfEntfernen(post(), trip({ status: 'active' }), AUTORIN), false);
});

Deno.test('vor dem Reveal darf auch die Owner-Person nicht entfernen', () => {
  assertEquals(darfEntfernen(post(), trip({ status: 'active' }), OWNER), false);
});

// Die Gegenprobe zum Status-Vergleich: er prueft auf 'revealed', nicht auf
// «nicht active». Ein spaeter hinzukommender Status (archiviert, gesperrt)
// faellt damit auf die sichere Seite, statt stillschweigend zu erlauben.
Deno.test('ein unbekannter Status erlaubt nichts', () => {
  assertEquals(darfEntfernen(post(), trip({ status: 'archiviert' }), OWNER), false);
  assertEquals(darfEntfernen(post(), trip({ status: '' }), AUTORIN), false);
});

// Und die Zuordnung: die Owner-Person EINER Reise ist nicht die Owner-Person
// jeder anderen. Der Handler laedt die Reise ueber `post.trip_id`, dieser Test
// haelt fest, dass die Regel den Vergleich auch wirklich anstellt.
Deno.test('die Owner-Person einer FREMDEN Reise darf nicht', () => {
  assertEquals(darfEntfernen(post(), trip({ owner_id: FREMDE }), OWNER), false);
});
