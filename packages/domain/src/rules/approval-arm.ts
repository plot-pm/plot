/** Who or what approves a plan. */
export type ApprovalArm = 'person' | 'pr' | 'ballot';

/**
 * The arm an approval takes.
 *
 * Keyed on the phase and the review channel only, never on a record: a record
 * can be edited away by hand, and the phase is a value the state gate holds.
 *
 * - `ballot`: `Review: ballot`, in every phase. The tally is the act of named
 *   people, and `approve` refuses it.
 * - `person`: a `design` plan on any other channel (`pr`, `in-session`, `NONE`
 *   or an empty field), and an `in-session` plan in any phase. `--who` must
 *   name a handle in `People`.
 * - `pr`: every other plan. The plan PR's merge is the approval.
 *
 * @param plan - the plan's normalized phase and declared review channel.
 * @returns the arm.
 */
export const approvalArm = (plan: { phase: string; review: string }): ApprovalArm => {
  const review = plan.review.trim().toLowerCase();
  if (review === 'ballot') return 'ballot';
  if (review === 'in-session') return 'person';
  if (plan.phase.trim().toLowerCase() !== 'design') return 'pr';
  return review === 'pr' || review === 'none' || review === '' ? 'person' : 'pr';
};
