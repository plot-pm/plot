import type { PlanRecord } from '../ports/plan-store.js';
import type { SliceReadings } from './eligible.js';
import { spikeOf } from './spike.js';

/**
 * One plan's slices as {@link SliceReadings}, read the same way by every
 * caller that builds them from a {@link PlanRecord}.
 *
 * `spike` and `spikeApproved` are read here and nowhere else per caller, so
 * the fleet scan's walk and the registry's queue agree on an approved spike
 * of a Design plan — the disagreement `sliceVerdicts` could not otherwise
 * catch, because both fields are optional on `SliceReadings` and a caller that
 * omits them still compiles.
 *
 * @param plan - the plan, as the plan store parsed it.
 * @param outstanding - one count per slice, in the caller's own policy: which
 *   branches count as unmerged is the caller's `settled`/landing rule, not
 *   this builder's.
 * @returns one `SliceReadings` per slice, in the plan's own order.
 */
export const sliceReadingsOf = (
  plan: PlanRecord,
  outstanding: readonly number[],
): SliceReadings[] => {
  const spike = spikeOf(plan.slices);
  const spikeApproved = plan.spikeApprovedRaw !== undefined && plan.spikeApprovedRaw !== '';
  return plan.slices.map((slice, s) => ({
    outstanding: outstanding[s]!,
    phase: plan.phase,
    branches: slice.branches.length,
    spike: spike?.slice === s,
    spikeApproved,
  }));
};
