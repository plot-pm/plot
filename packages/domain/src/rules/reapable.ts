import type { ReapRefusal } from '../entities/worktree.js';

/**
 * What the host was able to say about whether a branch's work landed.
 *
 * `unreachable` is distinct from `not-merged` because the readings differ even
 * though the verdict does not: the first means the question could not be put,
 * the second means it was answered no. Both refuse — silence is never
 * permission — and keeping them apart is what lets an unaskable host be
 * triggered against a fixture rather than only inferred.
 */
export type MergeReading = 'merged' | 'not-merged' | 'unreachable';

/**
 * What was measured of ONE worktree, from the four sources that can answer.
 *
 * Named for the tree rather than for the reap because `workflows/reap.ts`
 * already calls the whole estate's readings `ReapReadings`. The two are
 * different nouns — one tree against every tree — and the narrower one takes
 * the narrower name.
 *
 * Every field is a reading rather than a judgement. Who fetched them is the
 * caller's business, which is what keeps this rule pure and callable from a
 * plain function with no adapter in scope.
 */
export interface TreeReadings {
  /** The branch checked out, or `''` when the head is detached. */
  branch: string;
  /** The repository's default branch, as the host or the fallback named it. */
  defaultBranch: string;
  /** Whether this tree is the main checkout. */
  isMain: boolean;
  /**
   * The live worker's pid, or `null` when no process is running in the tree.
   *
   * Carried rather than reduced to a boolean because the refusal names it:
   * `worker alive (pid 4242)` is what an operator needs to go and look.
   */
  workerPid: string | null;
  /**
   * The first uncommitted path, or `''` when the tree is clean.
   *
   * The reading is the path and not a flag, for the same reason as the pid: the
   * refusal quotes it, and a boolean cannot be quoted.
   */
  dirtyPath: string;
  /** Whether the tree carries a `PLOT-BLOCKED*` marker. */
  blockedMarker: boolean;
  /** What the host said about any PR for this branch. */
  merge: MergeReading;
}

/**
 * One refusal, and the reading it was taken from.
 *
 * `detail` is empty for the refusals whose reading is the refusal itself; it
 * carries the pid for `live-worker` and the offending path for
 * `uncommitted-changes`.
 */
export interface ReapProblem {
  /** Which measurement refused. */
  refusal: ReapRefusal;
  /** The pid, the dirty path, or `''` where the refusal names no value. */
  detail: string;
}

/**
 * Every reason this worktree may not be reaped, in the order they are tested.
 *
 * The order is the argument and not a formality. A live worker is first because
 * it is the only signal describing someone acting right now; a caller reporting
 * one reason per tree takes the first and gets the most urgent. The remaining
 * order matches what the tree can lose: uncommitted work exists in exactly one
 * place, a marker holds a question for a person, a tree on the default branch
 * never had its dispatched branch checked out and so was never measured, and a
 * branch the host did not merge is unlanded.
 *
 * Merge state is read from whether a PR merged — never from the PR's state, a
 * merged PR reports `CLOSED`, and never from ancestry, which a squash-merge
 * leaves permanently ahead of the default branch. A host that could not be
 * asked refuses exactly as an unmerged branch does.
 *
 * @param readings What was measured of the tree.
 * @returns The refusals that apply, most urgent first; empty means reapable.
 */
export const reapProblems = (readings: TreeReadings): ReapProblem[] => {
  const problems: ReapProblem[] = [];
  if (readings.workerPid !== null && readings.workerPid !== '') {
    problems.push({ refusal: 'live-worker', detail: readings.workerPid });
  }
  if (readings.blockedMarker) {
    problems.push({ refusal: 'blocked-marker', detail: '' });
  }
  if (readings.dirtyPath !== '') {
    problems.push({ refusal: 'uncommitted-changes', detail: readings.dirtyPath });
  }
  if (readings.isMain || readings.branch === readings.defaultBranch) {
    problems.push({ refusal: 'on-default-branch', detail: readings.defaultBranch });
  }
  if (readings.merge !== 'merged') {
    problems.push({ refusal: 'no-merged-pr', detail: '' });
  }
  return problems;
};

/**
 * Whether a worktree may be removed.
 *
 * @param readings What was measured of the tree.
 * @returns True when no refusal applies.
 */
export const isReapableTree = (readings: TreeReadings): boolean =>
  reapProblems(readings).length === 0;

/**
 * The one refusal a caller reporting a single reason per tree should show.
 *
 * @param readings What was measured of the tree.
 * @returns The most urgent refusal, or `null` when the tree is reapable.
 */
export const firstReapRefusal = (readings: TreeReadings): ReapProblem | null =>
  reapProblems(readings)[0] ?? null;
