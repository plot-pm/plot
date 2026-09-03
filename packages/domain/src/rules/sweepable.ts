/**
 * What kind of leftover a finding is about.
 *
 * The sweep asks ONE question of every kind — *is anything here that nobody is
 * coming back for?* — and does not care what left it. A dead agent, an
 * interrupted dispatch, a `--stop` and a merge somebody did on the host all
 * produce the same populations, so the cause is not a field.
 *
 * `worktree` is not here. `reapable.ts` owns that kind and stays untouched:
 * a backstop that guesses is worse than none, and its five refusals were
 * written for exactly the population it sweeps.
 */
export type LeftoverKind = 'local-branch' | 'claim-ref' | 'dirty-tree';

/**
 * What was measured of one local branch.
 *
 * Two readings decide it, and both are measurements. The host's merge answer
 * is not git's: **`git branch -d` is not the gate.** It refuses an unmerged
 * branch, which sounds like the safety this needs — except a squash-merge
 * leaves a branch permanently ahead of the default branch, so `-d` refuses a
 * landed branch for the wrong reason. Measured 2026-09-02 on this estate: 85
 * of 98 local branches were already merged and `-d` would have kept all 85.
 */
export interface LocalBranchReadings {
  /** The branch's name. */
  branch: string;
  /** The repository's default branch. */
  defaultBranch: string;
  /**
   * Whether the host merged ANY PR for this branch.
   *
   * Read from the merge timestamp and never from the PR's state — a merged PR
   * reports `CLOSED` — and never from ancestry, which a squash-merge leaves
   * permanently ahead. An unreachable host answers false, so silence is never
   * permission.
   */
  hasMergedPr: boolean;
  /** Whether any worktree on this machine holds the branch. */
  checkedOut: boolean;
}

/**
 * Why a local branch may not be deleted.
 *
 * `checked-out` is not a milder form of `no-merged-pr`: deleting a branch out
 * from under a checkout is exactly what the reaper's guards exist to prevent,
 * and it refuses on its own even where the host says merged.
 *
 * `Sweep` is in the name because `workflows/dispatch.ts` already owns
 * `BranchRefusal`, and the two answer opposite questions about one noun: that
 * one says why a branch cannot be STARTED, this one says why it cannot be
 * DELETED. Collapsing them would let a dispatch reason reach a deletion.
 */
export type BranchSweepRefusal = 'default-branch' | 'no-merged-pr' | 'checked-out';

/**
 * Every reason this local branch stays, in the order they are tested.
 *
 * The default branch is first because acting on it is unrecoverable and no
 * other reading overturns it. The merge gate is second because it is the one
 * that says whether the work exists anywhere else. Being checked out is last
 * and refuses on its own.
 *
 * @param readings - what was measured of the branch.
 * @returns the refusals that apply, most urgent first; empty means sweepable.
 */
export const branchSweepProblems = (readings: LocalBranchReadings): BranchSweepRefusal[] => {
  const problems: BranchSweepRefusal[] = [];
  if (readings.branch === readings.defaultBranch) {
    problems.push('default-branch');
  }
  if (!readings.hasMergedPr) {
    problems.push('no-merged-pr');
  }
  if (readings.checkedOut) {
    problems.push('checked-out');
  }
  return problems;
};

/**
 * Whether a local branch may be deleted.
 *
 * The gate the plan states: **the host says merged, AND no worktree holds it.**
 *
 * @param readings - what was measured of the branch.
 * @returns true when no refusal applies.
 */
export const isSweepableBranch = (readings: LocalBranchReadings): boolean =>
  branchSweepProblems(readings).length === 0;

/**
 * The one refusal a caller reporting a single reason per branch should show.
 *
 * @param readings - what was measured of the branch.
 * @returns the most urgent refusal, or `null` when the branch is sweepable.
 */
export const firstBranchRefusal = (readings: LocalBranchReadings): BranchSweepRefusal | null =>
  branchSweepProblems(readings)[0] ?? null;

/**
 * How the reconcile scan classified an orphaned claim.
 *
 * Git cannot answer this: an abandoned claim and a dead worker leave the
 * identical empty branch. `plot-reconcile-scan.sh` section 3 reads the plan
 * annotation, which is the only signal, and this rule takes that classification
 * as a reading rather than re-deriving it — a second implementation of *how did
 * this claim end* is the drift that deletes real work.
 *
 * `abandoned` is a `deferred:`/`moved:` annotation: a person already recorded
 * the decision. `unresolved` is a bare `claimed:`, which needs judgment.
 */
export type ClaimDisposition = 'abandoned' | 'unresolved';

/** What was measured of one orphaned claim ref. */
export interface ClaimRefReadings {
  /** The branch the claim holds. */
  branch: string;
  /**
   * Whether the branch carries ONLY empty claim commits.
   *
   * A claim marker is titled `plot: claim ...` **and** empty — its tree equals
   * its parent's. The subject alone is not evidence: a human commit titled
   * *"plot: claim handling refactor"* carrying real files would otherwise read
   * as an empty claim, and the sweep would offer to delete real work.
   */
  isEmptyClaim: boolean;
  /** How the plan annotation classified it. */
  disposition: ClaimDisposition;
}

