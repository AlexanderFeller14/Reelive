// Der reale I/O-Adapter für reveal.ts' `RevealStore`-Schnittstelle — dünne
// Weiterleitung an einen Supabase-Client (Service-Role), dieselben Abfragen
// wie in der Fassung vor der Auslagerung, nur hierher verschoben. Eigene
// Datei statt Teil von reveal.ts: reveal.ts bleibt reine Logik ohne
// Supabase-Import, testbar ohne jede I/O; hier stehen genau die zwei
// Abfragen, die kein Unit-Test ersetzen kann —
//   - die CAS-Bedingung `.eq('status','active')` im Update
//     (aktualisiereWennAktiv)
//   - die Empfänger-Einschränkung `.in('user_id', userIds)` bei der
//     Token-Löschung (loescheTokens)
// — und die deshalb direkt (ohne Umweg über HTTP oder Expo)
// revealStore_integration_test.ts gegen den echten lokalen Stack prüft.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { RevealStore, TripZeile } from './reveal.ts';

// Fabrik statt eines direkten `createClient(...)`-Aufrufs: nur so lässt sich
// der Rückgabetyp sauber benennen. `ReturnType<typeof createClient>` allein
// (ohne die Fabrik) inferiert an dieser Stelle einen ANDEREN Typ als der
// tatsächliche Aufruf `createClient(url, key)` — createClient hat
// interdependente generische Default-Typparameter, und `typeof createClient`
// referenziert die allgemeine Funktionssignatur, nicht die an einer
// konkreten Aufrufstelle inferierten Defaults (in einer früheren Fassung
// dieser Function schlug `deno check` deshalb fehl, siehe task-2-report.md).
export function erstelleAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey);
}
export type AdminClient = ReturnType<typeof erstelleAdminClient>;

export function erstelleRevealStore(supabaseAdmin: AdminClient): RevealStore {
  return {
    async holeTrip(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('id, name, owner_id, status, revealed_at')
        .eq('id', tripId)
        .maybeSingle();
      return { data: data as TripZeile | null, error };
    },

    // `revealed_at: 'now'` ist kein Tippfehler für `new Date().toISOString()`:
    // 'now' ist in Postgres ein besonderer Datum/Zeit-Eingabewert (siehe
    // Postgres-Doku „Special Date/Time Inputs“), der beim Cast auf timestamptz
    // zur Startzeit der AUSFÜHRENDEN Transaktion aufgelöst wird — exakt
    // dasselbe Verhalten wie now()/CURRENT_TIMESTAMP in SQL, nur ausdrückbar
    // als gewöhnlicher Update-Wert über PostgREST (das keine SQL-Funktionsauf-
    // rufe im Request-Body entgegennimmt). Am lokalen Stack verifiziert: zwei
    // PATCH-Aufrufe im Abstand mehrerer Sekunden liefern unterschiedliche,
    // dem jeweiligen Ausführungszeitpunkt entsprechende Werte — der Zeitstempel
    // kommt also wirklich aus der Datenbank, nie aus Deno. Das ist relevant für
    // die Nachzügler-Regel (posts_insert_member,
    // supabase/migrations/20260803090300_sealing_rls.sql), die
    // `captured_at <= t.revealed_at` vergleicht — ABER `captured_at` ist
    // Gerätezeit: der Client setzt die Spalte selbst beim Insert (Spalten-Grant
    // in supabase/migrations/20260803090600_role_hardening.sql, Abschnitt 2).
    // Der Vergleich läuft also so oder so Gerätezeit gegen Serverzeit — dieses
    // grössere, prinzipiell unvermeidbare Delta beseitigt `now` nicht. Was
    // `now` beseitigt, ist die zusätzliche, kleinere Verschiebung, die
    // entstünde, WÜRDE Deno selbst einen Zeitstempel berechnen (z. B. `new
    // Date().toISOString()`) und ihn als Literal in dieselbe Spalte schreiben:
    // dann hinge revealed_at zusätzlich von der Uhr des Deno-Hosts ab, die von
    // der DB-Server-Uhr abweichen kann. `now` sorgt dafür, dass revealed_at
    // ausschliesslich von EINER Uhr abhängt — der des DB-Servers, derselben,
    // die auch bestimmt, wann ein `captured_at`-Wert als Nachzügler gilt.
    //
    // Die CAS-Bedingung `.eq('status','active')`: nur ein Update, dessen
    // WHERE-Klausel beim Ausführen noch zutrifft, betrifft eine Zeile. Zwei
    // wirklich parallele Aufrufe serialisieren sich an der Zeilensperre von
    // Postgres — der zweite sieht beim Ausführen bereits status='revealed'
    // und betrifft 0 Zeilen. Das ist der Teil, den revealStore_integration_test.ts
    // direkt (ohne HTTP) gegen den echten Stack beweist.
    async aktualisiereWennAktiv(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ status: 'revealed', revealed_at: 'now' })
        .eq('id', tripId)
        .eq('status', 'active')
        .select('revealed_at')
        .maybeSingle();
      return { data: data as { revealed_at: string } | null, error };
    },

    async holeRevealedAtNachlese(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('revealed_at')
        .eq('id', tripId)
        .maybeSingle();
      return { data: data as { revealed_at: string | null } | null, error };
    },

    async holeMitglieder(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', tripId);
      return { data: data as { user_id: string }[] | null, error };
    },

    async holeTokens(userIds) {
      const { data, error } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .in('user_id', userIds);
      return { data: data as { token: string }[] | null, error };
    },

    // userIds zusätzlich zu tokens (Review-Minor, siehe Kommentar in
    // reveal.ts/versendeRevealPush): begrenzt eine fälschlich als
    // DeviceNotRegistered gelesene Zuordnung auf den gerade angeschriebenen
    // Empfängerkreis, statt als Service-Role über die ganze Tabelle zu
    // laufen. Direkt geprüft in revealStore_integration_test.ts.
    async loescheTokens(tokens, userIds) {
      const { error } = await supabaseAdmin
        .from('push_tokens')
        .delete()
        .in('token', tokens)
        .in('user_id', userIds);
      return { error };
    },
  };
}
