import { laufendeBasis } from '../supabaseAdresse';

// Die Adresse des lokalen Servers ist eine LAN-IP, und die kommt per DHCP:
// zuhause eine andere als im Büro. Steht in der .env die von gestern, läuft
// jede Anfrage des Handys in eine tote Adresse — ohne Fehlermeldung, die das
// verriete (die App hängt stumm auf dem Anmeldescreen).
//
// Die App weiss es aber besser: Sie hat ihr JS-Bundle soeben von genau dem
// Rechner geholt, auf dem auch der Server läuft. Dessen Adresse gilt.
const METRO = '192.168.1.213:8081';

test('ausserhalb der Entwicklung bleibt die konfigurierte Adresse unangetastet', () => {
  // Im fertigen Build gibt es keinen Metro, und die Adresse ist die echte.
  expect(laufendeBasis('https://abc.supabase.co', METRO, false)).toBe('https://abc.supabase.co');
});

test('in der Entwicklung gilt der Rechner, der das Bundle geliefert hat', () => {
  expect(laufendeBasis('http://192.168.1.30:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('auch localhost wird ersetzt — für das Handy wäre das seine eigene Adresse', () => {
  expect(laufendeBasis('http://127.0.0.1:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('ein Bonjour-Name gilt ebenfalls als lokal', () => {
  expect(laufendeBasis('http://macbook.local:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('eine öffentliche Adresse wird nie umgebogen', () => {
  // Sonst zeigte ein Entwicklungs-Build plötzlich auf den eigenen Rechner,
  // obwohl er gegen die gehostete Instanz laufen soll.
  expect(laufendeBasis('https://abcdef.supabase.co', METRO, true)).toBe('https://abcdef.supabase.co');
});

test('der Port der Konfiguration bleibt stehen', () => {
  // Metro spricht 8081, Supabase 54321. Das zu verwechseln wäre der Fehler,
  // der beim Debuggen am längsten dauert.
  expect(laufendeBasis('http://192.168.1.30:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('ein Pfad hinter der Adresse bleibt erhalten', () => {
  expect(laufendeBasis('http://192.168.1.30:54321/api', METRO, true)).toBe(
    'http://192.168.1.213:54321/api'
  );
});

test('ohne bekannten Absender bleibt es beim Konfigurierten', () => {
  expect(laufendeBasis('http://192.168.1.30:54321', undefined, true)).toBe('http://192.168.1.30:54321');
});

test('ohne Konfiguration wird keine Adresse erfunden', () => {
  // Es fehlt dann auch der Anon-Schlüssel; der bestehende Hinweis in
  // supabase.ts soll greifen, nicht eine geratene Adresse.
  expect(laufendeBasis(undefined, METRO, true)).toBeUndefined();
});

test('eine Absenderadresse ohne Port wird trotzdem verstanden', () => {
  expect(laufendeBasis('http://192.168.1.30:54321', '192.168.1.213', true)).toBe(
    'http://192.168.1.213:54321'
  );
});
