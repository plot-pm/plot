import type { Issue } from '../entities/issue.js';

/** The label every follow-up issue of `plot-review` carries. */
export const REVIEW_ISSUE_LABEL = 'ai-generated';

const TITLE_PREFIX = 'plot-review: ';

/**
 * The title of the follow-up issue for a PR.
 *
 * The one place the title format is written; {@link findOpenReviewIssue} reads
 * the suffix this produces. The title names no counts: later heads add comments
 * to the issue and never edit its title, so counts would describe only the
 * first head.
 *
 * @param pr - the PR number.
 * @returns `plot-review: findings on PR #<pr>`.
 */
export const reviewIssueTitle = (pr: number): string => `${TITLE_PREFIX}findings on PR #${pr}`;

/**
 * The open follow-up issue of one PR, among issues that carry the review label.
 *
 * A title matches when it starts with `plot-review: ` and ends with
 * ` on PR #<pr>`, so `PR #1` does not match `PR #12`. The caller passes open
 * issues carrying {@link REVIEW_ISSUE_LABEL}; this function reads titles only.
 *
 * @param issues - the open issues carrying the review label.
 * @param pr - the PR number.
 * @returns the first match in the given order, or null.
 */
export const findOpenReviewIssue = (issues: readonly Issue[], pr: number): Issue | null =>
  issues.find((issue) => issue.title.startsWith(TITLE_PREFIX) && issue.title.endsWith(` on PR #${pr}`)) ?? null;
