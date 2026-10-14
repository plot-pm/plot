/**
 * The `plot/review` status a PR's head carried when it was read.
 *
 * - `success`, `failure`, `pending` — the host's own words for the newest
 *   status in that context.
 * - `absent` — the host was asked and holds no status in that context.
 * - `unread` — the host could not be asked. A different fact from `absent`: a
 *   failed read must never pass as a merge that needed no review.
 */
export type ReviewState = 'success' | 'failure' | 'pending' | 'absent' | 'unread';

/** What was read about one merged PR. */
export interface MergedReview {
  /** The PR number. */
  number: number;
  /** When the PR merged, ISO-8601. */
  mergedAt: string;
  /** The `plot/review` state on the PR's head. */
  review: ReviewState;
  /** Whether a PR comment starts with `review-bypass:`. */
  bypassed: boolean;
}

/** What {@link reviewBypasses} reports. */
export type ReviewBypassReport =
  | { kind: 'off' }
  | { kind: 'on'; bypasses: readonly number[]; unread: readonly number[] };

/**
 * Which merged PRs reached the default branch without a passing review.
 *
 * Only a PR merged after `since` is examined: a merge before the rule turned
 * on needed no review. With no usable `since` the rule reports nothing and
 * answers `off`, so the caller says why instead of printing an empty list.
 *
 * A PR is a bypass when its head's review state is not `success` and no
 * comment starts with `review-bypass:`. A PR whose review could not be read
 * is listed in `unread` and never in `bypasses`; it is not passed over.
 *
 * @param readings - one reading per merged PR, in any order.
 * @param since - ISO-8601 time the rule turned on, or `null` for none.
 * @returns `off`, or the PR numbers in ascending order.
 */
export const reviewBypasses = (
  readings: readonly MergedReview[],
  since: string | null,
): ReviewBypassReport => {
  const cutoff = since === null ? NaN : Date.parse(since);
  if (Number.isNaN(cutoff)) return { kind: 'off' };
  const after = readings
    .filter((r) => Date.parse(r.mergedAt) > cutoff)
    .sort((a, b) => a.number - b.number);
  return {
    kind: 'on',
    bypasses: after
      .filter((r) => r.review !== 'success' && r.review !== 'unread' && !r.bypassed)
      .map((r) => r.number),
    unread: after.filter((r) => r.review === 'unread').map((r) => r.number),
  };
};
