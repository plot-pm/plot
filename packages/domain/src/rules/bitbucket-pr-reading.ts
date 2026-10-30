/** A Bitbucket pull request payload, reduced to the fields `pr-state` reads. */
export interface BitbucketPr {
  id: number;
  state: string;
  draft?: boolean;
  links: { html: { href: string } };
  merge_commit?: { hash?: string | null } | null;
  destination?: { branch?: { name?: string } };
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
  /** Bitbucket names no merge time; `pr-list` already reads this as the #2202 stand-in. */
  updated_on?: string;
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
  checksLookup?: string;
  mergedAt?: string;
}

/**
 * The `pr-state` row of a Bitbucket pull request, with its check.
 *
 * `checks` is absent, never guessed: `unknown` where no Jenkins reading exists
 * (`colours` is `null`, because `CI: jenkins` is not set, the caller did not
 * ask for checks, or Jenkins could not answer), and `none` where Jenkins
 * answered and has no job for the branch. A `bound` entry, read for the head
 * commit by sha, outranks the branch colour, which carries no commit. A
 * branch colour stands unbound with `checksSha: ''` UNLESS `wasNamed` is true
 * and no `bound` entry exists for the branch — that combination means the row
 * was picked for a sha lookup this pass and the lookup then broke early, so
 * the colour may belong to a commit this PR no longer carries. That case
 * reads `unknown` with `checksLookup` set, rather than the stale colour.
 *
 * `mergeable` is always `unknown` here: Bitbucket Cloud's REST API has no
 * field or endpoint that reports merge-conflict status for a pull request
 * (measured 2026-10-20 against the PR object, its diffstat, and its
 * statuses). `plot-host.sh` overlays a real reading from a local
 * `git merge-tree` check afterward, via `foldBitbucketMergeable`.
 *
 * `mergedAt` is `updated_on` for a `MERGED` pull request, `''` otherwise —
 * the same stand-in `pr-list`'s Bitbucket arm already reads (#2238), because
 * the endpoint names no real merge timestamp (#2202). `updated_on` can move
 * after the merge (a later comment or label), so a caller ordering several
 * hops by this field gets whatever order that implies; see the release-chain
 * rule's own note on the same ceiling.
 *
 * @param pr - the payload, or `null` where the branch has no pull request.
 * @param colours - the branch-colour map, or `null` where it was not read.
 * @param bound - the sha-bound readings keyed by branch, or `null`.
 * @param wasNamed - true where this row's branch was picked for a sha lookup
 *   this pass (ambiguous colour, known head). Ignored unless `bound` has no
 *   entry for the branch.
 * @returns the row; a missing pull request reads `NONE` with no check.
 */
export const bitbucketPrState = (
  pr: BitbucketPr | null,
  colours: Readonly<Record<string, Reading>> | null,
  bound: Readonly<Record<string, Reading>> | null,
  wasNamed = false,
): PrStateRow => {
  if (pr === null) return { number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '' };
  const branch = pr.source?.branch?.name ?? '';
  const boundEntry = bound?.[branch] ?? null;
  const colourEntry = colours?.[branch] ?? null;
  const ambiguous = colourEntry?.checks === 'green' || colourEntry?.checks === 'failing';
  const brokenAsk = wasNamed && boundEntry === null && ambiguous;
  const entry = boundEntry ?? colourEntry;
  const checks = colours === null ? 'unknown' : brokenAsk ? 'unknown' : (entry?.checks ?? 'none');
  return {
    number: pr.id,
    state: pr.state === 'DECLINED' ? 'CLOSED' : pr.state,
    draft: pr.draft ?? false,
    url: pr.links.html.href,
    mergeCommit: pr.merge_commit?.hash ?? '',
    headSha: pr.source?.commit?.hash ?? '',
    base: pr.destination?.branch?.name ?? '',
    checks,
    checksSha: brokenAsk ? '' : (entry?.checksSha ?? ''),
    mergeable: 'unknown',
    mergedAt: pr.state === 'MERGED' ? (pr.updated_on ?? '') : '',
    ...(brokenAsk ? { checksLookup: 'broken' } : {}),
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
 * `description` and `time` answer `''` always — Bitbucket has no
 * `commitStatus` writer this host can drive, so no run embeds a run id here
 * for a newest-pending-wins rule to read back.
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
): { sha: string; state: string; description: string; time: string; bypass: boolean } => ({
  sha,
  state: REVIEW_STATE[statuses.find((s) => s.key === 'plot/review')?.state ?? ''] ?? 'absent',
  description: '',
  time: '',
  bypass: comments.some((c) => (c.content?.raw ?? '').startsWith('review-bypass:')),
});
