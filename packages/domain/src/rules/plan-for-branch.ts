/**
 * Which plan names a branch, and under which wave heading.
 *
 * Shared by `plot-open-pr.sh` and `plot-record-pr.sh`, which both answer
 * "which plan names this branch" the same way: grep candidate plan files by
 * literal branch name, parse each with `plot-plan-meta.sh`, and take the one
 * whose `waves[].branches[].branch` matches. The grep stays in shell — it is
 * a filesystem search, not a decision — and this rule is the decision: given
 * the parsed metadata of each candidate, which one names the branch, and
 * what is its wave called.
 *
 * @concept plan-for-branch
 */

/** The shape `plot-plan-meta.sh` prints, reduced to what this rule reads. */
export interface PlanMetaForBranch {
  /** The plan file's path, as `plot-plan-meta.sh` reports it. */
  readonly file: string;
  /** The plan's waves, each naming the branches under it. */
  readonly waves: ReadonlyArray<{
    readonly name: string;
    readonly branches: ReadonlyArray<{ readonly branch: string }>;
  }>;
}

/** Which plan file names the branch, and the wave heading it names it under. */
export interface PlanForBranch {
  readonly file: string;
  readonly waveName: string;
}

/**
 * The first candidate whose waves name `branch`, and the wave it names it
 * under — or `undefined` when no candidate does.
 *
 * Candidates are tried in order and the first match wins: a branch belongs to
 * exactly one plan, so ties are not expected, and the order is the caller's
 * (typically grep's match order) rather than a judgement made here.
 *
 * @param candidates the parsed metadata of each plan file to check, in the
 *   order they should be tried.
 * @param branch the branch to find.
 */
export const planForBranch = (candidates: readonly PlanMetaForBranch[], branch: string): PlanForBranch | undefined => {
  for (const meta of candidates) {
    for (const wave of meta.waves) {
      if (wave.branches.some((b) => b.branch === branch)) {
        return { file: meta.file, waveName: wave.name };
      }
    }
  }
  return undefined;
};
