import { describe, it, expect } from 'vitest';
import {
  VERIFY_HALT_AFTER,
  assign,
  autoVerify,
  failuresSinceSuccess,
  recordVerifyFailure,
  settleVerifyRun,
  settleVerifyRuns,
  verificationRow,
  verifyHalted,
  verifyStart,
  verifyRetryVerdict,
  type HeldSlice,
  type VerifyStartInput,
  type VerifyStore,
} from '../src/index.js';

const EMPTY: VerifyStore = { failures: {}, failedAt: [], lastSuccessAt: 0 };

const input = (over: Partial<VerifyStartInput> = {}): VerifyStartInput => ({
  on: true,
  slug: 'ship-it',
  tracer: false,
  deliveryCommit: 'abc1234',
  headroom: 'clear',
  machineOverride: false,
  held: [],
  going: new Set(),
  handRun: false,
  store: EMPTY,
  now: 1_000_000,
  ...over,
});

const held = (hold: HeldSlice['hold']): HeldSlice => ({ branch: 'b', hold, waitsOn: [], waitHeld: '', assignedTo: '' });

describe('autoVerify', () => {
  it('needs the switch and a declared command', () => {
    expect(autoVerify({ autoVerify: true, verifyCommand: 'claude -p' })).toBe(true);
    expect(autoVerify({ autoVerify: false, verifyCommand: 'claude -p' })).toBe(false);
    expect(autoVerify({ autoVerify: true, verifyCommand: '  ' })).toBe(false);
  });
});

describe('verifyStart', () => {
  it('starts a run when nothing refuses', () => {
    expect(verifyStart(input())).toEqual({ start: true });
  });

  it('names off when the switch or the command is missing', () => {
    expect(verifyStart(input({ on: false }))).toEqual({ start: false, reason: 'off' });
  });

  it('names starved without a Machine override, and starts with one', () => {
    expect(verifyStart(input({ headroom: 'starved' }))).toEqual({ start: false, reason: 'starved' });
    expect(verifyStart(input({ headroom: 'starved', machineOverride: true }))).toEqual({ start: true });
  });

  it('names no-free-agent while any slice is held on it, and not for other holds', () => {
    expect(verifyStart(input({ held: [held('waits'), held('no-free-agent')] }))).toEqual({
      start: false,
      reason: 'no-free-agent',
    });
    expect(verifyStart(input({ held: [held('waits'), held('no-brief')] }))).toEqual({ start: true });
  });

  it('names running while any verify run is going, for this plan or another', () => {
    expect(verifyStart(input({ going: new Set(['ship-it']) }))).toEqual({ start: false, reason: 'running' });
    expect(verifyStart(input({ going: new Set(['another-plan']) }))).toEqual({ start: false, reason: 'running' });
  });

  it("names hand-run for a plan whose trees a person's run holds", () => {
    expect(verifyStart(input({ handRun: true }))).toEqual({ start: false, reason: 'hand-run' });
  });

  it('names queue-unread while no queue pass has been read', () => {
    expect(verifyStart(input({ held: null }))).toEqual({ start: false, reason: 'queue-unread' });
  });

  it('names waiting inside the delay after a failure', () => {
    const f = recordVerifyFailure(undefined, 'abc1234', 1_000_000);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [1_000_000], lastSuccessAt: 0 };
    expect(verifyStart(input({ store, now: 1_000_001 }))).toEqual({ start: false, reason: 'waiting' });
    expect(verifyStart(input({ store, now: 1_060_000 }))).toEqual({ start: true });
  });

  it('names tracer', () => {
    expect(verifyStart(input({ tracer: true }))).toEqual({ start: false, reason: 'tracer' });
  });

  it('names halted at three failures newer than lastSuccessAt, across plans', () => {
    const store: VerifyStore = { failures: {}, failedAt: [10, 20, 30], lastSuccessAt: 5 };
    expect(verifyStart(input({ store }))).toEqual({ start: false, reason: 'halted' });
    expect(verifyStart(input({ store: { ...store, lastSuccessAt: 15 } }))).toEqual({ start: true });
  });
});

