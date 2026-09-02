import type { SpendRate } from './budget-record.js';

/** Milliseconds in the hour every rate here is stated over. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * The most a shared account may stretch one spender's interval.
 *
 * EIGHT, AND THE BOUND IS THE POINT. Two facts make an unbounded stretch a trap
 * rather than merely a large number.
 *
 * The first is the burst. The rate is read over a window that can be as short as
 * the gap between two lines, so `/plot-dispatch` fanning out eight worktrees —
 * each shelling `gh` twice inside a second — reports a rate far above anything
 * sustained. The second is the loop: the stretch is derived from spend, and a
 * board that has stopped asking has stopped spending, so a board pushed past an
 * hour has no reading of its own fresh enough to bring it back. A ceiling is
 * what keeps that loop closed.
 *
 * Eight is chosen against what the estate holds. The plan counts eleven scripts,
 * the board, and a person at a terminal; eight boards' worth of sustained spend
 * is past every population measured here, and 60 s x 8 = 8 minutes is still a
 * cadence a PR badge recovers from inside one review cycle.
 *
 * IT BOUNDS THE STRETCH, NOT THE SPEND. An account genuinely spending eight
 * times one board's share will exceed its budget, and that is the honest
 * outcome: this rule divides a cadence, it does not enforce a quota. The
 * reaction to an actual refusal belongs to another slice and deliberately not to
 * this one — reacting to an error here would compound with the division already
 * happening and drift the cadence down with nothing to bring it back.
 */
export const MAX_CADENCE_STRETCH = 8;

/**
 * How much of the gap to the target one adjustment closes.
 *
 * A QUARTER, AND WITHOUT IT THE CADENCE OSCILLATES INSTEAD OF DIVIDING. Every
 * board reads the same record and moves at the same moment, so a board that
 * jumps straight to its computed target moves the very rate the other boards are
 * about to read. Simulated over 400 adjustments at full step: two boards swing
 * between the ceiling and no stretch at all and the pair settles at 105 requests
 * an hour against a share of 60 — the property this rule exists for, missed by
 * roughly three quarters, by a controller that was individually correct on every
 * single step.
 *
 * 0.25 is the largest step measured stable across every population this estate
 * can hold. At 0.4, six boards settle at 64.1 an hour and five at 59.6; at 0.34,
 * six settle at 57.8. At 0.25, one through eight boards all settle at exactly
 * 60.0 — the share, to the tenth of a request.
 *
 * The cost is stated: convergence takes several refreshes rather than one, so a
 * second board appearing is met over a few minutes rather than instantly. That
 * is the right side to err on for a budget spent over an hour, and the wrong
 * side — a cadence that overshoots and recovers — spends more in the overshoot
 * than the smoothing ever saves.
 */
export const CADENCE_DAMPING = 0.25;

/**
 * What one board is entitled to spend an hour, in host requests.
 *
 * DERIVED FROM THE CADENCE, NEVER WRITTEN DOWN TWICE. A board refreshing every
 * `intervalMs` at `costPerRefresh` requests spends exactly this — 60 an hour on
 * every host today, which is why `prRefreshMsFor` multiplies the interval by the
 * cost in the first place. Computing it here rather than importing a constant
 * keeps the two from drifting: move the interval and this moves with it.
 *
 * @param intervalMs - the interval between refreshes.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @returns the requests an hour a board at that cadence spends.
 */
export const boardSharePerHour = (intervalMs: number, costPerRefresh: number): number =>
  (HOUR_MS / intervalMs) * costPerRefresh;

/**
 * What everything OTHER than this board is spending, in requests an hour.
 *
 * THE BOARD SUBTRACTS ITSELF, AND THAT IS WHAT LETS THE TOTAL LAND ON THE SHARE.
 * The record holds one line per host call from every spender on the computer,
 * this board's own calls included, so the observed rate is not an external load
 * — it is a number this board is itself moving. A stretch taken straight from it
 * chases its own tail: each board would divide by a rate that includes its own
 * spend, and the pair settles above the share rather than on it.
 *
 * The board's own contribution is DERIVED, not counted — it is exactly what its
 * current interval spends. Counting its own lines would need the record to carry
 * a process identity it deliberately does not have.
 *
 * Never negative. A rate below this board's own contribution means the window is
 * younger than the board's cadence, not that somebody is spending backwards.
 *
 * @param perHour - the account's observed requests an hour.
 * @param currentIntervalMs - the interval this board is refreshing at right now.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @returns the requests an hour attributable to every other spender.
 */
