/** One workflow run as `gh run list --json headSha,conclusion,status,startedAt,url,databaseId,workflowName` exports it. */
export interface GhRun {
  readonly headSha: string;
  readonly conclusion: string | null;
  readonly status: string;
  readonly startedAt: string;
  readonly url: string;
  readonly databaseId?: number;
  readonly workflowName?: string | null;
}

/** One entry of the `runs-for-sha` answer, in the shape `plot-host.sh` prints it. */
export interface RunForShaRow {
  sha: string;
  workflow: string;
  status: string;
  conclusion: string | null;
  url: string;
  startedAt: string;
}

/**
 * Every run for one commit, in the listing's order.
 *
 * A declared duplicate of the jq program in `plot-host.sh`'s `runs-for-sha`
 * arm; `corpus/runs-for-sha.corpus.test.ts` holds the two to one answer. The
 * listing is newest first, so the first entry is the newest run for the
 * commit. A run for any other commit is dropped. An empty conclusion reads
 * as null, and a missing workflow name as `''`.
 *
 * @param runs - the branch's runs, newest first, as `gh` exports them.
 * @param sha - the commit asked about.
 * @returns the commit's runs, newest first; `[]` where none matches.
 */
export const runsForShaOf = (runs: readonly GhRun[], sha: string): RunForShaRow[] =>
  runs
    .filter((one) => one.headSha === sha)
    .map((one) => ({
      sha: one.headSha,
      workflow: one.workflowName ?? '',
      status: one.status,
      conclusion: (one.conclusion ?? '') === '' ? null : one.conclusion,
      url: one.url,
      startedAt: one.startedAt,
    }));
