import { describe, expect, it } from 'vitest';

import {
  boardSharePerHour,
  cadenceStretch,
  CADENCE_DAMPING,
  MAX_CADENCE_STRETCH,
  othersPerHour,
  refreshIntervalMs,
  targetStretch,
} from '../src/rules/cadence.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: two boards spending on one account spend
 * no more than one board does, and a third changes that by nothing.
 *
 * Asserted as a SIMULATION rather than as a single call, because the claim is
 * about a fixed point and a single adjustment cannot exhibit one. Each board
 * reads the same record, subtracts only itself, and steps; the account's total
 * is what the assertion reads.
 */

/** The board's unstretched interval — `PR_REFRESH_MS`. */
const INTERVAL = 60_000;
/** GitHub costs one request per refresh; Bitbucket four. */
const GITHUB = 1;
const BITBUCKET = 4;
const HOUR = 60 * 60 * 1000;

/** What a board refreshing every `intervalMs` spends in an hour. */
const spendOf = (intervalMs: number, cost: number): number => (HOUR / intervalMs) * cost;

/**
 * Runs `count` boards against one shared account until they settle, and reports
 * what the account spends per hour and what interval each board landed on.
 *
 * Every board reads the SAME rate — that is what a shared record means — and
 * none of them is told how many others there are.
 */
const settle = (count: number, cost = GITHUB, external = 0): { perHour: number; intervalMs: number } => {
  let intervals = Array<number>(count).fill(INTERVAL * cost);
  for (let step = 0; step < 400; step++) {
    const observed = external + intervals.reduce((total, ms) => total + spendOf(ms, cost), 0);
    intervals = intervals.map((ms) => refreshIntervalMs(INTERVAL, cost, { perHour: observed }, ms));
  }
  return {
    perHour: intervals.reduce((total, ms) => total + spendOf(ms, cost), 0),
    intervalMs: intervals[0]!,
  };
};

describe('the cadence divides, it does not double', () => {
  it('leaves one board on a quiet account spending its whole share', () => {
    const one = settle(1);
    expect(one.intervalMs).toBe(INTERVAL);
    expect(one.perHour).toBe(60);
  });

  it('holds the account at the share of one board when a second appears', () => {
    const two = settle(2);
    // The plan's sentence, as arithmetic: "each refreshes half as often, and
    // the pair still spends 60 requests an hour."
    //
    // THE TOLERANCE IS MILLISECONDS, AND IT IS THE HONEST READING. Each board
    // steps against a rate it is itself moving, so the pair settles a couple of
    // milliseconds either side of the exact double. That is four orders of
    // magnitude below `PR_TICK_SLACK_MS`, which is the tolerance the gate
    // already applies to this same number — an exact assertion here would pin a
    // value the clock cannot tell apart from its neighbour.
    expect(two.intervalMs).toBeCloseTo(2 * INTERVAL, -1);
    expect(two.perHour).toBeCloseTo(60, 2);
  });

  it('changes that number by nothing when a third board appears', () => {
    expect(settle(3).perHour).toBeCloseTo(settle(2).perHour, 2);
    expect(settle(3).intervalMs).toBeCloseTo(3 * INTERVAL, -1);
  });

  it('holds the same total for every population up to the ceiling', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(settle(count).perHour).toBeCloseTo(60, 2);
    }
  });

  it('counts a spender that is not a board at all', () => {
    // The operator's own `gh` calls, at half a board's share. One board must
    // give way to them exactly as it gives way to a peer — which is the whole
    // reason the rate is read rather than the boards counted.
    const withOperator = settle(1, GITHUB, 30);
    expect(withOperator.perHour).toBeCloseTo(30, 2);
    expect(withOperator.intervalMs).toBeCloseTo(2 * INTERVAL, -1);
  });

  it('divides a Bitbucket board on top of its cost multiplier', () => {
    const one = settle(1, BITBUCKET);
    expect(one.intervalMs).toBe(4 * INTERVAL);
    expect(one.perHour).toBeCloseTo(60, 5);
    // Two Bitbucket boards still cost the account 60 an hour, at 8 minutes each
    // — the cost multiplier and the division compose rather than compete.
    const two = settle(2, BITBUCKET);
    expect(two.intervalMs).toBeCloseTo(8 * INTERVAL, -1);
    expect(two.perHour).toBeCloseTo(60, 2);
  });
});

describe('an absent rate leaves the cadence exactly where it is', () => {
  it('returns the unstretched interval for a null rate', () => {
    // A record holding one line, or several written inside one millisecond,
    // gives nothing to divide by. That is an absent rate, never a zero one.
    expect(refreshIntervalMs(INTERVAL, GITHUB, { perHour: null })).toBe(INTERVAL);
  });

  it('returns the unstretched interval for a record it could not read', () => {
    expect(refreshIntervalMs(INTERVAL, GITHUB, null)).toBe(INTERVAL);
  });

  it('does not stretch a board already stretched, when the rate goes absent', () => {
    // The load-bearing negative: a null must not hold a stretch in place either.
    // It walks back toward the unstretched interval rather than freezing.
    const stretched = 4 * INTERVAL;
    expect(refreshIntervalMs(INTERVAL, GITHUB, null, stretched)).toBeLessThan(stretched);
  });

  it('reads a non-finite rate as absent rather than as an enormous one', () => {
    expect(refreshIntervalMs(INTERVAL, GITHUB, { perHour: Number.POSITIVE_INFINITY })).toBe(INTERVAL);
    expect(refreshIntervalMs(INTERVAL, GITHUB, { perHour: Number.NaN })).toBe(INTERVAL);
  });

  it('reads a zero rate as no evidence rather than as an idle account', () => {
    expect(refreshIntervalMs(INTERVAL, GITHUB, { perHour: 0 })).toBe(INTERVAL);
  });
});

