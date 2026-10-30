import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { PrIndexRow } from '../entities/pr-index.js';
import { defaultBranchAgeMs } from './default-branch.js';
import type { DeskDeadAnswer } from './desk-dead.js';
import { reviewStartAllowed, type ReviewStart } from './review-run.js';
import type { SprintScope } from './sprint-scope.js';

/** A sibling plan's record, which that plan types when it builds its arm. */
export type SiblingReading = { read: 'unread' } | { read: 'record' };

/** The fixer's attempts record with its in-flight mark (#2903). */
export type FixerReading = { read: 'unread' } | { read: 'record'; inFlight: boolean };

/** The review verdict file `reviews/<pr>-<headSha>.md` as read through `reviewVerdict`. */
export type VerdictReading =
  | { read: 'verdict'; state: 'success' | 'failure'; description: string }
  | { read: 'absent' }
  | { read: 'unread' };

/** The live review run on a PR, from `review-in-flight.json` through `reviewRunLive`. */
export interface ReviewRunReading {
  readonly head: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly live: boolean;
}

/** The constants and config the rule reads. */
export interface SlicePrConfig {
  /** `Auto-review`. */
  readonly autoReview: boolean;
  /** How long a `pending` review counts as in flight, in milliseconds. */
  readonly reviewBoundMs: number;
  /** The most review starts one head gets. */
  readonly startBudget: number;
  /** `Checks wait`, in milliseconds. */
  readonly checksWaitMs: number;
}

/**
 * Everything {@link slicePrNext} reads about one open PR, as values.
 *
 * `fixer`, `ticket` and `repair` are optional until the plan that owns each
 * arm builds it; an absent field reads as no answer from that arm.
 */
export interface SlicePrNextReadings {
  /** This PR's OPEN row; `null` for a missing or undecodable store. */
  readonly row: PrIndexRow | null;
  /** The newest MERGED row of the index, for #2902's `merge-in-flight` hold. */
  readonly newestMerged: { mergedAt: string } | null;
  readonly scope: SprintScope;
  readonly reviewRun: ReviewRunReading | null;
  readonly reviewStarts: Pick<ReviewStart, 'head' | 'count' | 'lastAt'> | null;
  readonly verdict: VerdictReading;
  readonly defaultBranch: DefaultBranchReading | null;
  readonly desk: DeskDeadAnswer;
  readonly fixer?: FixerReading;
  readonly ticket?: SiblingReading;
  readonly repair?: SiblingReading;
  /**
   * True where the host is GitHub and `Merger app` is undeclared. Absent reads
   * as not applicable, which is every other host.
   */
  readonly mergerAppMissing?: boolean;
  readonly config: SlicePrConfig;
  /** Epoch milliseconds of the tick. */
  readonly now: number;
}

/** Why a hold holds. An open string set: a sibling plan adds its own. */
export type HoldReason =
  | 'review-in-flight'
  | 'fixer-in-flight'
  | 'ci-red-attempts-spent'
  | 'default-branch-red'
  | 'default-branch-stale'
  | 'default-branch-unread'
  | 'merge-in-flight'
  | 'conflicting'
  | 'merger-app-missing'
  | 'default-branch-unsettled'
  | 'unread'
  | (string & {});

/** The one step the fleet takes on an open slice PR. */
export type SlicePrStep =
  | { step: 'none'; why: string }
  | { step: 'review'; head: string }
  | {
      step: 'write-status';
      head: string;
      state: 'success' | 'failure';
      description: string;
      why: 'verdict-unwritten' | 'ticket-accepted';
    }
  | { step: 'merge'; head: string }
  | { step: 'hold'; reason: HoldReason }
  | { step: 'fixer'; head: string; evidence: 'high' | 'ci-red' }
  | { step: 'ticket'; head: string };

const none = (why: string): SlicePrStep => ({ step: 'none', why });
const hold = (reason: HoldReason): SlicePrStep => ({ step: 'hold', reason });
const isNone = (step: SlicePrStep): boolean => step.step === 'none';

/**
 * Arm 1. Whether the PR is one this fleet acts on at all.
 *
 * @param readings - the PR's readings.
 * @returns `none` with the first reason the PR is out, or `null` where it is in.
 */
