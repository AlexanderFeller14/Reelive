// The entire decision and send logic of reveal-trip, extracted out of
// Deno.serve, in response to a final-review finding that this function had
// zero automated tests (push_test.ts only covers push.ts in isolation).
// reveal-trip is the only path on which a trip ever changes status,
// irreversibly, and opens every moment for every member in one stroke,
// that makes it the most safety-critical code in the app next to
// media-urls/lesen.
//
// Style like media-urls/readAccess.ts and ../reveal-trip/push.ts: I/O
// sits behind a narrow, injectable interface (`RevealStore`, `SendFn`), the
// actual decision is a pure function over it. index.ts implements
// `RevealStore` as a thin, 1:1 forward to supabaseAdmin (the same queries
// as in the previous version, only moved here) and just calls
// `performReveal`.
//
// What this means for tests: reveal_test.ts checks `performReveal` and
// `sendRevealPush` with a fake store, no Docker, no network, runs on any
// machine. That covers the complete BRANCHING LOGIC: owner check, idempotent
// response, archive conflict, push only in the winner branch (never in the
// loser branch, exactly the finding that had already been fixed once in
// f26437a), exclusion of the triggering person from the recipients, and
// that a failing push no longer undoes the status change already made.
// What a pure function CANNOT cover: that the CAS condition (`status =
// 'active'`) sits in the REAL Postgres query and that two genuinely
// parallel calls really produce only one winner, that is covered by
// reveal_integration_test.ts against the real stack.

import type { PushMessage } from './push.ts';
import type { ReportFn } from '../_shared/errorReporter.ts';

// A no-op with no reporter passed in, tests that call `performReveal` with
// the previous four arguments (reveal_test.ts) therefore keep running
// unchanged; index.ts passes the real reporter built from SENTRY_DSN as the
// fifth argument (style like `sendFn`).
const NO_REPORTER: ReportFn = async () => {};

export type TripStatus = 'active' | 'revealed' | 'archived';

export type TripRow = {
  id: string;
  name: string;
  owner_id: string;
  status: TripStatus;
  revealed_at: string | null;
};

// Result of a store operation in the Supabase style (data/error), so
// index.ts' adapter can be taken over almost word for word from the
// previous version, less reshaping means less opportunity to change
// behaviour while moving it.
export type StoreResult<T> = { data: T | null; error: unknown };

export interface RevealStore {
  fetchTrip(tripId: string): Promise<StoreResult<TripRow>>;

  // The CAS update: sets status/revealed_at ONLY when status is currently
  // 'active'. data === null means "0 rows affected", a parallel call won,
  // not this one. The condition `.eq('status','active')` sits in the
  // adapter implementation (real Postgres query), it is the part only an
  // integration test against real Postgres can prove, see the header
  // comment.
  updateIfActive(tripId: string): Promise<StoreResult<{ revealed_at: string }>>;

  // Follow-up read after a lost CAS race: the trip IS revealed by now
  // (another call won), we only read the timestamp back.
  fetchRevealedAtFollowUp(tripId: string): Promise<StoreResult<{ revealed_at: string | null }>>;

  // ALL members of a trip, INCLUDING the triggering person. Deliberately
  // with no `.neq('user_id', triggeringUserId)` in the query: the exclusion
  // happens in `sendRevealPush` (pure JS filtering), so it is unit-testable
  // instead of living only in a SQL clause no test without Docker reaches.
  fetchMembers(tripId: string): Promise<StoreResult<{ user_id: string }[]>>;

  fetchTokens(userIds: string[]): Promise<StoreResult<{ token: string }[]>>;

  // tokens: tokens Expo reports as "DeviceNotRegistered".
  // userIds: additional restriction to the just-notified recipient circle
  // (review minor, see comment in sendRevealPush), both parameters already
  // arrive correctly restricted from the pure orchestration, the adapter
  // only has to carry them 1:1 into the query.
  deleteTokens(tokens: string[], userIds: string[]): Promise<{ error: unknown }>;
}

