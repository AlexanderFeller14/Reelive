import type { PushMessage } from '../reveal-trip/push.ts';

// What fellow travellers learn when their recap is shared or a link is
// revoked, as pure logic: no I/O, no client, no network. Pattern like
// reveal-trip/reveal.ts, for the same reason, which weighs especially heavy
// here: the recipient circle is the actual guarantee. If it only lived in a
// SQL clause, no test that runs without Docker would check it.
//
// ---------------------------------------------------------------------------
// Why this notification exists
// ---------------------------------------------------------------------------
// Since Phase 7, a share link shows not only the moments but also the
// places they were captured, unredacted (spec decision R4). Until now only
// the owner who created the link knew about that. Everyone else submitted
// their moments without ever learning that they now sit behind a public
// URL.
//
// The push is one half of the answer, the fleeting one. The other, the
// one you can look up later, is `public.recap_is_shared` (migration
// 20260820090000) and the row the trip screen builds from it. Whoever
// swipes the notification away or never allowed push still finds the
// information.

export type ShareEvent = 'created' | 'revoked';

// The two texts. Title and body differ, unlike the reveal push (there the
// same sentence appears twice): the title is the situation, the body says
// what follows from it.
//
// `who` is the display name of the owner, since she is the only one who can
// share or revoke. "Mira hat euren Recap geteilt" answers the first
// question such a notification raises right away. If the name is missing,
// the sentence stays, just without a person, instead of showing a gap.
//
// No em dash (DESIGN-LANGUAGE §6), plural "Ihr" form like the reveal push:
// the notification goes to the group, not to a single person.
export function textsFor(
  event: ShareEvent,
  tripName: string,
  who: string | null,
): { title: string; body: string } {
  if (event === 'created') {
    return {
      title: 'Euer Recap ist geteilt',
      body: who
        ? `${who} hat euren Recap von «${tripName}» geteilt. Wer den Link hat, sieht alle Momente samt ihren Orten.`
        : `Euer Recap von «${tripName}» ist geteilt. Wer den Link hat, sieht alle Momente samt ihren Orten.`,
    };
  }
  return {
    title: 'Der geteilte Link gilt nicht mehr',
    body: who
      ? `${who} hat den Link zu «${tripName}» widerrufen. Der Recap ist wieder nur für euch.`
      : `Der Link zu «${tripName}» wurde widerrufen. Der Recap ist wieder nur für euch.`,
  };
}

// Who gets the notification: all members except the person who triggered
// it.
//
// She already knows, she just tapped it herself, and a push for your own
// action is not information, it is an echo. Same rule and same reasoning
// as with the reveal, and like there deliberately a pure filter instead of
// a `.neq(…)` in the query, so a test can reach it.
export function recipientCircle(
  members: { user_id: string }[],
  triggeringUserId: string,
): string[] {
  return members.map((m) => m.user_id).filter((userId) => userId !== triggeringUserId);
}

export function buildMessages(
  tokens: { token: string }[],
  event: ShareEvent,
  trip: { id: string; name: string },
  who: string | null,
): PushMessage[] {
  const { title, body } = textsFor(event, trip.name, who);
  return tokens.map((t) => ({
    to: t.token,
    title,
    body,
    // Same field as with the reveal push, so tapping the notification lands
    // in the same branch. `event` sits next to it, in case the app later
    // wants to distinguish where to jump.
    data: { trip_id: trip.id, event },
  }));
}

// The store slice the send needs. Deliberately smaller than `ShareStore`:
// what is here is everything a notification touches, and a test does not
// have to rebuild the whole store.
export interface NotificationStore {
  fetchMembers(tripId: string): Promise<{ data: { user_id: string }[] | null; error: unknown }>;
  fetchTokens(userIds: string[]): Promise<{ data: { token: string }[] | null; error: unknown }>;
  deleteTokens(tokens: string[], userIds: string[]): Promise<{ error: unknown }>;
  fetchDisplayName(userId: string): Promise<{ data: string | null; error: unknown }>;
}

export type SendFn = (messages: PushMessage[]) => Promise<string[]>;

// Sends the notification and clears out tokens Expo reports as
// deregistered.
//
// Never throws and never reports to Sentry: a push that fails to arrive
// must not fail either the create or the revoke. This weighs heaviest for
// the revoke, it is the only lever that gets a link back out of the world,
// and it must not hang on a third-party service. Same stance as
// `sendRevealPush`, including the decision to NOT wire up the error
// reporter here.
export async function sendSharePush(
  store: NotificationStore,
  sendFn: SendFn,
  trip: { id: string; name: string },
  triggeringUserId: string,
  event: ShareEvent,
): Promise<void> {
  const { data: members, error: membersError } = await store.fetchMembers(trip.id);
  if (membersError) {
    console.error('share-link: trip_members select failed', membersError);
    return;
  }

  const recipientIds = recipientCircle(members ?? [], triggeringUserId);
  if (recipientIds.length === 0) return;

  const { data: tokenRows, error: tokenError } = await store.fetchTokens(recipientIds);
  if (tokenError) {
    console.error('share-link: push_tokens select failed', tokenError);
    return;
  }
  const tokens = tokenRows ?? [];
  if (tokens.length === 0) return;

  // The name is fetched only here, not above: if there is nobody to notify,
  // this query is superfluous too. A failure here only costs the name, not
  // the notification.
  const { data: who, error: nameError } = await store.fetchDisplayName(triggeringUserId);
  if (nameError) {
    console.error('share-link: profiles select for the display name failed', nameError);
  }

  const dead = await sendFn(buildMessages(tokens, event, trip, who ?? null));
  if (dead.length === 0) return;

  // Restricted to `recipientIds`, for the same reason as with the reveal:
  // the ticket-to-token mapping in push.ts is purely position-based. Should
  // Expo ever return a shifted block, a token wrongly read as deregistered
  // must NEVER delete outside the circle just notified.
  const { error: deleteError } = await store.deleteTokens(dead, recipientIds);
  if (deleteError) {
    console.error('share-link: cleaning up unregistered push_tokens failed', deleteError);
  }
}