describe('a quiet account never speeds a board up', () => {
  it('returns exactly the unstretched interval below the share of one board', () => {
    // 20 requests an hour is a third of the share. The board may not take the
    // spare: this rule slows a board down and never the other way.
    expect(refreshIntervalMs(INTERVAL, GITHUB, { perHour: 20 })).toBe(INTERVAL);
  });

  it('never returns below the unstretched interval on any rate', () => {
    for (const perHour of [0.1, 1, 20, 59, 60, 61, 600, 6000]) {
      expect(refreshIntervalMs(INTERVAL, GITHUB, { perHour })).toBeGreaterThanOrEqual(INTERVAL);
    }
  });
});

describe('the stretch is bounded, and the bound is stated', () => {
  it('never exceeds the ceiling on any rate a burst can report', () => {
    // A dispatch fanning out eight worktrees reports a rate far above anything
    // sustained, because the window can be as short as the gap between lines.
    for (const perHour of [600, 6_000, 60_000, 3_600_000]) {
      expect(cadenceStretch(perHour, INTERVAL, INTERVAL, GITHUB))
        .toBeLessThanOrEqual(MAX_CADENCE_STRETCH);
    }
  });

  it('caps the interval at the ceiling however long the board is left running', () => {
    let ms = INTERVAL;
    for (let step = 0; step < 200; step++) {
      ms = refreshIntervalMs(INTERVAL, GITHUB, { perHour: 3_600_000 }, ms);
    }
    expect(ms).toBe(MAX_CADENCE_STRETCH * INTERVAL);
  });

  it('recovers from the ceiling when the burst passes', () => {
    // The reason the ceiling exists: a board pushed past an hour has no reading
    // of its own fresh enough to bring it back. From the ceiling it must return.
    let ms = MAX_CADENCE_STRETCH * INTERVAL;
    for (let step = 0; step < 200; step++) {
      ms = refreshIntervalMs(INTERVAL, GITHUB, { perHour: spendOf(ms, GITHUB) }, ms);
    }
    expect(ms).toBe(INTERVAL);
  });

  it('takes the ceiling where every request is already spent by others', () => {
    // `others >= share` has nothing left to divide, which is the branch the
    // ceiling exists to answer rather than an infinity.
    expect(targetStretch(600, INTERVAL, INTERVAL, GITHUB)).toBe(MAX_CADENCE_STRETCH);
  });
});

describe('the board subtracts itself from what it reads', () => {
  it('attributes a rate equal to its own contribution entirely to itself', () => {
    expect(othersPerHour(60, INTERVAL, GITHUB)).toBe(0);
    expect(targetStretch(60, INTERVAL, INTERVAL, GITHUB)).toBe(1);
  });

  it('never reports a negative rate for other spenders', () => {
    // A window younger than the board's cadence reports less than the board is
    // spending. That is not somebody spending backwards.
    expect(othersPerHour(10, INTERVAL, GITHUB)).toBe(0);
  });

  it('subtracts the stretched contribution, not the unstretched one', () => {
    // A board already at 120 s spends 30 an hour, so an observed 60 leaves 30
    // for everyone else — not 0, which is what subtracting the base would say.
    expect(othersPerHour(60, 2 * INTERVAL, GITHUB)).toBe(30);
  });

  it('derives the share of one board from the interval and the cost', () => {
    expect(boardSharePerHour(INTERVAL, GITHUB)).toBe(60);
    expect(boardSharePerHour(4 * INTERVAL, BITBUCKET)).toBe(60);
  });

  it('refuses to divide by a share that is not a number to divide by', () => {
    expect(targetStretch(600, 0, INTERVAL, GITHUB)).toBe(1);
    expect(targetStretch(600, INTERVAL, INTERVAL, 0)).toBe(1);
  });
});

describe('the step is damped, and that is what makes it settle', () => {
  it('moves a fraction of the way to the target rather than all of it', () => {
    const target = targetStretch(120, INTERVAL, INTERVAL, GITHUB);
    const stepped = cadenceStretch(120, INTERVAL, INTERVAL, GITHUB);
    expect(target).toBe(MAX_CADENCE_STRETCH);
    expect(stepped).toBeCloseTo(1 + CADENCE_DAMPING * (target - 1), 10);
    expect(stepped).toBeLessThan(target);
  });

  it('walks a board back down toward the unstretched interval, never past it', () => {
    // A board sitting at the ceiling on an account that has gone quiet steps
    // down each refresh and stops at 1 rather than passing through it.
    let stretch = cadenceStretch(null, INTERVAL, MAX_CADENCE_STRETCH * INTERVAL, GITHUB);
    expect(stretch).toBeLessThan(MAX_CADENCE_STRETCH);
    for (let step = 0; step < 200; step++) {
      stretch = cadenceStretch(null, INTERVAL, stretch * INTERVAL, GITHUB);
    }
    expect(stretch).toBe(1);
  });

  it('never reads a board as refreshing faster than its unstretched interval', () => {
    // A current interval below the base would report a share above the board's
    // own, which is a state no caller can be in and must not compute one.
    expect(cadenceStretch(null, INTERVAL, 1_000, GITHUB)).toBe(1);
  });
});