// Signature like `send` from push.ts, but without its own `fetchImpl`
// argument, the injection happens one level higher here, index.ts passes
// the real `send` function by default (which itself uses the real global
// `fetch`).
export type SendFn = (messages: PushMessage[]) => Promise<string[]>;

// Sends the reveal notification to every member of the trip except the
// triggering person and deletes tokens Expo reports as deregistered.
//
// IMPORTANT: `performReveal` only calls this in the winner branch of the
// CAS update. A parallel call that did not itself trigger the status
// change (0 rows affected, follow-up branch) must not send the push a
// second time, exactly this double send was a review finding on an earlier
// version of this function (f26437a) and is now proven, not just by
// reading the code, by reveal_test.ts with a real two-call race against a
// shared fake store.
export async function sendRevealPush(
  store: RevealStore,
  sendFn: SendFn,
  trip: TripRow,
  triggeringUserId: string | null,
): Promise<void> {
  const { data: members, error: membersError } = await store.fetchMembers(trip.id);
  if (membersError) {
    console.error('reveal-trip: trip_members-Select fehlgeschlagen', membersError);
    return;
  }

  // The triggering person does not get her own reveal pushed to her, she
  // already knows, she just tapped "finish trip" herself. Previously a
  // `.neq('user_id', triggeringUserId)` clause in the SQL query itself, now
  // the same set as pure JS filtering, so reveal_test.ts can check it with
  // no Docker.
  //
  // triggeringUserId null (auto-reveal, Spec 2026-08-18): the calendar
  // triggered it, no person, nobody gets filtered; the comparison userId
  // !== null is true for every user_id.
  const recipientIds = (members ?? [])
    .map((m) => m.user_id)
    .filter((userId) => userId !== triggeringUserId);
  if (recipientIds.length === 0) return;

  const { data: tokenRows, error: tokenError } = await store.fetchTokens(recipientIds);
  if (tokenError) {
    console.error('reveal-trip: push_tokens-Select fehlgeschlagen', tokenError);
    return;
  }
  const tokens = tokenRows ?? [];
  if (tokens.length === 0) return;

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: `✈️ Euer Recap von «${trip.name}» ist bereit!`,
    body: `✈️ Euer Recap von «${trip.name}» ist bereit!`,
    data: { trip_id: trip.id },
  }));

  const dead = await sendFn(messages);
  if (dead.length === 0) return;

  // Additionally restricted to `recipientIds` (review minor): the
  // ticket-to-token mapping in push.ts is purely position-based (ticket i
  // belongs to message i). Should Expo ever return a shifted `data` block,
  // a token wrongly read as DeviceNotRegistered must NEVER delete outside
  // the just-notified recipient circle, the restriction limits the damage
  // to exactly this circle, instead of running as the service role over
  // the whole table.
  const { error: deleteError } = await store.deleteTokens(dead, recipientIds);
  if (deleteError) {
    console.error('reveal-trip: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
  }
}

export type RevealResult = { status: number; body: Record<string, unknown> };

