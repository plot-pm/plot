/** The rule a deadline belongs to. */
export type DeadlineRule =
  | 'claim-stale'
  | 'slice-idle'
  | 'worker-bound'
  | 'checks-wait'
  | 'fixer-bound'
  | 'question-escalation'
  | 'launch-grace'
  | 'launch-pid-bound'
  | 'default-branch-red'
  | 'default-branch-reask'
  | 'issue-read'
  | 'pr-read';

/** The epoch milliseconds each deadline counts from. An absent list or `null` holds no deadline. */
export interface DeadlineReadings {
  /** When each claim nobody holds was last committed (`claimStaleMs`). */
  claimedAt?: readonly number[];
  /** When each open slice's idle clock started (`Slice idle after`). */
  sliceIdleSince?: readonly number[];
  /** When each running worker started (`Worker bound`). */
  workerStartedAt?: readonly number[];
  /** When each pending check set began to wait (`Checks wait`). */
  checksPendingSince?: readonly number[];
  /** When each fixer run started (the fixer bound). */
  fixerStartedAt?: readonly number[];
  /** When each open desk question was asked (`questionEscalationMs`). */
  questionAskedAt?: readonly number[];
  /** When each launch with no recorded pid started (`launchGraceMs`). */
  launchedAt?: readonly number[];
  /** When each launch with a recorded pid started (`launchPidBoundMs`). */
  launchedPidAt?: readonly number[];
  /** When a host last answered about a default branch that reads settled red (`checksWaitMs`). */
  defaultBranchRedAskedAt?: number | null;
  /** When a host last answered about the default branch's head. */
  defaultBranchAskedAt?: number | null;
  /** When the issue read last finished. */
  issueReadAt?: number | null;
  /** When the PR read last finished. */
  prReadAt?: number | null;
}

/** Each deadline's bound, in milliseconds. A rule whose bound is absent holds no deadline. */
export interface DeadlineBounds {
  /** The age past which a claim nobody holds reads as orphaned. */
  claimStaleMs?: number;
  sliceIdleMs?: number;
  workerBoundMs?: number;
  /** `Checks wait`: the pending-checks bound, the red hold's bound, and twice the default-branch re-ask. */
  checksWaitMs?: number;
  fixerBoundMs?: number;
  /** The `Question escalation` ages, each one rung. */
  questionEscalationMs?: readonly number[];
  /** How long a launch with no recorded pid still counts. */
  launchGraceMs?: number;
  /** How long a launch with a live recorded pid still counts. */
  launchPidBoundMs?: number;
  issueRefreshMs?: number;
  prBeatMs?: number;
}

/** The earliest wall time a deadline rule can change its answer, and the rule. */
export interface NextDeadline {
  /** Epoch milliseconds. */
  at: number;
  rule: DeadlineRule;
}

/**
 * The rules whose answer changes once an age strictly exceeds the bound
 * (`age > bound`). Their deadline lies 1 ms after anchor plus bound, so a wait
 * that ends on it reads the changed answer.
 */
const STRICT: ReadonlySet<DeadlineRule> = new Set<DeadlineRule>([
  'claim-stale',
  'slice-idle',
  'question-escalation',
  'default-branch-red',
]);

/**
 * Names the earliest wall time after `now` at which any deadline rule can
 * change its answer.
 *
 * Each rule changes its answer when its anchor plus its bound is reached: a
 * worker at `workerStartedAt + workerBoundMs`, the default-branch re-ask at
 * half of `checksWaitMs` after the last answer, each question rung at
 * `questionAskedAt + age`. A rule in {@link STRICT} changes 1 ms later. A
 * deadline at or before `now` has already changed its rule's answer and is not
 * returned. A rule whose bound is absent holds no deadline.
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
  const one = (at: number | null | undefined): readonly number[] => (at == null ? [] : [at]);
  const bound = (ms: number | undefined): readonly number[] => (ms === undefined ? [] : [ms]);
  const candidates: [DeadlineRule, readonly number[], readonly number[]][] = [
    ['claim-stale', readings.claimedAt ?? [], bound(bounds.claimStaleMs)],
    ['slice-idle', readings.sliceIdleSince ?? [], bound(bounds.sliceIdleMs)],
    ['worker-bound', readings.workerStartedAt ?? [], bound(bounds.workerBoundMs)],
    ['checks-wait', readings.checksPendingSince ?? [], bound(bounds.checksWaitMs)],
    ['fixer-bound', readings.fixerStartedAt ?? [], bound(bounds.fixerBoundMs)],
    ['question-escalation', readings.questionAskedAt ?? [], bounds.questionEscalationMs ?? []],
    ['launch-grace', readings.launchedAt ?? [], bound(bounds.launchGraceMs)],
    ['launch-pid-bound', readings.launchedPidAt ?? [], bound(bounds.launchPidBoundMs)],
    ['default-branch-red', one(readings.defaultBranchRedAskedAt), bound(bounds.checksWaitMs)],
    ['default-branch-reask', one(readings.defaultBranchAskedAt), bound(bounds.checksWaitMs === undefined ? undefined : bounds.checksWaitMs / 2)],
    ['issue-read', one(readings.issueReadAt), bound(bounds.issueRefreshMs)],
    ['pr-read', one(readings.prReadAt), bound(bounds.prBeatMs)],
  ];
  let best: NextDeadline | null = null;
  for (const [rule, anchors, ages] of candidates) {
    const past = STRICT.has(rule) ? 1 : 0;
    for (const anchor of anchors) {
      for (const age of ages) {
        const at = anchor + age + past;
        if (at > now && (best === null || at < best.at)) best = { at, rule };
      }
    }
  }
  return best;
};

/**
 * The earliest of several deadlines.
 *
 * @param deadlines - the deadlines; `null` and `undefined` hold none.
 * @returns the one with the smallest `at`, the first on a tie, or `null` where none is held.
 */
export const earliestDeadline = (deadlines: readonly (NextDeadline | null | undefined)[]): NextDeadline | null => {
  let best: NextDeadline | null = null;
  for (const deadline of deadlines) {
    if (deadline != null && (best === null || deadline.at < best.at)) best = deadline;
  }
  return best;
};
