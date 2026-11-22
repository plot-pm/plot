/**
 * The counted slices per plan that the sprint, release and person cards score.
 *
 * @concept counted-slices
 */
import { pulseOmitsPlan } from './pulse-omits-plan.js';
import type { CountedSlice } from './slice-states.js';

/** One counted slice, with the plan it belongs to. */
export interface PlanCountedSlice extends CountedSlice {
  /** The plan's key, as the payload names it. */
  readonly plan: string;
}

/** The plan file's facts that decide a plan the pulse omits. */
export interface CountedPlanFacts {
  /** The plan's key, as the payload names it. */
  readonly plan: string;
  /** The plan's phase, as the plan store reads it. */
  readonly phase: string;
  /** The plan's `Type:` value, as the plan store reads it. */
  readonly type: string;
  /** The work item ids of the plan's slices that hold a non-deferred branch, in document order. */
  readonly sliceIds: readonly string[];
  /** The work item id that stands for the whole plan where `sliceIds` is empty. */
  readonly planId: string;
}

/** The readings {@link countedSlicesByPlan} folds. */
export interface CountedSlicesInput {
  /** The plans that get an entry, `[]` where no counted slice names them. */
  readonly seen: readonly string[];
  /** The counted slices, appended to their plan's entry in this order. */
  readonly slices: readonly PlanCountedSlice[];
  /** The plan facts; absent where the caller read none. */
  readonly plans?: readonly CountedPlanFacts[];
}

/**
 * The counted slices per plan.
 *
 * Each plan in `seen` gets an entry, and each slice is appended to its plan's
 * entry. A plan whose facts read phase `delivered`, for which `pulseOmitsPlan`
 * holds, and whose entry is absent or empty, gets one merged slice per id in
 * `sliceIds`, or one merged slice with id `planId` where `sliceIds` is empty.
 * A non-empty entry stays as it is. Every other plan keeps what it has, so a
 * plan with no reading has no entry.
 *
 * @param input - the plans seen, the counted slices and the plan facts.
 * @returns the counted slices keyed by plan.
 */
export const countedSlicesByPlan = ({ seen, slices, plans = [] }: CountedSlicesInput): Map<string, CountedSlice[]> => {
  const byPlan = new Map<string, CountedSlice[]>();
  for (const plan of seen) {
    if (plan !== '' && !byPlan.has(plan)) byPlan.set(plan, []);
  }
  for (const { plan, id, merge } of slices) {
    const list = byPlan.get(plan) ?? [];
    list.push({ id, merge });
    byPlan.set(plan, list);
  }
  for (const facts of plans) {
    if (facts.phase !== 'delivered' || !pulseOmitsPlan(facts.phase, facts.type)) continue;
    if ((byPlan.get(facts.plan) ?? []).length > 0) continue;
    const ids = facts.sliceIds.length > 0 ? facts.sliceIds : [facts.planId];
    byPlan.set(facts.plan, ids.map((id): CountedSlice => ({ id, merge: 'merged' })));
  }
  return byPlan;
};
