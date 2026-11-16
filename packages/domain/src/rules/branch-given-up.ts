/** A parsed plan, reduced to what {@link branchGivenUp} reads. */
export interface PlanBranchLines {
  /** Whether the Active index links the plan. */
  readonly active: boolean;
  /** The plan's file path, as the caller names it. Read by {@link branchGivenUpBy} only. */
  readonly file?: string;
  /** The plan's slices, each naming the branches under it. */
  readonly slices: ReadonlyArray<{
    readonly branches: ReadonlyArray<{
      readonly branch: string;
      readonly deferred: boolean;
      /** The text after `deferred:` or `moved:`; empty or absent for a bare marker. */
      readonly reason?: string;
    }>;
  }>;
}

/** The plan line that gave a branch up. */
export interface GivenUpBy {
  /** The plan file holding the first deferred line for the branch, `''` when the plan carries no `file`. */
  readonly file: string;
  /** The deferred line's reason, `''` for a bare marker. */
  readonly reason: string;
  /** The leading `YYYY-MM-DD` of the reason, `null` when the reason opens with none. */
  readonly date: string | null;
}

/**
 * The plan line that gave a branch up.
 *
 * The parser reports `deferred` for both `<!-- deferred: … -->` and
 * `<!-- moved: … -->`, so the annotation word does not decide.
 *
 * @param branch - the branch to ask about.
 * @param plans - every plan under the plan directory, with whether the Active index links it.
 * @returns the first deferred line in plan order when no Active-index plan
 *   schedules the branch as an active slice; `null` otherwise, including when
 *   no plan names the branch.
 */
export const branchGivenUpBy = (branch: string, plans: readonly PlanBranchLines[]): GivenUpBy | null => {
  const lines = plans.flatMap((plan) =>
    plan.slices.flatMap((slice) =>
      slice.branches
        .filter((b) => b.branch === branch)
        .map((b) => ({ plan, active: plan.active, deferred: b.deferred, reason: b.reason ?? '' })),
    ),
  );
  const first = lines.find((line) => line.deferred);
  const stillScheduled = lines.some((line) => line.active && !line.deferred);
  if (first === undefined || stillScheduled) return null;
  const date = /^\d{4}-\d{2}-\d{2}/.exec(first.reason.trim());
  return { file: first.plan.file ?? '', reason: first.reason, date: date ? date[0] : null };
};

/**
 * Whether the plans have given a branch up.
 *
 * @param branch - the branch to ask about.
 * @param plans - every plan under the plan directory, with whether the Active index links it.
 * @returns `true` exactly when {@link branchGivenUpBy} answers a line.
 */
export const branchGivenUp = (branch: string, plans: readonly PlanBranchLines[]): boolean =>
  branchGivenUpBy(branch, plans) !== null;