describe('verify failures', () => {
  it('names waiting until the delay after the last failure has passed', () => {
    const f = recordVerifyFailure(undefined, 'abc1234', 1_000_000);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [1_000_000], lastSuccessAt: 0 };
    expect(verifyStart(input({ store, now: 1_000_001 }))).toEqual({ start: false, reason: 'waiting' });
  });

  it('stops a plan after three failures under one delivery commit', () => {
    let f = recordVerifyFailure(undefined, 'abc1234', 1);
    f = recordVerifyFailure(f, 'abc1234', 2);
    expect(verifyRetryVerdict(f, 'abc1234', 1_000_000)).toBe('ready');
    f = recordVerifyFailure(f, 'abc1234', 3);
    expect(verifyRetryVerdict(f, 'abc1234', 1_000_000)).toBe('stopped');
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [1], lastSuccessAt: 0 };
    expect(verifyStart(input({ store }))).toEqual({ start: false, reason: 'stopped' });
  });

  it('starts the count again under a new delivery commit', () => {
    let f = recordVerifyFailure(undefined, 'abc1234', 1);
    f = recordVerifyFailure(recordVerifyFailure(f, 'abc1234', 2), 'abc1234', 3);
    expect(verifyRetryVerdict(f, 'def5678', 1_000_000)).toBe('ready');
    expect(recordVerifyFailure(f, 'def5678', 4).count).toBe(1);
  });

  it('counts the plan stop and the fleet halt separately', () => {
    const one = recordVerifyFailure(undefined, 'abc1234', 100);
    const store: VerifyStore = { failures: { 'ship-it': one }, failedAt: [10, 20, 100], lastSuccessAt: 0 };
    expect(verifyRetryVerdict(one, 'abc1234', 1_000_000)).toBe('ready');
    expect(failuresSinceSuccess(store)).toBe(VERIFY_HALT_AFTER);
    expect(verifyHalted(store)).toBe(true);
  });
});

describe('verificationRow', () => {
  it('names the plan stop and the plural count', () => {
    let f = recordVerifyFailure(undefined, 'abc1234', 1);
    f = recordVerifyFailure(recordVerifyFailure(f, 'abc1234', 2), 'abc1234', 3);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [1], lastSuccessAt: 0 };
    const row = verificationRow('ship-it', 'abc1234', store, 'l', 1_000_000);
    expect(row?.stopped).toBe(true);
    expect(row?.reason).toBe('verification failed 3 times; the fleet stopped retrying this plan');
  });

  it('names the log, the reason and the restart command', () => {
    const f = recordVerifyFailure(undefined, 'abc1234', 100);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [100], lastSuccessAt: 0 };
    const row = verificationRow('ship-it', 'abc1234', store, '/x/verify.log', 1_000_000);
    expect(row).toMatchObject({ restart: '/plot-deliver --verify ship-it', log: '/x/verify.log', stopped: false, fleetHalted: false });
    expect(row?.reason).toBe('verification failed 1 time');
  });

  it('says the fleet is halted for a plan with fewer failures than the stop', () => {
    const f = recordVerifyFailure(undefined, 'abc1234', 100);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [1, 2, 100], lastSuccessAt: 0 };
    const row = verificationRow('ship-it', 'abc1234', store, 'l', 1_000_000);
    expect(row?.fleetHalted).toBe(true);
    expect(row?.stopped).toBe(false);
    expect(row?.reason).toContain('the fleet is halted on verification failures');
  });

  it('names both a stopped plan and a halted fleet when both hold', () => {
    let f = recordVerifyFailure(undefined, 'abc1234', 1);
    f = recordVerifyFailure(recordVerifyFailure(f, 'abc1234', 2), 'abc1234', 3);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [1, 2, 3], lastSuccessAt: 0 };
    const row = verificationRow('ship-it', 'abc1234', store, 'l', 1_000_000);
    expect(row).toMatchObject({ stopped: true, fleetHalted: true });
    expect(row?.reason).toBe(
      'verification failed 3 times; the fleet stopped retrying this plan; the fleet is halted on verification failures',
    );
  });

  it('returns null for no record or a record under another delivery commit', () => {
    const f = recordVerifyFailure(undefined, 'abc1234', 100);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [100], lastSuccessAt: 0 };
    expect(verificationRow('other', 'abc1234', store, 'l', 1)).toBeNull();
    expect(verificationRow('ship-it', 'def5678', store, 'l', 1)).toBeNull();
  });
});

