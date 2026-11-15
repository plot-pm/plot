import { answered } from '../../port-result.js';
import type { Cancel, Clock } from '../../ports/clock.js';

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
  monotonic: () => answered(performance.now()),
  timeout: (delayMs, onFire) => {
    const timer = setTimeout(onFire, delayMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
  schedule: (intervalMs, onTick) => {
    const timer = setInterval(onTick, intervalMs);
    // UNREFFED, and it is the lifecycle rule rather than a tidiness habit: the
    // clock must never be the reason a process stays alive. The board's two
    // timers each called this before there was a pulse to hold the property.
    timer.unref?.();
    return () => clearInterval(timer);
  },
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
  monotonic: () => answered(0),
  // A clock that never advances never reaches a delay.
  timeout: () => () => undefined,
  // A clock that does not advance cannot beat. Scheduling against it is
  // accepted and does nothing, which is the honest answer for a time that
  // never reaches the next interval — and it keeps `clockFixed` usable by the
  // staleness rules it exists for without making them hold a second clock.
  schedule: () => () => undefined,
});

/**
 * A clock a test drives by hand.
 *
 * The reason `schedule` is a port at all. A pulse's divisors are only assertable
 * by counting beats, and counting twelve real 5 s beats is a minute of waiting
 * per assertion — so this advances them with a call and the suite stays fast and
 * deterministic.
 *
 * `now` advances with the beats, by `intervalMs` each, so a rule that reads the
 * time inside a tick sees a clock consistent with the schedule that ran it.
 *
 * @param at - the epoch milliseconds to start at.
 * @param offsetMinutes - the timezone offset to report; UTC when omitted.
 * `monotonic` starts at 0 and advances with `now` on every beat, so a test
 * that only advances beats sees a steady clock. `jump(ms)` moves `now` alone,
 * which is what a wake or a clock set reads like.
 *
 * @returns a clock, `advance(n)` to fire `n` beats on every live schedule and
 *   every one-shot timer that falls due, and `jump(ms)` to move the wall clock only.
 */
export const clockManual = (
  at: number,
  offsetMinutes = 0,
): Clock & { advance: (beats: number) => void; jump: (ms: number) => void; scheduled: () => number } => {
  // Every live schedule, by the interval it was made with. A Map keyed by an
  // object identity would do, but the array is what makes `scheduled()` — the
  // count a cancellation test asserts on — a length rather than a traversal.
  const live: { intervalMs: number; onTick: () => void }[] = [];
  const timers: { dueAt: number; onFire: () => void }[] = [];
  let clock = at;
  let monotonic = 0;
  return {
    now: () => answered(clock),
    monotonic: () => answered(monotonic),
    timeout: (delayMs, onFire): Cancel => {
      const entry = { dueAt: monotonic + delayMs, onFire };
      timers.push(entry);
      return () => {
        const held = timers.indexOf(entry);
        if (held >= 0) timers.splice(held, 1);
      };
    },
    timezoneOffsetMinutes: () => answered(offsetMinutes),
    schedule: (intervalMs, onTick): Cancel => {
      const entry = { intervalMs, onTick };
      live.push(entry);
      return () => {
        const held = live.indexOf(entry);
        // Guarded rather than assumed: `Cancel` promises that calling twice is
        // not an error, and an unguarded `splice(-1, 1)` would remove the LAST
        // schedule the second time — cancelling a stranger's clock.
        if (held >= 0) live.splice(held, 1);
      };
    },
    /**
     * Fires `beats` beats on every live schedule, oldest schedule first.
     *
     * Beat by beat rather than schedule by schedule, so a subscriber that
     * unsubscribes mid-run stops where a real timer would stop it. Iterated
     * over a copy, because a tick may schedule or cancel while this runs.
     */
    advance: (beats: number) => {
      for (let n = 0; n < beats; n += 1) {
        const step = live[0]?.intervalMs ?? 0;
        clock += step;
        monotonic += step;
        for (const entry of [...live]) entry.onTick();
        for (const entry of timers.filter((t) => t.dueAt <= monotonic)) {
          timers.splice(timers.indexOf(entry), 1);
          entry.onFire();
        }
      }
    },
    /** Moves `now` by `ms` and leaves `monotonic` where it is: a wake, or a clock that was set. */
    jump: (ms: number) => {
      clock += ms;
    },
    /** How many schedules are live — what a cancellation test asserts on. */
    scheduled: () => live.length,
  };
};
