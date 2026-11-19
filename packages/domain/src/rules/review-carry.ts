import { reviewVerdict, type ReviewCounts } from './review-verdict.js';

/** One earlier review of the same pull request, as its files under `reviews/` hold it. */
export interface PriorReview {
  /** The head commit that review read. */
  readonly head: string;
  /** The diff that review read, from `<pr>-<head>.diff`. */
  readonly diff: string;
  /** The reviewer's final answer, from `<pr>-<head>.md`. */
  readonly verdictText: string;
}

/** The earlier review whose verdict a new head takes over. */
export interface CarriedReview {
  /** The head commit the verdict was written for. */
  readonly from: string;
  readonly verdictText: string;
  readonly counts: ReviewCounts;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/**
 * A diff with its `index` lines removed and the line numbers of its hunk
 * headers cleared. Every other line, context lines included, stays as it is.
 *
 * @param diff - a `git diff` text.
 * @returns the text two diffs of the same change share.
 */
export const diffIdentity = (diff: string): string =>
  diff
    .split('\n')
    .filter((line) => !line.startsWith('index '))
    .map((line) => line.replace(HUNK, '@@ @@'))
    .join('\n');

/**
 * Which earlier review's verdict holds for the current head of a pull request.
 *
 * An earlier review qualifies when it read another head, its verdict counts
 * no HIGH finding, and its diff has the same {@link diffIdentity} as the
 * current one. An empty current diff, an unreadable verdict and a verdict with
 * a HIGH finding never qualify.
 *
 * @param head - the current head commit.
 * @param diff - the current diff against the merge base.
 * @param priors - the earlier reviews of the same pull request, in any order.
 * @returns the first qualifying review in `priors`, or `null` where none qualifies.
 */
export const carriedReview = (head: string, diff: string, priors: readonly PriorReview[]): CarriedReview | null => {
  if (diff.trim() === '') return null;
  const identity = diffIdentity(diff);
  for (const prior of priors) {
    if (prior.head === head || diffIdentity(prior.diff) !== identity) continue;
    const verdict = reviewVerdict(prior.verdictText);
    if (verdict.read !== 'counted' || verdict.counts.high !== 0) continue;
    return { from: prior.head, verdictText: prior.verdictText, counts: verdict.counts };
  }
  return null;
};