/** Why an orphaned claim ref stays. */
export type ClaimSweepRefusal = 'not-an-empty-claim' | 'needs-judgment';

/**
 * Every reason this claim ref stays.
 *
 * **Only what the scan already calls reapable is swept.** A bare `claimed:`
 * leaves a person's judgment intact and keeps being reported — a slow worker
 * and a dead one look identical, and one of them is doing real work.
 *
 * @param readings - what was measured of the claim.
 * @returns the refusals that apply, most urgent first; empty means sweepable.
 */
export const claimSweepProblems = (readings: ClaimRefReadings): ClaimSweepRefusal[] => {
  const problems: ClaimSweepRefusal[] = [];
  if (!readings.isEmptyClaim) {
    problems.push('not-an-empty-claim');
  }
  if (readings.disposition !== 'abandoned') {
    problems.push('needs-judgment');
  }
  return problems;
};

/**
 * Whether an orphaned claim ref may be deleted.
 *
 * @param readings - what was measured of the claim.
 * @returns true when no refusal applies.
 */
export const isSweepableClaim = (readings: ClaimRefReadings): boolean =>
  claimSweepProblems(readings).length === 0;

/**
 * The one refusal a caller reporting a single reason per claim should show.
 *
 * @param readings - what was measured of the claim.
 * @returns the most urgent refusal, or `null` when the claim is sweepable.
 */
export const firstClaimRefusal = (readings: ClaimRefReadings): ClaimSweepRefusal | null =>
  claimSweepProblems(readings)[0] ?? null;

/** What was measured of one dirty tree. */
export interface DirtyTreeReadings {
  /** The worktree's path. */
  path: string;
  /** The branch it holds, or `''` when detached. */
  branch: string;
  /** How many uncommitted paths it carries. */
  dirtyCount: number;
  /** The live worker's pid, or `null` when no process runs in it. */
  workerPid: string | null;
  /** The registry manifest naming it, or `''` when none does. */
  manifest: string;
}

/**
 * A dirty tree named as a leftover, with whoever owns it.
 *
 * **Reported, never deleted.** `uncommitted-changes` is a refusal for the same
 * reason the create-or-reset guard does not `reset --hard`: the case where the
 * guard is wrong is exactly the case where destruction cannot be undone. A
 * guard that misjudges should leave a desk the sweep reports, not deleted work.
 * So this kind has no `--yes` path at all, and that is the whole point of
 * naming it: the population was refused and never resolved, so nobody saw it.
 */
export interface DirtyTreeFinding {
  /** The worktree's path. */
  path: string;
  /** The branch it holds. */
  branch: string;
  /** How many uncommitted paths it carries. */
  dirtyCount: number;
  /**
   * Who owns it — a live pid, a manifest, or `'nobody'`.
   *
   * `nobody` is the finding. A tree a live worker is sitting at is somebody's
   * desk and its dirt is work in progress; a tree with neither a process nor a
   * registration is the leftover, and the sweep says so in the word a person
   * reads.
   */
  owner: string;
}

/**
 * Names a dirty tree's owner, or says nobody owns it.
 *
 * The order is the confidence order. A live pid is a process observed right
 * now; a manifest is an identity recorded once and possibly outlived. Neither
 * is a judgement — both are readings — and their absence is what makes the
 * tree a leftover.
 *
 * @param readings - what was measured of the tree.
 * @returns the pid, the manifest, or `'nobody'`.
 */
export const dirtyTreeOwner = (readings: DirtyTreeReadings): string => {
  if (readings.workerPid !== null && readings.workerPid !== '') {
    return `pid ${readings.workerPid}`;
  }
  if (readings.manifest !== '') {
    return readings.manifest;
  }
  return 'nobody';
};

/**
 * Whether a dirty tree is one nobody is coming back for.
 *
 * @param readings - what was measured of the tree.
 * @returns true when the tree is dirty and neither a process nor a manifest
 *   claims it.
 */
export const isUnownedDirtyTree = (readings: DirtyTreeReadings): boolean =>
  readings.dirtyCount > 0 && dirtyTreeOwner(readings) === 'nobody';

/**
 * The dirty trees nobody owns, as findings a report can render.
 *
 * @param trees - what was measured of every tree considered.
 * @returns one finding per unowned dirty tree, in the order they were read.
 */
export const unownedDirtyTrees = (
  trees: readonly DirtyTreeReadings[],
): DirtyTreeFinding[] =>
  trees.filter(isUnownedDirtyTree).map((t) => ({
    path: t.path,
    branch: t.branch,
    dirtyCount: t.dirtyCount,
    owner: 'nobody',
  }));
