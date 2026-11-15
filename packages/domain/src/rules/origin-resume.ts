/**
 * Whether a restart may resume a claimed slice from its ref on origin.
 *
 * A restart hands an existing desk to a new agent. Where this machine holds no
 * desk for the branch, the work can still exist on `origin/<branch>`: a claim
 * commit and the agent's commits, pushed from a desk that is gone. This rule
 * decides whether a new desk may be cut at that tip, and names the reason
 * where it may not.
 *
 * @concept origin-resume
 */

import { CLAIM_SUBJECT_PREFIX, isEmptyClaim, realCommits, type CommitReading } from './empty-claim.js';

/** The plan that names the branch, as read from its base. */
export type OriginPlanReading =
  /** No plan on the default branch or on a sprint branch names the branch. */
  | { readonly kind: 'none' }
  /** The plans could not be listed or parsed. */
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'named';
      /** The plan file, relative to the repository root. */
      readonly file: string;
      /** The plan's phase, normalized as the plan store reports it. */
      readonly phase: string;
      /** Whether the plan's branch line is deferred. */
      readonly deferred: boolean;
      /** The slice's base branch without `origin/`; `''` for the default branch. */
      readonly base: string;
    };

/** The branch's ref on origin, read after a fetch. */
export type OriginRefReading =
  /** Origin holds no ref for the branch. */
  | { readonly kind: 'absent' }
  /** The fetch or the commit listing failed. */
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'present';
      /** The commits `origin/<branch>` carries beyond its base, newest first. */
      readonly commits: readonly CommitReading[];
    };

/** The local `refs/heads/<branch>`, measured against `origin/<branch>`. */
export type LocalBranchReading =
  /** No local branch exists. */
  | { readonly kind: 'absent' }
  /** The local branch holds no commit that origin lacks. */
  | { readonly kind: 'contained' }
  /** The local branch holds `count` commits that origin lacks. */
  | { readonly kind: 'unpushed'; readonly count: number }
  /** The count could not be read. */
  | { readonly kind: 'unreadable' };

/** The host's answer about the branch's pull requests. */
export type OriginPrReading =
  /** The caller promised no network, so the host was not asked. */
  | { readonly kind: 'unasked' }
  /** The host was asked and gave no answer. */
  | { readonly kind: 'unanswerable' }
  /** The host knows no pull request for the branch. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'found';
      readonly number: number;
      /** `OPEN`, `MERGED` or `CLOSED`, as the host reports the newest PR. */
      readonly state: string;
      readonly draft: boolean;
    };

/** What {@link originResume} decides from. */
export interface OriginResumeReadings {
  readonly branch: string;
  /** Whether the caller runs unattended. */
  readonly unattended: boolean;
  readonly plan: OriginPlanReading;
  readonly origin: OriginRefReading;
  readonly local: LocalBranchReading;
  readonly pr: OriginPrReading;
  /** Whether any PR for the branch ever merged, read over every PR rather than the newest. */
  readonly merged: 'merged' | 'not-merged' | 'unknown';
  /** The sessions of live agents whose manifest names the branch. */
  readonly liveHolders: readonly string[];
}

/** Why a resume from origin is refused. */
export type OriginResumeRefusal =
  | 'unattended'
  | 'no-worktree'
  | 'origin-unreadable'
  | 'not-claimed'
  | 'no-work'
  | 'held-by-agent'
  | 'local-unpushed'
  | 'pr-unanswerable'
  | 'reached-review';

/** What {@link originResume} decided. */
export type OriginResumeVerdict =
  | {
      readonly kind: 'resume';
      /** The base branch the manifest records; `''` for the default branch. */
      readonly base: string;
      /** The plan file that names the branch. */
      readonly plan: string;
      /** The commits beyond the claim that the new desk inherits. */
      readonly work: number;
    }
  | { readonly kind: 'refused'; readonly reason: OriginResumeRefusal; readonly detail: string };

