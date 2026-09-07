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

/**
 * Why a branch's remote ref may not be deleted.
 *
 * A different question from {@link ReapRefusal}, which is about a checkout.
 * The two overlap in what they measure and never in what they cost — see
 * {@link refDeletionProblems}.
 */
export type RefRefusal =
  | 'given-up'
  | 'no-merged-pr'
  | 'open-pr'
  | 'checked-out'
  | 'on-default-branch'
  | 'live-worker'
  | 'uncommitted-changes'
  | 'blocked-marker';

/**
 * What was measured of ONE branch before deleting its ref.
 *
 * Extends {@link TreeReadings} rather than restating it: every reading the
 * reaper takes is a reading this question can use, and the fields below are
 * the ones only this question needs. A caller with no checkout to measure
 * passes the tree readings empty — see {@link refDeletionProblems}.
 */
export interface RefReadings extends TreeReadings {
  /**
   * Whether the plan recorded the branch as `deferred:` or `moved:`.
   *
   * Given up, not finished. `/plot-reconcile` reads that annotation to tell
   * deliberate abandonment from a dead worker, and it needs the ref to be
   * there to read it against.
   */
  givenUp: boolean;
  /**
   * Whether the host reports an OPEN PR on the branch, whatever else merged.
   *
   * Not the negation of {@link TreeReadings.merge}: a branch can carry both.
   * `changeset-release/main` is merged repeatedly and Changesets recreates and
   * reuses it, so its ref holds a live release PR while an older PR of its own
   * has merged.
   */
  openPr: boolean;
  /** Whether any worktree on this machine has the branch checked out. */
  checkedOut: boolean;
}

/**
 * One refusal to delete a ref, and the reading it was taken from.
 */
export interface RefProblem {
  /** Which measurement refused. */
  refusal: RefRefusal;
  /** The pid, the dirty path, or `''` where the refusal names no value. */
  detail: string;
}

/**
 * Every reason this branch's remote ref may not be deleted.
 *
 * ONE RULE, TWO CALLERS, AND THE SECOND CALLER IS WHY IT EXISTS. The reaper's
 * five refusals and the ref-deleter's five guards are the same question asked
 * about the same thing in two places, and on 2026-09-06 they already disagreed:
 * the ref-deleter never asked whether a worker was alive, and the reaper never
 * asked whether a PR was open. Each was blind to a guard the other applied.
 * Deleting a ref out from under a running worker is the failure that cannot be
 * repaired, so the readings compose rather than each script keeping its own.
 *
 * THE ASYMMETRY IS PRESERVED AND IS NOT THIS RULE'S TO FLATTEN. A reaped
 * checkout comes back with `git worktree add`; a deleted ref does not. That is
 * why the reaper is slug-blind and the ref-deleter is scoped to one plan — a
 * sweep over every merged ref on the estate would satisfy *"a delivered plan's
 * merged branches lose their refs"* and destroy unlanded work belonging to
 * plans nobody delivered. **The shared rule answers the question; each caller
 * keeps its own scope.** Nothing here reads a plan or enumerates a branch.
 *
 * The order is the order the tests run, and it is the argument. `given-up` is
 * first because it is a decision a person already recorded and no merge state
 * overturns it — checked before the host is even asked. The merge gate follows,
 * because unlanded work keeps its ref always. The rest describe someone acting
 * now: an open PR, a checkout somebody is reading, a live worker.
 *
 * @param readings What was measured of the branch and of any tree holding it.
 * @returns The refusals that apply, most urgent first; empty means deletable.
 */
export const refDeletionProblems = (readings: RefReadings): RefProblem[] => {
  const problems: RefProblem[] = [];
  if (readings.givenUp) {
    problems.push({ refusal: 'given-up', detail: '' });
  }
  if (readings.merge !== 'merged') {
    problems.push({ refusal: 'no-merged-pr', detail: '' });
  }
  if (readings.openPr) {
    problems.push({ refusal: 'open-pr', detail: '' });
  }
  if (readings.checkedOut) {
    problems.push({ refusal: 'checked-out', detail: '' });
  }
  if (readings.branch === readings.defaultBranch) {
    problems.push({ refusal: 'on-default-branch', detail: readings.defaultBranch });
  }
  // THE THREE THE REF-DELETER NEVER ASKED. Each describes somebody acting in a
  // checkout right now, and a ref deleted under them is not recoverable. They
  // are last because a caller with no tree to measure passes them empty, and a
  // refusal that never fires must not displace one that does.
  if (readings.workerPid !== null && readings.workerPid !== '') {
    problems.push({ refusal: 'live-worker', detail: readings.workerPid });
  }
  if (readings.dirtyPath !== '') {
    problems.push({ refusal: 'uncommitted-changes', detail: readings.dirtyPath });
  }
  if (readings.blockedMarker) {
    problems.push({ refusal: 'blocked-marker', detail: '' });
  }
  return problems;
};

