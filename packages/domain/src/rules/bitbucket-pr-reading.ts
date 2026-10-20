/** A Bitbucket pull request payload, reduced to the fields `pr-state` reads. */
export interface BitbucketPr {
  id: number;
  state: string;
  draft?: boolean;
  links: { html: { href: string } };
  merge_commit?: { hash?: string | null } | null;
  destination?: { branch?: { name?: string } };
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
}

/** A check word for a branch; `checksSha` is present only where it was read by sha. */
export interface Reading {
  checks: string;
  checksSha?: string;
  job?: string;
}

/** What `plot-host.sh pr-state` prints for a Bitbucket pull request. */
export interface PrStateRow {
  number: number;
  state: string;
  draft: boolean;
  url: string;
  mergeCommit: string;
  headSha?: string;
  base?: string;
  checks?: string;
  checksSha?: string;
  mergeable?: string;
}

/**
 * The `pr-state` row of a Bitbucket pull request, with its check.
 *
 * `checks` is absent, never guessed: `unknown` where no Jenkins reading exists
 * (`colours` is `null`, because `CI: jenkins` is not set or Jenkins could not
 * answer), and `none` where Jenkins answered and has no job for the branch. A
 * `bound` entry, read for the head commit by sha, outranks the branch colour,
 * which carries no commit. A branch colour stands unbound with `checksSha: ''`.
 *
 * `mergeable` is always `unknown` here: Bitbucket Cloud's REST API has no
 * field or endpoint that reports merge-conflict status for a pull request
 * (measured 2026-10-20 against the PR object, its diffstat, and its
 * statuses). `plot-host.sh` overlays a real reading from a local
 * `git merge-tree` check afterward, via `foldBitbucketMergeable`.
 *
 * @param pr - the payload, or `null` where the branch has no pull request.
 * @param colours - the branch-colour map, or `null` where it was not read.
 * @param bound - the sha-bound readings keyed by branch, or `null`.
 * @returns the row; a missing pull request reads `NONE` with no check.
 */
export const bitbucketPrState = (
  pr: BitbucketPr | null,
  colours: Readonly<Record<string, Reading>> | null,
  bound: Readonly<Record<string, Reading>> | null,
): PrStateRow => {
  if (pr === null) return { number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '' };
  const branch = pr.source?.branch?.name ?? '';
  const entry = bound?.[branch] ?? colours?.[branch] ?? null;
  const checks = colours === null ? 'unknown' : (entry?.checks ?? 'none');
  return {
    number: pr.id,
    state: pr.state === 'DECLINED' ? 'CLOSED' : pr.state,
    draft: pr.draft ?? false,
    url: pr.links.html.href,
    mergeCommit: pr.merge_commit?.hash ?? '',
    headSha: pr.source?.commit?.hash ?? '',
    base: pr.destination?.branch?.name ?? '',
    checks,
    checksSha: entry?.checksSha ?? '',
    mergeable: 'unknown',
  };
};

const REVIEW_STATE: Readonly<Record<string, string>> = {
  SUCCESSFUL: 'success',
  FAILED: 'failure',
  INPROGRESS: 'pending',
  STOPPED: 'error',
};

/**
 * The `pr-review` reading of a Bitbucket pull request.
 *
 * @param sha - the pull request's head commit.
 * @param statuses - the commit's build statuses, newest first.
 * @param comments - the pull request's comments.
 * @returns the newest `plot/review` status in GitHub's words (`absent` where
 *   none exists or its state has no mapping), and whether a comment starts
 *   `review-bypass:`.
 */
export const bitbucketReview = (
  sha: string,
  statuses: ReadonlyArray<{ key?: string; state?: string }>,
  comments: ReadonlyArray<{ content?: { raw?: string } }>,
): { sha: string; state: string; bypass: boolean } => ({
  sha,
  state: REVIEW_STATE[statuses.find((s) => s.key === 'plot/review')?.state ?? ''] ?? 'absent',
  bypass: comments.some((c) => (c.content?.raw ?? '').startsWith('review-bypass:')),
});
