import { currentBaseUrl } from '../supabaseUrl';

// The local server's address is a LAN IP, and that comes from DHCP: a
// different one at home than at the office. If the .env still holds
// yesterday's, every request from the phone runs into a dead address, with
// no error message giving it away (the app hangs silently on the login
// screen).
//
// But the app knows better: it just fetched its JS bundle from exactly the
// machine the server also runs on. That machine's address wins.
const METRO = '192.168.1.213:8081';

test('outside of development the configured address stays untouched', () => {
  // In a finished build there is no Metro, and the address is the real one.
  expect(currentBaseUrl('https://abc.supabase.co', METRO, false)).toBe('https://abc.supabase.co');
});

test('in development, the machine that delivered the bundle wins', () => {
  expect(currentBaseUrl('http://192.168.1.30:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('localhost gets replaced too, for the phone that would be its own address', () => {
  expect(currentBaseUrl('http://127.0.0.1:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('a Bonjour name counts as local too', () => {
  expect(currentBaseUrl('http://macbook.local:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('a public address is never rewritten', () => {
  // Otherwise a development build would suddenly point at its own machine,
  // even though it's meant to run against the hosted instance.
  expect(currentBaseUrl('https://abcdef.supabase.co', METRO, true)).toBe('https://abcdef.supabase.co');
});

test('the configured port stays as is', () => {
  // Metro speaks 8081, Supabase 54321. Mixing those up would be the bug
  // that takes longest to debug.
  expect(currentBaseUrl('http://192.168.1.30:54321', METRO, true)).toBe('http://192.168.1.213:54321');
});

test('a path behind the address is preserved', () => {
  expect(currentBaseUrl('http://192.168.1.30:54321/api', METRO, true)).toBe(
    'http://192.168.1.213:54321/api'
  );
});

test('without a known sender it stays with the configured value', () => {
  expect(currentBaseUrl('http://192.168.1.30:54321', undefined, true)).toBe('http://192.168.1.30:54321');
});

test('without configuration no address gets invented', () => {
  // The anon key is missing then too; the existing hint in supabase.ts
  // should apply, not a guessed address.
  expect(currentBaseUrl(undefined, METRO, true)).toBeUndefined();
});

test('a sender address without a port is still understood', () => {
  expect(currentBaseUrl('http://192.168.1.30:54321', '192.168.1.213', true)).toBe(
    'http://192.168.1.213:54321'
  );
});
