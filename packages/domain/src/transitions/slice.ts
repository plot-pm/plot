import { SliceVerdictSchema, type SliceVerdict } from '../entities/fleet.js';
import type { PrereqAnswer } from '../rules/eligible.js';
import { waitVerdict } from '../rules/eligible.js';

/*
 * A SLICE'S STATE IS DERIVED, NOT STATED — so a transition here is a VERDICT on
 * a change that already happened, and carries nothing to write.
 *
 * The third file in that half of the split, after `transitions/agent.ts` and
 * `transitions/worktree.ts`. `DESIGN-plan.md:810`: *"Plan and Story are the only
 * two entities whose state is a stated fact rather than a derived relation."*
 * `DESIGN-slice.md` §14 states the slice's case in its own words — *"a slice is
 * derived; it has no file and no record"* — and what looks like a transition is
 * a branch somewhere else merging.
 *
 * WHAT THIS FILE ADDS THAT `rules/eligible.ts` DOES NOT: that rule answers *what
 * is this slice, right now*, from a count and a phase. This file answers *which
 * move between two such answers is legal*, and *what clears a prerequisite*. The
 * verdict is consumed here, never re-derived.
 *
 * AND IT DOES NOT DEPEND ON `outstanding === 0` MEANING FINISHED.
 * `rules/eligible.ts:80` returns `complete` above every other test, including
 * for a slice with no branches at all — `the-slice-contract-says-what-it-reads`
 * is an open Draft about that line. This rule takes the verdict as a reading and
 * never reconstructs it from a count, so that plan can correct the derivation
 * without moving a single refusal here.
 */

/**
 * The verdicts, in the order `DESIGN-slice.md` §4 draws them.
 *
 * Re-exported as a value because a renderer groups by verdict and needs the
 * order; `SliceVerdictSchema.options` carries the same set and is the source.
 * **The states are not redeclared** — `entities/fleet.ts:82` owns them, and
 * `rules/eligible.ts` and `rules/waiting.ts` already read them from there.
 *
 * `empty` COMES LAST BECAUSE IT IS NOT ON THE PATH. The first four are the
 * order work passes through; `empty` is a malformed slice reachable from none
 * of them and leading to none. A renderer grouping by this order therefore
 * shows it after the work, which is where a heading naming no branch belongs.
 */
export const SLICE_LIFECYCLE: readonly SliceVerdict[] = [
  'unapproved',
  'blocked',
  'eligible',
  'complete',
  'empty',
];

/**
 * Which verdicts each verdict may become.
 *
 * Transcribed from `diagrams/slice-lifecycle.mmd`, the source of
 * `DESIGN-slice.md` §4's diagram. A verdict not listed here is not reachable
 * from the key, and {@link observeSliceVerdict} refuses it.
 *
 * `unapproved -> eligible` is in the diagram and is not a shortcut: a plan
 * approved while every prior slice has already landed reaches `eligible`
 * without ever being `blocked`. A one-slice plan does it on every approval,
 * because it has no prior slice to wait for.
 *
 * `blocked` cannot go back to `unapproved`. Both mean *you cannot start this*
 * and `DESIGN-slice.md` §14 keeps them apart precisely because they resolve
 * differently — one by merging work, the other by a person approving the plan.
 * A plan does not lose its approval; `transitions/plan.ts` names no move out of
 * `Approved` that is not forward.
 *
 * `complete` leads nowhere. Every non-deferred branch merged is a statement
 * about work that already landed, and merged work does not un-merge.
 *
 * `empty` LEADS NOWHERE EITHER, AND FOR THE OPPOSITE REASON. It is a malformed
 * slice — a heading naming no branch — not a stage anything passes through.
 * Nothing the fleet does resolves it: only an edit to the plan, giving the
 * heading a branch or deleting it, and that produces a different slice rather
 * than moving this one. So it is unreachable from every other verdict and
 * reaches none.
 */