export const othersPerHour = (
  perHour: number,
  currentIntervalMs: number,
  costPerRefresh: number,
): number => Math.max(0, perHour - boardSharePerHour(currentIntervalMs, costPerRefresh));

/**
 * The stretch this board would want if it could move all at once.
 *
 * The board is entitled to whatever share is left once every other spender is
 * paid: `share - others`. Refreshing at exactly that rate is what holds the
 * account's total at one board's share however many boards are running.
 *
 * NOT WHAT THE BOARD ACTUALLY MOVES TO. Every board computes this at the same
 * moment against the same record, so applying it whole makes them move as one
 * and overshoot together. {@link cadenceStretch} damps it; this is the target
 * that damping aims at, exported so the aim can be asserted apart from the step.
 *
 * @param perHour - the account's observed requests an hour, or null.
 * @param intervalMs - the unstretched interval, which sets this board's share.
 * @param currentIntervalMs - the interval this board is refreshing at right now.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @returns a multiplier at least 1 and at most {@link MAX_CADENCE_STRETCH}.
 */
export const targetStretch = (
  perHour: number | null,
  intervalMs: number,
  currentIntervalMs: number,
  costPerRefresh: number,
): number => {
  if (perHour === null || !Number.isFinite(perHour) || perHour <= 0) return 1;
  // THE SHARE IS TAKEN AT THE UNSTRETCHED CADENCE, WHICH IS ALREADY THE COST
  // MULTIPLIED ONE. `intervalMs` reasons about a refresh as a unit; the interval
  // a board actually starts at is that times the cost, and it is deliberately
  // the same 60 requests an hour on every host. Reading the share off
  // `intervalMs` alone would give Bitbucket a share of 240 and let two boards
  // there spend what four boards spend everywhere else.
  const share = boardSharePerHour(intervalMs * costPerRefresh, costPerRefresh);
  if (!Number.isFinite(share) || share <= 0) return 1;
  const others = othersPerHour(perHour, currentIntervalMs, costPerRefresh);
  // Nothing left for this board to spend, so the ceiling decides. This is the
  // branch a burst reaches, and the reason the ceiling is a number rather than
  // an infinity.
  if (others >= share) return MAX_CADENCE_STRETCH;
  // A QUIET ACCOUNT RETURNS 1, NEVER A FRACTION. `others` is floored at zero, so
  // this quotient is at least 1 by construction and the floor is a property of
  // the arithmetic rather than a clamp on it: a board may only ever be slowed
  // down. Speeding up on an idle record would spend the headroom of every
  // spender that happens to be quiet at that moment, and would oscillate against
  // the very rate it is reading.
  return Math.min(MAX_CADENCE_STRETCH, share / (share - others));
};

/**
 * How far to stretch one board's refresh interval, one adjustment at a time.
 *
 * THE CADENCE DIVIDES, IT DOES NOT DOUBLE. Two boards on one account converge on
 * a stretch of two each and the pair still spends 60 requests an hour; a third
 * makes it three and the total is unchanged again. Neither board knows the other
 * is there — each reads the same record and subtracts only itself.
 *
 * READ FROM THE RECORD, NEVER FROM A HEADCOUNT. The observed rate also carries
 * the operator's own `gh` calls and a dispatched worker's scans, which spend the
 * same account. A count of boards would miss both; a count of processes would
 * miss the person at the terminal.
 *
 * A REFUSAL IS NOT AN INPUT. The stretch is derived from observed spend alone. A
 * `throttled` response updates the connector's prediction, and the reaction to
 * it belongs to the slice that owns refusals.
 *
 * @param perHour - the account's observed requests an hour, or null.
 * @param intervalMs - the unstretched interval, which sets this board's share.
 * @param currentIntervalMs - the interval this board is refreshing at right now.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @returns a multiplier at least 1 and at most {@link MAX_CADENCE_STRETCH}.
 */
