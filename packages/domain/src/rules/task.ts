/**
 * What a worker whose process has already exited left behind.
 *
 * Three words, and they answer a different question from the process states
 * beside them in {@link ../entities/agent.js}. Every worker exits 0 — the one
 * that opened its PR, the one that stopped because it would not claim a test
 * run it had not seen, and the one that stopped to ask which retry semantics
 * were wanted — so the exit code cannot say whether the work is done.
 *
 * - `finished` — nothing is left behind. Review it.
 * - `waiting` — a person owes this branch an answer.
 * - `stalled` — work exists only on this machine, and no PR shows it.
 */
export type TaskState = 'finished' | 'waiting' | 'stalled';

/**
 * Whether the branch holds commits its upstream does not, or that the question
 * has no answer.
 *
 * `null` IS NOT `false`, and the difference is the whole reading. Only
 * `@{upstream}` separates pushed work from unpushed work, and a branch with no
 * upstream cannot be asked. A fallback that counted against the default branch
 * instead reported EVERY clean branch `stalled` in a repo with no remote,
 * because `rev-list --count '..HEAD'` with an empty left side counts the whole
 * history from the root commit — nine commits of ordinary history read as nine
 * commits of unpushed work. The fallback was wrong where it worked, too: a
 * branch ahead of the trunk is the normal state of every branch under review.
 *
 * So an unanswerable question yields no verdict, the same direction
 * {@link ../rules/movable.js} takes for its own `unknown`.
 */
export type UnpushedReading = boolean | null;

/**
 * What was measured of one worktree whose worker has exited.
 *
 * Every field is a reading. The rule performs no I/O and consults no host — who
 * gathered these is the caller's business, which is what keeps the decision
 * testable over all four booleans instead of over a real checkout.
 */
export interface TaskReadings {
  /**
   * Whether the host holds an open or merged PR for the branch.
   *
   * TAKEN AS A VALUE, never fetched here. The scan caches one host reply per
   * branch per run behind its `--offline` gate; `plot-dispatch.sh --status`
   * reads worktrees off disk and asks the host on its own terms. A caller that
   * cannot know says `false`, and the tree then answers — the fact is never
   * upgraded to `finished` by a guess.
   */
  hasPr: boolean;
  /** Whether a `PLOT-BLOCKED*` marker file stands in the worktree. */
  blocked: boolean;
  /** Whether the worktree holds uncommitted work, editor leftovers excluded. */
  dirty: boolean;
  /** Whether the branch holds unpushed commits, or `null` when unaskable. */
  unpushed: UnpushedReading;
}

/**
 * What the worker left behind.
 *
 * THE ORDER IS LOAD-BEARING, and each step earns its place from a measured
 * mistake rather than from tidiness:
 *
 * 1. **An open or merged PR outranks everything below it.** Work that reached
 *    review has left the worker's hands, so leftover local edits mean nothing
 *    there — a scratch file beside a merged PR is not unfinished work.
 * 2. **`waiting` outranks `stalled`**, because a marker is the worker saying
 *    *your turn*, and a worker asking a question has almost always left the
 *    work it was doing uncommitted beside the question. Checking dirtiness
 *    first would report every such branch `stalled`. Measured: a guard
 *    restarted one branch TWICE while its worker waited on an answer, and the
 *    second restart re-ran work the first had finished. That is a loop, not a
 *    rescue.
 * 3. **Uncommitted OR unpushed.** Committing clears dirtiness, so a worker that
 *    tidied up and stopped before pushing would otherwise read `finished` with
 *    nobody able to see its commits. Both are "work only this machine holds".
 *
 * An unanswerable `unpushed` falls through to `finished`, which is the answer
 * the branch gave before this state existed. A failure to observe is not
 * evidence of something to see.
 *
 * @param readings - what was measured of the worktree.
 * @returns the task state.
 */
export const taskState = (readings: TaskReadings): TaskState => {
  if (readings.hasPr) return 'finished';
  if (readings.blocked) return 'waiting';
  if (readings.dirty) return 'stalled';
  if (readings.unpushed === true) return 'stalled';
  return 'finished';
};
