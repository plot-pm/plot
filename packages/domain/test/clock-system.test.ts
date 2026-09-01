import { describe, it, expect } from 'vitest';

import { clockFixed, clockManual, clockSystem } from '../src/adapters/clock/clock-system.js';

/**
 * THE CLOCK'S PATHS, EXERCISED WITHOUT WAITING FOR REAL TIME.
 *
 * `clock-system.ts` read 0% branches, and the reading was honest but easy to
 * misread as a testability problem. The file has exactly ONE branch — the
 * `offsetMinutes = 0` default in `clockFixed` — and v8 counts a default-value
 * initializer as a branch taken when the argument is absent and not taken when
 * it is supplied. Zero percent meant nobody had ever passed an explicit offset,
 * which is one call away, not a host away.
 *
 * NOTHING HERE SLEEPS. The brief's rule is that a branch reachable only by
 * waiting stays excluded with its reason written down rather than being bought
 * with a slow test — and no branch in this file is one, which is why this suite
 * closes it completely instead of naming an exception.
 */

describe('the system clock reads the world', () => {
  it('answers with the current epoch milliseconds', async () => {
    // Bounded rather than compared: asserting an exact time is the one way to
    // make a clock test flaky, and the property that matters is that it reads
    // the real clock rather than a constant.
    const before = Date.now();
    const answer = await clockSystem().now();
    const after = Date.now();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value).toBeGreaterThanOrEqual(before);
    expect(answer.value).toBeLessThanOrEqual(after);
  });

  it('answers with this machine’s timezone offset, sign inverted', async () => {
    // `Date.getTimezoneOffset` returns minutes to ADD to local time to reach
    // UTC, so UTC+2 reports -120. The adapter negates it, because every caller
    // means the offset the way an ISO timestamp writes it.
    const answer = await clockSystem().timezoneOffsetMinutes();
    expect(answer).toEqual({ ok: true, value: -new Date().getTimezoneOffset() });
  });

  it('reports a time that moves', async () => {
    // The one property distinguishing this adapter from `clockFixed`: two reads
    // across an awaited turn never go backwards.
    const clock = clockSystem();
    const first = await clock.now();
    await Promise.resolve();
    const second = await clock.now();
    if (!first.ok || !second.ok) throw new Error('the system clock did not answer');
    expect(second.value).toBeGreaterThanOrEqual(first.value);
  });
});

describe('a fixed clock answers the same time forever', () => {
  it('answers the time it was built with, and never advances', async () => {
    // Every staleness rule in the domain is untestable against a real clock and
    // trivial against this one, which is the whole reason `Clock` is a port.
    const clock = clockFixed(1_756_000_000_000);
    expect(await clock.now()).toEqual({ ok: true, value: 1_756_000_000_000 });
    expect(await clock.now()).toEqual({ ok: true, value: 1_756_000_000_000 });
  });

  it('reports UTC when no offset is given', async () => {
    // The DEFAULT arm of the file's only branch, and the one every existing
    // caller takes.
    const answer = await clockFixed(0).timezoneOffsetMinutes();
    expect(answer).toEqual({ ok: true, value: 0 });
  });

  it('reports an offset it was given', async () => {
    // THE BRANCH THAT WAS AT ZERO. A fixed clock in a named zone is what makes
    // a date-boundary rule testable — 23:30 in UTC+2 is the previous day in
    // UTC, and a rule that reads dates must be assertable on both sides of that
    // without the suite's machine deciding which.
    expect(await clockFixed(0, 120).timezoneOffsetMinutes()).toEqual({ ok: true, value: 120 });
    expect(await clockFixed(0, -480).timezoneOffsetMinutes()).toEqual({ ok: true, value: -480 });
  });

  it('keeps an explicit zero apart from an absent offset in every observable way', async () => {
    // The two arms agree on the value, which is why the branch went unnoticed.
    // Asserting they agree is the point: the default is UTC, not "whatever the
    // machine is", and a future edit that made it machine-local would be caught
    // here rather than in a rule that reads a date.
    expect(await clockFixed(5, 0).timezoneOffsetMinutes()).toEqual(
      await clockFixed(5).timezoneOffsetMinutes(),
    );
  });
});

