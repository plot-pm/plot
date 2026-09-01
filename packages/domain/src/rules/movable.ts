/**
 * Why a worktree may not be moved into the configured root.
 *
 * Each is a measurement rather than a judgement, which is what licenses the
 * move: `git worktree move` on a checkout an agent is writing to breaks it
 * mid-run, and an agent asked *is this idle?* can talk itself past any of them.
 *
 * The names are shared with {@link ../rules/reapable.js} where the measurement
 * is the same one — `live-worker`, `blocked-marker` and `uncommitted-changes`
 * ask the identical question of the identical tree. `unpushed-commits` is this
 * rule's own: a reap reads the host for a merged PR, while a move asks only
 * whether the branch's own upstream already holds every commit.
 */
export type MoveRefusal =
  | 'live-worker'
  | 'blocked-marker'
  | 'uncommitted-changes'
  | 'unpushed-commits';

/**
 * How far ahead of its upstream a branch is, or that the question has no answer.
 *
 * `unknown` is distinct from `0` and it does NOT refuse. A branch with no
 * upstream cannot be asked whether its commits were pushed, and an unanswered
 * question is not a refusal — the same lesson `plot_worker_task_state` reached
 * from the other side, where counting against the default branch marked every
 * clean branch stalled in a remote-less repo.
 *
 * This is the one place these rules differ from {@link reapProblems}, where an
 * unaskable host refuses. A reap DELETES a checkout whose work may exist
 * nowhere else; a move relocates one and loses nothing, so silence costs
 * differently on the two paths.
 */
export type AheadReading = number | 'unknown';

/** What a shared classifier said about the process in one tree. */
export type TreeActivity = 'running' | 'waiting' | 'other';

/**
 * What was measured of ONE legacy worktree, from the three sources that answer.
 *
 * Every field is a reading rather than a judgement. Who fetched them is the
 * caller's business, which keeps this rule pure and callable from a plain
 * function with no adapter in scope.
 */
export interface MoveReadings {
  /**
   * What the shared state classifier said about the tree.
   *
   * Carried as its word rather than as two booleans because the classifier
   * answers once and this rule reads two refusals out of that one answer.
   * `other` collapses every state that does not refuse — a move asks whether
   * someone is at the desk, not what their process exited with.
   */
  activity: TreeActivity;
  /**
   * The live process's pid, or `''` when the classifier named none.
   *
   * Carried rather than reduced away because the refusal quotes it: `worker
   * alive (pid 4242)` is what sends an operator to look.
   */
  activePid: string;
  /**
   * The first uncommitted path, or `''` when the tree is clean.
   *
   * The reading is the path and not a flag, for the same reason as the pid: the
   * refusal names it, and a boolean cannot be named.
   */
  dirtyPath: string;
  /** How many commits the branch holds that its upstream does not. */
  ahead: AheadReading;
}

/**
 * One refusal, and the reading it was taken from.
 *
 * `detail` carries the pid for `live-worker`, the offending path for
 * `uncommitted-changes`, and the count for `unpushed-commits`; it is empty for
 * `blocked-marker`, whose reading is the refusal itself.
 */
export interface MoveProblem {
  /** Which measurement refused. */
  refusal: MoveRefusal;
  /** The pid, the dirty path, the ahead count, or `''`. */
  detail: string;
}

/**
 * Every reason this worktree may not be moved, in the order they are tested.
 *
 * The order is the argument and not a formality, and it is the order the shell
 * tested them in before this rule existed. Liveness comes first because it is
 * the only signal describing someone acting right now. A blocked marker is
 * second: a person owes the tree an answer, and moving it breaks the checkout
 * the answer is owed to. Uncommitted work is third and unpushed commits fourth,
 * ordered by where the work exists — one place versus one machine.
 *
 * LIVENESS AND UNCOMMITTED WORK ARE ASKED SEPARATELY, and folding them is a
 * hole. The classifier is keyed on the records a dispatch writes, so a
 * hand-made worktree that never ran one reads `other` however dirty its tree
 * is — and hand-made worktrees are precisely the estate a migration exists to
 * tidy.
 *
 * @param readings What was measured of the tree.
 * @returns The refusals that apply, most urgent first; empty means movable.
 */
export const moveProblems = (readings: MoveReadings): MoveProblem[] => {
  const problems: MoveProblem[] = [];
  if (readings.activity === 'running') {
    problems.push({ refusal: 'live-worker', detail: readings.activePid });
  }
  if (readings.activity === 'waiting') {
    problems.push({ refusal: 'blocked-marker', detail: '' });
  }
  if (readings.dirtyPath !== '') {
    problems.push({ refusal: 'uncommitted-changes', detail: readings.dirtyPath });
  }
  if (typeof readings.ahead === 'number' && readings.ahead > 0) {
    problems.push({ refusal: 'unpushed-commits', detail: String(readings.ahead) });
  }
  return problems;
};

/**
 * Whether a worktree may be moved.
 *
 * @param readings What was measured of the tree.
 * @returns True when no refusal applies.
 */
export const isMovableTree = (readings: MoveReadings): boolean =>
  moveProblems(readings).length === 0;

/**
 * The one refusal a caller reporting a single reason per tree should show.
 *
 * @param readings What was measured of the tree.
 * @returns The most urgent refusal, or `null` when the tree is movable.
 */
export const firstMoveRefusal = (readings: MoveReadings): MoveProblem | null =>
  moveProblems(readings)[0] ?? null;
