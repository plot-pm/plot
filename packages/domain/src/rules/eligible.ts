import type { BranchState, SliceVerdict } from '../entities/fleet.js';

/**
 * What was measured of ONE slice, from the two sources that can answer.
 *
 * `outstanding` is a COUNT rather than the branches themselves, because that is
 * all the verdict reads and because the count is where the caller's own policy
 * lives: a strict scan counts every unmerged branch, a `--loose` one discounts
 * pushed work whose PR verifiably passed. Which branches are settled is
 * adaptation — a git state and, under `--loose`, a host round trip; *what the
 * slice therefore is* is this rule.
 *
 * `phase` is the PLAN's phase, carried verbatim as the parser spelled it. It is
 * compared against an allowlist of one, so an unreadable or unexpected value
 * withholds `eligible` rather than inheriting it.
 */
export interface SliceReadings {
  /** Non-deferred branches of this slice that have not settled. */
  outstanding: number;
  /** The governing plan's phase, lowercased as the parser emits it. */
  phase: string;
}

/**
 * The one phase under which a slice may be started.
 *
 * AN ALLOWLIST OF ONE, mirroring `plot-dispatch.sh`'s own gate rather than
 * testing for `draft`. A denylist is the blocklist-collapse shape this codebase
 * keeps removing: `design` names a phase whose work cannot yet be handed over,
 * and `UNKNOWN`/`NONE` are unreadable answers. Under a `draft`-only test each of
 * those would inherit the good word.
 */
const DISPATCHABLE_PHASE = 'approved';

/**
 * The verdict for one slice, given what it holds and what stands before it.
 *
 * `eligible` IS A CLAIM ABOUT STARTABILITY, not about ordering alone. Measured
 * 2026-08-27: every one-slice plan in `not-started` on the live board read
 * `eligible`, and `plot-dispatch.sh` refused all six — *"plan is still Draft"*.
 * Both components were correct and answering different questions. They coincide
 * only for an approved plan, so approval is part of the word.
 *
 * ORDERING IS STILL COMPUTED FIRST, and `complete` outranks everything: a slice
 * whose branches have all merged IS complete whatever its plan says, because
 * that is a statement about work that already landed rather than an invitation
 * to start any. Only the word a reader ACTS on is withheld.
 *
 * NOT `blocked` for an unapproved plan, deliberately. That word means *an
 * earlier slice has not landed* — an ordering fact that resolves by merging
 * work. This resolves by a person approving the plan, and `blocked by <slice> —
 * 1 branch` is a sentence a row in this state cannot truthfully complete.
 *
 * @param readings What was measured of the slice.
 * @param priorComplete Whether every slice before this one is `complete`.
 * @returns The slice's verdict.
 */
export const sliceVerdict = (
  readings: SliceReadings,
  priorComplete: boolean,
): SliceVerdict => {
  if (readings.outstanding === 0) return 'complete';
  if (readings.phase !== DISPATCHABLE_PHASE) return 'unapproved';
  return priorComplete ? 'eligible' : 'blocked';
};

/**
 * Every slice of one plan, in the plan's own order.
 *
 * A FOLD, not a map, and that is the rule rather than a convenience: a slice's
 * verdict depends on every slice before it, so a caller asking one at a time
 * would have to carry `priorComplete` itself — which is the ordering half of
 * this rule leaking back out to the caller that just gave it up.
 *
 * `complete` is what advances the chain. Anything else stops it, including
 * `unapproved`: a plan nobody approved has landed nothing, so a later slice of
 * it is not ordered behind finished work.
 *
 * @param slices The plan's slices, in the order the plan names them.
 * @returns One verdict per slice, in the same order.
 */
export const sliceVerdicts = (slices: readonly SliceReadings[]): SliceVerdict[] => {
  let priorComplete = true;
  return slices.map((slice) => {
    const verdict = sliceVerdict(slice, priorComplete);
    priorComplete &&= verdict === 'complete';
    return verdict;
  });
};

/**
 * Whether a dispatch may take THIS branch right now.
 *
 * Two facts, and both are needed. The verdict speaks for the slice — an
 * `eligible` slice may be started — while `open` speaks for the branch: it is
 * the one state meaning *no ref, no PR, nobody on it*. A `claimed` branch of an
 * eligible slice is somebody's, a `wip` one is under way, and `unknown` is a
 * host that could not be asked, which is never permission.
 *
 * This is the claim `--next` acts on immediately by pushing a ref, so the
 * conjunction is the gate rather than a filter applied afterwards.
 *
 * @param verdict The slice's verdict.
 * @param state The branch's measured state.
 * @returns True when a worker may claim this branch.
 */
export const isClaimable = (verdict: SliceVerdict, state: BranchState): boolean =>
  verdict === 'eligible' && state === 'open';
