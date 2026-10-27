/** A parsed plan, reduced to what {@link branchGivenUp} reads. */
export interface PlanBranchLines {
  /** Whether the Active index links the plan. */
  readonly active: boolean;
  /** The plan's slices, each naming the branches under it. */
  readonly slices: ReadonlyArray<{
    readonly branches: ReadonlyArray<{ readonly branch: string; readonly deferred: boolean }>;
  }>;
}

/**
 * Whether the plans have given a branch up.
 *
 * The parser reports `deferred` for both `<!-- deferred: … -->` and
 * `<!-- moved: … -->`, so the annotation word does not decide.
 *
 * @param branch - the branch to ask about.
 * @param plans - every plan under the plan directory, with whether the Active index links it.
 * @returns `true` when at least one plan marks the branch deferred and no
 *   Active-index plan schedules it as an active slice; `false` otherwise,
 *   including when no plan names it.
 */
export const branchGivenUp = (branch: string, plans: readonly PlanBranchLines[]): boolean => {
  const lines = plans.flatMap((plan) =>
    plan.slices.flatMap((slice) =>
      slice.branches.filter((b) => b.branch === branch).map((b) => ({ active: plan.active, deferred: b.deferred })),
    ),
  );
  const deferred = lines.some((line) => line.deferred);
  const stillScheduled = lines.some((line) => line.active && !line.deferred);
  return deferred && !stillScheduled;
};
