import type { PortResult } from '../port-result.js';

/**
 * Reads the time, and schedules against it.
 *
 * Two questions, one source, and they belong together because a caller that
 * fakes one and not the other tests a rule against a clock that disagrees with
 * its own schedule.
 *
 * Reading looks trivial and is not: four entities carry staleness rules — a claim
 * goes stale after 24 hours, a delivered plan leaves a rolling window, a
 * sprint outlives its release, a machine reading decays on the next spawn —
 * and every one of them is untestable against a real clock.
 *
 * It returns a `PortResult` like every other port. A clock that cannot fail
 * still shares the shape, because a caller written against two result types
 * eventually reads one as the other.
 */
/**
 * Stops a schedule. Calling it twice is not an error and does nothing the
 * second time — a caller that has already cancelled has nothing to be wrong
 * about.
 */
export type Cancel = () => void;

export interface Clock {
  /**
   * Reads the current time.
   *
   * @returns epoch milliseconds.
   */
  now(): PortResult<number>;

  /**
   * Calls `onTick` every `intervalMs`, until cancelled.
   *
   * The one thing the domain cannot compute. A `Pulse` counts beats and decides
   * whose divisor comes up; it cannot make a beat ARRIVE, because elapsed time
   * is not a value it can be handed. So the clock is the only port here that is
   * a scheduler rather than a reader — every other one answers *where does this
   * fact come from*, and a beat comes from nowhere.
   *
   * **The schedule must never be the reason a process stays alive.** A pulse is
   * not a daemon: it dies with its machine's process, and an implementation on
   * a runtime with a handle count is expected to unref.
   *
   * Never a `PortResult`, unlike `now`. There is nothing to report at the call:
   * a schedule that could not be made would have to be observed by not
   * beating, and a caller with a cancel it may safely call has the same
   * recovery either way.
   *
   * @param intervalMs - the base, in milliseconds.
   * @param onTick - what to run on each beat. Its failure is the caller's to
   *   contain — see `entities/pulse.ts` `beat`, which is where that is done.
   * @returns a function that stops the schedule.
   */
  schedule(intervalMs: number, onTick: () => void): Cancel;

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