const NEXT: Readonly<Record<SliceVerdict, readonly SliceVerdict[]>> = {
  unapproved: ['blocked', 'eligible'],
  blocked: ['eligible'],
  eligible: ['complete'],
  complete: [],
  empty: [],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape `transitions/plan.ts`, `story.ts`, `agent.ts` and
 * `worktree.ts` use, and for the same reason: a slice's verdict is joined from
 * a plan file and git's answer about each branch, and the domain reaches
 * neither.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a slice transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'verdict-unrecognised'
  | 'verdict-terminal'
  | 'verdict-unreachable'
  | 'verdict-unchanged'
  | 'prior-slice-unlanded'
  | 'prerequisite-unlanded'
  | 'prerequisite-unasked'
  | 'prerequisite-unknown'
  | 'precondition-unmet';

/**
 * A refused transition, naming which gate fired.
 *
 * @see RefusalReason for the gates.
 */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The slice the refusal is about, as `plan#name`. */
  readonly id: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the verdict observed, and what it permits.
 *
 * **Carries nothing to write**, like the agent's and the worktree's. Nothing
 * anywhere stores a `SliceVerdict`; `plot-fleet-scan.sh` re-derives it from git
 * refs every run, and `DESIGN-slice.md` §9 records that there is *"no writer,
 * no cache, no record."*
 *
 * `dispatchable` is the one thing a caller acts on, and it is a property of the
 * destination rather than of the move: `eligible` is the only verdict that
 * promises a dispatch would agree.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The slice the verdict is about, as `plan#name`. */
  readonly id: string;
  /** The verdict it held. */
  readonly from: SliceVerdict;
  /** The verdict it now holds. */
  readonly to: SliceVerdict;
  /** Whether a dispatch would take this slice's branch now. */
  readonly dispatchable: boolean;
}

/** What a slice transition answers: the verdict, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a held transition.
 *
 * @param result - the result to test.
 * @returns true when the transition holds.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the transition.
 */
export const isRefusal = (result: TransitionResult): result is Refusal =>
  result.outcome === 'refused';

