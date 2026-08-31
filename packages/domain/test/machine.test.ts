import { describe, it, expect } from 'vitest';
import {
  HeadroomSchema,
  headroomFor,
  measureMachine,
  machineReadingIsStale,
  hasRoomToDispatch,
  dispatchDefers,
  deferralMessage,
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

/**
 * THE REGRESSION THIS REPO HAS MEASURED TWICE.
 *
 * `headroomFor` takes a spawn cost and nothing else, which is what makes the
 * rule enforceable rather than merely written down: there is no load average in
 * scope to consult. These tests fail the moment someone widens the signature to
 * "improve" the verdict by reading it.
 */
describe('headroomFor ignores load average, and must keep ignoring it', () => {
  it('reads clear at a high load average with a low spawn cost', () => {
    // Measured 2026-08-30: load read 13.0 across three readings while spawn
    // cost went 23.3 -> 76.5 -> 4.8 ms. The load average did not move; the
    // verdict did, three times, and the verdict was right each time.
    const loaded = measureMachine({
      ...sample,
      loadAverage: [13.0, 13.0, 13.0],
      spawnCostMs: 4.8,
    });
    expect(loaded.headroom).toBe('clear');
    expect(hasRoomToDispatch(loaded)).toBe(true);
  });

  it('reads starved at a low load average with a high spawn cost', () => {
    // The other direction, and the one that matters more: a quiet-looking load
    // average must not talk the verdict out of a measured 287 ms fork.
    const quiet = measureMachine({
      ...sample,
      loadAverage: [0.2, 0.3, 0.4],
      spawnCostMs: 287,
    });
    expect(quiet.headroom).toBe('starved');
    expect(hasRoomToDispatch(quiet)).toBe(false);
  });

  it('gives the same verdict for the same cost at any load average', () => {
    // Five workers ran fine at load 10 and starved the machine at load 8,
    // because the variable was what else was spawning. The verdict is a
    // function of the spawn cost ALONE, so these must be indistinguishable.
    const costs = [4.8, 25, 287];
    for (const spawnCostMs of costs) {
      const idle = measureMachine({ ...sample, loadAverage: [0, 0, 0], spawnCostMs });
      const busy = measureMachine({ ...sample, loadAverage: [64, 64, 64], spawnCostMs });
      expect(idle.headroom).toBe(busy.headroom);
    }
  });
});

describe('a starved reading defers, and says what it measured', () => {
  it('defers only on starved — tight is fit to work on', () => {
    // NOT the negation of hasRoomToDispatch: `tight` fails that and defers
    // nothing. Collapsing the two would stop the fleet on every tight reading.
    expect(dispatchDefers(measureMachine({ ...sample, spawnCostMs: 4.8 }))).toBe(false);
    expect(dispatchDefers(measureMachine({ ...sample, spawnCostMs: 25 }))).toBe(false);
    expect(dispatchDefers(measureMachine({ ...sample, spawnCostMs: 287 }))).toBe(true);
  });

  it('does not defer on an unmeasured reading — silence is never a refusal', () => {
    // `measuredAt` is required for exactly this reason: a starved reading
    // nobody can date is `unmeasured`, and `unmeasured` dispatches.
    const unmeasured = measureMachine({ ...sample, spawnCostMs: null });
    expect(unmeasured.headroom).toBe('unmeasured');
    expect(dispatchDefers(unmeasured)).toBe(false);
    expect(deferralMessage(unmeasured)).toBeNull();
  });

  it('carries the number, because "too much load" is not answerable', () => {
    const message = deferralMessage(measureMachine({ ...sample, spawnCostMs: 287 }));
    expect(message).not.toBeNull();
    // The measurement itself, so an operator can act on it.
    expect(message).toContain('287.0 ms');
    // The threshold it is being read against.
    expect(message).toContain('10 ms');
    expect(message).toContain('not yet');
    // NEVER the load average — it is not the verdict, so it is not the reason.
    expect(message?.toLowerCase()).not.toContain('load');
  });

  it('says nothing when the reading does not defer', () => {
    expect(deferralMessage(measureMachine({ ...sample, spawnCostMs: 4.8 }))).toBeNull();
    expect(deferralMessage(measureMachine({ ...sample, spawnCostMs: 25 }))).toBeNull();
  });
});
