import { z } from 'zod';

/**
 * How much room the machine has to start work.
 *
 * `unmeasured` is not `clear`: it means the question was not asked, or the
 * measurement failed.
 */
export const HeadroomSchema = z.enum(['clear', 'tight', 'starved', 'unmeasured']);
export type Headroom = z.infer<typeof HeadroomSchema>;

/**
 * The spawn-cost boundaries, in milliseconds, between headroom verdicts.
 *
 * Provisional: they come from one session's samples and are to be re-measured.
 */
export const HEADROOM_THRESHOLDS = { clearBelowMs: 10, starvedAboveMs: 50 } as const;

/**
 * The hardware every entity competes for.
 *
 * Identity: none — there is exactly one Machine, and that singularity is
 * load-bearing; with two, headroom would be a property of a pair. State:
 * measured, and the only state that decays instantly, so `measuredAt` is
 * required rather than optional.
 */
export interface Machine {
  /** The cost of forking one process, in milliseconds; null when unmeasured. */
  spawnCostMs: number | null;
  /** The verdict derived from `spawnCostMs`. */
  headroom: Headroom;
  /** When the reading was taken, as epoch milliseconds. */
  measuredAt: number;
  /** What taking the measurement itself cost, in milliseconds. */
  sampleMs: number;
  /** The 1-, 5- and 15-minute load averages; context only, never the verdict. */
  loadAverage: readonly [number, number, number];
  /** How many cores the machine has; context. */
  cores: number;
}

/**
 * Reads a spawn cost as a headroom verdict.
 *
 * Load average is deliberately not consulted: five workers ran fine at load 10
 * on one occasion and starved the machine at load 8 on another, because the
 * variable was what else was spawning rather than the count.
 *
 * @param spawnCostMs - the cost of forking one process, or null if unmeasured.
 * @returns `unmeasured` for a null cost, otherwise the threshold's verdict.
 */
export const headroomFor = (spawnCostMs: number | null): Headroom => {
  if (spawnCostMs === null) return 'unmeasured';
  if (spawnCostMs < HEADROOM_THRESHOLDS.clearBelowMs) return 'clear';
  if (spawnCostMs > HEADROOM_THRESHOLDS.starvedAboveMs) return 'starved';
  return 'tight';
};

/**
 * Builds a Machine reading from a spawn-cost measurement.
 *
 * The headroom is derived rather than supplied, so a reading cannot carry a
 * verdict that disagrees with its own measurement.
 *
 * @param sample - the measurement: its cost, what it cost to take, and when.
 * @returns the Machine reading, its headroom derived from the spawn cost.
 */
export const measureMachine = (sample: {
  spawnCostMs: number | null;
  measuredAt: number;
  sampleMs: number;
  loadAverage: readonly [number, number, number];
  cores: number;
}): Machine => ({ ...sample, headroom: headroomFor(sample.spawnCostMs) });

/**
 * Whether a machine reading is too old to act on.
 *
 * A machine's state decays at the next process anyone starts, so a reading
 * without a timestamp cannot be judged and one taken long ago is not evidence.
 *
 * @param machine - the reading to test.
 * @param now - the current time, as epoch milliseconds.
 * @param maxAgeMs - how old a reading may be and still count.
 * @returns true when the reading is older than `maxAgeMs`.
 */
export const machineReadingIsStale = (machine: Machine, now: number, maxAgeMs: number): boolean =>
  now - machine.measuredAt > maxAgeMs;

/**
 * Whether the machine has room to start more work.
 *
 * `unmeasured` answers false: a reading nobody took is not permission. The
 * caller decides what to do about that — this reports and refuses nothing.
 *
 * @param machine - the reading to consult.
 * @returns true only when headroom is `clear`.
 */
export const hasRoomToDispatch = (machine: Machine): boolean => machine.headroom === 'clear';
