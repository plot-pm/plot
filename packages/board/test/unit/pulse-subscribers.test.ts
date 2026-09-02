import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { addSubscriber, beat, createPulse, divisorFor, type Subscriber } from '@plot-pm/domain';

import { boardDivisors, prRefreshMsFor } from '../../src/server/fleet.js';

/**
 * THE BOARD'S TWO CADENCES, THROUGH ONE CLOCK.
 *
 * `ensureCache` had two `setInterval`s; it now has one pulse and two
 * subscribers at divisors 1 and 12. What this suite asserts is that the change
 * is a MOVE — the effective cadences are the same 5 s and 60 s — and that the
 * isolation the split timers bought survives it.
 *
 * Nothing here waits. `boardDivisors()` returns exactly what `ensureCache`
 * subscribes, so the cadence is arithmetic on a count rather than a minute of
 * real time per assertion. The divisor model is what makes that possible: see
 * `docs/stories/the-master-agent-holds-the-fleet/DESIGN-pulse.md` §9.
 */

const BASE_MS = 5_000;

/** A subscriber that counts its own runs, so a cadence is a number. */
const counting = (name: string, everyNthBeat: number) => {
  let runs = 0;
  const subscriber: Subscriber = {
    name,
    everyNthBeat,
    tick: () => {
      runs += 1;
    },
  };
  return { subscriber, count: () => runs };
};

describe('the board wires two subscribers at divisors 1 and 12', () => {
  it('names the scan at every beat and the PR reader at every twelfth', () => {
    expect(boardDivisors()).toEqual([
      { name: 'fleet-scan', everyNthBeat: 1 },
      { name: 'pr-reader', everyNthBeat: 12 },
    ]);
  });

  it('keeps both effective cadences exactly where they were', () => {
    // THE SLICE'S FIRST CLAUSE: the payload and the cadences are unchanged, and
    // the change is a move. 1 x 5 s is the git scan's 5 s; 12 x 5 s is the PR
    // reader's 60 s, which is `prRefreshMsFor('github')`.
    const [scan, reader] = boardDivisors();
    expect(scan.everyNthBeat * BASE_MS).toBe(5_000);
    expect(reader.everyNthBeat * BASE_MS).toBe(60_000);
    expect(reader.everyNthBeat * BASE_MS).toBe(prRefreshMsFor('github'));
  });

  it('derives the divisors rather than carrying them', () => {
    // 12 IS RIGHT ONLY BECAUSE THE BASE IS 5 s. Asserted by moving the base: at
    // 10 s the PR reader waits 6 beats and its effective cadence is still 60 s,
    // so nothing in the board has to be found and edited when the base changes.
    expect(divisorFor(createPulse(10_000, 0), 60_000)).toBe(6);
    expect(divisorFor(createPulse(10_000, 0), 60_000) * 10_000).toBe(60_000);
  });

  it('writes no 60 into the wiring', () => {
    // The brief's rule, read out of the source: the divisor is computed from
    // `PR_REFRESH_MS`, so a literal `everyNthBeat: 12` — a number that would
    // stop being true the moment the base moved — must not appear.
    const src = readFileSync(new URL('../../src/server/fleet.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/everyNthBeat:\s*\d/);
    expect(src).toContain('divisorFor(base, PR_REFRESH_MS)');
  });
});

describe('the board’s two subscribers still fail independently', () => {
  it('runs the scan every beat while the PR reader throws on each of its own', () => {
    // THE ASSERTION THAT IS THE SLICE, at the board's own divisors. The two
    // timers were split because git is local and free while the host is metered
    // and fails differently; a shared clock that re-coupled them would be worse
    // than what it replaced — one rate-limited host stalling the git scan.
    const [scanDivisor, readerDivisor] = boardDivisors();
    const scan = counting(scanDivisor.name, scanDivisor.everyNthBeat);
    let asked = 0;
    const throwingReader: Subscriber = {
      name: readerDivisor.name,
      everyNthBeat: readerDivisor.everyNthBeat,
      tick: () => {
        asked += 1;
        throw new Error('HTTP 429 — Rate limit for this resource has been exceeded');
      },
    };
    // The reader FIRST, so a beat that stopped at the throw would leave the scan
    // at zero rather than merely one short.
    let pulse = addSubscriber(addSubscriber(createPulse(BASE_MS, 0), throwingReader), scan.subscriber);
    for (let n = 0; n < 24; n += 1) pulse = beat(pulse).pulse;
    expect(scan.count()).toBe(24);
    // And the reader kept its own cadence too: a throw is not a reason to stop
    // asking, because the next beat is the retry and it is already scheduled.
    expect(asked).toBe(2);
  });

  it('runs the PR reader on its beat while the scan never returns', () => {
    // THE OTHER HALF, and the one an `await` in the beat would break: an 18.3 s
    // scan on a loaded estate outlives its own 5 s beat routinely, so a clock
    // that waited for it would drag the PR reader's 60 s out behind it.
    const [scanDivisor, readerDivisor] = boardDivisors();
    const reader = counting(readerDivisor.name, readerDivisor.everyNthBeat);
    let entered = 0;
    const hangingScan: Subscriber = {
      name: scanDivisor.name,
      everyNthBeat: scanDivisor.everyNthBeat,
      tick: () => {
        entered += 1;
        return new Promise<void>(() => undefined);
      },
    };
    let pulse = addSubscriber(addSubscriber(createPulse(BASE_MS, 0), hangingScan), reader.subscriber);
    for (let n = 0; n < 24; n += 1) pulse = beat(pulse).pulse;
    expect(reader.count()).toBe(2);
    expect(entered).toBe(24);
  });

  it('stops nothing when a subscriber throws every beat', () => {
    // A subscriber with a bug is not a stopped clock. `beatCount` is what a
    // stopped pulse would be read from, so it has to keep rising.
    const pulse = addSubscriber(createPulse(BASE_MS, 0), {
      name: 'pr-reader',
      everyNthBeat: 1,
      tick: () => {
        throw new Error('the host refused');
      },
    });
    expect(beat(beat(pulse).pulse).pulse.beatCount).toBe(2);
  });
});
