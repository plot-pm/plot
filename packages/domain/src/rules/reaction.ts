import type { RefusalKind } from './refusal.js';

/**
 * How long a caller waits for a quota it was given no reset for.
 *
 * FIVE MINUTES, AND IT IS A CEILING RATHER THAN A GUESS AT THE RESET. A spent
 * quota that states no reset is the `unknown` basis of `LimitReading` — the
 * connector reports nothing and the record has nothing stored — and the honest
 * reaction to *I do not know when this returns* is neither to keep asking nor
 * to wait the hour a GitHub window happens to last. Waiting an hour on a
 * connector that recovers in a minute makes the board dark for fifty-nine
 * minutes it did not owe; asking again immediately spends the quota to be
 * refused again.
 *
 * It is deliberately LONGER than {@link SECONDARY_RETRY_MS} and SHORTER than a
 * connector's stated window. A caller that reaches it has learnt nothing, so it
 * returns to ask — and the next refusal, if the bucket is still spent, carries
 * the same ceiling again. That is a poll at five minutes rather than a wait for
 * a number nobody has.
 */
export const UNSTATED_RESET_MS = 5 * 60 * 1000;

/**
 * How long a caller waits for a secondary limit.
 *
 * SECONDS, BECAUSE THAT IS WHAT IT COSTS. GitHub's own wording says so — *"You
 * have exceeded a secondary rate limit. Please wait 60 seconds"* — and the
 * limit is about requests AT ONCE rather than requests an hour, so it has
 * cleared by the time the burst that caused it has drained. A caller handed the
 * quota's wait here would sit out minutes for a ceiling that cleared in one.
 *
 * SIXTY IS THE NUMBER THE HOST ITSELF NAMES, and it is used only where the host
 * named none: {@link reactionTo} prefers the connector's own `retryAfterMs`
 * wherever the refusal carried one, because the connector knows its own burst
 * window and this does not.
 */
export const SECONDARY_RETRY_MS = 60 * 1000;

/**
 * How far one secondary refusal lowers the concurrency a caller allows itself.
 *
 * HALVING, FOR THE REASON `correctForRefusal` HALVES A PREDICTION. A secondary
 * refusal says only *fewer at once than this* — it carries no number of its own
 * — so a fixed decrement would take as many refusals to correct a wildly wrong
 * bound as a nearly-right one. Halving converges whatever the starting error,
 * and the estate's one measurement is exactly the shape that needs it: eight
 * workers refused on 2026-08-27, and seven is an inference from that eight
 * rather than a limit anybody read.
 */
const CONCURRENCY_FACTOR = 0.5;

/**
 * The fewest simultaneous calls a refusal may drive a caller down to.
 *
 * ONE. A caller lowered to zero can never call again, which no refusal
 * licenses: a secondary limit proves the previous count was too high, not that
 * the connector is shut. The same floor {@link MIN_PREDICTED_LIMIT} keeps for
 * the ceiling itself, and for the same reason.
 */
export const MIN_CONCURRENCY = 1;

/**
 * What a caller does about one refusal — the decision, not the sleeping.
 *
 * **NOTHING HERE WAITS.** The rule computes a duration and a bound; the caller
 * schedules around them. That split is what lets `plot-host.sh` keep exiting
 * immediately: a script that slept inside the adapter would block a worker for
 * as long as the window lasts, and `plot-reap.sh`'s safety argument needs an
 * unreachable host to ANSWER — *not merged* — rather than to hang. A refusal
 * that blocks reads as *could not ask*, which is right, only for as long as
 * nobody is waiting on it.
 *
 * **AND NOTHING HERE TOUCHES THE CADENCE.** `waitMs` is a one-off delay before
 * the next attempt, not a new interval. The cadence divides on observed spend
 * (`cadenceStretch`), and a refusal that also lowered it would compound with
 * that division and drift downward with nothing to restore it — the constraint
 * the plan states for this slice and the reason `cadenceStretch` documents a
 * refusal as *not an input*.
 */
export interface Reaction {
  /** How long to wait before the next attempt, in milliseconds. */
  waitMs: number;
  /**
   * Whether the wait is a floor the connector named, rather than one inferred.
   *
   * A NAMED FLOOR IS A PROMISE AND IS HONOURED EXACTLY. A reset the response
   * header carried, or a *"wait 60 seconds"* the connector printed, is the
   * connector's own number; an inferred one is this rule's ceiling for a
   * connector that said nothing. A caller may shave the second and must not
   * shave the first — see `prGateOpen`, which already draws that line.
   */
  stated: boolean;
  /**
   * What to multiply the caller's concurrency bound by, and never its interval.
   *
   * ONE ON EVERY REFUSAL BUT A SECONDARY ONE. A spent quota is an hourly
   * ceiling that one caller reaches alone, so lowering how many calls run at
   * once corrects a number the refusal is not evidence about — the same
   * asymmetry `correctForRefusal` keeps in the other direction, where only a
   * quota moves the hourly prediction.
   */
  concurrencyFactor: number;
  /**
   * Whether the cadence may be changed by this refusal.
   *
   * ALWAYS FALSE, AND IT IS A FIELD RATHER THAN A COMMENT BECAUSE A FIELD CAN
   * BE ASSERTED. The plan's constraint binds both reactions, and a rule that
   * only says so in prose is one a later caller can rationalize around. A test
   * reads this; nobody reads a paragraph.
   */
  touchesCadence: false;
}

