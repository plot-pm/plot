import { describe, it, expect } from 'vitest';

import { clockFixed, clockSystem } from '../src/adapters/clock/clock-system.js';

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
