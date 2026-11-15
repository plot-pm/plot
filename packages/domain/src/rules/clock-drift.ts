/** The bound on drift between two fleet beats, in milliseconds. */
export const CLOCK_DRIFT_BOUND_MS = 10_000;

/** One reading of both clocks, taken together. */
export interface ClockReading {
  /** The wall clock, epoch milliseconds. */
  wall: number;
  /** The monotonic clock, milliseconds from its own origin. */
  monotonic: number;
}

/** What two readings say about the wall clock. */
export interface ClockDrift {
  /** Elapsed wall time minus elapsed monotonic time, in milliseconds. */
  driftMs: number;
  /** Whether `driftMs` exceeds the bound in either direction: a wake or a clock set. */
  jumped: boolean;
}

/**
 * Compares the time two readings of the wall clock span with the time the
 * monotonic clock spans over the same two readings.
 *
 * A late timer on a loaded machine moves both clocks by the same amount and
 * reads no jump. A sleeping machine or a set clock moves the wall clock alone.
 *
 * @param previous - the earlier reading, taken at the previous fleet beat.
 * @param current - the later reading.
 * @param boundMs - the largest drift that is not a jump; 10 s by default.
 * @returns the drift, and whether it is past the bound. A drift equal to the bound is not a jump.
 */
export const clockDrift = (previous: ClockReading, current: ClockReading, boundMs = CLOCK_DRIFT_BOUND_MS): ClockDrift => {
  const driftMs = current.wall - previous.wall - (current.monotonic - previous.monotonic);
  return { driftMs, jumped: Math.abs(driftMs) > boundMs };
};
