/** The rule a deadline belongs to. */
export type DeadlineRule =
  | 'claim-stale'
  | 'slice-idle'
  | 'worker-bound'
  | 'checks-wait'
  | 'fixer-bound'
  | 'default-branch-reask'
  | 'issue-read'
  | 'pr-read';

/** The epoch milliseconds each deadline counts from. An absent list or `null` holds no deadline. */
export interface DeadlineReadings {
  /** When each live claim was made (`Claim stale after`). */
  claimedAt?: readonly number[];
  /** When each open slice's idle clock started (`Slice idle after`). */
  sliceIdleSince?: readonly number[];
  /** When each running worker started (`Worker bound`). */
  workerStartedAt?: readonly number[];
  /** When each pending check set began to wait (`Checks wait`). */
  checksPendingSince?: readonly number[];
  /** When each fixer run started (the fixer bound). */
  fixerStartedAt?: readonly number[];
  /** When a host last answered about the default branch's head. */
  defaultBranchAskedAt?: number | null;
  /** When the issue read last finished. */
  issueReadAt?: number | null;
  /** When the PR read last finished. */
  prReadAt?: number | null;
}

/** Each deadline's bound, in milliseconds. */
export interface DeadlineBounds {
  claimStaleMs: number;
  sliceIdleMs: number;
  workerBoundMs: number;
  checksWaitMs: number;
  fixerBoundMs: number;
  issueRefreshMs: number;
  prBeatMs: number;
}

/** The earliest wall time a deadline rule can change its answer, and the rule. */
export interface NextDeadline {
  /** Epoch milliseconds. */
  at: number;
  rule: DeadlineRule;
}

/**
 * Names the earliest wall time after `now` at which any deadline rule can
 * change its answer.
 *
 * Each rule changes its answer when its anchor plus its bound is reached: a
 * claim at `claimedAt + claimStaleMs`, the default-branch re-ask at half of
 * `checksWaitMs` after the last answer. A deadline at or before `now` has
 * already changed its rule's answer and is not returned; the rule that owns it
 * runs over the readings fleetd holds. A deadline names no readings.
 *
 * @param readings - the anchors, as values.
 * @param bounds - the bounds, in milliseconds.
 * @param now - the wall clock, epoch milliseconds.
 * @returns the earliest future deadline with its rule (the first rule in the
 *   {@link DeadlineRule} order on a tie), or `null` when the estate holds none.
 */
export const nextDeadline = (
  readings: DeadlineReadings,
  bounds: DeadlineBounds,
  now: number,
): NextDeadline | null => {
  const candidates: [DeadlineRule, readonly number[], number][] = [
    ['claim-stale', readings.claimedAt ?? [], bounds.claimStaleMs],
    ['slice-idle', readings.sliceIdleSince ?? [], bounds.sliceIdleMs],
    ['worker-bound', readings.workerStartedAt ?? [], bounds.workerBoundMs],
    ['checks-wait', readings.checksPendingSince ?? [], bounds.checksWaitMs],
    ['fixer-bound', readings.fixerStartedAt ?? [], bounds.fixerBoundMs],
    ['default-branch-reask', readings.defaultBranchAskedAt == null ? [] : [readings.defaultBranchAskedAt], bounds.checksWaitMs / 2],
    ['issue-read', readings.issueReadAt == null ? [] : [readings.issueReadAt], bounds.issueRefreshMs],
    ['pr-read', readings.prReadAt == null ? [] : [readings.prReadAt], bounds.prBeatMs],
  ];
  let best: NextDeadline | null = null;
  for (const [rule, anchors, bound] of candidates) {
    for (const anchor of anchors) {
      const at = anchor + bound;
      if (at > now && (best === null || at < best.at)) best = { at, rule };
    }
  }
  return best;
};
