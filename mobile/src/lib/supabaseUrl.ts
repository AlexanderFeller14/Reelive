// Where the Supabase server lives, and why the answer can't sit in a file
// during development.
//
// Locally the server runs on the same machine as Metro, reachable over a
// LAN IP. That comes from DHCP and is a different one at home than at the
// office. If `mobile/.env` still holds yesterday's, every request from the
// phone runs into a dead address, and without an error message that would
// give it away: the app hangs silently on the login screen (cost an hour
// each on 2026-08-11 and 2026-08-13).
//
// The app knows better than any file: it just fetched its JS bundle from
// exactly the machine the server also runs on. Expo calls this address
// `hostUri`. If the configuration points at a local address, the sender of
// the bundle wins instead: scheme, port and path stay, only the hostname
// gets replaced.
import Constants from 'expo-constants';

// Address ranges that only apply inside a private network, plus the
// Bonjour names. Everything else is a real address and never gets
// touched: otherwise a development build would suddenly point at its own
// machine, even though it's meant to run against the hosted instance.
const LOKAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function istLokal(host: string): boolean {
  return LOKAL.test(host) || host.endsWith('.local');
}

/**
 * @param konfiguriert  Value from `EXPO_PUBLIC_SUPABASE_URL`.
 * @param metroHostUri  Sender of the bundle, in the form `192.168.1.213:8081`.
 * @param imEntwicklungsmodus  `__DEV__`.
 */
export function currentBaseUrl(
  konfiguriert: string | undefined,
  metroHostUri: string | null | undefined,
  imEntwicklungsmodus: boolean
): string | undefined {
  if (!konfiguriert || !imEntwicklungsmodus || !metroHostUri) return konfiguriert;

  const metroHost = metroHostUri.split(':')[0];
  if (!metroHost) return konfiguriert;

  // Parsed by hand instead of via `new URL`: React Native's URL polyfill is
  // incomplete, and the hostname setter is one of the parts that can't be
  // relied on.
  const teile = konfiguriert.match(/^(\w+:\/\/)([^/:]+)(:\d+)?(.*)$/);
  if (!teile) return konfiguriert;

  const [, schema, host, port = '', rest] = teile;
  if (!istLokal(host)) return konfiguriert;
  return `${schema}${metroHost}${port}${rest}`;
}

// The one address everyone uses (lib/supabase.ts, features/auth/avatar.ts,
// features/auth/avatarApi.ts). `hostUri` is only set while the app is
// attached to a development server; in a finished build it's empty and the
// configured value applies unchanged.
export const supabaseBaseUrl = currentBaseUrl(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  Constants.expoConfig?.hostUri,
  __DEV__
);
