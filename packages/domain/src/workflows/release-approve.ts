import type { Pr } from '../entities/pr.js';
import type { PrReviewReading } from '../ports/host.js';
import { minHexLenFor } from '../adapters/host/min-hex-len.js';
import { RELEASE_BRANCH } from '../rules/release-branch.js';
import { sameCommit } from '../rules/same-commit.js';
import { type MergePorts, type MergeRefusal, mergeAt } from './merge.js';
import { type Caller, type Outcome, decide, refuse } from './decision.js';

/** The sha prefix to show in a refusal's detail text. */
const short = (sha: string | undefined): string =>
  sha === undefined || sha === '' ? 'none' : sha.slice(0, 12);

/**
 * Why `releaseApprove` refused. Each is the end of the action: nothing
 * merges, and no caller retries with the pin dropped.
 */
export type ReleaseApproveRefusal = 'unattended' | 'not-release-pr' | 'head-moved' | 'review-missing';

/** What `releaseApprove` reads. Every reading is the host's, taken fresh for this call. */
export interface ReleaseApproveReadings {
  /** Who is asking for the approval; an unattended caller is refused before anything else is read. */
  readonly caller: Caller;
  /**
   * The PR as the host answers now; null where the host holds none, and
   * `'unaskable'` where the host did not answer.
   */
  readonly pr: Pr | null | 'unaskable';
  /**
   * The `plot/review` state on the pinned head, re-asked through the host and
   * never folded from the checks rollup. `'unaskable'` where the read failed.
   */
  readonly review: PrReviewReading | 'unaskable';
}

/** What the caller asks for. */
export interface ReleaseApproveInput {
  /** The PR to approve. */
  readonly pr: number;
  /** The head commit the caller read the review for. */
  readonly sha: string;
  /** The hex-prefix floor {@link sameCommit} enforces for the `head-moved` check. */
  readonly minHexLen: number;
}

/** What a passing approval reports. Its merge is `merge`'s write, made through `mergeAt`. */
export interface ReleaseApproveDetail {
  /** The PR approved. */
  readonly pr: number;
  /** The head commit the approval is pinned to. */
  readonly sha: string;
  /** True where the host already holds the PR merged: nothing merges, and the finish resumes. */
  readonly alreadyMerged: boolean;
}

/**
 * Decides whether a release PR may be approved and merged at the commit the
 * caller read.
 *
 * Refuses `unattended` before any other reading, the same way `merge` does.
 * A PR the host already holds merged on a release branch decides with
 * `alreadyMerged`, and no review or head is asked of it.
 *
 * @param readings - the host's PR answer and the review reading.
 * @param input - the PR, the head commit the caller read, and the sha floor.
 * @returns a decision, or the first refusal, naming the reading it saw.
 */
export const releaseApprove = (
  readings: ReleaseApproveReadings,
  input: ReleaseApproveInput,
): Outcome<ReleaseApproveDetail, ReleaseApproveRefusal> => {
  const no = (reason: ReleaseApproveRefusal, detail: string) => refuse('release-approve', reason, detail);
  if (readings.caller === 'unattended') {
    return no('unattended', `an unattended caller does not approve release PR #${input.pr}. Approval is reviewed as an action, and this one had no reviewer.`);
  }
  const { pr } = readings;
  if (pr === 'unaskable' || pr === null || !RELEASE_BRANCH.test(pr.head)) {
    return no('not-release-pr', `PR #${input.pr} is not on a release branch. Only ${RELEASE_BRANCH} merges through release-approve.`);
  }
  if (pr.state === 'MERGED') {
    return decide('release-approve', [], { pr: input.pr, sha: input.sha, alreadyMerged: true });
  }
  const head = pr.headSha ?? '';
  if (!sameCommit(head, input.sha, input.minHexLen)) {
    const seen = short(head);
    return no('head-moved', `the head of PR #${input.pr} is ${seen}; the caller approved ${short(input.sha)}. Re-review the new head.`);
  }
  const { review } = readings;
  if (review === 'unaskable' || review.state !== 'success' || !sameCommit(review.sha, head, input.minHexLen)) {
    const seen = review === 'unaskable'
      ? 'the review read failed'
      : !sameCommit(review.sha, head, input.minHexLen)
        ? `'plot/review' names ${short(review.sha)}, not the head ${short(head)}`
        : `'plot/review' reads '${review.state}'`;
    return no('review-missing', `${seen} for PR #${input.pr}. Run the review on this head, then approve again.`);
  }
  return decide('release-approve', [], { pr: input.pr, sha: input.sha, alreadyMerged: false });
};

/** What `plot-ask.mjs release-approve` prints before the finish: the approval, or the refusal that stopped it. */
export type ReleaseApproveResult =
  | { approved: true; pr: number; sha: string; alreadyMerged: boolean }
  | { approved: false; reason: ReleaseApproveRefusal | MergeRefusal | 'host-refused'; detail: string };

/**
 * Approves a release PR at the head commit the person read, merges it, or refuses.
 *
 * An unattended caller is refused before any host read. Otherwise the PR and its
 * `plot/review` reading are asked of the host fresh, never from the PR index. On
 * a pass the merge goes through {@link mergeAt}, so its pin, check, review and
 * default-branch rules apply unchanged. A PR the host already holds merged skips
 * the merge.
 *
 * @param ports - the ports {@link mergeAt} takes.
 * @param pr - the PR number.
 * @param sha - the head commit the person read the review for.
 * @returns the approval, or the refusal naming its reason; `host-refused`
 *   carries the host's own words.
 */
export const releaseApproveAt = async (
  ports: MergePorts,
  pr: number,
  sha: string,
): Promise<ReleaseApproveResult> => {
  const refusedAs = (reason: ReleaseApproveRefusal | MergeRefusal | 'host-refused', detail: string): ReleaseApproveResult =>
    ({ approved: false, reason, detail });
  const asked = ports.caller === 'unattended'
    ? null
    : await Promise.all([ports.host.prState(pr), ports.host.prReview(pr), ports.host.backend()]);
  const out = releaseApprove(
    {
      caller: ports.caller,
      pr: asked?.[0].ok ? asked[0].value : 'unaskable',
      review: asked?.[1].ok ? asked[1].value : 'unaskable',
    },
    { pr, sha, minHexLen: minHexLenFor(asked?.[2].ok ? asked[2].value : '') },
  );
  if (out.outcome === 'refused') return refusedAs(out.reason, out.detail);
  if (out.detail.alreadyMerged) return { approved: true, pr, sha, alreadyMerged: true };
  const merged = await mergeAt(ports, pr, sha, true);
  if (!merged.merged) return refusedAs(merged.reason, merged.detail);
  return { approved: true, pr, sha, alreadyMerged: false };
};
