// Verwaltung des EIGENEN Teilen-Links durch die Owner-Person (Task-6-Brief),
// als Gegenstück zu shareApi.ts (dort: `aufloesen`, ohne JWT, für den
// öffentlichen Web-Player, Task 5). Erstellen und Widerrufen laufen über die
// Edge Function `share-link` (Service-Role): sie prüft Owner-Rolle und
// Reise-Status server-seitig noch einmal, auch wenn die aufrufende Stelle
// (uebersicht.tsx) das schon vorher weiss, die UI blendet nur aus, die
// Function erzwingt (CLAUDE.md-Eckpfeiler).
//
// BEWUSST NICHT in shareApi.ts ergänzt, obwohl der Plan (Phase-6-Plan, File
// Structure) genau eine gemeinsame Datei "Link erstellen, widerrufen,
// auflösen" skizziert: `mobile/src/app/teilen/__tests__/modulgraph.test.ts`
// (Task 5, W4-Beweis) liest den GESAMTEN Quelltext jeder von teilen/[token].tsx
// erreichbaren Datei und verlangt, dass im ganzen Graph GENAU EIN `aktion`-
// Literal vorkommt: `'aufloesen'`. shareApi.ts steht in diesem Graph (der
// Web-Player importiert sie). Zusätzliche `aktion: 'erstellen'`/`'widerrufen'`-
// Literale in DERSELBEN Datei hätten diesen bereits committeten, geprüften
// Test zerbrochen, nicht weil der Web-Player sie tatsächlich aufriefe
// (er importiert diese Datei hier gar nicht), sondern weil der Test den
// Quelltext der ganzen Datei durchsucht, nicht nur den vom Web-Player
// erreichbaren Ausführungspfad. Eine eigene Datei ist darum nicht nur
// sauberer (die App verwaltet ihren Link, der Web-Player löst ihn nur auf),
// sondern die einzige Option, die die bestehende W4-Zusicherung nicht
// aufweicht.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';

type Gelesen<T> = { data: T; error: string | null };

function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

// functions-js ersetzt einen echten Netzwerkfehler durch einen festen
// englischen Satz und legt die ursprüngliche Fetch-Fehlermeldung in `context`
// ab (gleiches Muster wie recapApi.ts/urlVorrat.ts/shareApi.ts).
function funktionMeldung(error: unknown, sonst: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return meldung(err ?? null, sonst);
}

async function funktionsFehlerText(error: unknown, sonst: string): Promise<string> {
  const httpFehler = error as { name?: string; context?: unknown };
  if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
    try {
      const body = (await httpFehler.context.clone().json()) as { fehler?: string };
      if (typeof body.fehler === 'string') return body.fehler;
    } catch {
      // Antwort war kein JSON, generische Meldung unten.
    }
  }
  return funktionMeldung(error, sonst);
}

// Basis des öffentlichen Web-Players, siehe Kommentar in .env.example, kein
// Sicherheitswert, nur eine Anzeige-Entscheidung. Ohne Standardwert: ein
// geratener Standard ergäbe einen Link, der aussieht wie einer und keiner
// ist (dieselbe Haltung wie die Function selbst, supabase/functions/share-link/
// index.ts, TEILEN_BASIS_URL).
//
// Als FUNKTION statt als modulweite Konstante gelesen: `process.env.*` wird
// von Metro beim Build durch einen Literal ersetzt, in Jest dagegen ganz
// normal zur Laufzeit gelesen, eine Konstante hätte den Wert beim ERSTEN
// Import dieses Moduls eingefroren und liesse sich in Tests, die sowohl den
// gesetzten als auch den fehlenden Fall prüfen wollen, nicht mehr umschalten.
function teilenBasisUrl(): string {
  return (process.env.EXPO_PUBLIC_TEILEN_BASIS_URL ?? '').replace(/\/$/, '');
}
const KONFIG_FEHLT_TEXT = 'Die Teilen-Funktion ist nicht eingerichtet. Wende dich an die Entwicklung.';

function baueUrl(token: string): string {
  return `${teilenBasisUrl()}/teilen/${token}`;
}

export type AktiverLink = { token: string; url: string; expiresAt: string | null };

