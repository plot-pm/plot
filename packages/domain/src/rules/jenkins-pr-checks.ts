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
  /** The head commit of the build the word was read from, or `''` where no build ran it. */
  checksSha: string;
}

/**
 * A PR row of the host's list, reduced to what binding needs.
 */
export interface PrRowHead {
  /** The row's head branch. */
  headRefName: string;
  /** The row's head commit, or absent where the host reported none. */
  headRefOid?: string | null;
  /** The host's last-change stamp of the row, or absent. */
  updatedAt?: string | null;
}

/** How many rows one `pr-list` pass reads by sha, at most. */
export const SHA_LOOKUPS_PER_PASS = 5;

/**
 * The rows whose branch colour cannot settle the head's check.
 *
 * A branch colour carries no commit, so `green` and `failing` may belong to the
 * previous head. `none` and `pending` need no sha: nothing concluded, or a build
 * is already in flight. A row with no head sha cannot be bound.
 *
 * Each entry costs the caller one Jenkins lookup, so at most `limit` rows are
 * returned, the most recently updated first. A row past the limit is left out
 * of the answer; the caller must not read its branch colour as the head's
 * check, because that is exactly the ambiguity this rule exists to flag.
 *
 * @param rows - the host's PR rows.
 * @param colours - the branch-colour map, keyed by branch, each entry carrying
 *   `checks` and `job`.
 * @param limit - the most rows to return.
 * @returns one entry per row to read by sha, newest `updatedAt` first.
 */
export const rowsToBind = (
  rows: readonly PrRowHead[],
  colours: Readonly<Record<string, { checks?: string; job?: string }>>,
  limit: number = SHA_LOOKUPS_PER_PASS,
): Array<{ branch: string; sha: string; job: string }> =>
  [...rows]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .flatMap((row) => {
      const sha = row.headRefOid ?? '';
      const entry = colours[row.headRefName];
      const ambiguous = entry?.checks === 'green' || entry?.checks === 'failing';
      return sha !== '' && ambiguous
        ? [{ branch: row.headRefName, sha, job: entry.job ?? row.headRefName }]
        : [];
    })
    .slice(0, limit);

/**
 * The check of a row's head commit, read from the builds Jenkins reported for it.
 *
 * `UNSTABLE` is failing. Every other word without a verdict — `ABORTED`,
 * `NOT_BUILT` — is `unknown`, because the PR row's `checks` has no `cancelled`.
 * An answer with no build of the commit is `unknown` and unbound: the colour
 * cannot bind to the head, and `pending` would hold the merge queue on a head
 * Jenkins may never report. A lookup that could not ask Jenkins is not an
 * answer, and returns `null` so the branch colour stands.
 *
 * @param runs - builds of the commit, in any order, or `null` where the lookup
 *   could not ask.
 * @param job - the job path to report.
 * @param sha - the head commit the builds were read for.
 * @returns the bound check, or `null` where the lookup could not ask.
 */
export const bindChecks = (
  runs: readonly JenkinsShaRun[] | null,
  job: string,
  sha: string,
): BoundChecks | null => {
  if (runs === null) return null;
  const newest = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (newest === undefined) return { checks: 'unknown', job, checksSha: '' };
  const word = newest.conclusion;
  const bound = (checks: BoundChecks['checks']): BoundChecks => ({ checks, job, checksSha: sha });
  if (newest.status === 'in_progress' || word === null) return bound('pending');
  if (word === 'SUCCESS') return bound('green');
  if (word === 'FAILURE' || word === 'UNSTABLE') return bound('failing');
  return bound('unknown');
};
