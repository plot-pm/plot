import type { PrIndexRow } from '../entities/pr-index.js';
import type { RunLogLine } from '../ports/run-log.js';
import { reviewStartAllowed, type ReviewStart } from './review-run.js';
import type { ReviewRunReading } from './slice-pr-next.js';
import type { SprintScope } from './sprint-scope.js';

/** Where a release is, in the order it passes through. */
export type ReleaseStage =
  | 'waiting-scope'
  | 'preparing'
  | 'ready'
  | 'merged'
  | 'publishing'
  | 'released'
  | 'failed';

/** The release PR as the caller read it. `none` is the host's answer; the index never supplies it. */
export type ReleasePrReading = PrIndexRow | 'none' | 'unaskable';

/** The required workflow's runs on the release PR's head, as `runsForSha` answered. */
export type ReleaseChecksReading =
  | { read: 'runs'; runs: readonly { workflow: string; status: string; conclusion: string | null }[] }
  | { read: 'unaskable' };

/** One changeset the release head carries. `plan` is the plan file name without `.md`; `''` where it names none. */
export interface ReleaseChangeset {
  readonly file: string;
  readonly plan: string;
}

/** What happened after the merge, read from the tag and the publish run. */
export type ReleaseFinishReading = 'none' | 'publishing' | 'released' | 'failed' | 'unaskable';

/** The constants the rule reads. */
export interface ReleasePrepareConfig {
  /** The workflow whose success stands for the required checks (`Default branch checks`). */
  readonly requiredWorkflow: string;
  /** How long a `pending` review counts as in flight, in milliseconds. */
  readonly reviewBoundMs: number;
  /** The most review starts one head gets. */
  readonly startBudget: number;
}

/** Everything {@link releasePrepareNext} reads, as values. */
export interface ReleasePrepareReadings {
  readonly scope: SprintScope;
  /** Each scoped plan's phase, lowercase, keyed by slug; `unaskable` where the plans could not be read. */
  readonly phases: ReadonlyMap<string, string> | 'unaskable';
  readonly pr: ReleasePrReading;
  readonly checks: ReleaseChecksReading;
  /** The changesets on the head; `unaskable` where they could not be listed. */
  readonly changesets: readonly ReleaseChangeset[] | 'unaskable';
  /** The run log's lines; `unaskable` where it could not be read. */
  readonly log: readonly RunLogLine[] | 'unaskable';
  readonly reviewRun: ReviewRunReading | null;
  readonly reviewStarts: Pick<ReviewStart, 'head' | 'count' | 'lastAt'> | null;
  readonly finish: ReleaseFinishReading;
  readonly config: ReleasePrepareConfig;
  /** Epoch milliseconds of the tick. */
  readonly now: number;
}

/** The changesets of a head, split by whether the sprint's scope owns them. */
export interface ReleaseChangesetGroups {
  readonly scope: readonly string[];
  readonly outside: readonly string[];
}

/** The one step fleetd takes on the release PR. */
export type ReleasePrepareStep =
  | { step: 'none'; why: string }
  | { step: 'hold'; reason: 'waiting-scope' | 'unaskable' }
  | { step: 'review'; head: string }
  | { step: 'notify'; head: string; first: boolean; changesets: ReleaseChangesetGroups };

const none = (why: string): ReleasePrepareStep => ({ step: 'none', why });

/** The run-log step naming a review start on the release head. */
export const RELEASE_REVIEW_STEP = 'release-review' as const;

/** The run-log step naming a notification about the release head. */
export const RELEASE_NOTIFIED_STEP = 'release-notified' as const;

/**
 * Splits a head's changesets into the sprint's scope plans and outside work.
 *
 * @param changesets - the changesets on the head.
 * @param slugs - the scope's plan slugs.
 * @returns the sorted file names of each group; a changeset naming no plan is outside work.
 */
export const groupChangesets = (
  changesets: readonly ReleaseChangeset[],
  slugs: readonly string[],
): ReleaseChangesetGroups => {
  const inScope = (plan: string): boolean => slugs.some((slug) => plan === slug || plan.endsWith(`-${slug}`));
  const files = (keep: (c: ReleaseChangeset) => boolean): string[] =>
    changesets.filter(keep).map((c) => c.file).sort();
  return { scope: files((c) => c.plan !== '' && inScope(c.plan)), outside: files((c) => c.plan === '' || !inScope(c.plan)) };
};

/**
 * The run-log outcome for a notification: the send status, then the head's changeset files.
 *
 * @param status - `sent`, `unaskable` or `failed <code>`.
 * @param files - every changeset file on the head.
 * @returns `<status>: <file>,<file>`.
 */
export const encodeNotifyOutcome = (status: string, files: readonly string[]): string =>
  `${status}: ${[...files].sort().join(',')}`;

/**
 * The changeset list on the newest notification line for a release branch.
 *
 * A line whose status is `failed …` counts as no notification, so the next
 * pass sends again. `sent` and `unaskable` both count: a repository with no
 * `Notify command` has chosen the board as its notice and is not asked again.
 *
 * @param log - the run log's lines, oldest first.
 * @param branch - the release branch.
 * @returns the file names, or `null` where no counted notification exists.
 */
export const lastNotifiedChangesets = (log: readonly RunLogLine[], branch: string): readonly string[] | null => {
  for (let i = log.length - 1; i >= 0; i--) {
    const line = log[i]!;
    if (line.step !== RELEASE_NOTIFIED_STEP || line.branch !== branch) continue;
    const at = line.outcome.indexOf(': ');
    const status = at < 0 ? line.outcome : line.outcome.slice(0, at);
    if (status !== 'sent' && status !== 'unaskable') continue;
    const list = at < 0 ? '' : line.outcome.slice(at + 2);
    return list === '' ? [] : list.split(',');
  }
  return null;
};