/**
 * Decides whether a restart may cut a new desk at `origin/<branch>`.
 *
 * The refusals, in order: an unattended caller; origin holds no ref
 * (`no-worktree`); the fetch, the commit listing or the plans could not be
 * read (`origin-unreadable`); no approved plan's slice names the branch, the
 * line is deferred, or origin carries no `plot: claim <branch>` marker
 * (`not-claimed`); origin carries the claim and nothing else (`no-work`); a
 * live agent's manifest names the branch (`held-by-agent`); the local branch
 * holds commits origin lacks, or its count cannot be read (`local-unpushed`);
 * the host was not asked or could not answer (`pr-unanswerable`); a PR other
 * than an open draft exists, or any PR merged (`reached-review`).
 *
 * @param readings - the plan, the refs, the host's answers and the registry.
 * @returns `resume` with the slice's base, or a refusal naming its reason.
 */
export const originResume = (readings: OriginResumeReadings): OriginResumeVerdict => {
  const { branch } = readings;
  const no = (reason: OriginResumeRefusal, detail: string): OriginResumeVerdict => ({ kind: 'refused', reason, detail });

  if (readings.unattended) {
    return no('unattended', `an unattended caller does not resume ${branch}; a restart needs a person`);
  }
  if (readings.origin.kind === 'absent') {
    return no('no-worktree', `this machine holds no worktree for ${branch}, and origin holds no ref for it`);
  }
  if (readings.origin.kind === 'unreadable') {
    return no('origin-unreadable', `origin/${branch} could not be fetched or listed`);
  }
  if (readings.plan.kind === 'unreadable') {
    return no('origin-unreadable', `the plans could not be read to find the slice that names ${branch}`);
  }
  if (readings.plan.kind === 'none') {
    return no('not-claimed', `no plan on the default branch or a sprint branch names ${branch} in a slice`);
  }
  const { plan } = readings;
  if (plan.phase.toLowerCase() !== 'approved') {
    return no('not-claimed', `${plan.file} names ${branch}, and the plan reads ${plan.phase}, not approved`);
  }
  if (plan.deferred) {
    return no('not-claimed', `${plan.file} defers ${branch}`);
  }
  const { commits } = readings.origin;
  const claim = `${CLAIM_SUBJECT_PREFIX}${branch}`;
  if (!commits.some((commit) => commit.subject === claim && isEmptyClaim(commit))) {
    return no('not-claimed', `origin/${branch} carries no empty \`${claim}\` commit`);
  }
  const work = realCommits(commits);
  if (work === 0) {
    return no('no-work', `origin/${branch} carries the claim and no work; release the claim or dispatch the slice`);
  }
  if (readings.liveHolders.length > 0) {
    return no('held-by-agent', `a live agent's manifest names ${branch}: ${readings.liveHolders.join(', ')}`);
  }
  if (readings.local.kind === 'unpushed') {
    return no('local-unpushed', `the local branch ${branch} holds ${readings.local.count} commit(s) that origin lacks; push them or remove the branch`);
  }
  if (readings.local.kind === 'unreadable') {
    return no('local-unpushed', `the local branch ${branch} could not be measured against origin/${branch}`);
  }
  if (readings.pr.kind === 'unasked') {
    return no('pr-unanswerable', `the caller promised no network, so the host was not asked whether ${branch} has a pull request`);
  }
  if (readings.pr.kind === 'unanswerable' || readings.merged === 'unknown') {
    return no('pr-unanswerable', `the host could not say whether ${branch} has a pull request`);
  }
  if (readings.merged === 'merged') {
    return no('reached-review', `a pull request for ${branch} merged`);
  }
  const { pr } = readings;
  if (pr.kind === 'found' && !(pr.draft && pr.state === 'OPEN')) {
    return no('reached-review', `${branch} has a pull request (#${pr.number}, ${pr.state})`);
  }
  return { kind: 'resume', base: plan.base, plan: plan.file, work };
};
