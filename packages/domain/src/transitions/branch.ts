import { BranchStateSchema, type BranchState } from '../entities/fleet.js';

/*
 * A BRANCH'S STATE IS DERIVED FROM GIT AND THE HOST, so a transition here is a
 * VERDICT on a change that already happened and carries nothing to write.
 * `plot-fleet-scan.sh` re-derives all eight from refs and PR state every run.
 *
 * WHAT THIS ADDS THAT `rules/reapable.ts` DOES NOT, and the distinction is the
 * reason this is not a third copy: that rule answers *may this WORKTREE be
 * removed* — a checkout, five measurements, `git worktree remove`. This answers
 * *which move between two branch states is legal*, and *may this branch's REMOTE
 * REF be deleted*. Different nouns, different blast radius: a removed checkout
 * comes back with `git worktree add`, a deleted ref does not.
 *
 * THE REF GUARDS ARE `plot-release-refs.sh`'s, CONSUMED RATHER THAN RE-DERIVED.
 * Measured 2026-09-06, that script and `plot-reap.sh` ask the same question of
 * the same thing and each is blind to a guard the other applies:
 * `plot-release-refs.sh` never asks about a live pid, `plot-reap.sh` never asks
 * `pr_open`. This file states both sets in one place so the third caller reads
 * one answer.
 */

/**
 * The states, in the order work passes through them.
 *
 * Re-exported as a value because a renderer groups by state and needs the
 * order; `BranchStateSchema.options` carries the same eight and is the source.
 * **The states are not redeclared** — `entities/fleet.ts:54` owns them.
 *
 * `unknown`, `waiting` and `blocked` come last because none is on the path.
 * `unknown` is the absence of a reading; the other two are what the host
 * answered about a branch this one waits on, and both replace `open` or
 * `unknown` only.
 */
export const BRANCH_LIFECYCLE: readonly BranchState[] = [
  'open',
  'claimed',
  'wip',
  'merged',
  'deferred',
  'unknown',
  'waiting',
  'blocked',
];

/**
 * Which states each state may become.
 *
 * `open -> claimed -> wip -> merged` is the path a branch takes. `open -> wip`
 * skips the claim: a person committing to a branch nobody dispatched reaches
 * `wip` without one.
 *
 * `merged` leads nowhere. Merged work does not un-merge, and the host's answer
 * is `mergedAt` rather than a state that could be re-read differently.
 *
 * `deferred` is reachable from every unfinished state and leads nowhere: it is
 * a person giving the branch up, recorded in the plan, and it is undone by
 * editing the plan rather than by the branch moving.
 *
 * `waiting` and `blocked` are reachable from `open` and `unknown` only — the
 * entity states it: they *"replace `open` or `unknown` only, so a branch
 * carrying work keeps the state its work earned"*. `waiting` resolves when the
 * prerequisite lands; `blocked` resolves by editing the plan, so it reaches
 * `open` and not `waiting`.
 *
 * `unknown` reaches every state a reading can produce: it is the absence of an
 * answer, and any answer replaces it.
 */
const NEXT: Readonly<Record<BranchState, readonly BranchState[]>> = {
  unknown: ['open', 'claimed', 'wip', 'merged', 'deferred', 'waiting', 'blocked'],
  open: ['claimed', 'wip', 'merged', 'deferred', 'waiting', 'blocked'],
  claimed: ['wip', 'merged', 'deferred', 'open'],
  wip: ['merged', 'deferred'],
  merged: [],
  deferred: [],
  waiting: ['open', 'claimed', 'wip', 'merged', 'deferred'],
  blocked: ['open', 'deferred'],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape `transitions/plan.ts`, `story.ts`, `agent.ts`, `worktree.ts`
 * and `slice.ts` use, and for the same reason: a branch's state is joined from
 * git refs and the host's answer, and the domain reaches neither.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a branch transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'work-would-be-overwritten'
  | 'ref-deferred'
  | 'ref-unlanded'
  | 'ref-has-open-pr'
  | 'ref-checked-out'
  | 'ref-is-default-branch'
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
  /** The branch the refusal is about. */
  readonly branch: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the state observed, and what it permits.
 *
 * Carries nothing to write. Nothing stores a `BranchState`; the scan re-derives
 * it from refs every run.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The branch the state is about. */
  readonly branch: string;
  /** The state it held. */
  readonly from: BranchState;
  /** The state it now holds. */
  readonly to: BranchState;
  /** Whether this branch's work has landed. */
  readonly landed: boolean;
}