describe('the system clock schedules against itself', () => {
  it('fires on the interval and stops when cancelled', async () => {
    // THE ONE TEST HERE THAT WAITS, and it waits 1 ms per beat rather than 5 s:
    // the interval is a parameter, so the property — it fires, then it stops —
    // is assertable at any base. `clockManual` is what the divisor tests use.
    const clock = clockSystem();
    let beats = 0;
    const cancel = clock.schedule(1, () => {
      beats += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    cancel();
    const atCancel = beats;
    expect(atCancel).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(beats).toBe(atCancel);
  });

  it('does not hold the process open', () => {
    // The clock must never be the reason a process stays alive: a pulse is not
    // a daemon and dies with its machine's process.
    //
    // Asserted on the TIMER rather than on `process.getActiveResourcesInfo()`,
    // which reports the whole runtime's timers — vitest holds several, so that
    // reading cannot say anything about this one. `hasRef` is the handle's own
    // answer, and it is false only because the adapter unreffed it.
    const timers: NodeJS.Timeout[] = [];
    const real = globalThis.setInterval;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      const timer = real(fn, ms);
      timers.push(timer);
      return timer;
    }) as typeof globalThis.setInterval;
    try {
      const cancel = clockSystem().schedule(1_000, () => undefined);
      expect(timers).toHaveLength(1);
      expect(timers[0].hasRef()).toBe(false);
      cancel();
    } finally {
      globalThis.setInterval = real;
    }
  });
});

describe('a fixed clock accepts a schedule and never beats', () => {
  it('returns a cancel that does nothing, twice', () => {
    // A time that never advances never reaches the next interval. Accepted
    // rather than refused, so the staleness rules this clock exists for need no
    // second clock beside it.
    let beats = 0;
    const cancel = clockFixed(1_000).schedule(5_000, () => {
      beats += 1;
    });
    cancel();
    cancel();
    expect(beats).toBe(0);
  });
});

describe('a manual clock is driven by hand', () => {
  it('fires every live schedule once per advanced beat', () => {
    const clock = clockManual(1_000);
    const a: number[] = [];
    const b: number[] = [];
    clock.schedule(5_000, () => void a.push(a.length));
    clock.schedule(5_000, () => void b.push(b.length));
    clock.advance(3);
    expect([a.length, b.length]).toEqual([3, 3]);
    expect(clock.scheduled()).toBe(2);
  });

  it('advances its own time by the interval it beat at', () => {
    // So a rule that reads `now` inside a tick sees a clock consistent with the
    // schedule that ran it.
    const clock = clockManual(1_000);
    clock.schedule(5_000, () => undefined);
    clock.advance(2);
    expect(clock.now()).toEqual({ ok: true, value: 11_000 });
  });

  it('leaves its time alone when nothing is scheduled', () => {
    // No schedule means no interval to advance by. A clock nobody asked to beat
    // reports the time it was built with.
    const clock = clockManual(1_000);
    clock.advance(5);
    expect(clock.now()).toEqual({ ok: true, value: 1_000 });
  });

  it('cancels only the schedule that was cancelled, however often', () => {
    // THE GUARD THAT MATTERS: an unguarded `splice` would remove the LAST
    // schedule on a second cancel — cancelling a stranger's clock.
    const clock = clockManual(1_000);
    const kept: number[] = [];
    const cancel = clock.schedule(5_000, () => undefined);
    clock.schedule(5_000, () => void kept.push(kept.length));
    cancel();
    cancel();
    expect(clock.scheduled()).toBe(1);
    clock.advance(2);
    expect(kept).toHaveLength(2);
  });

  it('honours a schedule cancelled from inside a tick', () => {
    // Iterated over a copy, so a tick may cancel or schedule while a beat runs.
    const clock = clockManual(1_000);
    let beats = 0;
    const cancel: { fn: () => void } = { fn: () => undefined };
    cancel.fn = clock.schedule(5_000, () => {
      beats += 1;
      cancel.fn();
    });
    clock.advance(4);
    expect(beats).toBe(1);
  });

  it('reports the timezone offset it was given', () => {
    expect(clockManual(0, 120).timezoneOffsetMinutes()).toEqual({ ok: true, value: 120 });
    expect(clockManual(0).timezoneOffsetMinutes()).toEqual({ ok: true, value: 0 });
  });
});
