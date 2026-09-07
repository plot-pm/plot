/*
 * THE PLAN AND THE SLICE — the two entities a plan file writes.
 *
 * A PLAN WRITES THE SLICE; GIT WRITES THE BRANCH. That sentence is the whole
 * reason `Slice` is not folded into `Branch`. They are 1:1 — a Slice holds
 * exactly one branch — so the distinction has to be ARGUED rather than assumed,
 * and ownership is the argument.
 *
 * The two disagree constantly, and the estate measures it. Counted 2026-09-07
 * through `plot-plan-meta.sh` over 225 plan files: **21 branch lines carry a
 * `deferred:` or `moved:` annotation**, and `moved:`/`split-from:` appear 26
 * times in the prose besides. Every one states something about a branch that no
 * ref can tell you. A deferred Slice is a plan's decision about work it will not
 * do; the branch it names may not exist, may exist unmerged, or may have merged
 * under another plan. That is why neither derives from the other.
 *
 * WHAT THIS FILE IS FOR, and it is not a wrapper. `entities/fleet.ts` already
 * carries the READING shapes — `PlanSchema` and `PlanSliceSchema` are what
 * `plot-fleet-scan.sh --json` reports. This file holds the JUDGING that had no
 * home and was therefore done in several places at once:
 *
 *   - {@link planIdOf} — a plan's identity. FOUR implementations existed
 *     (`rules/pulse.ts`, `server/board.ts`, `server/auto-deliver.ts`,
 *     `server/auto-dispatch.ts`) and they DISAGREE: the three in the board take
 *     a basename first, the domain's own did not, so a full path answered
 *     `docs/plans/2026-09-04-x` where the board answered `x`. The parser emits
 *     `file` as a repository-relative PATH, so the domain's copy was reading the
 *     wrong one in production and its tests never noticed — every one of them
 *     passes a bare filename.
 *
 *   - {@link planStateOf} — the parser's wire word turned into a `PlanState`.
 *     This lived inline in `server/entry/transition.ts` as a cast, which is
 *     where `UNKNOWN` became the string `'unknown'` — a value `PlanState` does
 *     not admit and the cast hid.
 *
 *   - {@link sliceIntent} — what the PLAN says about a branch, as against what
 *     git says. The one reading no ref can supply.
 *
 * A SLICE'S VERDICT IS NOT HERE. `rules/eligible.ts` decides it and
 * `transitions/slice.ts` judges its moves; this file names the entity those
 * two already act on. A second derivation of a verdict is the drift that
 * deadlocks a slice.
 *
 * `Wave` IS NOT SPELLED HERE FOR `Slice`. `DESIGN-slice.md` settles the
 * vocabulary — a Slice belongs to one plan, a Wave is the fleet's cohort and
 * spans plans — and the code's remaining `Wave`-for-`Slice` spellings are a
 * known defect with its own plan. Nothing here adds to it.
 */

// TYPE-ONLY, AND THAT IS THE WHOLE IMPORT LIST. A value import of `sliceId`
// from `transitions/slice.js` would reach `entities/fleet.js` for
// `SliceVerdictSchema` and take `zod` with it — 324 KB into any bundle wanting a
// plan's identity. `transitions/plan.ts:1` records the same measurement and made
// the same choice. `sliceId` is exported from the barrel; a caller holding a
// Slice composes `plan#name` through it.
import type { PlanState } from '../transitions/plan.js';

/**
 * A plan's identity, from the dated filename the estate stores it under.
 *
 * ONE DEFINITION, and the four it replaces did not agree. The basename is taken
 * FIRST, which is the fix: `plot-plan-meta.sh` reports `file` as a
 * repository-relative path (`docs/plans/2026-09-04-x.md`), and a derivation that
 * strips only a leading date leaves the directory on — so the same plan had two
 * identities depending on which component asked.
 *
 * A file carrying neither a date prefix nor an extension is left alone: a plan
 * written outside the dated convention still has an identity, and inventing one
 * would make it unmatchable to its own slices.
 *
 * @param file - the plan's path or filename, dated or not.
 * @returns the slug, with any directory, date prefix and `.md` suffix removed.
 */
export const planIdOf = (file: string): string => {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
};

/**
 * The parser's phase word, as the domain's {@link PlanState}.
 *
 * THE TWO ABSENCES ARE KEPT APART, because they resolve differently and the
 * cast this replaces collapsed one of them. `plot-plan-meta.sh` spells an absent
 * `Phase:` field `NONE` and a phase it does not recognise `UNKNOWN`; the shell
 * spells an unset field `''`. `NONE` and `''` mean *unmeasured* and map to
 * `none`, which every transition refuses on rather than guessing past.
 *
 * `UNKNOWN` IS ALSO `none`, AND THAT IS A DECISION RATHER THAN A COLLAPSE. A
 * mis-spelled phase is a plan whose state nobody can read, which is exactly what
 * `none` means to a transition — and the alternative measured worse: the inline
 * cast it replaces produced the string `'unknown'`, a value `PlanState` does not
 * admit, so it typechecked only because the cast silenced it and reached every
 * `switch` as an unhandled default. The refusal was right by accident. It is now
 * right by construction, and {@link planStateIsReadable} is what a caller asks
 * when it needs to tell *unreadable* from a real state.
 *
 * @param wire - the phase as the parser or the shell spelled it.
 * @returns the state, or `none` where the phase was absent or unrecognised.
 */
