// Account deletion (Task 9, phase 6). Calls the edge function
// `konto-loeschen` (finished and verified, see
// supabase/functions/konto-loeschen/), no new schema is created here, only
// the call path. Same pattern as recapApi.revealTrip/urlPool.holeVorrat:
// supabase.functions.invoke, errors arrive either as a FunctionsHttpError
// with German plain text in the JSON body, or as a network error detected
// via istOffline.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';

type Loaded<T> = { data: T; error: string | null };

function message(error: { message?: string } | null, fallback: string): string {
  return istOffline(error) ? OFFLINE_HINT : fallback;
}

// functions-js replaces a genuine network error with a fixed English
// sentence and stashes the original fetch error message in `context`,
// both places must be checked before falling back to the generic message
// (same pattern as recapApi.ts/urlPool.ts).
function functionMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return message(err ?? null, fallback);
}

// The HTTP status of a FunctionsHttpError, if the function actually
// answered (not just a network error), `deleteAccount` needs EXACTLY this
// status to tell 401-after-deletion apart from every other error (see
// there).
function functionStatus(error: unknown): number | null {
  const httpError = error as { name?: string; context?: unknown } | null;
  if (httpError?.name === 'FunctionsHttpError' && httpError.context instanceof Response) {
    return httpError.context.status;
  }
  return null;
}

// The German plain text from a FunctionsHttpError's JSON body, if present,
// else `null` (the caller then falls back to the generic message). Its
// own function instead of an inline try/catch at every call site (same
// reuse principle as functionMessage).
async function functionPlainText(error: unknown): Promise<string | null> {
  const httpError = error as { name?: string; context?: unknown } | null;
  if (httpError?.name === 'FunctionsHttpError' && httpError.context instanceof Response) {
    try {
      const body = (await httpError.context.clone().json()) as { fehler?: string };
      if (typeof body.fehler === 'string') return body.fehler;
    } catch {
      // Response wasn't JSON, null, caller falls back.
    }
  }
  return null;
}

// Matches the function's response for `{ aktion: 'zahlen' }`
// (supabase/functions/konto-loeschen/index.ts). `betroffene_personen`
// already counts WITHOUT the requesting person themself (store.ts,
// `zaehle`), `deletionSummaryText` below doesn't need to correct that
// again.
export type DeletionCounts = {
  eigene_reisen: number;
  momente_in_eigenen_reisen: number;
  betroffene_personen: number;
  eigene_momente_anderswo: number;
};

const COUNTS_ERROR = 'Die Zahlen konnten nicht ermittelt werden. Probier es gleich nochmal.';

// Fetches what the deletion dialog MUST show before confirming is even
// possible (brief: "Without loaded counts, confirming must not be
// possible."), `data: null` on every error, never a guessed/empty counts
// structure a caller could accidentally let pass as "loaded".
export async function fetchDeletionCounts(): Promise<Loaded<DeletionCounts | null>> {
  const { data, error } = await supabase.functions.invoke('konto-loeschen', {
    body: { aktion: 'zahlen' },
  });
  if (error) {
    const plainText = await functionPlainText(error);
    return { data: null, error: plainText ?? functionMessage(error, COUNTS_ERROR) };
  }
  const counts = data as Partial<DeletionCounts> | null;
  if (
    !counts ||
    typeof counts.eigene_reisen !== 'number' ||
    typeof counts.momente_in_eigenen_reisen !== 'number' ||
    typeof counts.betroffene_personen !== 'number' ||
    typeof counts.eigene_momente_anderswo !== 'number'
  ) {
    return { data: null, error: COUNTS_ERROR };
  }
  return {
    data: {
      eigene_reisen: counts.eigene_reisen,
      momente_in_eigenen_reisen: counts.momente_in_eigenen_reisen,
      betroffene_personen: counts.betroffene_personen,
      eigene_momente_anderswo: counts.eigene_momente_anderswo,
    },
    error: null,
  };
}

const DELETE_ERROR = 'Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.';

// Triggers the deletion. **Contract detail (Task-9-brief, verbatim):** if
// the success response gets lost on the way back and this call is
// repeated (e.g. a second tap after a timeout), the function answers the
// second attempt with 401, the account (and thus the user behind the JWT)
// no longer exists by then (supabaseAdmin.auth.getUser fails for a
// deleted account). A 401 AFTER a deletion attempt is therefore success,
// not an error, otherwise the UI would show an error on an actual
// success. Every OTHER status stays a genuine error.
export async function deleteAccount(): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('konto-loeschen', {
    body: { aktion: 'loeschen' },
  });
  if (!error) return { error: null };
  if (functionStatus(error) === 401) return { error: null };
  const plainText = await functionPlainText(error);
  return { error: plainText ?? functionMessage(error, DELETE_ERROR) };
}

// Pure text building blocks (no IO), separately testable, no own file
// needed for two small sentences. `betroffene_personen` already counts
// without the requesting person (see DeletionCounts above).
function ownTripsSentence(counts: DeletionCounts): string {
  const tripWord = counts.eigene_reisen === 1 ? 'Reise' : 'Reisen';
  const momentWord = counts.momente_in_eigenen_reisen === 1 ? 'Moment' : 'Momenten';
  const personWord = counts.betroffene_personen === 1 ? 'Person' : 'Personen';
  const verb = counts.eigene_reisen === 1 ? 'verschwindet' : 'verschwinden';
  return (
    `${counts.eigene_reisen} ${tripWord} mit insgesamt ${counts.momente_in_eigenen_reisen} ${momentWord} von ` +
    `${counts.betroffene_personen} ${personWord} ${verb} unwiederbringlich, auch für alle anderen.`
  );
}

function ownMomentsElsewhereSentence(count: number): string {
  return count === 1
    ? 'Ausserdem geht dein Moment in einer fremden Reise verloren.'
    : `Ausserdem gehen deine ${count} Momente in fremden Reisen verloren.`;
}

// The dialog text "must tell the truth" (brief, verbatim): ALWAYS names
// the concrete numbers where they apply, instead of a glossed-over blanket
// phrasing. Without own trips AND without own moments elsewhere, only the
// bare account deletion itself remains to be said.
export function deletionSummaryText(counts: DeletionCounts): string {
  const sentences: string[] = [];
  if (counts.eigene_reisen > 0) sentences.push(ownTripsSentence(counts));
  if (counts.eigene_momente_anderswo > 0) sentences.push(ownMomentsElsewhereSentence(counts.eigene_momente_anderswo));
  if (sentences.length === 0) return 'Dein Konto und dein Profil werden endgültig gelöscht.';
  return sentences.join(' ');
}
