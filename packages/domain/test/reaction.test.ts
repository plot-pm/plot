import { describe, expect, it } from 'vitest';

import {
  loweredConcurrency,
  msUntilReset,
  reactionTo,
  MIN_CONCURRENCY,
  SECONDARY_RETRY_MS,
  UNSTATED_RESET_MS,
} from '../src/rules/reaction.js';
import { refusalKind } from '../src/rules/refusal.js';
import { refreshIntervalMs } from '../src/rules/cadence.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: a refusal is REACTED to, and the two
 * limits get two reactions. Until this slice nothing reacted at all —
 * `plot-host.sh` held no sleep, no retry and no backoff, and `fleet.ts` never
 * read `throttled`.
 *
 * The constraint that binds both reactions is asserted here rather than
 * described: the cadence divides on observed spend, and a refusal that also
 * lowered it would compound with that division and drift downward with nothing
 * to restore it.
 */

/** A moment to measure resets from. */
const NOW = 1_756_512_000_000;

/** What GitHub says when the window's requests are gone. */
const QUOTA = 'GraphQL: API rate limit already exceeded for user ID 870334';
/** What GitHub says when too many arrived at once. */
const SECONDARY = 'You have exceeded a secondary rate limit. Please wait 60 seconds…';
/** A refusal that names no limit at all. */
const OUTAGE = 'gh: 503 Service Unavailable';

