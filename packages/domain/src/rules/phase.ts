import { z } from 'zod';

import type { BranchState } from '../entities/fleet.js';
import type { StoryStatus } from '../entities/story.js';
import type { Phase } from '../entities/workflow.js';
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
  'draft', 'open', 'approved', 'in-progress', 'deliverable', 'delivered', 'released',
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

/**
 * The workflow phase a plan state belongs to, or `null` for a state there is none.
 *
 * `null` rather than a default: a state this does not know is a plan format the
 * workflow does not understand, and putting it in Discovery would answer a
 * question nobody could answer.
 *
 * @param helperPhase - the state as the plan file spells it, lowercased.
 * @param _started - unused; kept as the seam a `started`-forking state would use.
 * @returns the phase, or `null` where the state is not one the workflow knows.
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
 * The workflow phase a story status belongs to.
 *
 * Total over the six statuses, unlike {@link toBoardPhase}: a status is a value
 * of a closed enum, so there is no unrecognised case to answer `null` for.
 *
 * Discovery produces an approved story, so a story being written is in it and a
 * `ready` story is what Design starts from. `paused` holds Development rather
 * than returning to Design: pausing stops work, it does not undo it.
 *
 * @param status - the story's status, from its frontmatter.
 * @returns the phase the story's work has reached.
 */
export const storyPhase = (status: StoryStatus): Phase => {
  switch (status) {
    case 'draft':
      return 'Discovery';
    case 'ready':
      return 'Design';
    case 'active':
    case 'paused':
      return 'Development';
    case 'in-review':
      return 'Testing';
    case 'done':
      return 'Released';
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
