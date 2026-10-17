/**
 * A Jenkins build as `plot-host.sh`'s sha-bound read reports it.
 */
export interface JenkinsShaRun {
  /** `in_progress` while the build runs, `completed` after. */
  status: string;
  /** Jenkins' raw `result` word, or `null` while the build runs. */
  conclusion: string | null;
  /** ISO timestamp of the build's start, or `''`. */
  startedAt: string;
}

/**
 * A PR row's check as bound to its head commit.
 */
export interface BoundChecks {
  /** The PR row's `checks` word. */
  checks: 'green' | 'pending' | 'failing' | 'unknown';
  /** The job path the word was read from. */
  job: string;
}

/**
 * A PR row of the host's list, reduced to what binding needs.
 */
export interface PrRowHead {
  /** The row's head branch. */
  headRefName: string;
  /** The row's head commit, or absent where the host reported none. */
  headRefOid?: string | null;
}

/**
 * The rows whose branch colour cannot settle the head's check.
 *
 * A branch colour carries no commit, so `green` and `failing` may belong to the
 * previous head. `none` and `pending` need no sha: nothing concluded, or a build
 * is already in flight. A row with no head sha cannot be bound.
 *
 * @param rows - the host's PR rows.
 * @param colours - the branch-colour map, keyed by branch, each entry carrying
 *   `checks` and `job`.
 * @returns one entry per row to read by sha, in row order.
 */
export const rowsToBind = (
  rows: readonly PrRowHead[],
  colours: Readonly<Record<string, { checks?: string; job?: string }>>,
): Array<{ branch: string; sha: string; job: string }> =>
  rows.flatMap((row) => {
    const sha = row.headRefOid ?? '';
    const entry = colours[row.headRefName];
    const ambiguous = entry?.checks === 'green' || entry?.checks === 'failing';
    return sha !== '' && ambiguous
      ? [{ branch: row.headRefName, sha, job: entry.job ?? row.headRefName }]
      : [];
  });

/**
 * The check of the newest build that ran a row's head commit.
 *
 * `UNSTABLE` is failing. Every other word without a verdict — `ABORTED`,
 * `NOT_BUILT` — is `unknown`, because the PR row's `checks` has no `cancelled`.
 *
 * @param runs - builds of one commit, in any order.
 * @param job - the job path to report.
 * @returns the bound check, or `null` where no build ran that commit.
 */
export const bindChecks = (runs: readonly JenkinsShaRun[], job: string): BoundChecks | null => {
  const newest = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (newest === undefined) return null;
  const word = newest.conclusion;
  if (newest.status === 'in_progress' || word === null) return { checks: 'pending', job };
  if (word === 'SUCCESS') return { checks: 'green', job };
  if (word === 'FAILURE' || word === 'UNSTABLE') return { checks: 'failing', job };
  return { checks: 'unknown', job };
};