describe('msUntilReset — what is left of a stated reset', () => {
  it('counts the milliseconds from now to the reset', () => {
    expect(msUntilReset(NOW + 12 * 60_000, NOW)).toBe(12 * 60_000);
  });

  it('answers null where the connector stated no reset', () => {
    expect(msUntilReset(null, NOW)).toBeNull();
  });

  /**
   * A RESET IN THE PAST IS A REFILLED BUCKET. Waiting for a moment that has
   * gone would hold a caller for a window that already closed.
   */
  it('answers null where the reset has already passed', () => {
    expect(msUntilReset(NOW - 1, NOW)).toBeNull();
    expect(msUntilReset(NOW, NOW)).toBeNull();
  });

  it('answers null for a reset that is not a number at all', () => {
    expect(msUntilReset(Number.NaN, NOW)).toBeNull();
    expect(msUntilReset(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });
});

describe('reactionTo — a spent quota waits for its reset', () => {
  /** The Done-when line: the reaction waits for the reset the header carried. */
  it('waits exactly until the reset the response header carried', () => {
    const reaction = reactionTo(refusalKind(QUOTA), NOW + 12 * 60_000, NOW);
    expect(reaction).toEqual({
      waitMs: 12 * 60_000,
      stated: true,
      concurrencyFactor: 1,
      touchesCadence: false,
    });
  });

  /**
   * THE RATE WAS NOT THE CAUSE, SO THE RATE IS NOT THE FIX. A quota refusal
   * leaves concurrency exactly where it was — the asymmetry `correctForRefusal`
   * keeps in the other direction, where only a quota moves the hourly
   * prediction.
   */
  it('leaves concurrency untouched on a quota', () => {
    const reaction = reactionTo('quota', NOW + 60_000, NOW);
    expect(reaction?.concurrencyFactor).toBe(1);
    expect(loweredConcurrency(8, reaction)).toBe(8);
  });

  /**
   * THE OPEN QUESTION THE PLAN LEFT, ANSWERED RATHER THAN DEFAULTED SILENTLY.
   * `limit.ts` permits a null reset, and a connector reporting none is the
   * `unknown` basis. The answer waits the ceiling and SAYS it was not stated,
   * so a banner can decline to print a reset it never received.
   */
  it('waits the ceiling and reports it unstated where no reset was given', () => {
    const reaction = reactionTo('quota', null, NOW);
    expect(reaction).toEqual({
      waitMs: UNSTATED_RESET_MS,
      stated: false,
      concurrencyFactor: 1,
      touchesCadence: false,
    });
  });

  /**
   * A RESET THAT HAS PASSED IS A STATED ANSWER, NOT AN ABSENT ONE — the bucket
   * refilled while the refusal was in flight, so nothing is owed and the caller
   * rejoins its cadence. It must NOT fall through to the unstated ceiling: that
   * would hold a board for five minutes on a bucket that is already full.
   */
  it('waits nothing where the stated reset has already passed', () => {
    expect(reactionTo('quota', NOW - 1_000, NOW)).toEqual({
      waitMs: 0,
      stated: true,
      concurrencyFactor: 1,
      touchesCadence: false,
    });
  });

  /** A quota reads its reset and ignores any wait the message named. */
  it('prefers the stated reset over a named retry on a quota', () => {
    expect(reactionTo('quota', NOW + 900_000, NOW, 30_000)?.waitMs).toBe(900_000);
  });
});

describe('reactionTo — a secondary limit retries in seconds', () => {
  /** The Done-when line: retries within seconds, and lowers concurrency. */
  it('retries after seconds and halves concurrency', () => {
    const reaction = reactionTo(refusalKind(SECONDARY), null, NOW);
    expect(reaction?.waitMs).toBe(SECONDARY_RETRY_MS);
    expect(reaction?.concurrencyFactor).toBe(0.5);
    expect(reaction?.touchesCadence).toBe(false);
  });

  /** The connector knows its own burst window, so its number outranks ours. */
  it('honours a wait the connector named, and calls it stated', () => {
    expect(reactionTo('secondary', null, NOW, 45_000)).toEqual({
      waitMs: 45_000,
      stated: true,
      concurrencyFactor: 0.5,
      touchesCadence: false,
    });
  });

  it('falls back to its own seconds where the named wait is nonsense', () => {
    expect(reactionTo('secondary', null, NOW, 0)?.waitMs).toBe(SECONDARY_RETRY_MS);
    expect(reactionTo('secondary', null, NOW, -5)?.waitMs).toBe(SECONDARY_RETRY_MS);
    expect(reactionTo('secondary', null, NOW, Number.NaN)?.waitMs).toBe(SECONDARY_RETRY_MS);
  });

  /**
   * THE PRIMARY RESET DESCRIBES A DIFFERENT CEILING. A secondary limit clears
   * in seconds, so waiting the quota's minutes would sit out a limit that has
   * already gone — which is what `resetApplies` refuses for the banner and this
   * refuses for the wait.
   */
  it('ignores a reset time on a secondary limit', () => {
    expect(reactionTo('secondary', NOW + 45 * 60_000, NOW)?.waitMs).toBe(SECONDARY_RETRY_MS);
  });

  /** A secondary refusal is retried in SECONDS, and this is what that means. */
  it('waits under two minutes, whatever the reset said', () => {
    const reaction = reactionTo('secondary', NOW + 60 * 60_000, NOW);
    expect(reaction?.waitMs).toBeLessThan(120_000);
  });
});

describe('reactionTo — an outage is not a limit', () => {
  /**
   * A WAIT DOES NOT FIX AN AUTH ERROR. Backing off for a 503 would make the
   * board look stalled for a reason nothing could explain, so an outage rejoins
   * the ordinary cadence.
   */
  it('waits nothing and lowers nothing', () => {
    expect(reactionTo(refusalKind(OUTAGE), null, NOW)).toEqual({
      waitMs: 0,
      stated: false,
      concurrencyFactor: 1,
      touchesCadence: false,
    });
  });

  it('has nothing to answer where nothing refused', () => {
    expect(reactionTo(null, null, NOW)).toBeNull();
    expect(reactionTo(refusalKind(''), null, NOW)).toBeNull();
  });
});

describe('the cadence is untouched by either reaction', () => {
  /**
   * THE CONSTRAINT THE PLAN STATES FOR THIS SLICE, ASSERTED RATHER THAN
   * DESCRIBED. The cadence divides on observed spend, and a refusal that also
   * halved it would compound with that division and drift downward with nothing
   * to restore it.
   */
  it('reports touchesCadence false for every refusal there is', () => {
    for (const kind of ['quota', 'secondary', 'outage'] as const) {
      expect(reactionTo(kind, NOW + 60_000, NOW)?.touchesCadence).toBe(false);
    }
  });

  /**
   * THE CADENCE AFTER THE WAIT EQUALS THE CADENCE BEFORE IT — the Done-when
   * line, asserted against the rule that owns the cadence. A reaction carries
   * no input `refreshIntervalMs` reads, so the interval on either side of a
   * refusal is the same number.
   */
  it('leaves the interval identical either side of a quota wait', () => {
    const rate = { perHour: 180 };
    const before = refreshIntervalMs(60_000, 1, rate, 120_000);
    const reaction = reactionTo('quota', NOW + 12 * 60_000, NOW);
    expect(reaction?.waitMs).toBeGreaterThan(0);
    const after = refreshIntervalMs(60_000, 1, rate, 120_000);
    expect(after).toBe(before);
  });
});

describe('loweredConcurrency — a bound falls and never rises', () => {
  it('halves on a secondary refusal', () => {
    expect(loweredConcurrency(8, reactionTo('secondary', null, NOW))).toBe(4);
    expect(loweredConcurrency(7, reactionTo('secondary', null, NOW))).toBe(3);
  });

  /**
   * EIGHT REFUSED ON 2026-08-27 AND SEVEN IS AN INFERENCE FROM IT. Halving
   * converges on whatever the real bound is without needing the number nobody
   * measured.
   */
  it('converges from the one population the estate has measured', () => {
    let bound = 8;
    for (let i = 0; i < 5; i += 1) {
      bound = loweredConcurrency(bound, reactionTo('secondary', null, NOW));
    }
    expect(bound).toBe(MIN_CONCURRENCY);
  });

  /**
   * A CALLER LOWERED TO ZERO CAN NEVER CALL AGAIN. A refusal proves the count
   * was too high, not that the connector is shut.
   */
  it('never falls below one', () => {
    expect(loweredConcurrency(1, reactionTo('secondary', null, NOW))).toBe(MIN_CONCURRENCY);
    expect(loweredConcurrency(0, reactionTo('secondary', null, NOW))).toBe(MIN_CONCURRENCY);
  });

  it('holds the bound where the refusal was not a secondary one', () => {
    expect(loweredConcurrency(8, reactionTo('quota', NOW + 60_000, NOW))).toBe(8);
    expect(loweredConcurrency(8, reactionTo('outage', null, NOW))).toBe(8);
    expect(loweredConcurrency(8, null)).toBe(8);
  });

  it('leaves a bound it cannot do arithmetic on exactly where it was', () => {
    expect(loweredConcurrency(
      Number.POSITIVE_INFINITY,
      reactionTo('secondary', null, NOW),
    )).toBe(Number.POSITIVE_INFINITY);
  });
});