/**
 * Whether the required workflow passed on the head.
 *
 * @param checks - the head's runs.
 * @param workflow - the required workflow's name.
 * @returns `green` where a run of it succeeded, `pending` where one is still going, `unknown` where the read failed, else `not-green`.
 */
const requiredChecks = (
  checks: ReleaseChecksReading,
  workflow: string,
): 'green' | 'pending' | 'not-green' | 'unknown' => {
  if (checks.read === 'unaskable') return 'unknown';
  const runs = checks.runs.filter((run) => run.workflow === workflow);
  if (runs.some((run) => run.conclusion === 'success')) return 'green';
  return runs.some((run) => run.conclusion === null) ? 'pending' : 'not-green';
};

/**
 * Whether the head's `plot/review` is a pass on the head, which `releaseApprove` requires.
 *
 * `plotReviewSha` pairs with `plotReview` and is read only beside it; a pass
 * naming another commit is not a pass on this head.
 *
 * @param row - the release PR's row.
 * @returns `true` where the review passed on the row's head.
 */
const reviewPassed = (row: PrIndexRow): boolean =>
  row.plotReview === 'success' && row.headSha !== undefined && row.plotReviewSha === row.headSha;

/**
 * Where the release is.
 *
 * Reads the finish first, then the PR's merge state, then the scope's phases,
 * and last whether the head can be approved now. A reading that failed answers
 * `waiting-scope` or `preparing`, never `ready`.
 *
 * @param readings - everything read of the release.
 * @returns the stage the board shows and the approval button follows.
 */
export const releaseStage = (readings: ReleasePrepareReadings): ReleaseStage => {
  if (readings.finish === 'failed') return 'failed';
  if (readings.finish === 'released') return 'released';
  if (readings.finish === 'publishing') return 'publishing';
  const { pr, scope, phases } = readings;
  if (pr !== 'none' && pr !== 'unaskable' && pr.state === 'MERGED') return 'merged';
  if (scope.read === 'none' || phases === 'unaskable') return 'waiting-scope';
  if (!scope.slugs.every((slug) => phases.get(slug) === 'delivered')) return 'waiting-scope';
  if (pr === 'none' || pr === 'unaskable' || pr.state !== 'OPEN' || pr.headSha === undefined) return 'preparing';
  const green = requiredChecks(readings.checks, readings.config.requiredWorkflow) === 'green';
  return green && reviewPassed(pr) ? 'ready' : 'preparing';
};

/**
 * The next step on the release PR.
 *
 * A second rule beside `slicePrNext`, for exactly one PR. It holds while the
 * scope is unread, empty or not wholly Delivered; starts a review for a head
 * whose required checks passed and whose `plot/review` is not a pass on it;
 * and notifies once the head can be approved, on the first head and after
 * that only where the head's changeset list differs from the last
 * notification's. Outside work is listed and never holds the release.
 *
 * Every failed reading holds. The index never says there is no release PR:
 * `none` is the caller's host answer, and an absent index row is the caller's
 * to turn into a host question.
 *
 * @param readings - everything read of the release, as values.
 * @returns the step.
 */
export const releasePrepareNext = (readings: ReleasePrepareReadings): ReleasePrepareStep => {
  const stage = releaseStage(readings);
  if (stage === 'merged' || stage === 'publishing' || stage === 'released' || stage === 'failed') return none(stage);
  if (stage === 'waiting-scope') {
    const unread = readings.scope.read === 'scope' && readings.phases === 'unaskable';
    return { step: 'hold', reason: unread ? 'unaskable' : 'waiting-scope' };
  }
  const { pr, scope, config, now } = readings;
  if (pr === 'unaskable' || readings.changesets === 'unaskable' || readings.log === 'unaskable') {
    return { step: 'hold', reason: 'unaskable' };
  }
  if (pr === 'none') return none('no-release-pr');
  if (scope.read !== 'scope' || pr.headSha === undefined) return { step: 'hold', reason: 'unaskable' };
  const head = pr.headSha;

  if (stage === 'preparing') {
    const checks = requiredChecks(readings.checks, config.requiredWorkflow);
    if (checks === 'unknown') return { step: 'hold', reason: 'unaskable' };
    if (checks !== 'green') return none(`checks-${checks}`);
    if (pr.plotReview === undefined) return none('not-asked');
    if (readings.reviewRun !== null && readings.reviewRun.live && readings.reviewRun.head === head) {
      return none('review-in-flight');
    }
    const startedAt = pr.plotReviewAt === undefined ? Number.NaN : Date.parse(pr.plotReviewAt);
    const onHead = pr.plotReviewSha === head;
    const stalePending = pr.plotReview === 'pending' && onHead && now - startedAt > config.reviewBoundMs;
    const needs = pr.plotReview === 'absent' || pr.plotReview === 'error' || !onHead || stalePending;
    if (!needs) return none('review-pending');
    const allowed = reviewStartAllowed(readings.reviewStarts, head, config.startBudget, now);
    return allowed === 'ok' ? { step: 'review', head } : none(allowed);
  }

  const groups = groupChangesets(readings.changesets, scope.slugs);
  const files = [...groups.scope, ...groups.outside].sort();
  const last = lastNotifiedChangesets(readings.log, pr.head);
  if (last === null) return { step: 'notify', head, first: true, changesets: groups };
  const same = last.length === files.length && last.every((file, i) => file === files[i]);
  return same ? none('notified') : { step: 'notify', head, first: false, changesets: groups };
};
