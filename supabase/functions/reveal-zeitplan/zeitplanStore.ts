// Der reale I/O-Adapter für zeitplan.ts' ZeitplanStore-Schnittstelle: die
// geteilten Bausteine (CAS-Reveal, Mitglieder, Tokens) kommen unverändert
// aus ../reveal-trip/revealStore.ts, hier stehen nur die drei Zeitplan-
// Abfragen. Deren Bedingungen (streng kleiner, Marker-CAS) prüft
// zeitplanStore_integration_test.ts gegen den echten Stack.
import type { ZeitplanStore } from './zeitplan.ts';
import type { TripZeile } from '../reveal-trip/reveal.ts';
import { erstelleRevealStore, type AdminClient } from '../reveal-trip/revealStore.ts';

export { erstelleAdminClient } from '../reveal-trip/revealStore.ts';

const TRIP_SPALTEN = 'id, name, owner_id, status, revealed_at';

export function erstelleZeitplanStore(supabaseAdmin: AdminClient): ZeitplanStore {
  return {
    ...erstelleRevealStore(supabaseAdmin),

    // Streng kleiner: am Enddatum selbst (bis 23:59) bleibt die Reise
    // unterwegs (Spec §2).
    async holeFaelligeReisen(heute) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_SPALTEN)
        .eq('status', 'active')
        .lt('end_date', heute);
      return { data: data as TripZeile[] | null, error };
    },

    async holeErinnerungsReisen(heute) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_SPALTEN)
        .eq('status', 'active')
        .eq('end_date', heute)
        .is('end_reminder_sent_at', null);
      return { data: data as TripZeile[] | null, error };
    },

    // 'now' wie in revealStore.ts: der Zeitstempel kommt aus der DB-Uhr.
    // Die CAS-Bedingung `is('end_reminder_sent_at', null)`: nur der erste
    // Lauf betrifft eine Zeile, jeder weitere bekommt null zurück. Zusätzlich
    // `status = 'active'`: eine Reise, die zwischen Auswahl und diesem
    // Update manuell revealed wurde, darf die Erinnerung nicht mehr
    // bekommen, sie ist schon aufgedeckt (Spec §2: nur solange die Reise
    // noch active ist).
    async markiereErinnerung(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ end_reminder_sent_at: 'now' })
        .eq('id', tripId)
        .eq('status', 'active')
        .is('end_reminder_sent_at', null)
        .select('end_reminder_sent_at')
        .maybeSingle();
      return { data: data as { end_reminder_sent_at: string } | null, error };
    },
  };
}