export const guardArm = (readings: SlicePrNextReadings): SlicePrStep | null => {
  const { row, scope } = readings;
  if (row === null) return none('no-row');
  if (row.state !== 'OPEN') return none('not-open');
  if (row.draft) return none('draft');
  if (scope.read === 'none') return none(`scope-${scope.why}`);
  if (!scope.branches.includes(row.head)) return none('out-of-scope');
  return null;
};

/**
 * Arm 2. A live review run on the current head holds the PR.
 *
 * @param readings - the PR's readings.
 * @returns a `review-in-flight` hold, or `none`.
 */
export const reviewRunArm = (readings: SlicePrNextReadings): SlicePrStep => {
  const { row, reviewRun } = readings;
  if (reviewRun !== null && reviewRun.live && reviewRun.head === row?.headSha) return hold('review-in-flight');
  return none('no-review-run');
};

/**
 * Arm 3. A verdict file the index does not yet reflect gets its status written.
 *
 * A row with no `plotReview` field was never asked, and the index never says
 * no, so that row answers `none`.
 *
 * @param readings - the PR's readings.
 * @returns `write-status`, a hold where the verdict file is unreadable, or `none`.
 */
export const restatusArm = (readings: SlicePrNextReadings): SlicePrStep => {
  const { row, verdict } = readings;
  if (verdict.read === 'unread') return hold('unread');
  if (verdict.read !== 'verdict') return none('no-verdict');
  if (row === null || row.headSha === undefined || row.plotReview === undefined) return none('not-asked');
  if (row.plotReview === verdict.state && row.plotReviewSha === row.headSha) return none('status-written');
  return {
    step: 'write-status',
    head: row.headSha,
    state: verdict.state,
    description: verdict.description,
    why: 'verdict-unwritten',
  };
};

/**
 * Arm 4 (#2903). A live fixer makes the head temporary.
 *
 * @param readings - the PR's readings.
 * @returns a `fixer-in-flight` hold, an `unread` hold, or `none`.
 */
export const fixerInFlightArm = (readings: SlicePrNextReadings): SlicePrStep => {
  const { fixer } = readings;
  if (fixer === undefined) return none('fixer-not-built');
  if (fixer.read === 'unread') return hold('unread');
  return fixer.inFlight ? hold('fixer-in-flight') : none('no-fixer-run');
};

/**
 * Arm 5 (#2903). The HIGH arms. Answers only a hold on an unread ticket record until #2903 builds the rest.
 *
 * @param readings - the PR's readings.
 * @returns an `unread` hold, or `none`.
 */
export const highArm = (readings: SlicePrNextReadings): SlicePrStep =>
  readings.ticket?.read === 'unread' ? hold('unread') : none('high-not-built');

/**
 * Arm 6 (#2903). The CI-red arms. Answers `none` until #2903 builds them.
 *
 * @returns `none`.
 */
export const ciRedArm = (_readings: SlicePrNextReadings): SlicePrStep => none('ci-red-not-built');

/**
 * Arm 7. Whether this head gets a review.
 *
 * Answers `review` when all hold, and `none` with the first failed reason
 * otherwise: `auto-review-off`; `not-asked`; `checks-unbound` or
 * `ci-not-green`; `reviewed`; `budget-spent` or `backoff`. A red default
 * branch never holds a review. Arm 3 runs first and already intercepts every
 * `verdict.read` other than `absent`, so this arm never sees one.
 *
 * @param readings - the PR's readings.
 * @returns `review`, or `none`.
 */
export const reviewArm = (readings: SlicePrNextReadings): SlicePrStep => {
  const { row, config, reviewStarts, now } = readings;
  if (!config.autoReview) return none('auto-review-off');
  if (row === null || row.plotReview === undefined || row.headSha === undefined) return none('not-asked');
  if (row.checksSha !== row.headSha || row.ciChecks === undefined) return none('checks-unbound');
  if (row.ciChecks !== 'green') return none('ci-not-green');

  const onHead = row.plotReviewSha === row.headSha;
  const startedAt = row.plotReviewAt === undefined ? Number.NaN : Date.parse(row.plotReviewAt);
  const pendingStale = row.plotReview === 'pending' && onHead && now - startedAt > config.reviewBoundMs;
  const needs =
    row.plotReview === 'absent' || row.plotReview === 'error' || !onHead || pendingStale;
  if (!needs) return none('reviewed');

  const allowed = reviewStartAllowed(reviewStarts, row.headSha, config.startBudget, now);
  if (allowed !== 'ok') return none(allowed);
  return { step: 'review', head: row.headSha };
};

