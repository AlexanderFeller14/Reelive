// Wo der Supabase-Server steht — und warum die Antwort in der Entwicklung
// nicht in einer Datei stehen kann.
//
// Lokal läuft der Server auf demselben Rechner wie Metro, erreichbar über eine
// LAN-IP. Die kommt per DHCP und ist zuhause eine andere als im Büro. Steht in
// `mobile/.env` die von gestern, läuft jede Anfrage des Handys in eine tote
// Adresse, und zwar ohne Fehlermeldung, die das verriete: Die App hängt stumm
// auf dem Anmeldescreen (am 2026-08-11 und am 2026-08-13 je eine Stunde
// gekostet).
//
// Die App weiss es besser als jede Datei: Sie hat ihr JS-Bundle soeben von
// genau dem Rechner geholt, auf dem auch der Server läuft. Expo nennt diese
// Adresse `hostUri`. Zeigt die Konfiguration auf eine lokale Adresse, gilt
// deshalb der Absender des Bundles — Schema, Port und Pfad bleiben, nur der
// Rechnername wird ersetzt.
import Constants from 'expo-constants';

// Adressbereiche, die nur im eigenen Netz gelten, plus die Bonjour-Namen.
// Alles andere ist eine echte Adresse und wird nie angefasst — sonst zeigte
// ein Entwicklungs-Build plötzlich auf den eigenen Rechner, obwohl er gegen
// die gehostete Instanz laufen soll.
const LOKAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function istLokal(host: string): boolean {
  return LOKAL.test(host) || host.endsWith('.local');
}

/**
 * @param konfiguriert  Wert aus `EXPO_PUBLIC_SUPABASE_URL`.
 * @param metroHostUri  Absender des Bundles, Form `192.168.1.213:8081`.
 * @param imEntwicklungsmodus  `__DEV__`.
 */
export function laufendeBasis(
  konfiguriert: string | undefined,
  metroHostUri: string | null | undefined,
  imEntwicklungsmodus: boolean
): string | undefined {
  if (!konfiguriert || !imEntwicklungsmodus || !metroHostUri) return konfiguriert;

  const metroHost = metroHostUri.split(':')[0];
  if (!metroHost) return konfiguriert;

  // Von Hand zerlegt statt über `new URL`: React Natives URL-Ersatz ist
  // unvollständig, und der Setzer für den Rechnernamen gehört zu den Teilen,
  // auf die kein Verlass ist.
  const teile = konfiguriert.match(/^(\w+:\/\/)([^/:]+)(:\d+)?(.*)$/);
  if (!teile) return konfiguriert;

  const [, schema, host, port = '', rest] = teile;
  if (!istLokal(host)) return konfiguriert;
  return `${schema}${metroHost}${port}${rest}`;
}

// Die eine Adresse, die alle benutzen (lib/supabase.ts, features/auth/avatar.ts,
// features/auth/avatarApi.ts). `hostUri` steht nur, solange die App an einem
// Entwicklungsserver hängt; im fertigen Build ist es leer und der konfigurierte
// Wert gilt unverändert.
export const supabaseBasis = laufendeBasis(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  Constants.expoConfig?.hostUri,
  __DEV__
);
