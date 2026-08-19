import type { Href } from 'expo-router';
import type { RedeemResult } from './types';

// Pure decision, independent of where the result comes from, both the root
// layout AND the join screen use this same rule instead of each repeating
// it: `already_member` is not an error, a link redeemed a second time leads
// into the trip just like a fresh join.
export function resolveTargetPath(result: RedeemResult): Href | null {
  if (result.trip_id && (result.status === 'joined' || result.status === 'already_member')) {
    return `/reise/${result.trip_id}`;
  }
  return null;
}

export type PendingInviteDeps = {
  peekRememberedInvite: () => Promise<string | null>;
  redeemInvite: (code: string) => Promise<RedeemResult>;
  discardRememberedInvite: () => Promise<void>;
  // Reports whether the calling effect is still active (not torn down). Injected
  // as a function rather than a bool so the current value at the moment of the
  // check counts, not the value at the start of the call.
  isActive: () => boolean;
};

// Orchestrates redeeming a code remembered before login, kept separate from
// the root-layout effect so it is testable, since every IO dependency is
// injected. Returns the target path if a navigation should happen, null
// otherwise.
//
// Replay safety: the code is NOT deleted on read (peek instead of take),
// otherwise it would get lost if the effect is torn down between reading and
// the actual redemption attempt (e.g. because `status` briefly flips away
// and back due to a hasProfile re-evaluation). Only once redeemInvite() has
// actually been called does the attempt count as having happened, and then
// it is ALWAYS discarded, even on failure: otherwise a permanently invalid
// code would be retried on every future signedIn.
export async function redeemPendingInvite(deps: PendingInviteDeps): Promise<Href | null> {
  const code = await deps.peekRememberedInvite();
  if (!code) return null;
  if (!deps.isActive()) return null; // torn down before the attempt: code stays put
  const result = await deps.redeemInvite(code);
  await deps.discardRememberedInvite(); // attempt happened: always discard
  if (!deps.isActive()) return null; // effect is gone: no longer navigate
  return resolveTargetPath(result);
}
