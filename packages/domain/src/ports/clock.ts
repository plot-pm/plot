import type { PortResult } from '../port-result.js';

/**
 * Reads the time.
 *
 * It looks trivial and is not: four entities carry staleness rules — a claim
 * goes stale after 24 hours, a delivered plan leaves a rolling window, a
 * sprint outlives its release, a machine reading decays on the next spawn —
 * and every one of them is untestable against a real clock.
 *
 * It returns a `PortResult` like every other port. A clock that cannot fail
 * still shares the shape, because a caller written against two result types
 * eventually reads one as the other.
 */
export interface Clock {
  /**
   * Reads the current time.
   *
   * @returns epoch milliseconds.
   */
  now(): PortResult<number>;

  /**
   * Reads the local timezone offset, in minutes east of UTC.
   *
   * A transition record is dated in local time, so the offset is a reading
   * rather than a constant.
   *
   * @returns the offset in minutes.
   */
  timezoneOffsetMinutes(): PortResult<number>;
}