const refuse = (id: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  id,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param id - the slice the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (id: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    id,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (verdict: string): verdict is SliceVerdict =>
  (SliceVerdictSchema.options as readonly string[]).includes(verdict);

/**
 * A slice's identity, as `DESIGN-slice.md` §3 settles it.
 *
 * The pair, never the name alone: `Counted` appears in 11 plans and means
 * something different in each. The default slice has an empty name, so its id
 * is `slug#`.
 *
 * @param plan - the plan's slug.
 * @param name - the slice's heading, `''` for the default slice.
 * @returns the composite identity, `plan#name`.
 */
export const sliceId = (plan: string, name: string): string => `${plan}#${name}`;

/** What `observeSliceVerdict` needs beyond the slice's current verdict. */
export interface ObserveVerdictInput {
  /** The verdict now derived. */
  to: string;
  /**
   * Whether every slice before this one is `complete`, when the move is into
   * `eligible`.
   *
   * Required for that move and ignored for every other, because ordering is the
   * only thing `eligible` promises beyond approval — `DESIGN-slice.md` §1: *"a
   * slice may not start until every prior slice has landed"*, and §14 calls
   * that the one word that promises a dispatch agrees.
   */
  priorComplete?: boolean;
  /** Readings a caller measured, such as whether the plan file parsed. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a slice may be observed to hold a given verdict.
 *
 * Callable alone, because a board must know whether a row's move is legal
 * before rendering it. It is not a permission: {@link observeSliceVerdict}
 * re-checks, because a caller that asked is indistinguishable from one that did
 * not.
 *
 * @param id - the slice's identity, `plan#name`.
 * @param from - the verdict it held.
 * @param to - the verdict it would be observed in.
 * @param priorComplete - whether every prior slice is complete, for a move into
 *   `eligible`.
 * @returns true when the gates would pass.
 */
export const sliceVerdictObservable = (
  id: string,
  from: SliceVerdict,
  to: string,
  priorComplete = true,
): boolean => !isRefusal(observeSliceVerdict(id, from, { to, priorComplete }));

/**
 * Judges a change of slice verdict that a scan has already derived.
 *
 * The legal moves are `diagrams/slice-lifecycle.mmd`, transcribed into
 * {@link NEXT}. Anything else refuses.
 *
 * **Into `eligible` the ordering is asked as well**, because that word asserts
 * both approval and ordering and a reader acts on it directly. A caller that
 * supplies no ordering reading is believed here and nowhere else: the parameter
 * defaults to *priors landed*, which is what a one-slice plan and the first
 * slice of any plan truthfully report. `false` is what a caller says when it
 * looked and found unlanded work ahead.
 *
 * @param id - the slice's identity, `plan#name`.
 * @param from - the verdict it held.
 * @param input - the verdict now derived, the ordering reading, plus any readings.
 * @returns a decision carrying the move, or a refusal naming the gate that
 *   fired: `verdict-unrecognised`, `verdict-unchanged`, `verdict-terminal`,
 *   `verdict-unreachable`, `prior-slice-unlanded` or `precondition-unmet`.
 */
export const observeSliceVerdict = (
  id: string,
  from: SliceVerdict,
  input: ObserveVerdictInput,
): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      id,
      'verdict-unrecognised',
      `'${input.to}' is not a slice verdict — the four are ${SliceVerdictSchema.options.join(', ')}.`,
    );
  }
  const to: SliceVerdict = input.to;

  if (from === to) {
    return refuse(id, 'verdict-unchanged', `slice '${id}' is already '${to}' — nothing moved.`);
  }

  if (NEXT[from].length === 0) {
    return refuse(
      id,
      'verdict-terminal',
      `slice '${id}' is 'complete' — every non-deferred branch merged, and merged work does not un-merge.`,
    );
  }

  if (!NEXT[from].includes(to)) {
    return refuse(
      id,
      'verdict-unreachable',
      `slice '${id}' cannot go '${from}' -> '${to}' — from '${from}' it may become ${NEXT[from].join(' or ')}.`,
    );
  }

  if (to === 'eligible' && input.priorComplete === false) {
    return refuse(
      id,
      'prior-slice-unlanded',
      `slice '${id}' cannot become 'eligible' with a prior slice unlanded — 'eligible' promises a dispatch would take this, and the ordering is a gate rather than advice.`,
    );
  }

  const blocked = unmet(id, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', id, from, to, dispatchable: to === 'eligible' };
};

/**
 * What was read about the branch a slice's `waits:` annotation names.
 *
 * **THE HOST IS ASKED, AND THE REFS ARE NOT.** That is the whole of this
 * slice's assertion, and the shape is what enforces it: there is no field here
 * for *does the ref exist*, so a caller holding only refs has nothing to pass
 * and a rule reading refs cannot be written against this type.
 *
 * `waitsOn` is carried verbatim as `plot-plan-meta.sh` reported it — the
 * `waits_on` field it emits per branch, parsed in nine places there and
 * **never re-parsed here**. The parser is the contract; a second reading of
 * the annotation is a second answer.
 */
export interface PrerequisiteReading {
  /** The branch this slice's branch waits on — `''` where it declares none. */
  waitsOn: string;
  /** What the host said about that branch's pull requests. */
  answer: PrereqAnswer;
}

/**
 * Whether a slice's prerequisite has cleared, and why not where it has not.
 *
 * **THE DEADLOCK THIS REFUSES, STATED AS A TYPE.** A slice waiting on another
 * names it with `waits:`. If the prerequisite merges and `plot-release-refs.sh`
 * later deletes its remote ref, a naive reading finds no branch and concludes
 * the prerequisite never landed — so the waiter waits forever, because its
 * dependency succeeded.
 *
 * That was found while writing `a-slice-can-wait-on-another-plan` and fixed by
 * correcting the plan; until now it was remembered in prose. **A merged PR
 * outlives the branch it was cut from**, so the question is put to the host and
 * {@link PrerequisiteReading} carries no ref for a caller to read instead.
 *
 * The verdict itself is {@link waitVerdict}'s and is not re-derived: two
 * implementations of *has this prerequisite landed* is the drift that deadlocks
 * a slice, and this file classifies its answer rather than computing a second.
 *
 * - `merged` clears. The ref may be gone; the merge is what mattered.
 * - `unmerged` holds — a wait with an end, resolved by that branch landing.
 * - `none` refuses as `prerequisite-unknown`: the host answered and has never
 *   seen a PR for that name, which is a typo resolved by editing the plan
 *   rather than by waiting.
 * - `unreachable` refuses as `prerequisite-unasked`. Silence is not permission,
 *   and it is equally not proof of a typo — it resolves the moment the host can
 *   be asked again.
 *
 * @param id - the slice's identity, `plan#name`.
 * @param reading - the branch the slice waits on, and what the host said of it.
 * @param preconditions - readings a caller measured.
 * @returns a decision that the slice may proceed to `eligible`, or a refusal
 *   naming the gate: `prerequisite-unlanded`, `prerequisite-unknown`,
 *   `prerequisite-unasked` or `precondition-unmet`.
 */
export const prerequisiteCleared = (
  id: string,
  reading: PrerequisiteReading,
  preconditions: readonly Precondition[] = [],
): TransitionResult => {
  if (reading.waitsOn !== '' && reading.answer === 'unreachable') {
    return refuse(
      id,
      'prerequisite-unasked',
      `slice '${id}' waits on '${reading.waitsOn}' and the host could not be asked — silence is not permission to start, and not proof of a typo either.`,
    );
  }

  if (reading.waitsOn !== '' && reading.answer === 'none') {
    return refuse(
      id,
      'prerequisite-unknown',
      `slice '${id}' waits on '${reading.waitsOn}' and the host has never seen a pull request for it — a typo in the plan, resolved by editing the plan rather than by waiting.`,
    );
  }

  const held = waitVerdict(reading.waitsOn, reading.answer);
  if (held !== '') {
    return refuse(
      id,
      'prerequisite-unlanded',
      `slice '${id}' waits on '${reading.waitsOn}', which has not merged — a wait with an end, cleared by that branch landing.`,
    );
  }

  const blocked = unmet(id, preconditions);
  if (blocked) return blocked;

  return { outcome: 'decided', id, from: 'blocked', to: 'eligible', dispatchable: true };
};
