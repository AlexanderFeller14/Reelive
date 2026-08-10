// Gemeinsame Offline-Erkennung für alle Supabase-Aufrufe (authApi, tripsApi).
// DESIGN-LANGUAGE §6 verlangt, dass ein Fehler Ursache UND Lösung nennt, «kein
// Netz» ist die eine Ursache, die der Nutzer selbst beheben kann, also muss sie
// benannt werden statt in einem allgemeinen «probier es nochmal» zu verschwinden.

export const OFFLINE_HINT = 'Du bist offline. Verbinde dich und probier es nochmal.';

// Weder auth-js noch postgrest-js liefern für einen abgebrochenen Netzwerk-
// Aufruf einen Statuscode, sie reichen die Fetch-Fehlermeldung als `message`
// durch. Deren Wortlaut hängt an der Plattform:
//   Web/Node: «TypeError: Failed to fetch» / «AuthRetryableFetchError: …»
//   React Native (Hermes): «TypeError: Network request failed»
// Die zweite Variante enthält kein «fetch», genau die trifft aber auf dem
// Zielgerät zu. Deshalb prüft das Muster beide Wortlaute; ein echter
// Postgres-/PostgREST-Fehler («new row violates row-level security policy …»)
// enthält keinen davon.
const OFFLINE_MUSTER = /fetch|network request failed/i;

export function istOffline(error: { message?: string } | null | undefined): boolean {
  return OFFLINE_MUSTER.test(error?.message ?? '');
}
