/**
 * Whether a plan names a branch: the reading the Delivery tab's loose placement
 * and the `loose-delete` controller's `named` refusal share.
 *
 * A slice names its branch, deferred or not, while its plan is Draft, Design,
 * Approved or Delivered. A plan that is Released, Superseded or Rejected is
 * finished, and its slices name no branch.
 *
 * @concept plan-names-branch
 */

/** The plan phases whose slices name no branch, as the plan store normalizes them. */
export const FINISHED_PLAN_PHASES: ReadonlySet<string> = new Set(['released', 'superseded', 'rejected']);

/**
 * Whether a plan in `phase` is finished, so that its slices name no branch.
 *
 * @param phase - the plan's phase, in any letter case.
 * @returns `true` for `released`, `superseded` and `rejected`.
 */
export const planIsFinished = (phase: string): boolean => FINISHED_PLAN_PHASES.has(phase.toLowerCase());

/** A parsed plan, reduced to what {@link planNamesBranch} reads. */
export interface PlanNamingReading {
  /** The plan's phase, in any letter case. */
  readonly phase: string;
  /** The plan's slices, each with the branch lines under it, deferred ones included. */
  readonly slices: ReadonlyArray<{ readonly branches: ReadonlyArray<{ readonly branch: string }> }>;
}

/**
 * Whether `plan` names `branch` in a slice.
 *
 * @param plan - the plan's phase and slices.
 * @param branch - the branch to look for.
 * @returns `true` where a slice line names the branch, deferred or moved
 *   included, and the plan is not finished.
 */
export const planNamesBranch = (plan: PlanNamingReading, branch: string): boolean =>
  !planIsFinished(plan.phase) && plan.slices.some((slice) => slice.branches.some((line) => line.branch === branch));
