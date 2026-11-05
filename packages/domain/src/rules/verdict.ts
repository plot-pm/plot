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
// plot-state: classification — what a reader may DO about a branch, recomputed
//                              from four readings on every call. Nothing holds
//                              a verdict, so nothing moves between these: the
//                              branch transitions and the verdict is derived
//                              again.
export const StartabilityVerdictSchema = z.enum([
  'start-work', 'needs-brief', 'waiting-on-approval', 'someone-is-on-it', 'no-known-worker',
]);
export type StartabilityVerdict = z.infer<typeof StartabilityVerdictSchema>;

/**
 * Whether a branch's hand-off brief was found.
 *
 * `unknown` is a third value rather than a default for `missing`: a caller that
 * did not look has said nothing, and reporting that as an absent brief would
 * claim a gap nobody measured.
 */
// plot-state: reading — whether a brief was found when somebody looked. The
//                       file appears and disappears; this records one look, and
//                       'unknown' is the look nobody took.
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

  // A branch held by an open `waits:` annotation has no pull request to start
  // from, whatever its slice verdict and brief say.
  if (state === 'waiting' || state === 'blocked') return null;

  // A branch an earlier wave blocks cannot be started whatever the brief says.
  if (verdict !== 'eligible') return null;

  // An eligible branch of an approved plan with no brief is not startable:
  // `/plot-implement` writes it and `plot-dispatch.sh` refuses without one.
  // `unknown` reads as present — see {@link BriefStateSchema}.
  if (brief === 'missing') return 'needs-brief';

  return 'start-work';
};

/** What {@link sliceHold} reads of one branch. */
export interface HoldBranch {
  /** The branch name. */
  branch: string;
  /** The branch's state, as the scan reports it. */
  state: BranchState;
  /** {@link startabilityVerdict} for the branch, or `null`. */
  startability: StartabilityVerdict | null;
}

/** A slice whose only unsettled branches wait on an open `waits:` annotation. */
export interface SliceHold {
  /** Whether any held branch is `blocked` (its prerequisite has no pull request). */
  blocked: boolean;
  /** The names of the held (`waiting` or `blocked`) branches. */
  held: string[];
}

/**
 * Whether an eligible slice is held: it has unsettled branches, at least one
 * waits on an open prerequisite, and none of them is startable.
 *
 * Reads {@link startabilityVerdict} through each branch's `startability` and adds
 * only the hold. A branch counts as unsettled unless it is `merged` or `deferred`.
 *
 * @param verdict - the slice's verdict, as the scan reports it.
 * @param branches - each branch's state and startability.
 * @returns the hold, or `null` where the slice is not held.
 */
export const sliceHold = (verdict: string, branches: readonly HoldBranch[]): SliceHold | null => {
  if (verdict !== 'eligible') return null;
  const unsettled = branches.filter((b) => b.state !== 'merged' && b.state !== 'deferred');
  if (unsettled.some((b) => b.startability !== null)) return null;
  const holding = branches.filter((b) => b.state === 'waiting' || b.state === 'blocked');
  if (holding.length === 0) return null;
  return { blocked: holding.some((b) => b.state === 'blocked'), held: holding.map((b) => b.branch) };
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