export const cadenceStretch = (
  perHour: number | null,
  intervalMs: number,
  currentIntervalMs: number,
  costPerRefresh: number,
): number => {
  const base = intervalMs * costPerRefresh;
  const current = Math.max(base, currentIntervalMs) / base;
  // AN ABSENT RATE HOLDS THE CADENCE WHERE IT IS, AND A ZERO RATE WALKS IT
  // BACK. `perHour` is null where the window holds no span to divide by — one
  // line, or several inside one millisecond — and that is an absent rate rather
  // than a zero one. The two must not act alike: an absent rate is NO EVIDENCE,
  // so the honest response is to move nothing, while a rate that IS zero is
  // evidence of an idle account and earns the walk back to the unstretched
  // interval. Coercing the null to 0 collapses that distinction and reads an
  // account that has only just started writing as one that has stopped.
  if (perHour === null) return current;
  const target = targetStretch(perHour, intervalMs, currentIntervalMs, costPerRefresh);
  const stepped = current + CADENCE_DAMPING * (target - current);
  // The floor is reasserted after the step, not assumed from it: a board already
  // stretched further than its target walks back DOWN toward 1, and must stop
  // there rather than pass through it.
  const bounded = Math.min(MAX_CADENCE_STRETCH, Math.max(1, stepped));
  // SNAPPED ONTO THE TARGET WHERE THE REMAINING GAP IS UNDER A MILLISECOND OF
  // INTERVAL, because a damped step approaches its target asymptotically and
  // never arrives. The residue is far below anything a timer can honour, but it
  // does not decay away: a board recovering from a burst would sit at 60002 ms
  // for as long as it runs rather than at the 60 s this file documents, and a
  // board holding at the ceiling would report 479999. Snapping is what makes
  // the two states this rule promises — unstretched, and at the ceiling —
  // reachable rather than merely approached.
  //
  // It closes the gap to the TARGET and not to a round number: the target is
  // where the arithmetic is going, and rounding the interval instead quantises
  // the step into a one-millisecond limit cycle around the same place.
  //
  // THE THRESHOLD IS THE STEP, NOT THE GAP. A gap of one millisecond is not the
  // right test, because the step only closes a QUARTER of whatever remains: a
  // board sitting 1.5 ms above its target moves 0.4 ms and stays there for as
  // long as it runs. So the snap fires wherever the step itself would be worth
  // less than a millisecond of interval — which is exactly the condition under
  // which no further step can ever arrive.
  return Math.abs(target - bounded) * base * CADENCE_DAMPING < 1 ? target : bounded;
};

/**
 * The interval a board should leave between PR refreshes, given the cost of one
 * refresh and what the account is observed to be spending.
 *
 * THE ONE ANSWER A CADENCE ASKS FOR, composed here rather than in the board so
 * it is testable as arithmetic rather than only observable through a live timer.
 * `prRefreshMsFor` calls this and holds no second copy of the reasoning.
 *
 * ONE BOARD ON A QUIET ACCOUNT IS UNCHANGED. An absent rate, an unreadable
 * record, or a rate no higher than this board's own contribution all return
 * exactly `intervalMs * costPerRefresh` — the number this board returned before
 * the record existed. The uncommon case must not slow the common one down.
 *
 * ROUNDED TO A WHOLE MILLISECOND, because the value is compared against a clock
 * and a fractional interval buys nothing a timer can honour.
 *
 * @param intervalMs - the unstretched interval, `PR_REFRESH_MS`.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @param rate - what the record says about this account, or null where the
 *   record could not be read at all. An unreadable record leaves the cadence
 *   where it is: silence is not evidence of a busy account, and slowing down
 *   because a file is missing would make the board depend on it.
 * @param currentIntervalMs - the interval this board is refreshing at right now;
 *   defaults to the unstretched one, which is where a board starts.
 * @returns the interval in whole milliseconds, never below the unstretched one.
 */
export const refreshIntervalMs = (
  intervalMs: number,
  costPerRefresh: number,
  rate: Pick<SpendRate, 'perHour'> | null,
  currentIntervalMs: number = intervalMs * costPerRefresh,
): number => {
  const base = intervalMs * costPerRefresh;
  const stretch = cadenceStretch(
    rate?.perHour ?? null,
    intervalMs,
    currentIntervalMs,
    costPerRefresh,
  );
  return Math.round(base * stretch);
};
