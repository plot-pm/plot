import { z } from 'zod';

import { type BranchState, SliceVerdictSchema, type SliceVerdict } from '../entities/fleet.js';

/**
 * What a reader may do about one branch, or `null` when there is nothing to say.
 *
 * Distinct from a slice's verdict, and neither is derived from the other: a
 * slice verdict answers *may this cohort start?* while this answers *may I
 * start this branch, now?* — `needs-brief` and `someone-is-on-it` are branch
 * facts no slice verdict carries.
 */
export const StartabilityVerdictSchema = z.enum([
  'start-work', 'needs-brief', 'waiting-on-approval', 'someone-is-on-it',
]);
export type StartabilityVerdict = z.infer<typeof StartabilityVerdictSchema>;

/**
 * Whether a branch's hand-off brief was found.
 *
 * `unknown` is a third value rather than a default for `missing`: a caller that
 * did not look has said nothing, and reporting that as an absent brief would
 * claim a gap nobody measured.
 */
export const BriefStateSchema = z.enum(['present', 'missing', 'unknown']);
export type BriefState = z.infer<typeof BriefStateSchema>;

/**
 * Whether one branch can be started, from four readings and no I/O.
 *
 * The gates apply in order and the first that fires wins: the branch's own
 * state, then the plan's phase, then the slice's wave ordering, then the brief.
 *
 * @param state - the branch's state, as the scan reports it.
 * @param planPhase - the governing plan's phase, lowercased.
 * @param verdict - the slice's verdict, as the scan reports it.
 * @param brief - whether a hand-off brief was found for the branch.
 * @returns the verdict, or `null` where nothing is offered.
 */
export const startabilityVerdict = (
  state: BranchState,
  planPhase: string,
  verdict: string,
  brief: BriefState,
): StartabilityVerdict | null => {
  // `wip` and `claimed` mean someone has it; merged is finished; deferred was
  // shelved. Only `open` can be started.
  if (state === 'wip' || state === 'claimed') return 'someone-is-on-it';
  if (state === 'merged' || state === 'deferred') return null;

  // A Draft plan is not yours to start — approve it or leave it.
  if (planPhase === 'draft') return 'waiting-on-approval';

  // A branch an earlier wave blocks cannot be started whatever the brief says.
  if (verdict !== 'eligible') return null;

  // An eligible branch of an approved plan with no brief is not startable:
  // `/plot-implement` writes it and `plot-dispatch.sh` refuses without one.
  // `unknown` reads as present — see {@link BriefStateSchema}.
  if (brief === 'missing') return 'needs-brief';

  return 'start-work';
};

/**
 * A slice verdict, or `null` where the value is not one.
 *
 * The parse IS the rule: the wire carries a string, and what the domain accepts
 * as a verdict is the enum rather than whatever the scan happened to print.
 *
 * @param verdict - the value the scan reported.
 * @returns the verdict, or `null` when it is not a member.
 */
export const waveVerdict = (verdict: string): SliceVerdict | null => {
  const parsed = SliceVerdictSchema.safeParse(verdict);
  return parsed.success ? parsed.data : null;
};
