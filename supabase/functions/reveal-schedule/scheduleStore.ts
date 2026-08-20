// The real I/O adapter for schedule.ts' ScheduleStore interface: the shared
// building blocks (CAS reveal, members, tokens) come unchanged from
// ../reveal-trip/revealStore.ts, only the five schedule-specific queries
// sit here. Their conditions (strictly less than, marker CAS) are checked
// by scheduleStore_integration_test.ts against the real stack.
import type { ScheduleStore } from './schedule.ts';
import type { TripRow } from '../reveal-trip/reveal.ts';
import { createRevealStore, type AdminClient } from '../reveal-trip/revealStore.ts';

export { createAdminClient } from '../reveal-trip/revealStore.ts';

const TRIP_COLUMNS = 'id, name, owner_id, status, revealed_at';

export function createScheduleStore(supabaseAdmin: AdminClient): ScheduleStore {
  return {
    ...createRevealStore(supabaseAdmin),

    // Strictly less than: on the end date itself (until 23:59) the trip is
    // still ongoing (Spec §2).
    async fetchDueTrips(today) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_COLUMNS)
        .eq('status', 'active')
        .lt('end_date', today);
      return { data: data as TripRow[] | null, error };
    },

    async fetchReminderTrips(today) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_COLUMNS)
        .eq('status', 'active')
        .eq('end_date', today)
        .is('end_reminder_sent_at', null);
      return { data: data as TripRow[] | null, error };
    },

    // 'now' like in revealStore.ts: the timestamp comes from the DB clock.
    // The CAS condition `is('end_reminder_sent_at', null)`: only the first
    // run affects a row, every further one gets null back. Additionally
    // `status = 'active'`: a trip revealed manually between selection and
    // this update must no longer get the reminder, it is already revealed
    // (Spec §2: only while the trip is still active).
    async markReminder(tripId) {
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

    async fetchTripStartTrips(today) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_COLUMNS)
        .eq('status', 'active')
        .eq('start_date', today)
        .is('start_push_sent_at', null);
      return { data: data as TripRow[] | null, error };
    },

    // 'now' like in revealStore.ts: the timestamp comes from the DB clock.
    // CAS and status condition like markReminder: a trip revealed between
    // selection and this update must not get the start push anymore.
    async markStartPush(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ start_push_sent_at: 'now' })
        .eq('id', tripId)
        .eq('status', 'active')
        .is('start_push_sent_at', null)
        .select('start_push_sent_at')
        .maybeSingle();
      return { data: data as { start_push_sent_at: string } | null, error };
    },
  };
}