/**
 * The one refusal a caller reporting a single reason per branch should show.
 *
 * @param readings What was measured of the branch.
 * @returns The most urgent refusal, or `null` when the ref may be deleted.
 */
export const firstRefRefusal = (readings: RefReadings): RefProblem | null =>
  refDeletionProblems(readings)[0] ?? null;

/**
 * One condition's answer: it holds, it does not, or it could not be asked.
 *
 * `unknown` is a reading and not an error. Measured 2026-09-06: **22 of 32
 * remote branches have no worktree, 69%** — and four of the reaper's five
 * conditions need that tree, leaving only the merge state answerable without
 * one. A boolean would invent an answer on two branches in three, for the
 * operation no `git worktree add` can undo.
 */
export type ConditionReading = 'true' | 'false' | 'unknown';

/**
 * Which conditions a tree can answer at all.
 *
 * `present` means a worktree was found and read. `absent` means none exists, so
 * the four tree-sourced conditions answer `unknown` — the distinction is the
 * reading, and *nothing was there* is not *nothing was looked at*.
 *
 * `vanished` is git's own answer that a listed worktree's directory is gone —
 * the `prunable` field of `git worktree list --porcelain`. It reads like
 * `absent` to every condition, because there is equally nothing to measure, and
 * it is a SEPARATE word because the two say different things to an operator:
 * `absent` means no desk was ever made, `vanished` means git still lists one
 * that is not there. Measured 2026-09-06: 3 of 20 worktrees on this estate were
 * prunable, and the reaper's five refusals could see none of them, since every
 * one measures something *in* a tree that is not there.
 */
export type TreePresence = 'present' | 'absent' | 'vanished';

/**
 * Whether a tree can be measured at all.
 *
 * The PRIOR question the four tree-sourced conditions depend on. A caller asks
 * it before reading a refusal, because *nothing to remove* and *do not remove
 * this* are different sentences and an operator acts on them differently.
 *
 * @param tree Whether a worktree was found, and in what state.
 * @returns True when there is a directory to take a reading from.
 */
export const treeIsThere = (tree: TreePresence): boolean => tree === 'present';

/**
 * Whether git lists a worktree whose directory is gone.
 *
 * NOT A REFUSAL. The five refusals say *do not remove this*; this says *there
 * is nothing to remove and the entry is stale*. A refusal sends an operator to
 * go and look; this tells them `git worktree prune` will tidy it.
 *
 * @param tree Whether a worktree was found, and in what state.
 * @returns True when the entry is stale and `git worktree prune` is the repair.
 */
export const treeHasVanished = (tree: TreePresence): boolean => tree === 'vanished';

/**
 * What was measured of ONE desk, for the question both verbs ask of it.
 *
 * Extends {@link RefReadings} rather than restating it, and adds the one thing
 * neither previous shape recorded: whether there was a tree to read. Without
 * that field an empty `dirtyPath` means both *clean* and *unmeasured*, and the
 * two callers need to tell them apart — the reaper because an unmeasured tree
 * is nothing to reap, the ref-deleter because it is no evidence against
 * deletion.
 *
 * Named for the rule rather than for the desk: `DeskReadings` is the
 * supervisor's, in `rules/gates.ts`, and answers what an agent owes. This
 * answers what still holds a checkout or a ref, and one name over both would
 * make the two questions look like one.
 */
export interface FinishedWithReadings extends RefReadings {
  /**
   * Whether a worktree was found for the branch, and in what state.
   *
   * `vanished` arrives from git's `prunable`, carried by the trees port rather
   * than measured again here — the adapter reaches the world and the domain
   * takes readings as values.
   */
  tree: TreePresence;
}

/**
 * Every condition that can hold a desk, each answered `true`, `false` or
 * `unknown`.
 *
 * The names are the conditions rather than the refusals: this states what is
 * the case, and each caller decides which answers refuse it.
 */