describe('settleVerifyRun', () => {
  const plan = { deliveryCommit: 'abc1234', verified: false };

  it('is a success when the default branch holds a current record for the judged commit', () => {
    expect(settleVerifyRun(0, 'abc1234', { ...plan, verified: true })).toEqual({ settle: 'success' });
    expect(settleVerifyRun(null, 'abc1234', { ...plan, verified: true })).toEqual({ settle: 'success' });
  });

  it('is a failure on the time bound, on a non-zero exit, and on a clean exit with no record', () => {
    expect(settleVerifyRun(124, 'abc1234', plan)).toEqual({ settle: 'failure', why: 'the run reached Worker bound' });
    expect(settleVerifyRun(2, 'abc1234', plan)).toEqual({ settle: 'failure', why: 'the run exited 2' });
    expect(settleVerifyRun(0, 'abc1234', plan)).toEqual({ settle: 'failure', why: 'the run left no record' });
    expect(settleVerifyRun(null, 'abc1234', plan)).toEqual({ settle: 'failure', why: 'the run left no record' });
  });

  it('is gone, neither success nor failure, for a plan that left Delivered or was delivered again', () => {
    expect(settleVerifyRun(0, 'abc1234', null)).toEqual({ settle: 'gone', why: 'the plan no longer reads Delivered' });
    expect(settleVerifyRun(1, 'abc1234', { ...plan, deliveryCommit: 'def5678' })).toEqual({
      settle: 'gone',
      why: 'the plan was delivered again',
    });
  });
});

describe('settleVerifyRuns', () => {
  const plans = (entries: Record<string, { deliveryCommit: string; verified: boolean }>) => new Map(Object.entries(entries));

  it('records a failure under the judged commit and adds it to failedAt', () => {
    const out = settleVerifyRuns(EMPTY, [{ slug: 'a', commit: 'c1', code: 1 }], plans({ a: { deliveryCommit: 'c1', verified: false } }), new Set(), 50);
    expect(out.store.failures.a).toEqual({ count: 1, lastAt: 50, reading: 'c1' });
    expect(out.store.failedAt).toEqual([50]);
    expect(out.settled).toEqual([{ slug: 'a', settlement: { settle: 'failure', why: 'the run exited 1' } }]);
  });

  it('clears the plan and the halt on a success', () => {
    const before: VerifyStore = { failures: { a: { count: 2, lastAt: 9, reading: 'c1' } }, failedAt: [7, 8, 9], lastSuccessAt: 0 };
    expect(verifyHalted(before)).toBe(true);
    const out = settleVerifyRuns(before, [{ slug: 'a', commit: 'c1', code: 0 }], plans({ a: { deliveryCommit: 'c1', verified: true } }), new Set(), 50);
    expect(out.store).toEqual({ failures: {}, failedAt: [], lastSuccessAt: 50 });
    expect(verifyHalted(out.store)).toBe(false);
  });

  it('changes nothing for a run whose plan left Delivered', () => {
    const out = settleVerifyRuns(EMPTY, [{ slug: 'a', commit: 'c1', code: 0 }], plans({}), new Set(), 50);
    expect(out.store).toEqual(EMPTY);
    expect(out.settled[0]?.settlement.settle).toBe('gone');
  });

  it("counts a person's record as a success that clears the failure and lifts the halt", () => {
    const before: VerifyStore = { failures: { a: { count: 3, lastAt: 9, reading: 'c1' } }, failedAt: [7, 8, 9], lastSuccessAt: 0 };
    const out = settleVerifyRuns(before, [], plans({ a: { deliveryCommit: 'c1', verified: true } }), new Set(), 50);
    expect(out.store).toEqual({ failures: {}, failedAt: [], lastSuccessAt: 50 });
    expect(out.settled).toEqual([{ slug: 'a', settlement: { settle: 'success' } }]);
  });

  it('keeps the failure of a plan with no record, or with a run still going', () => {
    const before: VerifyStore = { failures: { a: { count: 1, lastAt: 9, reading: 'c1' }, b: { count: 1, lastAt: 9, reading: 'c2' } }, failedAt: [9, 9], lastSuccessAt: 0 };
    const out = settleVerifyRuns(
      before,
      [],
      plans({ a: { deliveryCommit: 'c1', verified: false }, b: { deliveryCommit: 'c2', verified: true } }),
      new Set(['b']),
      50,
    );
    expect(out.store).toEqual(before);
    expect(out.settled).toEqual([]);
  });
});

describe('scaleUp counts a going verify run', () => {
  const fleet = { size: 3, headroom: 'clear' as const, spawnCostMs: 5, desks: ['d1', 'd2', 'd3'] };
  const queued = (verifying?: number) => ({
    slices: [],
    agents: [],
    ...(verifying === undefined ? {} : { verifying }),
  });

  it('adds the run to running', () => {
    const none = assign(queued(), { fleet }).detail.scaling;
    const one = assign(queued(1), { fleet }).detail.scaling;
    expect(none?.running).toBe(0);
    expect(one?.running).toBe(1);
  });
});
