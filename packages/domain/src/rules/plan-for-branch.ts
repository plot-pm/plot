/**
 * Which plan names a branch, and under which slice heading.
 *
 * Two steps, both pure. {@link plansMentioning} narrows the plan files to
 * those whose text contains the branch name: a branch name is a literal
 * string, so a plan that does not contain it cannot name it, and only the
 * survivors need parsing. {@link planForBranch} then reads the parsed
 * candidates and takes the one whose `slices[].branches[].branch` matches.
 *
 * @concept plan-for-branch
 */

/** A plan file's path and its text, as read from disk. */
export interface PlanText {
  /** The plan file's path. */
  readonly file: string;
  /** The whole file. */
  readonly text: string;
}

/** A parsed plan, reduced to what {@link planForBranch} reads. */
export interface PlanSlicesForBranch {
  /** The plan file's path, as the parser reports it. */
  readonly file: string;
  /** The plan's slices, each naming the branches under it. */
  readonly slices: ReadonlyArray<{
    readonly name: string;
    readonly branches: ReadonlyArray<{ readonly branch: string }>;
  }>;
}

/** Which plan file names the branch, and the slice heading it names it under. */
export interface PlanForBranch {
  readonly file: string;
  readonly sliceName: string;
}

/**
 * The plan files whose text contains `branch`, in the order given.
 *
 * @param plans - each plan file's path and text.
 * @param branch - the branch to look for, matched as a literal string.
 * @returns the paths of the plans that contain it.
 */
export const plansMentioning = (plans: readonly PlanText[], branch: string): string[] =>
  plans.filter((plan) => plan.text.includes(branch)).map((plan) => plan.file);

/**
 * The first candidate whose slices name `branch`, and the slice it names it
 * under — or `undefined` when no candidate does.
 *
 * Candidates are tried in order and the first match wins: a branch belongs to
 * one plan, and the order is the caller's.
 *
 * @param candidates - the parsed plans to check, in the order to try them.
 * @param branch - the branch to find.
 * @returns the plan file and slice name, or `undefined`.
 */
export const planForBranch = (candidates: readonly PlanSlicesForBranch[], branch: string): PlanForBranch | undefined => {
  for (const plan of candidates) {
    for (const slice of plan.slices) {
      if (slice.branches.some((b) => b.branch === branch)) {
        return { file: plan.file, sliceName: slice.name };
      }
    }
  }
  return undefined;
};
