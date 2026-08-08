// Der serverseitige Gegenpart zu mobile/src/lib/fehlermelder.ts — Spec §9:
// «In den Edge Functions ein schlanker Fehler-Melder über `fetch`, ohne
// Paket — ein npm-Import in Deno für zwei Zeilen wäre unverhältnismässig.»
// Das war in Task 10 des Plans nicht übernommen worden (siehe
// abschluss-fix-server.md) und wird hier nachgezogen, als eigenes Modul unter
// `_shared/`, damit alle vier Functions dieselbe Implementierung nutzen statt
// vier leicht verschiedene Kopien.
//
// ---------------------------------------------------------------------------
// Dieselbe Eigenschaft wie clientseitig: ohne DSN ein vollständiger No-Op
// ---------------------------------------------------------------------------
// Kein DSN → kein Netzaufruf, keine Konsolen-Warnung, keine Ausnahme. Das ist
// nicht nur Symmetrie mit der App, sondern notwendig: Diese Functions laufen
// heute in jeder lokalen Entwicklungsumgebung ohne SENTRY_DSN (siehe
// supabase/functions/.env.example), und ein Fehler-Melder, der sich dort
// anders verhält als "es passiert nichts", wäre selbst ein neuer Fehler.
//
// ---------------------------------------------------------------------------
// Was in einen Fehlerbericht darf — und was NICHT
// ---------------------------------------------------------------------------
// Der clientseitige Final-Review fand, dass Sentrys Default-Verhalten
// (Breadcrumbs) signierte S3-Lese-URLs und Moment-Inhalte (Caption,
// Koordinaten, Ortsname) einsammelt — Daten, die ein Fehlerbericht nie
// enthalten darf: eine signierte URL ist ein Zugangstoken mit Ablaufzeit,
// kein Diagnosewert, und Moment-Inhalte sind exakt das, was Reelive
// versiegelt. Serverseitig ist das Risiko strukturell anders (kein
// automatisches Breadcrumb-Tracking, weil kein SDK läuft), aber derselbe
// Fehler liesse sich manuell wiederholen, würfe jemand eine ganze
// Datenbankzeile oder ein rohes Response-Objekt in `kontext`. Deshalb zwei
// harte Regeln, beide im Typsystem erzwungen, nicht nur per Konvention:
//
//   1. `kontext` ist auf flache Primitive beschränkt (string/number/boolean/
//      null). Kein Objekt, kein Array, keine verschachtelte Struktur kann
//      hindurchgereicht werden — TypeScript verweigert an der Aufrufstelle
//      schon den Typ, lange bevor irgendetwas signiert oder verschickt wäre.
//      Aufrufer schicken darum IDs und Zählwerte (user_id, trip_id, anzahl),
//      nie storage_key-Listen, nie signierte URLs, nie Caption/Ort/Koordinate.
//   2. Der eigentliche Fehler (erster Parameter, `unknown` — typischerweise
//      ein Postgres- oder S3-Fehlerobjekt) wird NICHT roh serialisiert.
//      `nachrichtAus()` liest ausschliesslich `.message` (Error-Instanzen)
//      bzw. ein String-Feld `message` aus einem Fehlerobjekt und verwirft den
//      Rest. Postgres-Fehler tragen gelegentlich Spaltenwerte in `.detail`
//      ("Key (id)=(…) already exists.") — dieses Feld erreicht Sentry darum
//      nie, nur die Kurzmeldung.
//
// Was das ausschliesst: Diese Functions signieren nie eine Lese-URL, bevor
// sie sie zurückgeben, und melden nie ein Ergebnisobjekt aus einem
// erfolgreichen S3-Aufruf — die Aufrufstellen in den vier `index.ts` geben an
// `melde()` ausschliesslich Fehlerobjekte und die oben beschriebenen
// Primitive weiter. Kein Aufrufer muss diese Regel selbst durchsetzen, sie
// ergibt sich aus der Signatur.
//
// ---------------------------------------------------------------------------
// Warum die Sentry-"Store"-API und kein Envelope-Format
// ---------------------------------------------------------------------------
// `@sentry/react-native` (Client) und ein hypothetisches `@sentry/deno`
// sprechen das neuere Envelope-Format (mehrteilig, mit eigener Framing-
// Syntax). Für "einen Fehlertext plus ein paar Primitive" ist das mehr
// Format, als der Zweck verlangt — genau das Argument aus Spec §9 gegen ein
// Paket gilt auch gegen dessen Wire-Format. Die ältere, weiterhin von
// sentry.io und Self-Hosted-Instanzen bediente Store-API
// (`POST /api/<project>/store/`, ein einziges JSON-Objekt, Authentifizierung
// über den `X-Sentry-Auth`-Header) deckt denselben Zweck mit einem einzigen
// `fetch`-Aufruf ab.
//
// ---------------------------------------------------------------------------
// Fehlschlagen darf dieser Melder nie sichtbar
// ---------------------------------------------------------------------------
// Eine kaputte DSN, ein nicht erreichbares Sentry, ein Timeout: nichts davon
// darf die eigentliche Antwort der Function verzögern oder zum Scheitern
// bringen. `melde()` wirft deshalb nie — jeder Fehlerfall (Parsing, Netz,
// Timeout) wird verschluckt, höchstens mit einer eigenen console.error-Zeile
// quittiert. Ein Timeout von zwei Sekunden verhindert, dass ein
// hängendes Sentry eine Fehlerantwort auf unbestimmte Zeit aufhält — die
// Aufrufer in den `index.ts`-Dateien warten (`await`) auf `melde()`, damit
// der Bericht sicher abgeschickt ist, bevor die Function-Instanz nach der
// Response beendet werden könnte (Edge Functions kennen kein garantiertes
// Fortleben nicht-awaiteter Promises nach dem Response-Return).

