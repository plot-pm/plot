import { describe, expect, it } from 'vitest';

import { clockManual } from '@plot-pm/domain/adapters';

import { sliceIdleDeadline } from '../../src/server/entry/registryd-main.js';
import { tickWake } from '../../src/shared/tick-wake.js';

const HOUR = 3_600_000;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
};
const never = new Promise<void>(() => undefined);

const watched = (clock: ReturnType<typeof clockManual>) => {
  const slept: number[] = [];
  clock.schedule(5_000, () => undefined);
  const wake = tickWake(clock, async (ms) => void slept.push(ms));
  return { wake, slept };
};

describe('the tick waits on a trigger or a deadline', () => {
  it('stays waiting while the watches are armed and nothing is pending, however long the clock runs, and never sleeps', async () => {
    const clock = clockManual(1_000_000);
    const { wake, slept } = watched(clock);
    let ended = false;
    void wake.wait({ deadlineAt: null, degraded: false, intervalMs: 60_000, requested: never }).then(() => (ended = true));
    clock.advance(24 * 60);
    await settle();
    expect(ended).toBe(false);
    expect(slept).toEqual([]);
  });

  it('ends on a trigger named during the wait', async () => {
    const clock = clockManual(1_000_000);
    const { wake } = watched(clock);
    let ended = false;
    void wake.wait({ deadlineAt: null, degraded: false, intervalMs: 60_000, requested: never }).then(() => (ended = true));
    await settle();
    expect(ended).toBe(false);
    wake.trigger();
    await settle();
    expect(ended).toBe(true);
  });

  it('ends at once on a trigger named during the tick, and forgets one named before the tick started', async () => {
    const clock = clockManual(1_000_000);
    const { wake } = watched(clock);
    wake.trigger();
    wake.clear();
    let ended = false;
    void wake.wait({ deadlineAt: null, degraded: false, intervalMs: 60_000, requested: never }).then(() => (ended = true));
    await settle();
    expect(ended).toBe(false);
    wake.trigger();
    await settle();
    expect(ended).toBe(true);
    let second = false;
    void wake.wait({ deadlineAt: null, degraded: false, intervalMs: 60_000, requested: never }).then(() => (second = true));
    await settle();
    expect(second).toBe(true);
  });

  it('ends on the deadline with no trigger named, and not before', async () => {
    const clock = clockManual(1_000_000);
    const { wake } = watched(clock);
    let ended = false;
    void wake.wait({ deadlineAt: 1_000_000 + 2 * HOUR, degraded: false, intervalMs: 60_000, requested: never }).then(() => (ended = true));
    clock.advance((60 * 60_000) / 5_000);
    await settle();
    expect(ended).toBe(false);
    clock.advance((60 * 60_000) / 5_000);
    await settle();
    expect(ended).toBe(true);
  });

  it('ends on the interval only while a watch is degraded', async () => {
    const clock = clockManual(1_000_000);
    const { wake, slept } = watched(clock);
    let ended = false;
    await wake.wait({ deadlineAt: null, degraded: true, intervalMs: 60_000, requested: never }).then(() => (ended = true));
    expect(ended).toBe(true);
    expect(slept).toEqual([60_000]);
  });

  it('ends on a stop request', async () => {
    const clock = clockManual(1_000_000);
    const { wake } = watched(clock);
    let stop: () => void = () => undefined;
    const requested = new Promise<void>((resolve) => (stop = resolve));
    let ended = false;
    void wake.wait({ deadlineAt: null, degraded: false, intervalMs: 60_000, requested }).then(() => (ended = true));
    stop();
    await settle();
    expect(ended).toBe(true);
  });
});

describe('sliceIdleDeadline', () => {
  const NOW = 10 * HOUR;
  const slice = (branch: string, movedAt: string | null, blocked = false) => ({
    pr: { branch, createdAt: '' },
    lines: movedAt === null ? [] : [{ branch, step: 'dispatch', outcome: 'moved', at: movedAt }],
    blocked,
  });

  it('names the earliest moment an open slice passes the bound, from its last moved line', () => {
    const slices = [slice('a', new Date(NOW - HOUR).toISOString()), slice('b', new Date(NOW - 30 * 60_000).toISOString())];
    expect(sliceIdleDeadline(slices, 0, 2 * HOUR, NOW)).toEqual({ at: NOW + HOUR, rule: 'slice-idle' });
  });

  it('floors the clock at fleetd\'s start', () => {
    expect(sliceIdleDeadline([slice('a', null)], NOW - 10 * 60_000, 2 * HOUR, NOW)).toEqual({ at: NOW - 10 * 60_000 + 2 * HOUR, rule: 'slice-idle' });
  });

  it('holds none for a blocked slice, no slice, a disabled rule, or a slice already idle', () => {
    expect(sliceIdleDeadline([slice('a', null, true)], 0, 2 * HOUR, NOW)).toBeNull();
    expect(sliceIdleDeadline([], 0, 2 * HOUR, NOW)).toBeNull();
    expect(sliceIdleDeadline([slice('a', null)], 0, null, NOW)).toBeNull();
    expect(sliceIdleDeadline([slice('a', new Date(NOW - 3 * HOUR).toISOString())], 0, 2 * HOUR, NOW)).toBeNull();
  });
});
