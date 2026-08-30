import { answered } from '../../port-result.js';
import type { Clock } from '../../ports/clock.js';

/**
 * Reads the system clock.
 *
 * The only adapter that reaches nothing outside the process, and it lives here
 * anyway: the domain may not read a clock, and a `Clock` implementation is the
 * boundary regardless of how cheap crossing it happens to be.
 *
 * @returns a `Clock` backed by `Date`.
 */
export const clockSystem = (): Clock => ({
  now: () => answered(Date.now()),
  timezoneOffsetMinutes: () => answered(-new Date().getTimezoneOffset()),
});

/**
 * Builds a clock that answers with a fixed time.
 *
 * Every staleness rule in the domain is untestable against a real clock and
 * trivial against this one, which is the whole reason `Clock` is a port.
 *
 * @param at - the epoch milliseconds to answer `now` with.
 * @param offsetMinutes - the timezone offset to report; UTC when omitted.
 * @returns a `Clock` that never advances.
 */
export const clockFixed = (at: number, offsetMinutes = 0): Clock => ({
  now: () => answered(at),
  timezoneOffsetMinutes: () => answered(offsetMinutes),
});
