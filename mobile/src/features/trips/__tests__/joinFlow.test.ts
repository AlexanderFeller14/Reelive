import { redeemPendingInvite, resolveTargetPath, type PendingInviteDeps } from '../joinFlow';
import type { RedeemResult } from '../types';

// Builds fake deps for redeemPendingInvite: `active` starts at true and can
// be flipped via the redeemInvite call to simulate an effect that is torn
// down exactly during the redemption attempt.
function makeDeps(opts: {
  code?: string | null;
  result?: RedeemResult;
  activeBeforeAttempt?: boolean;
  activeAfterAttempt?: boolean;
}) {
  const {
    code = 'abc123',
    result = { status: 'joined', trip_id: 't1' },
    activeBeforeAttempt = true,
    activeAfterAttempt = true,
  } = opts;
  let active = activeBeforeAttempt;
  const peekRememberedInvite = jest.fn(async () => code);
  const redeemInvite = jest.fn(async (_code: string) => {
    active = activeAfterAttempt;
    return result;
  });
  const discardRememberedInvite = jest.fn(async () => {});
  const deps: PendingInviteDeps = {
    peekRememberedInvite,
    redeemInvite,
    discardRememberedInvite,
    isActive: () => active,
  };
  return { deps, peekRememberedInvite, redeemInvite, discardRememberedInvite };
}

test('a successful join leads into the trip and discards the code', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = makeDeps({
    result: { status: 'joined', trip_id: 't1' },
  });
  await expect(redeemPendingInvite(deps)).resolves.toBe('/reise/t1');
  expect(redeemInvite).toHaveBeenCalledWith('abc123');
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('already_member also leads into the trip', async () => {
  const { deps, discardRememberedInvite } = makeDeps({
    result: { status: 'already_member', trip_id: 't1' },
  });
  await expect(redeemPendingInvite(deps)).resolves.toBe('/reise/t1');
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('a failed attempt discards the code anyway', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = makeDeps({
    result: { status: 'not_found', trip_id: null },
  });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(redeemInvite).toHaveBeenCalledTimes(1);
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('an aborted attempt (effect torn down before redeeming) leaves the code in place', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = makeDeps({ activeBeforeAttempt: false });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(redeemInvite).not.toHaveBeenCalled();
  expect(discardRememberedInvite).not.toHaveBeenCalled();
});

test('no remembered code: neither redemption nor discarding', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = makeDeps({ code: null });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(redeemInvite).not.toHaveBeenCalled();
  expect(discardRememberedInvite).not.toHaveBeenCalled();
});

test('effect torn down during the attempt: code is discarded, but no longer navigated', async () => {
  const { deps, discardRememberedInvite } = makeDeps({
    result: { status: 'joined', trip_id: 't1' },
    activeAfterAttempt: false,
  });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('resolveTargetPath: joined → trip', () => {
  expect(resolveTargetPath({ status: 'joined', trip_id: 't1' })).toBe('/reise/t1');
});

test('resolveTargetPath: already_member → trip', () => {
  expect(resolveTargetPath({ status: 'already_member', trip_id: 't1' })).toBe('/reise/t1');
});

test('resolveTargetPath: not_found → no target', () => {
  expect(resolveTargetPath({ status: 'not_found', trip_id: null })).toBeNull();
});

test('resolveTargetPath: not_active → no target', () => {
  expect(resolveTargetPath({ status: 'not_active', trip_id: null })).toBeNull();
});
