import { describe, it, expect } from 'vitest';
import {
  HeadroomSchema,
  headroomFor,
  measureMachine,
  machineReadingIsStale,
  hasRoomToDispatch,
} from '../src/index.js';

/**
 * The resource every other entity competes for, whose absence made four
 * diagnoses wrong — 7 workers dead at `exit 124` blamed on a Plot defect four
 * times, when it was machine starvation. `exit 124` is `timeout`'s signal: it
 * says the clock ran out, and without a Machine the only reading available is
 * *the worker stopped*. Opposite conclusions — restart elsewhere, or the work
 * is broken.
 */

const sample = { measuredAt: 1_000, sampleMs: 374, loadAverage: [2, 2, 2] as const, cores: 16 };

describe('headroom reads the spawn cost', () => {
  it('names the four verdicts and refuses a fifth', () => {
    expect(HeadroomSchema.options).toEqual(['clear', 'tight', 'starved', 'unmeasured']);
    expect(HeadroomSchema.safeParse('busy').success).toBe(false);
  });

  it('reads the measured clear and starved readings apart', () => {
    // 3.6 ms measured three consecutive runs against the story's starved 286 ms
    // — a 79x swing on the same hardware.
    expect(headroomFor(3.6)).toBe('clear');
    expect(headroomFor(286)).toBe('starved');
  });

  it('calls the middle band tight', () => {
    expect(headroomFor(25)).toBe('tight');
  });

  it('holds the thresholds at their boundaries', () => {
    // Provisional, from one session — pinned so a change is deliberate.
    expect(headroomFor(10)).toBe('tight');
    expect(headroomFor(50)).toBe('tight');
    expect(headroomFor(9.9)).toBe('clear');
    expect(headroomFor(50.1)).toBe('starved');
  });

  it('reports unmeasured rather than clear when nothing was measured', () => {
    // A reading nobody took is not a quiet machine.
    expect(headroomFor(null)).toBe('unmeasured');
  });
});

describe('a machine reading cannot disagree with itself', () => {
  it('derives headroom from the cost rather than accepting one', () => {
    expect(measureMachine({ ...sample, spawnCostMs: 3.6 }).headroom).toBe('clear');
    expect(measureMachine({ ...sample, spawnCostMs: 286 }).headroom).toBe('starved');
  });

  it('prices the measurement itself', () => {
    // 374 ms for 100 spawns against an 18.3 s scan — 2% of one scan, which is
    // what makes a reading per pulse affordable.
    expect(measureMachine({ ...sample, spawnCostMs: 3.6 }).sampleMs).toBe(374);
  });

  it('keeps load average as context, never as the verdict', () => {
    // Five workers ran fine at load 10 and starved the machine at load 8: the
    // variable was what else was spawning, not the count.
    const busy = measureMachine({ ...sample, loadAverage: [30, 30, 30], spawnCostMs: 3.6 });
    expect(busy.headroom).toBe('clear');
  });
});

describe('a machine reading decays', () => {
  it('goes stale once older than the bound', () => {
    // It decays at the next process anyone starts — faster than a branch,
    // which goes stale at the next push.
    const m = measureMachine({ ...sample, spawnCostMs: 3.6 });
    expect(machineReadingIsStale(m, 1_500, 1_000)).toBe(false);
    expect(machineReadingIsStale(m, 5_000, 1_000)).toBe(true);
  });
});

describe('dispatch asks for room', () => {
  it('grants it only on a clear reading', () => {
    expect(hasRoomToDispatch(measureMachine({ ...sample, spawnCostMs: 3.6 }))).toBe(true);
    expect(hasRoomToDispatch(measureMachine({ ...sample, spawnCostMs: 25 }))).toBe(false);
    expect(hasRoomToDispatch(measureMachine({ ...sample, spawnCostMs: 286 }))).toBe(false);
  });

  it('refuses on an unmeasured reading rather than assuming room', () => {
    expect(hasRoomToDispatch(measureMachine({ ...sample, spawnCostMs: null }))).toBe(false);
  });
});
