import type { Caller } from '../workflows/decision.js';
import type { MergedAnswer, PrLookup } from '../ports/host.js';
import type { RemoteShaReading } from '../ports/refs.js';
import type { PortResult } from '../port-result.js';
import type { OriginPlanReading } from './origin-resume.js';
import { isEmptyClaim, type CommitReading } from './empty-claim.js';
import { SPRINT_BRANCH_PREFIX } from './slice-base.js';

/** Why the delete controller refuses a branch. */
export type LooseDeleteRefusal =
  | 'unattended'
  | 'protected'
  | 'named'
  | 'held'
  | 'claimed'
  | 'open-pr'
  | 'merged'
  | 'unpushed'
  | 'unaskable'
  | 'no-remote-branch'
  | 'tip-moved';

/** The branch prefix Changesets writes its release PR from. */
export const RELEASE_BRANCH_PREFIX = 'changeset-release/';

/** What the delete controller read about one branch before it decides. */
export interface LooseDeleteReadings {
  /** Who asks. */
  readonly caller: Caller;
  /** The branch to delete. */
  readonly branch: string;
  /** The repository's default branch. */
  readonly defaultBranch: PortResult<string>;
  /** The plan whose slice names the branch, on the default branch or a sprint branch. */
  readonly plan: OriginPlanReading;
  /** Whether a worktree on this machine holds the branch. */
  readonly desk: PortResult<boolean>;
  /** The sessions of the registry manifests that name the branch, live or not. */
  readonly manifests: PortResult<readonly string[]>;
  /** The commits `origin/<default>..origin/<branch>` holds. */
  readonly commits: PortResult<readonly CommitReading[]>;
  /** The host's PR for the branch, `null` where it holds none. */
  readonly pr: PortResult<PrLookup>;
  /** Whether the host merged any PR for the branch. */
  readonly merged: PortResult<MergedAnswer>;
  /** How many commits this machine's local branch holds that `origin/<branch>` does not; `null` where there is no local branch. */
  readonly unpushed: PortResult<number> | null;
  /** The commit the branch points at on the remote, read live. */
  readonly remoteTip: PortResult<RemoteShaReading>;
  /** The commit `origin/<branch>` resolves to in this clone. */
  readonly localTip: PortResult<string>;
}

/** The controller's decision: delete at `tip`, or refuse. */
export type LooseDeleteDecision =
  | { readonly kind: 'delete'; readonly tip: string }
  | { readonly kind: 'refuse'; readonly reason: LooseDeleteRefusal; readonly detail: string };

const refuse = (reason: LooseDeleteRefusal, detail: string): LooseDeleteDecision => ({ kind: 'refuse', reason, detail });

/**
 * Decides whether a loose branch's remote ref may be deleted.
 *
 * Refuses, in this order: an unattended caller; the default branch, a
 * `sprint/` integration branch and a `changeset-release/` branch (`protected`);
 * a branch a plan's slice names (`named`); a branch a desk on this machine or a
 * registry manifest holds (`held`); a branch carrying a claim marker, which
 * `release-claim` gives up instead (`claimed`); a host that cannot be asked
 * about the PR or the merge; an open PR; a merged PR; a local branch with a
 * commit `origin/<branch>` lacks; a branch with no remote ref; and a remote tip
 * that differs from the one this clone holds. Every reading that did not
 * answer refuses, as `unaskable` where no other name fits.
 *
 * @param readings - what the controller read.
 * @returns `delete` with the tip to pin and lease against, or the refusal.
 */
export const looseDelete = (readings: LooseDeleteReadings): LooseDeleteDecision => {
  const { branch } = readings;
  if (readings.caller === 'unattended') return refuse('unattended', 'an unattended caller deletes no branch');
  if (!readings.defaultBranch.ok || readings.defaultBranch.value === '') {
    return refuse('unaskable', 'git cannot say which branch is the default branch');
  }
  if (branch === readings.defaultBranch.value) return refuse('protected', `${branch} is the default branch`);
  if (branch.startsWith(SPRINT_BRANCH_PREFIX)) return refuse('protected', `${branch} is a sprint integration branch`);
  if (branch.startsWith(RELEASE_BRANCH_PREFIX)) return refuse('protected', `${branch} is the release branch Changesets writes`);
  if (readings.plan.kind === 'unreadable') return refuse('unaskable', 'the plans that could name the branch cannot be read');
  if (readings.plan.kind === 'named') return refuse('named', `${readings.plan.file} names ${branch} in a slice`);
  if (!readings.desk.ok) return refuse('unaskable', 'git cannot list the worktrees on this machine');
  if (readings.desk.value) return refuse('held', `a worktree on this machine holds ${branch}`);
  if (!readings.manifests.ok) return refuse('unaskable', 'the agent registry cannot be read');
  if (readings.manifests.value.length > 0) {
    return refuse('held', `the registry manifest of ${readings.manifests.value.join(', ')} names ${branch}`);
  }
  if (!readings.commits.ok) return refuse('unaskable', 'git cannot list the commits the branch holds');
  if (readings.commits.value.some(isEmptyClaim)) {
    return refuse('claimed', `${branch} carries a claim marker; release-claim gives up the claim and the ref`);
  }
  if (!readings.pr.ok) return refuse('unaskable', 'the host cannot say whether a PR exists for the branch');
  if (!readings.merged.ok || readings.merged.value === 'unknown') {
    return refuse('unaskable', 'the host cannot say whether the branch merged');
  }
  if (readings.pr.value !== null && readings.pr.value.state === 'OPEN') {
    return refuse('open-pr', `PR #${readings.pr.value.number} is open for the branch`);
  }
  if (readings.merged.value === 'merged') return refuse('merged', 'the host merged a PR for the branch; plot-release-refs.sh owns it');
  if (readings.unpushed !== null) {
    if (!readings.unpushed.ok) return refuse('unaskable', 'git cannot say whether the local branch holds an unpushed commit');
    if (readings.unpushed.value > 0) {
      return refuse('unpushed', `the local branch holds ${readings.unpushed.value} commit(s) origin/${branch} does not`);
    }
  }
  if (!readings.remoteTip.ok || readings.remoteTip.value === 'unknown') {
    return refuse('no-remote-branch', 'the remote ref could not be read, or the branch is not on the remote');
  }
  const tip = readings.remoteTip.value.sha;
  if (!readings.localTip.ok || readings.localTip.value !== tip) {
    return refuse('tip-moved', 'the remote tip is not the tip this clone holds; fetch and look again');
  }
  return { kind: 'delete', tip };
};