/**
 * Arm 8 (#2902, with #2904's repair exception). Whether this head merges.
 *
 * A row whose `plot/review` is not `success` on its head answers `none` (or an
 * `unread` hold on an unread repair record). Otherwise the first failing hold
 * answers: `default-branch-unread` for no reading; `default-branch-stale` for
 * a reading whose `askedAt` is older than `Checks wait` or does not parse, red
 * or green; `default-branch-red`; `default-branch-unsettled` for a settled
 * state that is not green; `merge-in-flight` for a settled commit that is not
 * the head, or a merged row newer than the reading; `conflicting`;
 * `merger-app-missing`. The stale check is this arm's own and never
 * `defaultBranchRed`: a merge cannot be undone, so an old reading holds here
 * where it lifts the queue's hold.
 *
 * @param readings - the PR's readings.
 * @returns `merge`, a hold, or `none`.
 */
export const mergeArm = (readings: SlicePrNextReadings): SlicePrStep => {
  const { row, defaultBranch, newestMerged, config, now } = readings;
  if (readings.repair?.read === 'unread') return hold('unread');
  if (row === null || row.headSha === undefined) return none('not-asked');
  if (row.plotReview !== 'success' || row.plotReviewSha !== row.headSha) return none('not-passed');
  if (defaultBranch === null) return hold('default-branch-unread');
  const age = defaultBranchAgeMs(defaultBranch, now);
  if (age === null || age > config.checksWaitMs) return hold('default-branch-stale');
  const { settled } = defaultBranch;
  if (settled?.state === 'red') return hold('default-branch-red');
  if (settled === undefined || settled.state !== 'green') return hold('default-branch-unsettled');
  const mergedAt = newestMerged === null ? Number.NaN : Date.parse(newestMerged.mergedAt);
  const askedAt = Date.parse(defaultBranch.askedAt);
  if (settled.sha !== defaultBranch.headSha || (newestMerged !== null && !(mergedAt <= askedAt))) {
    return hold('merge-in-flight');
  }
  if (row.mergeable === 'CONFLICTING') return hold('conflicting');
  if (readings.mergerAppMissing === true) return hold('merger-app-missing');
  return { step: 'merge', head: row.headSha };
};

/** One open PR and the step {@link slicePrNext} answered for it. */
export interface PrStepAnswer {
  readonly pr: number;
  readonly step: SlicePrStep;
}

/**
 * Picks the one PR to merge in a pass.
 *
 * @param answers - each open PR's step.
 * @returns the lowest-numbered PR whose step is `merge` with its head, or `null` where none is.
 */
export const nextMerge = (answers: readonly PrStepAnswer[]): { pr: number; head: string } | null => {
  let pick: { pr: number; head: string } | null = null;
  for (const { pr, step } of answers) {
    if (step.step === 'merge' && (pick === null || pr < pick.pr)) pick = { pr, head: step.head };
  }
  return pick;
};

/**
 * The next step for one open PR.
 *
 * Calls the arms in a fixed order and returns the first answer that is not
 * `none`: guard, review run, re-status, fixer in flight, HIGH, CI red,
 * review, merge. An arm that writes or holds on the current head comes before
 * an arm that starts new work on it. A guard `none` ends the walk. With no
 * answer, the review arm's `none` is returned, because it names the reason.
 *
 * @param readings - everything read of the PR, as values.
 * @returns the step.
 */
export const slicePrNext = (readings: SlicePrNextReadings): SlicePrStep => {
  const guard = guardArm(readings);
  if (guard !== null) return guard;
  const arms = [reviewRunArm, restatusArm, fixerInFlightArm, highArm, ciRedArm, reviewArm, mergeArm];
  let review: SlicePrStep = none('no-arm-answered');
  for (const arm of arms) {
    const answer = arm(readings);
    if (arm === reviewArm) review = answer;
    if (!isNone(answer)) return answer;
  }
  return review;
};