/** What a branch transition answers: the state, or the gate that stopped it. */
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

const refuse = (branch: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  branch,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param branch - the branch the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (branch: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    branch,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is BranchState =>
  (BranchStateSchema.options as readonly string[]).includes(state);

/** The states that mean a branch carries work somebody built. */
const CARRIES_WORK: readonly BranchState[] = ['claimed', 'wip', 'merged'];

/** What `observeBranchState` needs beyond the branch's current state. */
export interface ObserveBranchInput {
  /** The state now derived. */
  to: string;
  /** Readings a caller measured, such as whether the ref could be listed. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a branch may be observed to hold a given state.
 *
 * Callable alone, because a board must know whether a row's move is legal
 * before rendering it. It is not a permission: {@link observeBranchState}
 * re-checks, because a caller that asked is indistinguishable from one that did
 * not.
 *
 * @param branch - the branch's name.
 * @param from - the state it held.
 * @param to - the state it would be observed in.
 * @returns true when the gates would pass.
 */
export const branchStateObservable = (branch: string, from: BranchState, to: string): boolean =>
  !isRefusal(observeBranchState(branch, from, { to }));

/**
 * Judges a change of branch state that a scan has already derived.
 *
 * The legal moves are {@link NEXT}. Anything else refuses.
 *
 * @param branch - the branch's name.
 * @param from - the state it held.
 * @param input - the state now derived, plus any readings.
 * @returns a decision carrying the move, or a refusal naming the gate that
 *   fired: `state-unrecognised`, `state-unchanged`, `state-terminal`,
 *   `state-unreachable`, `work-would-be-overwritten` or `precondition-unmet`.
 */
export const observeBranchState = (
  branch: string,
  from: BranchState,
  input: ObserveBranchInput,
): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      branch,
      'state-unrecognised',
      `'${input.to}' is not a branch state — the eight are ${BranchStateSchema.options.join(', ')}.`,
    );
  }
  const to: BranchState = input.to;

  if (from === to) {
    return refuse(branch, 'state-unchanged', `branch '${branch}' is already '${to}' — nothing moved.`);
  }

  if (NEXT[from].length === 0) {
    return refuse(
      branch,
      'state-terminal',
      from === 'merged'
        ? `branch '${branch}' is 'merged' — merged work does not un-merge.`
        : `branch '${branch}' is 'deferred' — a branch given up is undone by editing the plan, not by moving.`,
    );
  }

  // The entity's own rule, made refusable: `merged` and `deferred` *"replace
  // only 'open' or 'unknown', which is what a rule would refuse"*. Applied to
  // `waiting` and `blocked` too — both are what the host said about a DIFFERENT
  // branch, so neither may overwrite a state this branch's own work earned.
  if (
    (to === 'waiting' || to === 'blocked') &&
    (CARRIES_WORK as readonly string[]).includes(from)
  ) {
    return refuse(
      branch,
      'work-would-be-overwritten',
      `branch '${branch}' is '${from}' and would become '${to}' — that state is about a branch this one waits on, and a branch carrying work keeps the state its work earned.`,
    );
  }

  if (!NEXT[from].includes(to)) {
    return refuse(
      branch,
      'state-unreachable',
      `branch '${branch}' cannot go '${from}' -> '${to}' — from '${from}' it may become ${NEXT[from].join(' or ')}.`,
    );
  }

  const blocked = unmet(branch, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', branch, from, to, landed: to === 'merged' };
};

/**
 * What was measured of one branch before its remote ref is deleted.
 *
 * Every field is a reading rather than a judgement, which is what keeps this
 * rule pure and callable with no adapter in scope.
 *
 * `merged` is the HOST's answer and never git's: a merged PR reports `CLOSED`,
 * and a squash-merge leaves the branch permanently ahead of the default branch.
 * A host that could not be asked reports `false`, so silence keeps the ref.
 */
export interface RefReadings {
  /** The branch's name. */
  branch: string;
  /** The repository's default branch. */
  defaultBranch: string;
  /** Whether the plan annotates this branch `deferred:` or `moved:`. */
  givenUp: boolean;
  /** Whether the host reports any merged pull request for it. */
  merged: boolean;
  /** Whether the host reports an open pull request on it. */
  openPr: boolean;
  /** Whether any worktree has it checked out. */
  checkedOut: boolean;
}

/** The five guards that stand between a merged branch and its ref being deleted. */
export type RefRefusal =
  | 'ref-is-default-branch'
  | 'ref-deferred'
  | 'ref-unlanded'
  | 'ref-has-open-pr'
  | 'ref-checked-out';

/**
 * Every reason this branch's remote ref may not be deleted, most urgent first.
 *
 * The five are `plot-release-refs.sh`'s guards, consumed here rather than
 * re-derived. The order matches what the ref can lose: the default branch is
 * never a candidate, a given-up branch keeps its ref because `/plot-reconcile`
 * needs it plus its annotation, unlanded work is the gate, an open PR is live
 * even where an older one merged, and a checked-out branch is one somebody is
 * reading.
 *
 * @param readings - what was measured of the branch.
 * @returns the refusals that apply, most urgent first; empty means deletable.
 */
export const refProblems = (readings: RefReadings): RefRefusal[] => {
  const problems: RefRefusal[] = [];
  if (readings.branch === readings.defaultBranch) problems.push('ref-is-default-branch');
  if (readings.givenUp) problems.push('ref-deferred');
  if (!readings.merged) problems.push('ref-unlanded');
  if (readings.openPr) problems.push('ref-has-open-pr');
  if (readings.checkedOut) problems.push('ref-checked-out');
  return problems;
};

/**
 * Whether a branch's remote ref may be deleted.
 *
 * @param readings - what was measured of the branch.
 * @param preconditions - readings a caller measured.
 * @returns a decision that the ref may go, or a refusal naming the first guard
 *   that fired.
 */
export const refReleasable = (
  readings: RefReadings,
  preconditions: readonly Precondition[] = [],
): TransitionResult => {
  const problem = refProblems(readings)[0];
  if (problem !== undefined) {
    return refuse(readings.branch, problem, REF_DETAIL[problem](readings));
  }

  const blocked = unmet(readings.branch, preconditions);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    branch: readings.branch,
    from: 'merged',
    to: 'merged',
    landed: true,
  };
};

/** What each ref guard says when it fires. */
const REF_DETAIL: Readonly<Record<RefRefusal, (readings: RefReadings) => string>> = {
  'ref-is-default-branch': (r) => `'${r.branch}' is the default branch — never deleted.`,
  'ref-deferred': (r) =>
    `branch '${r.branch}' was given up rather than finished — /plot-reconcile needs the ref and its annotation.`,
  'ref-unlanded': (r) =>
    `branch '${r.branch}' has no merged pull request — unlanded work keeps its ref, and an unaskable host answers the same way.`,
  'ref-has-open-pr': (r) => `branch '${r.branch}' has an open pull request using it.`,
  'ref-checked-out': (r) => `branch '${r.branch}' is checked out in a worktree — somebody is reading it.`,
};
