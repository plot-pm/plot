import { checkWord, checksOf, ciChecksOf, jqOr, PLOT_REVIEW_CONTEXT, type RollupItem } from './checks-of.js';
import { mergeableOf } from './mergeable-of.js';

/**
 * One pull request as `gh pr list --json` exports it, for the fields
 * `plot-host.sh pr-list` asks. The plain listing carries no
 * `statusCheckRollup`, `mergeable`, `mergeStateStatus` or `reviewDecision`.
 */
export interface GhPullRequest {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly state?: unknown;
  readonly headRefName?: unknown;
  readonly isDraft?: unknown;
  readonly url?: unknown;
  readonly updatedAt?: unknown;
  readonly author?: { readonly login?: unknown } | null;
  readonly headRefOid?: unknown;
  readonly mergedAt?: unknown;
  readonly statusCheckRollup?: readonly RollupItem[] | null;
  readonly mergeable?: unknown;
  readonly mergeStateStatus?: unknown;
  readonly reviewDecision?: unknown;
}

/** One `pr-list` row: every field the projection writes, by name. */
export type GithubPrRow = Readonly<Record<string, unknown>>;

/** The value a field jq reads from a missing key: `null`. */
const field = (value: unknown): unknown => (value === undefined ? null : value);

/** jq's `ascii_downcase`: lower-cases A to Z and nothing else. */
const asciiDowncase = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The plain `pr-list` row: the projection of `plot-host.sh`'s plain GitHub
 * arm, a declared duplicate held by `corpus/github-pr-listing.corpus.test.ts`.
 *
 * @param pr - the pull request as `gh` exports it.
 * @returns `number`, `title`, `state`, `head`, `draft`, `url`, `updatedAt`,
 *   `headSha`, `mergedAt` and `author`; the last four `''` where absent.
 */
export const githubPlainRow = (pr: GhPullRequest): GithubPrRow => ({
  number: field(pr.number),
  title: field(pr.title),
  state: field(pr.state),
  head: field(pr.headRefName),
  draft: field(pr.isDraft),
  url: field(pr.url),
  updatedAt: jqOr(pr.updatedAt, ''),
  headSha: jqOr(pr.headRefOid, ''),
  mergedAt: jqOr(pr.mergedAt, ''),
  author: jqOr(pr.author?.login, ''),
});

/**
 * The `plot/review` fields of a rich row: the first rollup item whose
 * `context` is `plot/review`, or `plotReview: 'absent'` where none is.
 *
 * @param pr - the pull request as `gh` exports it.
 * @returns `plotReview` alone, or with `plotReviewSha` and `plotReviewAt`.
 */
const plotReviewOf = (pr: GhPullRequest): GithubPrRow => {
  const review = (pr.statusCheckRollup ?? []).find((item) => jqOr(item.context, '') === PLOT_REVIEW_CONTEXT);
  if (review === undefined) return { plotReview: 'absent' };
  return {
    plotReview: asciiDowncase(String(jqOr(review.state, ''))),
    plotReviewSha: jqOr(pr.headRefOid, ''),
    plotReviewAt: jqOr(review.startedAt, ''),
  };
};

/**
 * The rich `pr-list` row: the projection of `plot-host.sh`'s rollup GitHub
 * arm (the arm without `CI: jenkins`), a declared duplicate held by
 * `corpus/github-pr-listing.corpus.test.ts`.
 *
 * @param pr - the pull request as `gh` exports it.
 * @returns the plain fields with `checks`, `ciChecks`, `mergeable`, `review`,
 *   `checksSha`, `failing_checks` and the `plot/review` fields.
 */
export const githubRichRow = (pr: GhPullRequest): GithubPrRow => ({
  ...githubPlainRow(pr),
  checks: checksOf(pr.statusCheckRollup),
  mergeable: mergeableOf(pr),
  review: jqOr(pr.reviewDecision, ''),
  checksSha: jqOr(pr.headRefOid, ''),
  failing_checks: (pr.statusCheckRollup ?? [])
    .filter((item) => checkWord(item) === 'bad')
    .map((item) => jqOr(item.name, jqOr(item.context, '')))
    .filter((name) => name !== ''),
  ciChecks: ciChecksOf(pr.statusCheckRollup),
  ...plotReviewOf(pr),
});

/**
 * Whether a row is terminal: `MERGED` or `CLOSED`.
 *
 * @param row - a `pr-list` row.
 * @returns true for a merged or closed row.
 */
export const isTerminalRow = (row: GithubPrRow): boolean => row.state === 'MERGED' || row.state === 'CLOSED';

/**
 * A terminal row of a `--rich-open` listing: the plain row with the absent
 * verdicts `plot-host.sh` adds, `checks` and `mergeable` `unknown`, `review`
 * `''` and `failing_checks` empty.
 *
 * @param row - the plain row.
 * @returns the row with the absent verdicts.
 */
export const withAbsentVerdicts = (row: GithubPrRow): GithubPrRow => ({
  ...row,
  checks: 'unknown',
  mergeable: 'unknown',
  review: '',
  failing_checks: [],
});
