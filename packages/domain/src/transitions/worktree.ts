import type { WorktreeState } from '../entities/worktree.js';
import { WorktreeStateSchema } from '../entities/worktree.js';
import type { ReapProblem, TreeReadings } from '../rules/reapable.js';
import { reapProblems } from '../rules/reapable.js';

/*
 * A DESK'S STATE IS OBSERVED, NOT STATED — so a transition here is a VERDICT on
 * a change that already happened, and carries nothing to write.
 *
 * The same split `transitions/agent.ts` opens with. `DESIGN-plan.md:810`:
 * *"Plan and Story are the only two entities whose state is a stated fact
 * rather than a derived relation."* Nothing writes a `WorktreeState`; it is
 * re-derived from `git worktree list`, the process table and the tree itself on
 * every scan.
 *
 * WHAT THIS FILE ADDS THAT `rules/reapable.ts` DOES NOT: that rule answers *may
 * this tree be removed* and the reaper already asks it. This file answers *what
 * may a desk MOVE BETWEEN*, and — the slice's assertion — *what does removing
 * it cost*. The reap question is consumed here, never re-derived.
 */

/**
 * Which states each state may become.
 *
 * Transcribed from `diagrams/worktree-lifecycle.mmd`, the source of
 * `DESIGN-worktree.md` §4's diagram. A state not listed here is not reachable
 * from the key, and {@link observeWorktreeState} refuses it.
 *
 * `created -> finished` is in the diagram and is not a shortcut: it is the
 * hand-made tree, cut by a person with `git worktree add` and never dispatched.
 * `plot-dispatch.sh` describes that population as the one with no claim ref,
 * and it reaches `finished` without ever having been `occupied` because no
 * worker ran in it.
 *
 * `gone` leads nowhere. A removed checkout is re-creatable — see
 * {@link removalIsRecreatable} — but re-creating it produces a NEW desk at
 * `created`, not a resumption of this one. The lifecycle ends; the branch does
 * not.
 */
const NEXT: Readonly<Record<WorktreeState, readonly WorktreeState[]>> = {
  created: ['occupied', 'finished'],
  occupied: ['finished'],
  finished: ['reapable'],
  reapable: ['gone'],
  gone: [],
};

/**
 * What a removal destroys, and whether git can put it back.
 *
 * **THE SLICE'S ASSERTION, AS A TYPE.** `plot-reap.sh` and
 * `plot-release-refs.sh` refuse differently, and the reason lives only in their
 * comments today: a removed checkout *"comes back with `git worktree add`, a
 * deleted ref does not, so the blast radius is bounded by the plan file."*
 *
 * - `checkout` — the working tree. Re-creatable: every commit it held is in the
 *   object database, reachable from the branch ref.
 * - `ref` — the branch itself. **Not re-creatable.** Deleting it drops the last
 *   name for its commits, and the reflog that could have found them dies with
 *   the checkout that held it.
 *
 * This is why the reaper is slug-blind and the ref-deleter is plan-scoped: an
 * operation that cannot be undone earns a narrower blast radius, and the
 * asymmetry is the argument rather than an inconsistency between two scripts.
 */
export type RemovalTarget = 'checkout' | 'ref';

/**
 * Whether each removal target can be restored after the fact.
 *
 * Read by {@link removalIsRecreatable}, and exported so a caller can render the
 * distinction without re-stating it. A `false` here is what makes a refusal
 * non-negotiable rather than a default a `--force` may override.
 */
