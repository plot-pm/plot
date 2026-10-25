import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { Pr } from '../entities/pr.js';
import { defaultBranchAgeMs } from '../rules/default-branch.js';
import { sameCommit } from '../rules/same-commit.js';
import { type Outcome, decide, refuse } from './decision.js';

/**
 * Why `merge` refused. Each is the end of the action: nothing merges, and no
 * caller retries with the pin dropped.
 */
export type MergeRefusal =
  | 'unaskable'
  | 'pr-not-open'
  | 'head-moved'
  | 'draft'
  | 'checks-not-green'
  | 'checks-unbound'
  | 'default-branch-red'
  | 'default-branch-stale';

/** What `merge` reads. Every reading is the host's, taken fresh for this call. */
export interface MergeReadings {
  /**
   * The PR as the host answers now; null where the host holds none, and
   * `'unaskable'` where the host did not answer.
   */
  readonly pr: Pr | null | 'unaskable';
  /**
   * The default branch's CI reading; null where none is recorded, and
   * `'unaskable'` where the read itself failed. A missing, unparseable or
   * other-version file is null and holds nothing; a failed read is not.
   */
  readonly defaultBranch: DefaultBranchReading | null | 'unaskable';
}

/** What the caller asks for. */
export interface MergeInput {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the caller read the checks for. */
  readonly sha: string;
  /** The current time, as epoch milliseconds. */
  readonly now: number;
  /** The `Checks wait` bound, in milliseconds; an older default-branch reading refuses the merge. */
  readonly checksWaitMs: number;
  /**
   * The host backend's word (`'github'`, `'bitbucket'`, or `''` where the
   * caller could not resolve one). Decides the floor {@link sameCommit} uses
   * for the `head-moved` check: GitHub always reports and expects a full
   * 40-character head (`headRefOid`), so a caller sha shorter than that is
   * never legitimate there and the floor rises to close the collision window;
   * Bitbucket can legitimately report a shorter head, so it keeps the 7+
   * default, and so does an unresolved backend.
   */
  readonly backend: string;
}

/** The hex floor {@link sameCommit} enforces for a given host backend. */
const minHexLenFor = (backend: string): number => (backend === 'github' ? 40 : 7);

/** What a passing merge decides, beyond its write. */
export interface MergeDetail {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the merge is pinned to. */
  readonly sha: string;
  /** Whether a default-branch reading within `Checks wait` existed; absent is reported, not permitted. */
  readonly defaultBranchRead: boolean;
}

const short = (sha: string | undefined): string =>
  sha === undefined || sha === '' ? 'none' : sha.slice(0, 12);

/**
 * Decides whether a PR may merge at the commit the caller read.
 *
 * Refuses unless all four hold at the host's answer now: the head names the
 * same commit as the caller's sha (see {@link sameCommit} — a short host head
 * and a full-length caller sha, in either direction, still match, at the floor
 * `input.backend` sets: 40 characters on GitHub, whose head is always full-length,
 * and 7 elsewhere), the check rollup is green for that head, the PR is not a
 * draft, and the default branch is not red. A host that did not answer, or that names no head commit,
 * refuses as `unaskable`, and so does a default-branch read that failed. A
 * missing default-branch reading holds nothing and the decision says so in its
 * detail. A reading whose `askedAt` is older than `input.checksWaitMs`, or does
 * not parse, refuses as `default-branch-stale`: a merge cannot be undone, so a
 * reading no host confirmed within the bound permits nothing, whether it reads
 * red or green.
 *
 * `checks-unbound` guards a rollup that names a commit other than the head.
 * A PR's `checksSha` and `headSha` both name commits on the same ref; when an
 * adapter reports checks against a commit other than the head, the refusal
 * fires.
 *
 * @param readings - the host's PR answer and the default-branch reading.
 * @param input - the PR, the head commit the caller read, the clock and the `Checks wait` bound.
 * @returns a decision with one `pr-merge` write pinned to the host's head in
 *   the host's own form (`pr.headSha`, which names the caller's commit), or the
 *   first refusal, naming the reading it saw.
 */
export const merge = (readings: MergeReadings, input: MergeInput): Outcome<MergeDetail, MergeRefusal> => {
  const no = (reason: MergeRefusal, detail: string) => refuse('merge', reason, detail);
  const { pr } = readings;
  if (pr === 'unaskable') {
    return no('unaskable', `the host did not answer for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
  }
  if (pr === null || pr.state !== 'OPEN') {
    return no('pr-not-open', `PR #${input.pr} is ${pr === null ? 'unknown to the host' : pr.state}. Only an open PR merges.`);
  }
  if (pr.headSha === undefined || pr.headSha === '') {
    return no('unaskable', `the host named no head commit for PR #${input.pr}, so the merge cannot be pinned to ${short(input.sha)}. Nothing was merged.`);
  }
  if (!sameCommit(pr.headSha, input.sha, minHexLenFor(input.backend))) {
    return no('head-moved', `the head of PR #${input.pr} is ${short(pr.headSha)}; the caller read ${short(input.sha)}. Re-read the checks for the new head.`);
  }
  if (pr.draft) return no('draft', `PR #${input.pr} is a draft. Mark it ready, then ask again.`);
  if (pr.checks !== 'green') {
    return no('checks-not-green', `the checks of PR #${input.pr} read '${pr.checks}' at ${short(pr.headSha)}. Merge when they read 'green'.`);
  }
  if (pr.checksSha === undefined || pr.checksSha === '' || pr.checksSha !== pr.headSha) {
    return no('checks-unbound', `the green checks of PR #${input.pr} name ${short(pr.checksSha)}, not the head ${short(pr.headSha)}. A green that names no matching commit proves nothing about this head.`);
  }
  const defaultBranch = readings.defaultBranch;
  if (defaultBranch === 'unaskable') {
    return no('unaskable', `the default branch's reading could not be read for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
  }
  if (defaultBranch !== null) {
    const age = defaultBranchAgeMs(defaultBranch, input.now);
    if (age === null || age > input.checksWaitMs) {
      const seen = age === null ? `has an askedAt that does not parse ('${defaultBranch.askedAt}')` : `is ${Math.floor(age / 1000)} s old`;
      return no('default-branch-stale', `the reading of ${defaultBranch.branch} ${seen}; Checks wait is ${Math.floor(input.checksWaitMs / 1000)} s. A merge needs a reading a host confirmed within that bound; nothing was merged.`);
    }
    if (defaultBranch.settled?.state === 'red') {
      return no('default-branch-red', `${defaultBranch.branch} is red on ${short(defaultBranch.settled.sha)}. A merge now stacks a change on an unproven base.`);
    }
  }
  return decide('merge', [{ kind: 'pr-merge', pr: input.pr, deleteBranch: false, sha: pr.headSha }], {
    pr: input.pr,
    sha: input.sha,
    defaultBranchRead: readings.defaultBranch !== null,
  });
};
