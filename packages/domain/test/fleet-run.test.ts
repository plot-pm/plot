import { describe, it, expect } from 'vitest';
import {
  RUN_HALT_AFTER,
  failuresSinceSuccess,
  recordRunFailure,
  runHalted,
  runRetryVerdict,
  slotRefusal,
  type HeldSlice,
  type RunStore,
  type SlotRefusalInput,
} from '../src/index.js';

const EMPTY: RunStore = { failures: {}, failedAt: [], lastSuccessAt: 0 };

const held = (hold: HeldSlice['hold']): HeldSlice => ({ branch: 'b', hold, waitsOn: [], waitHeld: '', assignedTo: '' });

const slotInput = (over: Partial<SlotRefusalInput> = {}): SlotRefusalInput => ({
  held: [],
  headroom: 'clear',
  machineOverride: false,
  ...over,
});

describe('runRetryVerdict and recordRunFailure', () => {
  it('names waiting until the delay after the last failure has passed', () => {
    const f = recordRunFailure(undefined, 'abc1234', 1_000_000);
    expect(runRetryVerdict(f, 'abc1234', 1_000_001)).toBe('waiting');
    expect(runRetryVerdict(f, 'abc1234', 1_060_000)).toBe('ready');
  });

  it('stops a plan after three failures under one commit', () => {
    let f = recordRunFailure(undefined, 'abc1234', 1);
    f = recordRunFailure(f, 'abc1234', 2);
    expect(runRetryVerdict(f, 'abc1234', 1_000_000)).toBe('ready');
    f = recordRunFailure(f, 'abc1234', 3);
    expect(runRetryVerdict(f, 'abc1234', 1_000_000)).toBe('stopped');
  });

  it('starts the count again under a new commit', () => {
    let f = recordRunFailure(undefined, 'abc1234', 1);
    f = recordRunFailure(recordRunFailure(f, 'abc1234', 2), 'abc1234', 3);
    expect(runRetryVerdict(f, 'def5678', 1_000_000)).toBe('ready');
    expect(recordRunFailure(f, 'def5678', 4).count).toBe(1);
  });
});

describe('failuresSinceSuccess and runHalted', () => {
  it('counts failures newer than lastSuccessAt, across plans', () => {
    const store: RunStore = { failures: {}, failedAt: [10, 20, 30], lastSuccessAt: 5 };
    expect(failuresSinceSuccess(store)).toBe(RUN_HALT_AFTER);
    expect(runHalted(store)).toBe(true);
    expect(runHalted({ ...store, lastSuccessAt: 15 })).toBe(false);
  });

  it('halts at RUN_HALT_AFTER and not before', () => {
    const store: RunStore = { failures: {}, failedAt: [10, 20], lastSuccessAt: 0 };
    expect(runHalted(store)).toBe(false);
    expect(runHalted({ ...store, failedAt: [10, 20, 30] })).toBe(true);
  });
});

describe('slotRefusal', () => {
  it('names queue-unread while no queue pass has been read', () => {
    expect(slotRefusal(slotInput({ held: null }))).toBe('queue-unread');
  });

  it('names no-free-agent while any slice is held on it, and not for other holds', () => {
    expect(slotRefusal(slotInput({ held: [held('waits'), held('no-free-agent')] }))).toBe('no-free-agent');
    expect(slotRefusal(slotInput({ held: [held('waits'), held('no-brief')] }))).toBeNull();
  });

  it('names starved without a Machine override, and nothing with one', () => {
    expect(slotRefusal(slotInput({ headroom: 'starved' }))).toBe('starved');
    expect(slotRefusal(slotInput({ headroom: 'starved', machineOverride: true }))).toBeNull();
  });

  it('answers null when nothing refuses', () => {
    expect(slotRefusal(slotInput())).toBeNull();
  });
});

describe('EMPTY store fixture', () => {
  it('starts with no failures and no halt', () => {
    expect(runHalted(EMPTY)).toBe(false);
    expect(failuresSinceSuccess(EMPTY)).toBe(0);
  });
});