type ShareLinkRow = { token: string; expires_at: string | null; created_at: string };

const LADEFEHLER = 'Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.';
const ERSTELLEN_FEHLER = 'Der Link konnte nicht erstellt werden. Probier es gleich nochmal.';
const WIDERRUFEN_FEHLER = 'Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.';

// Der jüngste NICHT widerrufene, NICHT abgelaufene Link dieser Reise, oder
// `data: null`, wenn es keinen gibt (nie angelegt, alle widerrufen, oder alle
// abgelaufen). Ein abgelaufener Link zählt hier bewusst wie gar keiner: die
// Sheet würde sonst einen toten Link zum Kopieren/Teilen anbieten, statt neu
// erstellen zu lassen, `aufloesen` lehnt ihn ohnehin serverseitig ab
// (dieselbe Ablehnung wie ein widerrufener oder unbekannter Token, siehe
// share-link/aufloesung.ts), diese Prüfung hier verhindert nur, dass die App
// so tut, als wäre er noch etwas wert.
//
// Direkter Read statt eines Umwegs über die Function, siehe Kopfkommentar.
export async function holeAktivenLink(tripId: string): Promise<Gelesen<AktiverLink | null>> {
  const { data, error } = await supabase
    .from('share_links')
    .select('token, expires_at, created_at')
    .eq('trip_id', tripId)
    .eq('revoked', false)
    .order('created_at', { ascending: false });

  if (error) return { data: null, error: meldung(error, LADEFEHLER) };

  const jetzt = Date.now();
  const zeilen = (data ?? []) as ShareLinkRow[];
  const aktiv = zeilen.find((z) => z.expires_at === null || Date.parse(z.expires_at) > jetzt);
  if (!aktiv) return { data: null, error: null };

  if (!teilenBasisUrl()) return { data: null, error: KONFIG_FEHLT_TEXT };

  return { data: { token: aktiv.token, url: baueUrl(aktiv.token), expiresAt: aktiv.expires_at }, error: null };
}

// gueltigTage: null heisst "ohne Ablauf" (share-link/index.ts, Vertrag Task 2).
// `expiresAt` in der Rückgabe ist HIER, im Client, aus `gueltigTage` berechnet,
// die Function selbst gibt bei `erstellen` nur { token, url } zurück, kein
// expires_at. Das ist rein informativ für die Anzeige ("gültig bis …"), nie
// für eine Prüfung: die einzige massgebliche Uhr ist die der Function
// (beurteileToken vergleicht dort gegen die tatsächlich in share_links
// gespeicherte expires_at-Zeile). Eine Abweichung von wenigen Sekunden durch
// Netzwerklatenz ist für einen Anzeigetext ohne Belang.
export async function erstelleLink(tripId: string, gueltigTage: number | null): Promise<Gelesen<AktiverLink | null>> {
  const { data, error } = await supabase.functions.invoke('share-link', {
    body: { aktion: 'erstellen', trip_id: tripId, gueltig_tage: gueltigTage },
  });
  if (error) {
    return { data: null, error: await funktionsFehlerText(error, ERSTELLEN_FEHLER) };
  }
  const antwort = data as { token?: unknown; url?: unknown } | null;
  if (!antwort || typeof antwort.token !== 'string' || typeof antwort.url !== 'string') {
    return { data: null, error: ERSTELLEN_FEHLER };
  }
  const expiresAt = gueltigTage === null ? null : new Date(Date.now() + gueltigTage * 86_400_000).toISOString();
  return { data: { token: antwort.token, url: antwort.url, expiresAt }, error: null };
}

// Idempotent auf Server-Seite (share-link/index.ts), ein zweiter Widerruf
// ist kein Fehler, diese Funktion reicht das unverändert durch.
export async function widerrufeLink(token: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('share-link', {
    body: { aktion: 'widerrufen', token },
  });
  if (error) {
    return { error: await funktionsFehlerText(error, WIDERRUFEN_FEHLER) };
  }
  const ergebnis = data as { ok?: boolean } | null;
  if (!ergebnis?.ok) return { error: WIDERRUFEN_FEHLER };
  return { error: null };
}
