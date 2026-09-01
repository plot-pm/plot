import { z } from 'zod';

import type { BranchState } from '../entities/fleet.js';
import type { Landed } from './deliverable.js';

/**
 * The columns a board shows, in the order work passes through them.
 *
 * Five rather than one per plan phase: Delivered and Released are both work
 * that has landed, and a column is a partition.
 */
export const BOARD_PHASES = [
  'Discovery', 'Design', 'Development', 'Testing', 'Released',
] as const;
export type Phase = (typeof BOARD_PHASES)[number];

/**
 * A plan's status, as a reader acts on it rather than as the file spells it.
 *
 * Finer than {@link Phase}: one phase can hold several statuses, because
 * `approved` covers a plan nobody has started, one in flight, and one whose
 * every branch has landed.
 */
export const PlanStatusSchema = z.enum([
  'draft', 'open', 'approved', 'in-progress', 'deliverable', 'delivered', 'released',
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

/**
 * The board column a plan phase belongs to, or `null` for a phase there is none.
 *
 * `null` rather than a default: a phase this does not know is a plan format
 * this board does not understand, and putting it in Discovery would render a
 * confident answer to a question nobody could answer.
 *
 * @param helperPhase - the phase as the plan file spells it, lowercased.
 * @param _started - unused; kept as the seam a `started`-forking phase would use.
 * @returns the column, or `null` where the phase is not one this board knows.
 */
export const toBoardPhase = (helperPhase: string, _started = false): Phase | null => {
  switch (helperPhase) {
    case 'draft':
      return 'Discovery';
    case 'design':
      return 'Design';
    case 'approved':
      return 'Development';
    case 'delivered':
      return 'Testing';
    case 'released':
      return 'Released';
    default:
      return null;
  }
};

/**
 * The column ONE BRANCH belongs to, which is not always its plan's.
 *
 * A deferred branch returns to the plan's own phase whatever its commits say —
 * the one place intent outranks git, because a branch given up is not work in
 * progress.
 *
 * @param planPhase - the governing plan's phase, lowercased.
 * @param state - the branch's state, as the scan reports it.
 * @returns the column, or `null` where the phase is not one this board knows.
 */
export const rowPhase = (planPhase: string, state: BranchState): Phase | null => {
  if (state === 'deferred') return toBoardPhase(planPhase, false);
  // `merged` and `wip` count as started; `claimed` does NOT — an empty claim
  // marker is a dispatcher taking a branch, not an agent having built anything.
  return toBoardPhase(planPhase, state === 'wip' || state === 'merged');
};

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
}

/**
 * A plan's status, from readings and no I/O.
 *
 * Only `approved` is more than a rename: a plan whose branches have all landed
 * is `deliverable`, one somebody has started or claimed is `in-progress`, and
 * one nobody has touched is `approved`.
 *
 * A draft splits on the review channel rather than on the phase: `Review: pr`
 * means the draft is public and readable, which is `open`; anything else is
 * still `draft`.
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
    case 'approved':
      if (readings.landed === 'merged') return 'deliverable';
      if (readings.started || readings.anyClaimed) return 'in-progress';
      return 'approved';
    default:
      return readings.review === 'pr' ? 'open' : 'draft';
  }
};