// The complete decision chain of reveal-trip starting from the loaded trip
// row: owner check -> idempotent (already revealed) -> archive conflict ->
// CAS update -> push only in the winner branch -> follow-up read in the
// loser branch. Word for word the same as the previous version inside
// Deno.serve (error text, status codes, order, which branch triggers the
// push), index.ts now only calls this and translates the result into a
// Response.
// `report` is the fifth, optional argument (style like `sendFn`): index.ts
// passes the real reporter built from SENTRY_DSN, tests leave it out
// (NO_REPORTER) or inject their own fake to prove THAT it is really called
// at the three places below, not just that a reporter exists (see point 2
// of the final review: "an error reporter with no caller is worthless").
// Deliberately NOT wired into `sendRevealPush`: a network error against
// Expo, a broken ticket, or an empty recipient list are, per the comment
// there, already deliberately tolerated, non-critical outcomes, the same
// function would contradict itself if it reported to Sentry what it
// classifies in the next breath as "must not fail the reveal".
export async function performReveal(
  store: RevealStore,
  sendFn: SendFn,
  tripId: string,
  requestingUserId: string,
  report: ReportFn = NO_REPORTER,
): Promise<RevealResult> {
  const { data: trip, error: tripError } = await store.fetchTrip(tripId);
  if (tripError) {
    console.error('reveal-trip: trips-Select fehlgeschlagen', tripError);
    await report(tripError, { trip_id: tripId });
    return { status: 500, body: { error: 'Reise konnte nicht geladen werden.' } };
  }
  if (!trip) {
    return { status: 404, body: { error: 'Reise nicht gefunden.' } };
  }

  if (trip.owner_id !== requestingUserId) {
    return { status: 403, body: { error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' } };
  }

  // Idempotent: a second tap on "finish trip" (e.g. because the network
  // wobbled the first time) is not an error, the app gets the same
  // revealed_at value as on the first successful call. This branch never
  // even reaches the CAS update, so no second push either, only for a
  // SEQUENTIAL second call, after the first response already came back.
  // The real race (two calls that BOTH read status==='active' before
  // either commits) instead runs through the CAS branch below, winner and
  // loser told apart by the update result.
  if (trip.status === 'revealed') {
    return { status: 200, body: { ok: true, revealed_at: trip.revealed_at } };
  }
  if (trip.status === 'archived') {
    return { status: 409, body: { error: 'Diese Reise ist schon archiviert.' } };
  }

  // status === 'active': the only status change, atomic via the CAS
  // condition in the adapter (`.eq('status','active')` on the real Postgres
  // query, see the RevealStore comment).
  const { data: updated, error: updateError } = await store.updateIfActive(tripId);
  if (updateError) {
    console.error('reveal-trip: trips-Update fehlgeschlagen', updateError);
    await report(updateError, { trip_id: tripId, user_id: requestingUserId });
    return { status: 500, body: { error: 'Reise konnte nicht abgeschlossen werden.' } };
  }

  let revealedAt: string | null;
  if (updated) {
    // We triggered the status change, and only for that reason also the
    // push. The send deliberately sits INSIDE this branch: were it after
    // the if/else, the loser of a race (below, 0 rows affected) would also
    // trigger it again and send the same notification to every member a
    // second time, even though its own call changed nothing at all.
    revealedAt = updated.revealed_at;

    // The status change is the truth, the notification only the message: a
    // network error against Expo, a broken ticket, or an empty recipient
    // list must not fail the reveal, the response to the owner stays 200
    // with the already-determined revealedAt, regardless of how the send
    // turns out.
    try {
      await sendRevealPush(store, sendFn, trip, requestingUserId);
    } catch (err) {
      console.error('reveal-trip: Push-Versand fehlgeschlagen', err);
    }
  } else {
    // 0 rows affected: a parallel call was faster and already flipped the
    // status from 'active' to 'revealed' (the CAS condition therefore no
    // longer applied). That is not an error, the trip IS revealed now, we
    // only read back which timestamp it happened at. NO push here: the
    // winner branch above already sent it.
    const { data: followUp, error: followUpError } = await store.fetchRevealedAtFollowUp(tripId);
    if (followUpError || !followUp) {
      console.error('reveal-trip: Nachlesen nach paralellem Reveal fehlgeschlagen', followUpError);
      await report(followUpError ?? new Error('reveal-trip: Nachlesen nach parallelem Reveal ohne Zeile.'), {
        trip_id: tripId,
      });
      return { status: 500, body: { error: 'Reise konnte nicht abgeschlossen werden.' } };
    }
    revealedAt = followUp.revealed_at;
  }

  return { status: 200, body: { ok: true, revealed_at: revealedAt } };
}
