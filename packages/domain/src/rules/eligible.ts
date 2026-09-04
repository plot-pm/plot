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
 * The phases a plan cannot be dispatched from because it is FINISHED.
 *
 * An allowlist again, and a separate one: these do not mean *not yet approved*,
 * they mean *approved, built and shipped*. Folding them into the single
 * `!== 'approved'` test made a delivered plan's slice read `unapproved`, and
 * the row said *"the plan needs approving first"* about work that had already
 * landed. Measured 2026-09-04 on `an-agent-holds-one-desk`, Delivered with a
 * real `Approved:` record, every slice of it reading `unapproved`.
 *
 * The slice reads `complete` here even when its branches cannot be found. A
 * plan reaches `delivered` only through the delivery gate, which verifies every
 * non-deferred branch merged — so the plan's own phase is the stronger
 * evidence, and it is the evidence that survives the branch being reaped. Both
 * of that plan's outstanding slices name refs the host no longer has.
 */
const FINISHED_PHASES: readonly string[] = ['delivered', 'released'];

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
  // A FINISHED PLAN'S SLICE IS COMPLETE, whatever its branches now say. The
  // check sits above the approval test because `unapproved` is a statement
  // about the FUTURE — somebody must approve this — and a delivered plan has no
  // future to ask about.
  if (FINISHED_PHASES.includes(readings.phase)) return 'complete';
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
 * A THIRD FACT, AND IT IS THE BRANCH'S DECLARATION RATHER THAN A MEASUREMENT.
 * `held` is what {@link waitVerdict} made of the branch's `waits:` annotation:
 * "" where nothing holds it, `waiting` or `blocked` where something does. It is
 * tested SEPARATELY from `state` because the two can disagree — a caller that
 * has the plan's annotation but derives `state` from git alone would read
 * `open` over a live prerequisite, which is exactly the branch this rule must
 * refuse. Measured 2026-09-02: `waits_on` reached `FleetReading` and no rule,
 * and two workers were dispatched onto prerequisites that had not merged.
 *
 * DEFAULTED TO "", so a caller with no annotation to offer asks the question it
 * always asked. A branch declaring nothing is held by nothing.
 *
 * @param verdict The slice's verdict.
 * @param state The branch's measured state.
 * @param held What the branch's `waits:` annotation holds it in, or "".
 * @returns True when a worker may claim this branch.
 */
export const isClaimable = (
  verdict: SliceVerdict,
  state: BranchState,
  held: '' | 'waiting' | 'blocked' = '',
): boolean => verdict === 'eligible' && state === 'open' && held === '';

/**
 * What the host answered about a prerequisite branch's pull requests.
 *
 * `merged`      the host merged a PR for it — asked of PRs, never of refs
 * `unmerged`    the host has a PR for it and none merged
 * `none`        the host answered, and it has never seen a PR for that branch
 * `unreachable` the host could not be asked at all
 *
 * `none` AND `unreachable` ARE KEPT APART, and collapsing them is the defect
 * this type exists to prevent. `none` is evidence — a branch name nobody ever
 * opened work for, which is a typo. `unreachable` is the absence of evidence,
 * and the two lead to opposite verdicts below.
 */
export type PrereqAnswer = 'merged' | 'unmerged' | 'none' | 'unreachable';

/**
 * What a branch's `waits:` annotation makes of it, given what the host said.
 *
 * ```
 * ''        cleared — the prerequisite merged, so the annotation stops mattering
 * 'waiting' a wait with an end: the prerequisite exists and has not landed
 * 'blocked' no PR ever existed for the named branch — a typo, or a branch
 *           nobody created
 * ```
 *
 * THE QUESTION IS PUT TO THE HOST, NEVER TO THE REFS, and the caller owes that
 * shape. `plot-release-refs.sh` deletes the remote refs of a delivered plan's
 * merged branches, so a prerequisite that COMPLETED eventually has no ref — a
 * rule reading refs would hold its dependent forever because its dependency
 * succeeded. A merged PR outlives the branch it was cut from.
 *
 * AN UNREACHABLE HOST HOLDS AND DOES NOT BLOCK. Silence is not permission to
 * start, and it is equally not proof of a typo, so it answers `waiting`: a
 * refusal that resolves the moment the host can be asked again.
 *
 * @param waitsOn The branch this one waits on — "" where it declares none.
 * @param answer What the host said about that branch's pull requests.
 * @returns "" where nothing holds the branch, else the state it is held in.
 */
export const waitVerdict = (
  waitsOn: string,
  answer: PrereqAnswer,
): '' | 'waiting' | 'blocked' => {
  if (waitsOn === '') return '';
  if (answer === 'merged') return '';
  return answer === 'none' ? 'blocked' : 'waiting';
};
