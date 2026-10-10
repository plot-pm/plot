import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { Pr } from '../entities/pr.js';
import { defaultBranchRed } from '../rules/default-branch.js';
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
  | 'default-branch-red';

/** What `merge` reads. Every reading is the host's, taken fresh for this call. */
export interface MergeReadings {
  /**
   * The PR as the host answers now; null where the host holds none, and
   * `'unaskable'` where the host did not answer.
   */
  readonly pr: Pr | null | 'unaskable';
  /** The default branch's CI reading, or null where none is recorded. */
  readonly defaultBranch: DefaultBranchReading | null;
}

/** What the caller asks for. */
export interface MergeInput {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the caller read the checks for. */
  readonly sha: string;
}

/** What a passing merge decides, beyond its write. */
export interface MergeDetail {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the merge is pinned to. */
  readonly sha: string;
  /** Whether a default-branch reading existed; absent is reported, not permitted. */
  readonly defaultBranchRead: boolean;
}

const short = (sha: string | undefined): string =>
  sha === undefined || sha === '' ? 'none' : sha.slice(0, 12);

/**
 * Decides whether a PR may merge at the commit the caller read.
 *
 * Refuses unless all four hold at the host's answer now: the head equals the
 * caller's sha, the check rollup is green for that head, the PR is not a draft,
 * and the default branch is not red. A host that did not answer, or that names
 * no head commit, refuses as `unaskable`. A missing default-branch reading
 * holds nothing and the decision says so in its detail.
 *
 * @param readings - the host's PR answer and the default-branch reading.
 * @param input - the PR and the head commit the caller read.
 * @returns a decision with one `pr-merge` write pinned to `input.sha`, or the
 *   first refusal, naming the reading it saw.
 */
export const merge = (readings: MergeReadings, input: MergeInput): Outcome<MergeDetail, MergeRefusal> => {
  const no = (reason: MergeRefusal, detail: string) => refuse('merge', reason, detail);
  const { pr } = readings;
  if (pr === 'unaskable') {
    return no('unaskable', `the host did not answer for PR #${input.pr}. Absent is not green; nothing was merged.`);
  }
  if (pr === null || pr.state !== 'OPEN') {
    return no('pr-not-open', `PR #${input.pr} is ${pr === null ? 'unknown to the host' : pr.state}. Only an open PR merges.`);
  }
  if (pr.headSha === undefined || pr.headSha === '') {
    return no('unaskable', `the host named no head commit for PR #${input.pr}, so the merge cannot be pinned to ${short(input.sha)}. Nothing was merged.`);
  }
  if (pr.headSha !== input.sha) {
    return no('head-moved', `the head of PR #${input.pr} is ${short(pr.headSha)}; the caller read ${short(input.sha)}. Re-read the checks for the new head.`);
  }
  if (pr.draft) return no('draft', `PR #${input.pr} is a draft. Mark it ready, then ask again.`);
  if (pr.checks !== 'green') {
    return no('checks-not-green', `the checks of PR #${input.pr} read '${pr.checks}' at ${short(pr.headSha)}. Merge when they read 'green'.`);
  }
  if (pr.checksSha === undefined || pr.checksSha === '' || pr.checksSha !== pr.headSha) {
    return no('checks-unbound', `the green checks of PR #${input.pr} name ${short(pr.checksSha)}, not the head ${short(pr.headSha)}. A green that names no matching commit proves nothing about this head.`);
  }
  if (defaultBranchRed(readings.defaultBranch)) {
    const settled = readings.defaultBranch?.settled;
    return no('default-branch-red', `${readings.defaultBranch?.branch ?? 'the default branch'} is red on ${short(settled?.sha)}. A merge now stacks a change on an unproven base.`);
  }
  return decide('merge', [{ kind: 'pr-merge', pr: input.pr, deleteBranch: false, sha: input.sha }], {
    pr: input.pr,
    sha: input.sha,
    defaultBranchRead: readings.defaultBranch !== null,
  });
};