/**
 * How long to wait for a reset the connector stated.
 *
 * MEASURED FROM `now`, NEVER FROM THE CALL. The reset is an absolute moment on
 * the connector's clock, so the wait is what is left of it — and a reset
 * already in the past is a bucket that has refilled, which is no wait at all.
 *
 * @param resetAt - when the connector says the window resets, epoch
 *   milliseconds; null where it did not say.
 * @param now - epoch milliseconds.
 * @returns the milliseconds left, or null where there is no stated reset to
 *   wait for — including a reset that has already passed, which is an answer
 *   rather than an absence and is handled by the caller as *no wait owed*.
 */
export const msUntilReset = (resetAt: number | null, now: number): number | null => {
  if (resetAt === null || !Number.isFinite(resetAt)) return null;
  const left = resetAt - now;
  return left > 0 ? left : null;
};

/**
 * What one refusal asks its caller to do.
 *
 * **THE TWO LIMITS GET TWO REACTIONS, AND THE BUCKET NAME CHOSE BETWEEN THEM
 * BEFORE THIS WAS CALLED.** `refusalKind` reads the connector's wording and
 * `bucketVerdict` reads the record by name, so by here the question is settled
 * and this rule only acts on it.
 *
 * **A spent quota is a WAIT, not a slowdown.** Stop until the reset the
 * response header carried, then resume at the previous cadence. The rate was
 * not the cause — a bucket empties at whatever rate it is spent — so the rate
 * is not the fix.
 *
 * **A secondary limit is a CONCURRENCY problem.** Retry after seconds and halve
 * what runs at once. Frequency is untouched, because the limit bounds requests
 * at once and says nothing about requests an hour.
 *
 * **An outage is neither, and gets no wait at all.** A refusal that names no
 * limit is not one — a DNS blip or an expired token is not fixed by waiting,
 * and a caller that backed off for one would look stalled for a reason nothing
 * could explain. It rejoins the ordinary cadence, which is where every failure
 * that is not a limit already goes.
 *
 * **A QUOTA WITH NO STATED RESET WAITS THE CEILING AND SAYS SO.** `resetAt` is
 * nullable by design — a connector that reports no reset is the `unknown`
 * basis — and the answer is neither to invent a number nor to read absence as
 * permission. It waits {@link UNSTATED_RESET_MS} with `stated: false`, so a
 * caller can tell a promise from a guess and a banner can decline to print a
 * reset it never received.
 *
 * @param kind - which limit was hit, from `refusalKind`; null where nothing
 *   refused, which is not a case this answers.
 * @param resetAt - when the connector says the window resets, epoch
 *   milliseconds; null where it did not say. Read only for a quota — a
 *   secondary limit's reset describes a different ceiling, which is why
 *   `resetApplies` exists.
 * @param now - epoch milliseconds.
 * @param retryAfterMs - a wait the connector named in its own words, or null.
 *   Preferred over {@link SECONDARY_RETRY_MS} for a secondary limit, because
 *   the connector knows its own burst window.
 * @returns what to do, or null where there was no refusal to react to.
 */
export const reactionTo = (
  kind: RefusalKind | null,
  resetAt: number | null,
  now: number,
  retryAfterMs: number | null = null,
): Reaction | null => {
  if (kind === null) return null;
  if (kind === 'outage') {
    return { waitMs: 0, stated: false, concurrencyFactor: 1, touchesCadence: false };
  }
  if (kind === 'secondary') {
    const named = retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs > 0;
    return {
      waitMs: named ? retryAfterMs : SECONDARY_RETRY_MS,
      stated: named,
      concurrencyFactor: CONCURRENCY_FACTOR,
      touchesCadence: false,
    };
  }
  const until = msUntilReset(resetAt, now);
  // A RESET THAT HAS PASSED IS NOT AN ABSENT ONE. The bucket refilled while the
  // refusal was in flight, so there is nothing left to wait for and the caller
  // rejoins its cadence — which is a stated answer, not a guess.
  if (resetAt !== null && Number.isFinite(resetAt) && until === null) {
    return { waitMs: 0, stated: true, concurrencyFactor: 1, touchesCadence: false };
  }
  return {
    waitMs: until ?? UNSTATED_RESET_MS,
    stated: until !== null,
    concurrencyFactor: 1,
    touchesCadence: false,
  };
};

/**
 * The concurrency bound one refusal leaves behind.
 *
 * LOWERED BY A SECONDARY LIMIT AND BY NOTHING ELSE, floored at
 * {@link MIN_CONCURRENCY}. A caller holds its own bound — this slice lowers
 * what `bug/the-budget-bounds-simultaneous-calls` will later cap — so the rule
 * is stated here as arithmetic and the number is the caller's to keep.
 *
 * IT NEVER RAISES. A reaction is evidence in one direction only: a refusal
 * proves the count was too high, and the absence of a refusal proves nothing
 * about how much higher it could have gone. Restoring the bound is a different
 * question with a different input, and inventing one here would let a quiet
 * minute undo what a measured refusal established.
 *
 * @param current - the bound the caller is running at now.
 * @param reaction - what {@link reactionTo} answered, or null.
 * @returns the new bound, never below {@link MIN_CONCURRENCY} and never above
 *   `current`.
 */
export const loweredConcurrency = (current: number, reaction: Reaction | null): number => {
  if (reaction === null || reaction.concurrencyFactor >= 1) return current;
  if (!Number.isFinite(current)) return current;
  return Math.max(MIN_CONCURRENCY, Math.floor(current * reaction.concurrencyFactor));
};
