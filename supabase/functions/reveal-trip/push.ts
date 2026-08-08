// Reiner Versand-Baustein für die Reveal-Benachrichtigung: kennt nur die
// Expo-Push-API, keine Datenbank. `index.ts` liest push_tokens/trip_members
// und ruft hier nur noch mit fertigen Nachrichten an.
//
// Warum ein einspritzbares `fetchImpl`: `push_test.ts` soll ohne laufenden
// Stack und ohne echtes Netz auskommen (Vorbild: keys_test.ts in
// media-urls, das ebenfalls reine Logik ohne I/O testet). Der
// Produktionscode ruft `sende(nachrichten)` ohne zweites Argument auf und
// bekommt das globale `fetch`.
//
// Fehlerverhalten ist bewusst grosszügig: ein Netzfehler oder ein
// kaputtes/unerwartetes Antwortformat bricht `sende` NICHT ab (kein throw),
// sondern wird geloggt und übersprungen — der Block, der scheitert, liefert
// dann einfach keine zu löschenden Tokens. `index.ts` legt zusätzlich noch
// ein try/catch um den gesamten Versand (Verteidigung in der Tiefe), aber
// schon `push.ts` selbst soll ein einzelnes fehlgeschlagenes Push-Ticket
// nicht die übrigen Blöcke kosten lassen.

export type PushNachricht = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo nimmt höchstens 100 Nachrichten pro Anfrage entgegen.
const EXPO_BLOCK_GROESSE = 100;

// Zerlegt eine Liste in Blöcke fester Grösse, letzter Block darf kleiner
// sein. Eine leere Liste liefert eine leere Liste von Blöcken (kein leerer
// Block).
export function inBloecke<T>(items: T[], groesse: number): T[][] {
  if (groesse <= 0) {
    throw new RangeError('groesse muss grösser als 0 sein.');
  }
  const bloecke: T[][] = [];
  for (let i = 0; i < items.length; i += groesse) {
    bloecke.push(items.slice(i, i + groesse));
  }
  return bloecke;
}

type ExpoTicket = {
  status?: unknown;
  details?: { error?: unknown } | null;
};

function istDeviceNotRegistered(ticket: unknown): boolean {
  if (!ticket || typeof ticket !== 'object') return false;
  const t = ticket as ExpoTicket;
  if (t.status !== 'error') return false;
  const details = t.details;
  if (!details || typeof details !== 'object') return false;
  return (details as { error?: unknown }).error === 'DeviceNotRegistered';
}

// `tickets` ist die `data`-Liste aus der Expo-Antwort, ein Ticket je
// Nachricht, in derselben Reihenfolge wie die Anfrage — deshalb hier per
// Index mit `tokens` verzahnt. `tickets` ist `unknown`, weil die Antwort von
// einem fremden Dienst kommt: eine unerwartete Form (kein Array, zu kurz,
// Ticket ohne "status") darf nie werfen, nur weniger Treffer liefern.
export function tokensZumLoeschen(tickets: unknown, tokens: string[]): string[] {
  if (!Array.isArray(tickets)) return [];
  const zuLoeschen: string[] = [];
  for (let i = 0; i < tickets.length && i < tokens.length; i++) {
    if (istDeviceNotRegistered(tickets[i])) {
      zuLoeschen.push(tokens[i]);
    }
  }
  return zuLoeschen;
}

// Schickt alle Nachrichten in Blöcken à höchstens 100 an Expo und liefert
// die Tokens zurück, deren Ticket "DeviceNotRegistered" meldet — die ruft
// `index.ts` anschliessend zum Löschen auf. Wirft nie: jeder Fehler (Netz,
// HTTP-Status, Antwortformat) landet in console.error, der betroffene Block
// liefert dann schlicht keine Treffer.
export async function sende(
  nachrichten: PushNachricht[],
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const zuLoeschen: string[] = [];

  for (const block of inBloecke(nachrichten, EXPO_BLOCK_GROESSE)) {
    if (block.length === 0) continue;
    try {
      const antwort = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(block),
      });

      if (!antwort.ok) {
        console.error(
          'reveal-trip/push: Expo antwortete mit Status',
          antwort.status,
          await antwort.text().catch(() => ''),
        );
        continue;
      }

      const payload: unknown = await antwort.json();
      const daten = (payload as { data?: unknown } | null)?.data;
      const fehler = (payload as { errors?: unknown } | null)?.errors;
      if (Array.isArray(fehler) && fehler.length > 0) {
        console.error('reveal-trip/push: Expo meldete Fehler', fehler);
      }
      zuLoeschen.push(...tokensZumLoeschen(daten, block.map((n) => n.to)));
    } catch (err) {
      console.error('reveal-trip/push: Anfrage an Expo fehlgeschlagen', err);
    }
  }

  return zuLoeschen;
}