export const planStateOf = (wire: string): PlanState => {
  switch (wire.trim().toLowerCase()) {
    case 'draft':
      return 'draft';
    case 'design':
      return 'design';
    case 'approved':
      return 'approved';
    case 'delivered':
      return 'delivered';
    case 'released':
      return 'released';
    case 'rejected':
      return 'rejected';
    case 'superseded':
      return 'superseded';
    default:
      return 'none';
  }
};

/**
 * Whether a plan's state was read at all.
 *
 * @param state - the state to test.
 * @returns true for every state but `none`.
 */
export const planStateIsReadable = (state: PlanState): boolean => state !== 'none';

/**
 * What a PLAN says about one of its branches, which no ref can answer.
 *
 * `active`   the plan still wants this branch landed
 * `deferred` the plan gave the branch up rather than finishing it
 *
 * `moved:` IS `deferred`, and the parser has said so since the reconcile scan
 * was written: both mean *this plan is not doing this work*, and the difference
 * — whether another slice picked it up — is prose a person reads. Modelling them
 * apart here would be a second answer to a question `plot-plan-meta.sh` already
 * settles, and it reports `deferred: true` for either annotation.
 */
// A UNION RATHER THAN A `z.enum`, so `check-state-declarations.sh` does not see
// it and does not need to: nothing parses this off a wire. It is DERIVED from
// the boolean `deferred` the parser already reports, produced and consumed in
// the same process, so a schema would validate what TypeScript guarantees.
// `DeltaOutcome` in `rules/pulse.ts` is the same shape for the same reason.
//
// It is a classification and not a lifecycle in any case: it does not move on
// its own, and only an edit to the plan changes it. The branch's own states are
// `entities/fleet.ts`'s `BranchStateSchema`, which IS declared.
export type SliceIntent = 'active' | 'deferred';

/**
 * One branch's worth of a plan — the unit a plan writes and a dispatch takes.
 *
 * Identity: the pair `plan#name`, never the name alone. `Counted` appears in 11
 * plans and means something different in each. `sliceId` in
 * `transitions/slice.ts` composes it and is not restated here.
 *
 * A Slice holds EXACTLY ONE BRANCH and belongs to EXACTLY ONE PLAN
 * ([DESIGN-slice.md](../../../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md)).
 * The fleet's cohort that spans plans is a Wave — {@link ../entities/wave.js} —
 * and is persisted nowhere.
 *
 * NO VERDICT FIELD, deliberately. A slice's verdict is derived from its plan's
 * phase and its branch's merge state every time it is asked, and
 * `DESIGN-slice.md` §9 records that there is *"no writer, no cache, no record."*
 * Storing one here would be a cache with no invalidation, in the entity the
 * scan re-derives on every pulse.
 */
export interface Slice {
  /** The plan that wrote it — a slice belongs to one. */
  plan: string;
  /** The slice's name, from its `### ` heading; `''` for the default slice. */
  name: string;
  /** The one branch it names; `''` where the heading names none. */
  branch: string;
  /** Where it sits in the plan's own order, from 0. */
  order: number;
  /** What the plan says about the branch — the reading git cannot supply. */
  intent: SliceIntent;
  /** Why the plan gave the branch up, as written; `''` where it did not. */
  intentReason: string;
}

/**
 * A plan — the stated record Plot's whole lifecycle turns on.
 *
 * Identity: a slug, from the dated filename ({@link planIdOf}). State: STATED
 * in the file, not derived, which is what `DESIGN-plan.md` means by *"Plan and
 * Story are the only two entities whose state is a stated fact rather than a
 * derived relation."* It can therefore be wrong, and can go stale with nothing
 * detecting it — the reason every transition in `transitions/plan.ts` takes its
 * host-dependent facts as readings rather than trusting the file.
 *
 * This type is what a component needs to know ABOUT a plan, not the plan: a
 * plan's value is its prose, and a consumer needing that reads the file.
 */
export interface Plan {
  /** The slug — the identity. */
  id: string;
  /** The path it was read from, relative to the repository root. */
  file: string;
  /** The plan's title, from its first heading. */
  title: string;
  /** The state the file states. */
  state: PlanState;
  /** The declared review channel — `pr`, `in-session`, `ballot`, or `''`. */
  review: string;
  /** The story it belongs to, or `''` — a plan has at most one. */
  story: string;
  /** The sprint it is a member of, or `''` — a plan has at most one. */
  sprint: string;
  /** Its slices, in the order the file declares them. */
  slices: readonly Slice[];
}

/**
 * The branches a plan still wants landed.
 *
 * DEFERRED SLICES ARE EXCLUDED, and that is the plan's own decision being
 * honoured rather than a filter. A deferred branch is work the plan gave up, so
 * counting it as outstanding would hold a plan open on work nobody intends to
 * do — which is the delivery gate's rule, stated once here.
 *
 * A slice naming no branch contributes nothing: there is no ref to land.
 *
 * @param plan - the plan to read.
 * @returns each branch once, in the plan's own order.
 */
export const branchesWanted = (plan: Plan): string[] => [
  ...new Set(
    plan.slices
      .filter((slice) => slice.intent === 'active' && slice.branch !== '')
      .map((slice) => slice.branch),
  ),
];

/**
 * The slices a plan gave up, with the reason each was given up for.
 *
 * The estate's 21 annotated branch lines are what this reads, and they are the
 * case that keeps Slice and Branch apart: the answer survives the branch not
 * existing, because the plan wrote it.
 *
 * @param plan - the plan to read.
 * @returns one entry per deferred slice, in the plan's own order.
 */
export const slicesDeferred = (plan: Plan): Slice[] =>
  plan.slices.filter((slice) => slice.intent === 'deferred');
