import { describe, it, expect } from 'vitest';
import {
  VERIFY_HALT_AFTER,
  assign,
  autoVerify,
  failuresSinceSuccess,
  recordVerifyFailure,
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

  it('names running for the same plan only', () => {
    expect(verifyStart(input({ going: new Set(['ship-it']) }))).toEqual({ start: false, reason: 'running' });
    expect(verifyStart(input({ going: new Set(['another-plan']) }))).toEqual({ start: true });
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

  it('returns null for no record or a record under another delivery commit', () => {
    const f = recordVerifyFailure(undefined, 'abc1234', 100);
    const store: VerifyStore = { failures: { 'ship-it': f }, failedAt: [100], lastSuccessAt: 0 };
    expect(verificationRow('other', 'abc1234', store, 'l', 1)).toBeNull();
    expect(verificationRow('ship-it', 'def5678', store, 'l', 1)).toBeNull();
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
