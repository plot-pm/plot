import { describe, expect, it } from 'vitest';

import { clockManual } from '../src/adapters/clock/clock-system.js';
import { CLOCK_DRIFT_BOUND_MS, clockDrift, type ClockReading } from '../src/rules/clock-drift.js';

const at = (wall: number, monotonic: number): ClockReading => ({ wall, monotonic });

describe('clockDrift reads a wake or a jump between two fleet beats', () => {
  it('reads no jump when both clocks move together', () => {
    expect(clockDrift(at(1000, 50), at(6000, 5050))).toEqual({ driftMs: 0, jumped: false });
  });
  it('reads no jump for a late timer on a loaded machine', () => {
    expect(clockDrift(at(0, 0), at(9000, 0)).jumped).toBe(false);
  });
  it('holds the bound at 10 s, and a drift equal to the bound is not a jump', () => {
    expect(CLOCK_DRIFT_BOUND_MS).toBe(10_000);
    expect(clockDrift(at(0, 0), at(10_000, 0)).jumped).toBe(false);
    expect(clockDrift(at(0, 0), at(10_001, 0)).jumped).toBe(true);
  });
  it('reads a jump backwards as well', () => {
    expect(clockDrift(at(100_000, 0), at(95_000, 5000))).toEqual({ driftMs: -10_000, jumped: false });
    expect(clockDrift(at(100_000, 0), at(80_000, 5000)).jumped).toBe(true);
  });
  it('takes the bound as a parameter', () => {
    expect(clockDrift(at(0, 0), at(3000, 0), 2000).jumped).toBe(true);
  });

  it('reads a wake on clockManual: the monotonic clock stands still while the wall clock moves 30 minutes', () => {
    const clock = clockManual(1_000_000);
    const read = (): ClockReading => {
      const wall = clock.now();
      const mono = clock.monotonic();
      if (!wall.ok || !mono.ok) throw new Error('the clock did not answer');
      return { wall: wall.value, monotonic: mono.value };
    };
    clock.schedule(5000, () => undefined);
    const before = read();
    clock.advance(1);
    expect(clockDrift(before, read()).jumped).toBe(false);
    const steady = read();
    clock.jump(30 * 60_000);
    clock.advance(1);
    expect(clockDrift(steady, read())).toEqual({ driftMs: 30 * 60_000, jumped: true });
  });
});
