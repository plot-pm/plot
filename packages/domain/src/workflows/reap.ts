import type { Worktree, ReapRefusal } from '../entities/worktree.js';
import { reapRefusals } from '../entities/worktree.js';
import { type Decision, type Write, decide } from './decision.js';

/**
 * What was measured of one worktree, beside the worktree itself.
 *
 * Every field is a measurement rather than a judgement. That is what licenses
 * the removal: an agent asked *is this safe to delete?* can talk itself past
 * any of them, and a decision computed from measurements cannot.
 */
export interface ReapEvidence {
  /** Whether a worker process is alive in the tree. */
  workerAlive: boolean;
  /** Whether the tree carries a `PLOT-BLOCKED*` marker. */
  blockedMarker: boolean;
  /**
   * Whether the host merged ANY PR for the branch.
   *
   * Read from the merge timestamp and never from the state — a merged PR
   * reports `CLOSED` — and never from ancestry, which a squash-merge leaves
   * permanently ahead of the default branch. An unreachable host answers
   * false, so silence is never permission.
   */
  hasMergedPr: boolean;
  /** Whether this is a tree the dispatcher created, and so this workflow's to remove. */
  isDispatchTree: boolean;
  /** The registry manifest naming this tree, or `''` when none does. */
  manifest: string;
  /**
   * Whether the branch left agent-log files beside its worktree.
   *
   * A reading rather than a judgement, like the rest: whether the files are
   * there, never whether they may go. Their absence is the desired state, so
   * `false` produces no write instead of a write that would find nothing.
   */
  hasLog: boolean;
}

/** One worktree and what was measured of it. */
export interface ReapCandidate {
  /** The worktree. */
  tree: Worktree;
  /** What was measured of it. */
  evidence: ReapEvidence;
}

/** A manifest whose worktree is already gone. */
export interface OrphanedManifest {
  /** The manifest's path. */
  file: string;
  /** The worktree it names, which is not there. */
  worktree: string;
}

/** What `reap` reads about the estate. */
export interface ReapReadings {
  /** Every worktree git knows about, with what was measured of each. */
  candidates: readonly ReapCandidate[];
  /**
   * Manifests whose recorded worktree no longer exists.
   *
   * Swept separately because they need no PR check and no liveness check:
   * nothing runs in a directory that is not there, which is the strongest
   * evidence of dead available rather than the weakest. A manifest recording
   * no worktree at all is not in this list — it names an agent between
   * checkouts, and absence of a path is not absence of an agent.
   */
  orphanedManifests: readonly OrphanedManifest[];
  /** The repository's default branch. */
  defaultBranch: string;
}

/** What `reap` was asked to bound itself by. */
export interface ReapInput {
  /** How many trees to reap at most; 0 for no bound. */
  max?: number;
}

/** One tree this run would not remove, and why. */
export interface ReapKept {
  /** The tree's path. */
  path: string;
  /** The branch it holds. */
  branch: string;
  /**
   * Why it stays.
   *
   * `max-reached` joins the five measured refusals: it is the operator's
   * bound rather than a fact about the tree, and naming it apart keeps a
   * bounded run from reading as five trees that failed a test.
   */
  reason: ReapRefusal | 'max-reached';
}

/** What a reap decided, beyond its writes. */
export interface ReapDetail {
  /** The trees this run would remove, in order. */
  reaping: readonly string[];
  /** The trees it would not, each with the reason. */
  kept: readonly ReapKept[];
  /** The orphaned manifests it would clear. */
  cleared: readonly string[];
}

/**
 * Decides which worktrees would be reaped, and what that would remove.
 *
 * Transcribed from `plot-reap.sh`. It never refuses as a whole: a run with
 * nothing to reap is a decision with no writes, because the question is asked
 * of every tree separately and one tree's live worker says nothing about the
 * next. The five per-tree refusals come from {@link reapRefusals}, which the
 * `Worktree` entity owns — a second implementation of *may this be removed* is
 * exactly the drift that would delete somebody's work.
 *
 * The three writes per tree are ordered and the order is load-bearing: the
 * checkout goes first and the manifest second, because the reverse leaves a
 * live worktree unregistered and the registry answers that by synthesizing an
 * `unknown` row — the same bad row, earned a different way. The log goes last
 * because it is the only one that is pure cleanup, so a failure before it has
 * cost the least and its own failure costs nothing.
 *
 * @param readings - the trees, their measurements, and the orphaned manifests.
 * @param input - the bound to apply, if any.
 * @returns a decision naming every removal; never a refusal.
 */
export const reap = (readings: ReapReadings, input: ReapInput = {}): Decision<ReapDetail> => {
  const max = input.max ?? 0;
  const writes: Write[] = [];
  const reaping: string[] = [];
  const kept: ReapKept[] = [];

  for (const { tree, evidence } of readings.candidates) {
    // Not ours to remove, and not reported either: a hand-made worktree is
    // outside this workflow's population rather than a tree that failed a test.
    if (!evidence.isDispatchTree) continue;

    const refusals = reapRefusals(tree, {
      workerAlive: evidence.workerAlive,
      blockedMarker: evidence.blockedMarker,
      hasMergedPr: evidence.hasMergedPr,
      defaultBranch: readings.defaultBranch,
    });
    if (refusals.length > 0) {
      // The first, because the script reports one reason per tree and its order
      // is the argument: a live worker outranks everything else, being the only
      // signal describing someone acting right now.
      kept.push({ path: tree.path, branch: tree.branch, reason: refusals[0] as ReapRefusal });
      continue;
    }

    if (max > 0 && reaping.length >= max) {
      kept.push({ path: tree.path, branch: tree.branch, reason: 'max-reached' });
      continue;
    }

    reaping.push(tree.path);
    writes.push({ kind: 'worktree-remove', path: tree.path });
    if (evidence.manifest !== '') {
      writes.push({ kind: 'manifest-clear', worktree: tree.path });
    }
    // And the log LAST, because it is the only one that is pure cleanup: a
    // missing manifest orphans an agent, while a missing log costs a record of
    // work the host already merged. Omitted entirely when there is none — a
    // write that would find nothing is not a write.
    if (evidence.hasLog) {
      writes.push({ kind: 'log-clear', branch: tree.branch });
    }
  }

  // The orphan sweep runs regardless of the bound: it removes no checkout, so
  // it cannot be what a `--max` was set to limit.
  const cleared = readings.orphanedManifests.map((m) => m.worktree);
  for (const orphan of readings.orphanedManifests) {
    writes.push({ kind: 'manifest-clear', worktree: orphan.worktree });
  }

  return decide('reap', writes, { reaping, kept, cleared });
};
