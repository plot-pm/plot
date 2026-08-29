import { z } from 'zod';

/**
 * Where a worktree sits in its life.
 *
 * `created`   `git worktree add` ran; no worker yet.
 * `occupied`  an agent's process is alive in it.
 * `finished`  the worker exited; the tree may still hold work.
 * `reapable`  every refusal passes.
 * `gone`      removed — the branch and its refs survive.
 */
export const WorktreeStateSchema = z.enum(['created', 'occupied', 'finished', 'reapable', 'gone']);
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/**
 * Why a worktree may not be removed.
 *
 * Each is a measurement rather than a judgement, and each asks about the agent
 * or what it left behind — never about the tree itself.
 */
export const ReapRefusalSchema = z.enum([
  'live-worker',
  'uncommitted-changes',
  'blocked-marker',
  'on-default-branch',
  'no-merged-pr',
]);
export type ReapRefusal = z.infer<typeof ReapRefusalSchema>;

/**
 * A desk: one checkout, one branch, one agent.
 *
 * Identity: a natural key — the path, which git enforces as unique. State:
 * derived, so it goes stale and is re-run rather than stored.
 *
 * The branch is not the identity: a worktree may hold a detached HEAD.
 */
export interface Worktree {
  /** The absolute path — the identity. */
  path: string;
  /** The branch checked out, or `''` when detached. */
  branch: string;
  /** Whether this is the main checkout; never reapable. */
  isMain: boolean;
  /** No uncommitted changes AND no unpushed commits; false when uncheckable. */
  clean: boolean;
  /** The owning agent's session id, or null when the tree is orphaned. */
  agentSession: string | null;
  /** Git's own view that the directory is gone; not Plot's question. */
  prunable: boolean;
}

/**
 * Whether a worktree carries work that has not landed.
 *
 * A tree that could not be checked reports unclean, so it stays visible rather
 * than being silently dropped — absent is not false, applied to a filesystem.
 *
 * @param tree - the worktree to test.
 * @returns true when the tree holds uncommitted changes or unpushed commits.
 */
export const holdsUnlandedWork = (tree: Worktree): boolean => !tree.clean;

/**
 * Whether a worktree is an orphan — one Plot did not create and does not own.
 *
 * An orphan is not an unoccupied desk. The ownership runs the other way: the
 * worktree is the agent's desk, so a tree with no agent is a different thing to
 * report rather than a free one to take.
 *
 * @param tree - the worktree to test.
 * @returns true when no agent owns it.
 */
export const isOrphan = (tree: Worktree): boolean => tree.agentSession === null;

/**
 * Every reason this worktree may not be reaped, given what was measured of it.
 *
 * Reports all of them rather than the first, so an operator sees the whole
 * picture. A tree is reapable when this is empty.
 *
 * @param tree - the worktree to judge.
 * @param evidence - what was measured: whether a worker process is alive,
 *   whether a `PLOT-BLOCKED` marker is present, whether any PR for the branch
 *   merged, and the repository's default branch.
 * @returns the refusals that apply, in a stable order; empty means reapable.
 */
export const reapRefusals = (
  tree: Worktree,
  evidence: {
    workerAlive: boolean;
    blockedMarker: boolean;
    hasMergedPr: boolean;
    defaultBranch: string;
  },
): ReapRefusal[] => {
  const refusals: ReapRefusal[] = [];
  if (evidence.workerAlive) refusals.push('live-worker');
  if (holdsUnlandedWork(tree)) refusals.push('uncommitted-changes');
  if (evidence.blockedMarker) refusals.push('blocked-marker');
  // A tree sitting on the default branch never had its dispatched branch
  // checked out, so its state was never measured.
  if (tree.isMain || tree.branch === evidence.defaultBranch) refusals.push('on-default-branch');
  // Read from whether a PR merged, never from ancestry: a squash-merge leaves
  // the branch permanently ahead of the default branch.
  if (!evidence.hasMergedPr) refusals.push('no-merged-pr');
  return refusals;
};

/**
 * Whether a worktree may be removed.
 *
 * @param tree - the worktree to judge.
 * @param evidence - the same measurements `reapRefusals` reads.
 * @returns true when no refusal applies.
 */
export const isReapable = (
  tree: Worktree,
  evidence: Parameters<typeof reapRefusals>[1],
): boolean => reapRefusals(tree, evidence).length === 0;