export const REMOVAL_IS_RECREATABLE: Readonly<Record<RemovalTarget, boolean>> = {
  checkout: true,
  ref: false,
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape `transitions/plan.ts`, `transitions/story.ts` and
 * `transitions/agent.ts` use, and for the same reason: a desk's state lives on
 * a filesystem and in a process table, and the domain reaches neither.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a worktree transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'reap-refused'
  | 'removal-not-recreatable'
  | 'removal-scope-unbounded'
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
  /** The desk the refusal is about, by path. */
  readonly path: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the state observed, and what it would destroy.
 *
 * **Carries nothing to write**, like the agent's. `destroys` is not a record; it
 * is what the caller is about to do, named so a refusal and a decision describe
 * the same act in the same words.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The desk the verdict is about, by path. */
  readonly path: string;
  /** The state it held. */
  readonly from: WorktreeState;
  /** The state it now holds. */
  readonly to: WorktreeState;
  /** What moving to `to` destroys, or null when it destroys nothing. */
  readonly destroys: RemovalTarget | null;
}

/** What a worktree transition answers: the verdict, or the gate that stopped it. */
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

const refuse = (path: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  path,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param path - the desk the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (path: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    path,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is WorktreeState =>
  (WorktreeStateSchema.options as readonly string[]).includes(state);

/** What `observeWorktreeState` needs beyond the desk's current state. */
export interface ObserveStateInput {
  /** The state now observed. */
  to: string;
  /**
   * What was measured of the tree, when the move is `finished -> reapable`.
   *
   * Required for that one move and ignored for every other, because it is the
   * only move whose legality is the five refusals rather than the diagram.
   */
  readings?: TreeReadings;
  /** Readings a caller measured, such as whether the tree was listable. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a desk may be observed to move to a given state.
 *
 * Callable alone, because a board must know whether a row's move is legal
 * before rendering it. It is not a permission: {@link observeWorktreeState}
 * re-checks, because a caller that asked is indistinguishable from one that did
 * not.
 *
 * @param path - the desk's path.
 * @param from - the state it holds.
 * @param to - the state it would be observed in.
 * @param readings - what was measured, needed only for `finished -> reapable`.
 * @returns true when the gates would pass.
 */
export const worktreeStateObservable = (
  path: string,
  from: WorktreeState,
  to: string,
  readings?: TreeReadings,
): boolean => !isRefusal(observeWorktreeState(path, from, { to, readings }));

/**
 * Judges a change of desk state that a component has already observed.
 *
 * The legal moves are `diagrams/worktree-lifecycle.mmd`, transcribed into
 * {@link NEXT}. Anything else refuses.
 *
 * **`finished -> reapable` is the one move the diagram does not decide alone.**
 * The diagram labels it *"every refusal empty"*, and the refusals are
 * {@link reapProblems}'s. So this asks that rule rather than re-deriving it:
 * two implementations of *may this be removed* is the drift that deletes
 * somebody's work, and `entities/worktree.ts` already states that reason for
 * the same delegation.
 *
 * A caller that supplies no readings for that move is refused rather than
 * believed. *Nobody measured* is not *every refusal passed* — the same
 * direction `rules/reapable.ts` fails in when the host cannot be asked.
 *
 * @param path - the desk's path.
 * @param from - the state it held.
 * @param input - the state now observed, the tree's readings, plus any readings.
 * @returns a decision carrying the move and what it destroys, or a refusal
 *   naming the gate that fired: `state-unrecognised`, `state-unchanged`,
 *   `state-terminal`, `state-unreachable`, `reap-refused` or
 *   `precondition-unmet`.
 */
export const observeWorktreeState = (
  path: string,
  from: WorktreeState,
  input: ObserveStateInput,
): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      path,
      'state-unrecognised',
      `'${input.to}' is not a worktree state — the five are ${WorktreeStateSchema.options.join(', ')}.`,
    );
  }
  const to: WorktreeState = input.to;

  if (from === to) {
    return refuse(path, 'state-unchanged', `desk '${path}' is already '${to}' — nothing moved.`);
  }

  if (NEXT[from].length === 0) {
    return refuse(
      path,
      'state-terminal',
      `desk '${path}' is 'gone' — its checkout was removed, and re-creating it with 'git worktree add' produces a new desk at 'created' rather than resuming this one.`,
    );
  }

  if (!NEXT[from].includes(to)) {
    return refuse(
      path,
      'state-unreachable',
      `desk '${path}' cannot go '${from}' -> '${to}' — from '${from}' it may become ${NEXT[from].join(' or ')}.`,
    );
  }

  if (from === 'finished' && to === 'reapable') {
    if (!input.readings) {
      return refuse(
        path,
        'reap-refused',
        `desk '${path}' was not measured — 'reapable' means all five refusals passed, and nobody looked.`,
      );
    }
    const problems = reapProblems(input.readings);
    if (problems.length > 0) {
      return refuse(path, 'reap-refused', describeProblems(path, problems));
    }
  }

  const blocked = unmet(path, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', path, from, to, destroys: to === 'gone' ? 'checkout' : null };
};

/**
 * The refusals as one sentence, most urgent first.
 *
 * @param path - the desk the refusals are about.
 * @param problems - what {@link reapProblems} returned.
 * @returns a sentence naming every refusal, with the values they measured.
 */
const describeProblems = (path: string, problems: readonly ReapProblem[]): string => {
  const named = problems.map((p) => (p.detail ? `${p.refusal} (${p.detail})` : p.refusal));
  return `desk '${path}' is not reapable — ${named.join(', ')}.`;
};

/** What `removalIsRecreatable` needs beyond the desk. */
export interface RemovalInput {
  /** What the caller is about to destroy. */
  target: RemovalTarget;
  /**
   * The plan whose slice names this branch, or `''` when the caller is
   * sweeping the estate rather than delivering one plan.
   *
   * Read only for `ref`, which is why it is not on the state input: a checkout
   * removal is re-creatable, so its blast radius does not need bounding.
   */
  planSlug?: string;
  /** Readings a caller measured. */
  preconditions?: readonly Precondition[];
}

/**
 * Judges whether a removal may proceed, given what it destroys.
 *
 * **THE ASYMMETRY, ENFORCED RATHER THAN COMMENTED.** A checkout removal passes:
 * every commit survives on the branch ref, so `git worktree add` puts the desk
 * back. A ref deletion does not pass here at all — it is not re-creatable, so
 * this rule refuses it and names the component that owns the decision.
 *
 * `a-desk-is-finished-with-once` (#705) is what routes `plot-release-refs.sh`
 * through a rule of its own; this file supplies the transitions the desk has
 * and deliberately stops at the boundary. The refusal is therefore a
 * SIGNPOST — *this rule does not decide that* — rather than a claim that ref
 * deletion never happens.
 *
 * **`removal-scope-unbounded` is the second half of the same argument.** An
 * unrecoverable act earns a narrower blast radius, which is why the reaper is
 * slug-blind and the ref-deleter is plan-scoped. A `ref` removal named against
 * no plan is a sweep over every merged ref on the estate — it satisfies *"a
 * delivered plan's merged branches lose their refs"* and destroys unlanded work
 * belonging to plans nobody delivered.
 *
 * @param path - the desk's path.
 * @param input - what is being destroyed, the plan bounding it, plus any readings.
 * @returns a decision that the removal is recoverable, or a refusal naming the
 *   gate: `removal-not-recreatable`, `removal-scope-unbounded` or
 *   `precondition-unmet`.
 */
export const removalIsRecreatable = (
  path: string,
  input: RemovalInput,
): TransitionResult => {
  if (!REMOVAL_IS_RECREATABLE[input.target]) {
    if (!input.planSlug) {
      return refuse(
        path,
        'removal-scope-unbounded',
        `deleting a ref for desk '${path}' names no plan — a ref deletion is bounded by the plan file precisely because it cannot be undone, and a sweep over every merged ref destroys unlanded work belonging to plans nobody delivered.`,
      );
    }
    return refuse(
      path,
      'removal-not-recreatable',
      `deleting the ref for desk '${path}' is not re-creatable — a removed checkout comes back with 'git worktree add', a deleted ref does not, so the act belongs to the plan-scoped ref-deleter rather than to this rule.`,
    );
  }

  const blocked = unmet(path, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', path, from: 'reapable', to: 'gone', destroys: input.target };
};
