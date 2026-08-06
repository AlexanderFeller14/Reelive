import { redeemPendingInvite, ermittleZielPfad, type PendingInviteDeps } from '../joinFlow';
import type { RedeemResult } from '../types';

// Baut Fake-Deps für redeemPendingInvite: `aktiv` startet bei true und kann
// per redeemInvite-Aufruf umgeschaltet werden, um einen Effect zu simulieren,
// der genau während des Einlöseversuchs abgeräumt wird.
function machDeps(opts: {
  code?: string | null;
  ergebnis?: RedeemResult;
  aktivVorVersuch?: boolean;
  aktivNachVersuch?: boolean;
}) {
  const {
    code = 'abc123',
    ergebnis = { status: 'joined', trip_id: 't1' },
    aktivVorVersuch = true,
    aktivNachVersuch = true,
  } = opts;
  let aktiv = aktivVorVersuch;
  const peekRememberedInvite = jest.fn(async () => code);
  const redeemInvite = jest.fn(async (_code: string) => {
    aktiv = aktivNachVersuch;
    return ergebnis;
  });
  const discardRememberedInvite = jest.fn(async () => {});
  const deps: PendingInviteDeps = {
    peekRememberedInvite,
    redeemInvite,
    discardRememberedInvite,
    istAktiv: () => aktiv,
  };
  return { deps, peekRememberedInvite, redeemInvite, discardRememberedInvite };
}

test('erfolgreicher Beitritt führt in die Reise und verwirft den Code', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = machDeps({
    ergebnis: { status: 'joined', trip_id: 't1' },
  });
  await expect(redeemPendingInvite(deps)).resolves.toBe('/reise/t1');
  expect(redeemInvite).toHaveBeenCalledWith('abc123');
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('already_member führt ebenfalls in die Reise', async () => {
  const { deps, discardRememberedInvite } = machDeps({
    ergebnis: { status: 'already_member', trip_id: 't1' },
  });
  await expect(redeemPendingInvite(deps)).resolves.toBe('/reise/t1');
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('fehlgeschlagener Versuch verwirft den Code trotzdem', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = machDeps({
    ergebnis: { status: 'not_found', trip_id: null },
  });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(redeemInvite).toHaveBeenCalledTimes(1);
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('abgebrochener Versuch (Effect vor dem Einlösen abgeräumt) lässt den Code liegen', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = machDeps({ aktivVorVersuch: false });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(redeemInvite).not.toHaveBeenCalled();
  expect(discardRememberedInvite).not.toHaveBeenCalled();
});

test('kein gemerkter Code: weder Einlösung noch Verwerfen', async () => {
  const { deps, redeemInvite, discardRememberedInvite } = machDeps({ code: null });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(redeemInvite).not.toHaveBeenCalled();
  expect(discardRememberedInvite).not.toHaveBeenCalled();
});

test('Effect während des Versuchs abgeräumt: Code wird verworfen, aber nicht mehr navigiert', async () => {
  const { deps, discardRememberedInvite } = machDeps({
    ergebnis: { status: 'joined', trip_id: 't1' },
    aktivNachVersuch: false,
  });
  await expect(redeemPendingInvite(deps)).resolves.toBeNull();
  expect(discardRememberedInvite).toHaveBeenCalledTimes(1);
});

test('ermittleZielPfad: joined → Reise', () => {
  expect(ermittleZielPfad({ status: 'joined', trip_id: 't1' })).toBe('/reise/t1');
});

test('ermittleZielPfad: already_member → Reise', () => {
  expect(ermittleZielPfad({ status: 'already_member', trip_id: 't1' })).toBe('/reise/t1');
});

test('ermittleZielPfad: not_found → kein Ziel', () => {
  expect(ermittleZielPfad({ status: 'not_found', trip_id: null })).toBeNull();
});

test('ermittleZielPfad: not_active → kein Ziel', () => {
  expect(ermittleZielPfad({ status: 'not_active', trip_id: null })).toBeNull();
});
