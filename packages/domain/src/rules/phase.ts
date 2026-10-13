import { z } from 'zod';

import type { Landed } from './deliverable.js';

// THE PHASES BELONG TO THE WORKFLOW, RE-EXPORTED HERE. This file holds the
// mappings onto them; `entities/workflow.ts` holds the phases, their order and
// their leadership.
export { BOARD_PHASES, PHASE_LEADERSHIP, DevelopmentWorkflow, phaseOrder } from '../entities/workflow.js';
export type { Phase, PhaseLeadership } from '../entities/workflow.js';

/**
 * A plan's status, as a reader acts on it rather than as the file spells it.
 *
 * Finer than {@link Phase}: one phase can hold several statuses, because
 * `approved` covers a plan nobody has started, one in flight, and one whose
 * every branch has landed.
 */
// plot-state: lifecycle plan — the phase a plan is written through, refined by
//                              what its slices did. transitions/plan.ts holds
//                              the approve, deliver and release decisions and
//                              the refusals that order them.
export const PlanStatusSchema = z.enum([
  'draft', 'open', 'approved', 'in-progress', 'deliverable', 'proven', 'delivered', 'released', 'withdrawn',
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

/**
 * What was read of ONE plan, from the file and from the pulse.
 *
 * Readings rather than the sources they came from: the caller runs the pulse
 * queries and this decides, which is what keeps the rule callable without a
 * `FleetReading` in scope and testable without one.
 */
export interface PlanReadings {
  /** The phase the plan file states, lowercased. */
  phase: string;
  /** The plan's declared review channel — `pr` means a draft is public. */
  review: string;
  /** Whether the plan records any `Started:` line. */
  started: boolean;
  /** Whether every non-deferred branch has landed, as `allSlicesMerged` says. */
  landed: Landed;
  /** Whether any branch carries a claim nobody has built on yet. */
  anyClaimed: boolean;
  /** Whether the plan file carries `Tracer: yes`. Absent reads as a plan that is not a tracer. */
  tracer?: boolean;
}

/**
 * A plan's status, from readings and no I/O.
 *
 * Only `approved` is more than a rename: a plan whose branches have all landed
 * is `deliverable` (`proven` for a tracer plan, which never reads `deliverable`), one somebody has started or claimed is `in-progress`, and
 * one nobody has touched is `approved`.
 *
 * A draft splits on the review channel rather than on the phase: `Review: pr`
 * means the draft is public and readable, which is `open`; anything else is
 * still `draft`.
 *
 * `rejected` and `superseded` are one status, `withdrawn`: both name a plan
 * nobody intends to build, and a reader acts on them identically. They are
 * TERMINAL like `released` — the arm returns before the review channel, the
 * landed reading or the claim is consulted, because a plan somebody rejected
 * is rejected whether or not its draft was public and whether or not a branch
 * happened to land.
 *
 * @param readings - what was read of the plan.
 * @returns the status a reader acts on.
 */
export const planStatus = (readings: PlanReadings): PlanStatus => {
  switch (readings.phase) {
    case 'released':
      return 'released';
    case 'delivered':
      return 'delivered';
    case 'rejected':
    case 'superseded':
      return 'withdrawn';
    case 'approved':
      if (readings.landed === 'merged') return readings.tracer ? 'proven' : 'deliverable';
      if (readings.started || readings.anyClaimed) return 'in-progress';
      return 'approved';
    default:
      return readings.review === 'pr' ? 'open' : 'draft';
  }
};