export type FehlerKontext = Record<string, string | number | boolean | null>;

// Eine Function pro Modul (media-urls, share-link, reveal-trip,
// konto-loeschen) — als Sentry-Tag mitgeschickt, damit die vier Quellen in
// einem gemeinsamen Sentry-Projekt unterscheidbar bleiben, ohne dass jeder
// Aufrufer das selbst mitgeben müsste.
export type MeldeFn = (fehler: unknown, kontext?: FehlerKontext) => Promise<void>;

const TIMEOUT_MS = 2000;

// Liest ausschliesslich eine Kurzmeldung — nie das ganze Objekt. Siehe
// Kopfkommentar, Regel 2.
function nachrichtAus(fehler: unknown): string {
  if (fehler instanceof Error) return fehler.message || fehler.name;
  if (fehler && typeof fehler === 'object') {
    const m = (fehler as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return String(fehler);
}

type GeparsteDsn = { postUrl: string; publicKey: string };

// DSN-Form: `https://<public_key>@<host>[:<port>]/[<pfad-präfix>/]<projekt-id>`.
// Self-Hosted-Instanzen hängen den Ingest manchmal hinter einem Pfad-Präfix
// (Reverse Proxy); deshalb wird nur das LETZTE Pfadsegment als Projekt-ID
// behandelt, alles davor bleibt als Präfix erhalten. `url.username` ist der
// Public Key — Sentry-DSNs tragen kein Passwort (der zweite Teil vor dem "@"
// bleibt leer).
function parseDsn(dsn: string): GeparsteDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const publicKey = url.username;
  const pfad = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!publicKey || !pfad) return null;
  const segmente = pfad.split('/');
  const projekt = segmente[segmente.length - 1];
  const praefix = segmente.slice(0, -1).join('/');
  const postUrl = `${url.protocol}//${url.host}/${praefix ? praefix + '/' : ''}api/${projekt}/store/`;
  return { postUrl, publicKey };
}

// Fabrik statt eines modulweiten Singletons: Jede Function konstruiert ihren
// eigenen Melder aus ihrer eigenen `Deno.env.get('SENTRY_DSN')`-Lesung (Stil
// wie `erstelleAdminClient`/`erstelleKontoStore` in den Function-Ordnern) —
// und Tests können eine eigene, injizierte `fetchImpl` durchreichen, ganz
// ohne echtes Netz (Stil wie `sende(nachrichten, fetchImpl)` in
// reveal-trip/push.ts).
export function erstelleFehlermelder(
  dsn: string,
  funktion: string,
  fetchImpl: typeof fetch = fetch,
): MeldeFn {
  // Leere DSN: die einzige Prüfung, die vor jedem weiteren Schritt steht.
  // Kein Parsing-Versuch, kein Log — der dokumentierte No-Op-Zustand.
  if (!dsn) {
    return async () => {};
  }

  const geparst = parseDsn(dsn);
  if (!geparst) {
    // Anders als eine fehlende DSN ist das ein Konfigurationsfehler (eine
    // gesetzte, aber unbrauchbare DSN) — die Function bleibt trotzdem
    // funktionsfähig (der Melder wird zum No-Op), aber der Betrieb soll es im
    // eigenen Log sehen, so wie bei jedem anderen "X fehlt/ist unvollständig"
    // in diesen Functions.
    console.error(`${funktion}: SENTRY_DSN ist gesetzt, aber nicht auflösbar.`);
    return async () => {};
  }

  return async (fehler, kontext) => {
    const event = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'other',
      level: 'error',
      logger: 'edge-function',
      message: { message: nachrichtAus(fehler) },
      tags: { funktion },
      extra: kontext,
    };
    try {
      const antwort = await fetchImpl(geparst.postUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Sentry-Auth':
            `Sentry sentry_version=7, sentry_client=reelive-edge/1.0, sentry_key=${geparst.publicKey}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await antwort.body?.cancel();
    } catch (err) {
      // Der Melder darf nie selbst zum Fehler werden, den ihn wieder jemand
      // melden müsste — siehe Kopfkommentar.
      console.error(`${funktion}: Fehlerbericht an Sentry konnte nicht gesendet werden.`, err);
    }
  };
}