export interface FinishedWith {
  /** The plan recorded the branch as `deferred:` or `moved:`. */
  givenUp: ConditionReading;
  /** No PR for the branch merged, or the host could not be asked. */
  noMergedPr: ConditionReading;
  /** The host reports an OPEN PR on the branch, whatever else merged. */
  openPr: ConditionReading;
  /** Some worktree on this machine has the branch checked out. */
  checkedOut: ConditionReading;
  /** The branch is the repository's default branch. */
  onDefaultBranch: ConditionReading;
  /** A worker process is alive in the desk. */
  liveWorker: ConditionReading;
  /** The desk holds uncommitted changes. */
  uncommittedChanges: ConditionReading;
  /** The desk carries a `PLOT-BLOCKED*` marker. */
  blockedMarker: ConditionReading;
  /**
   * Git lists a worktree for this desk whose directory is gone.
   *
   * NOT ONE OF THE CONDITIONS ABOVE, and deliberately last. Each of those says
   * something holds the desk; this says there is no desk to hold. It is the
   * prior question the four tree-sourced conditions depend on, which is why a
   * `true` here comes with `unknown` on every one of them.
   */
  vanished: ConditionReading;
}

/**
 * Every condition both verbs apply to a desk, stated once.
 *
 * ONE RULE, AND THE CALLERS STAY DIFFERENT. `plot-reap.sh` removes a checkout
 * and `plot-release-refs.sh` deletes a remote ref; a removed checkout comes
 * back with `git worktree add` and a deleted ref does not. So the two verbs
 * read one answer and each keeps its own licence and its own scope — the reaper
 * slug-blind, the ref-deleter bounded by one plan file. This states the
 * conditions; it permits nothing and enumerates nothing.
 *
 * WHERE THE TWO LEGITIMATELY DIFFER, THIS NAMES IT RATHER THAN OMITTING IT. An
 * open PR keeps a ref and says nothing about a checkout — `changeset-release/
 * main` is merged repeatedly and Changesets reuses the branch, so a live
 * release PR sits on a ref whose own older PR merged. A live worker pid keeps a
 * checkout and says nothing about a ref. Until this rule existed each of those
 * was an ABSENCE in one of two shell scripts, visible only by reading both.
 *
 * `unknown` IS AN ANSWER. The four tree-sourced conditions cannot be asked of a
 * branch with no worktree, which is 69% of this estate. They answer `unknown`
 * rather than `false`, and the caller decides what that is worth: the reaper
 * has nothing to reap, the ref-deleter has no evidence against deletion. This
 * refuses on none of them — refusing on silence is the estate's rule for an
 * unreachable HOST, and applying it here would disable the ref-deleter on the
 * majority of the estate.
 *
 * @param readings What was measured of the desk.
 * @returns One answer per condition; nothing is judged.
 */
export const finishedWith = (readings: FinishedWithReadings): FinishedWith => {
  // The four the tree answers. With no tree they are unasked, not false — and a
  // VANISHED tree is unaskable for the same reason an absent one is, since the
  // directory the reading would come from is not there either way.
  const ofTree = (held: boolean): ConditionReading =>
    treeIsThere(readings.tree) ? (held ? 'true' : 'false') : 'unknown';

  return {
    givenUp: readings.givenUp ? 'true' : 'false',
    // `unreachable` and `not-merged` agree here for the reason they agree in
    // `reapProblems`: the question is whether work landed, and a host that
    // could not be asked has not said it did. That is a HOST reading, not a
    // tree one — it stays two-valued because the caller's answer is the same
    // either way, and both callers already refuse on it.
    noMergedPr: readings.merge === 'merged' ? 'false' : 'true',
    openPr: readings.openPr ? 'true' : 'false',
    // Whether a branch is checked out is answered by walking every worktree, so
    // the absence of THIS desk's tree is itself the answer: nothing holds it.
    checkedOut: readings.checkedOut ? 'true' : 'false',
    onDefaultBranch:
      readings.isMain || readings.branch === readings.defaultBranch ? 'true' : 'false',
    liveWorker: ofTree(readings.workerPid !== null && readings.workerPid !== ''),
    uncommittedChanges: ofTree(readings.dirtyPath !== ''),
    blockedMarker: ofTree(readings.blockedMarker),
    // A REPORT, not a refusal, and the one condition a vanished tree can still
    // answer: git said so, and git needed no directory to say it.
    vanished: treeHasVanished(readings.tree) ? 'true' : 'false',
  };
};
