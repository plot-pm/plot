import { SprintStateSchema, isPromised, scoreItem, type Sprint, type SprintState } from '../entities/sprint.js';

/*
 * A SPRINT'S STATE IS STATED, NOT DERIVED — `entities/sprint.ts:58`: *"stated in
 * the file, so it can be wrong"*. So a transition here decides a WRITE, the way
 * `transitions/plan.ts` and `transitions/story.ts` do, and not a verdict on
 * something that already happened.
 *
 * A SPRINT ENDS WHEN SOMEBODY SAYS IT ENDED. The timebox is a plan, not a
 * measurement: a sprint past its `plannedEnd` is late rather than closed, and
 * nothing may close it on the calendar's word. That is why `actualEnd` is a
 * separate field from `plannedEnd` and why closing carries a date.
 *
 * THE COMMITMENT IS WHAT `Committed` MEANS. `entities/sprint.ts:15` — *"Only
 * `must` is a promise"* — so a sprint with no Must has promised nothing and
 * committing to it records a commitment that does not exist.
 */

/**
 * The states, in the order a timebox passes through them.
 *
 * Re-exported as a value because a renderer groups by state and needs the
 * order; `SprintStateSchema.options` carries the same four and is the source.
 * **The states are not redeclared** — `entities/sprint.ts:9` owns them.
 */
export const SPRINT_LIFECYCLE: readonly SprintState[] = [
  'Planning',
  'Committed',
  'Active',
  'Closed',
];

/**
 * Which states each state may become.
 *
 * The entity states the order: *"a timebox is opened, committed to, run and
 * closed, in that order and once each"*. There are no branches and no way back
 * — a sprint that reopens is a new timebox with its own week in its own slug.
 *
 * `Planning -> Closed` is legal and is the abandonment: a sprint nobody
 * committed to may be closed without ever running, which is what happened to
 * every planned week that was overtaken. It skips `Committed` and `Active`
 * because neither ever occurred, and inventing them would record work nobody
 * did.
 *
 * `Closed` leads nowhere.
 */
const NEXT: Readonly<Record<SprintState, readonly SprintState[]>> = {
  Planning: ['Committed', 'Closed'],
  Committed: ['Active', 'Closed'],
  Active: ['Closed'],
  Closed: [],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape the other transition files use, and for the same reason: a
 * sprint lives in a file on disk, and the domain reaches nothing.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a sprint transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'commitment-empty'
  | 'release-unnamed'
  | 'close-date-missing'
  | 'close-date-before-start'
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
  /** The sprint the refusal is about, by slug. */
  readonly slug: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds, and the write it calls for.
 *
 * `actualEnd` is non-null only for a move to `Closed`: it is the date the
 * timebox ended, which the file records beside the state and nothing else
 * writes.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The sprint the write is about, by slug. */
  readonly slug: string;
  /** The state to write. */
  readonly state: SprintState;
  /** The date to record beside it, or null for any move but a close. */
  readonly actualEnd: string | null;
}

/** What a sprint transition answers: the write, or the gate that stopped it. */
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

const refuse = (slug: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  slug,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param slug - the sprint the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (slug: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    slug,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is SprintState =>
  (SprintStateSchema.options as readonly string[]).includes(state);

/** What `setSprintState` needs beyond the sprint. */
export interface SetSprintStateInput {
  /** The state to move to. */
  to: string;
  /** The date the timebox ended, ISO-8601 — required for a close. */
  on?: string;
  /** Readings a caller measured, such as whether the sprint file is writable. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a sprint may move to a given state.
 *
 * Callable alone, because a board must know whether to offer the move before
 * anyone takes it. It is not a permission: {@link setSprintState} re-checks.
 *
 * @param sprint - the sprint to test.
 * @param to - the state it would move to.
 * @returns true when the mechanical gates would pass.
 */
export const sprintStateSettable = (sprint: Sprint, to: string): boolean =>
  !isRefusal(setSprintState(sprint, { to, on: '0000-00-00' }));

/**
 * Decides the write that moving a sprint to a state calls for.
 *
 * **Committing asks what was promised.** Only a `must` item is a promise, so a
 * sprint whose Musts are empty has committed to nothing, and a sprint naming no
 * release has no gate to be judged at.
 *
 * **Closing carries the date the timebox ended**, which is not its
 * `plannedEnd`: a sprint past its planned end is late, and only a person says
 * it closed.
 *
 * @param sprint - the sprint to move.
 * @param input - the state to move to, the close date, plus any readings.
 * @returns a decision carrying the state and its date, or a refusal naming the
 *   gate that fired: `state-unrecognised`, `state-unchanged`, `state-terminal`,
 *   `state-unreachable`, `commitment-empty`, `release-unnamed`,
 *   `close-date-missing`, `close-date-before-start` or `precondition-unmet`.
 */
export const setSprintState = (sprint: Sprint, input: SetSprintStateInput): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      sprint.slug,
      'state-unrecognised',
      `'${input.to}' is not a sprint state — the four are ${SprintStateSchema.options.join(', ')}.`,
    );
  }
  const to: SprintState = input.to;

  if (sprint.state === to) {
    return refuse(
      sprint.slug,
      'state-unchanged',
      `sprint '${sprint.slug}' is already '${to}' — nothing to move.`,
    );
  }

  if (NEXT[sprint.state].length === 0) {
    return refuse(
      sprint.slug,
      'state-terminal',
      `sprint '${sprint.slug}' is closed — a sprint that reopens is a new timebox with its own week.`,
    );
  }

  if (!NEXT[sprint.state].includes(to)) {
    return refuse(
      sprint.slug,
      'state-unreachable',
      `sprint '${sprint.slug}' cannot go '${sprint.state}' -> '${to}' — from '${sprint.state}' it may become ${NEXT[sprint.state].join(' or ')}.`,
    );
  }

  if (to === 'Committed') {
    if (!sprint.items.some(isPromised)) {
      return refuse(
        sprint.slug,
        'commitment-empty',
        `sprint '${sprint.slug}' names no Must — only a Must is a promise, so committing would record a commitment that does not exist.`,
      );
    }
    if (sprint.release.trim() === '') {
      return refuse(
        sprint.slug,
        'release-unnamed',
        `sprint '${sprint.slug}' names no release — the release is the gate's key, and a commitment nothing is judged at is not one.`,
      );
    }
  }

  if (to === 'Closed') {
    const on = (input.on ?? '').trim();
    if (on === '') {
      return refuse(
        sprint.slug,
        'close-date-missing',
        `sprint '${sprint.slug}' cannot close without a date — a sprint ends when somebody says it ended, and a close nobody can place is not one.`,
      );
    }
    if (sprint.start !== '' && on < sprint.start) {
      return refuse(
        sprint.slug,
        'close-date-before-start',
        `sprint '${sprint.slug}' cannot close on ${on}, before it started on ${sprint.start}.`,
      );
    }
  }

  const blocked = unmet(sprint.slug, input.preconditions ?? []);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    slug: sprint.slug,
    state: to,
    actualEnd: to === 'Closed' ? (input.on ?? '').trim() : null,
  };
};

/**
 * Whether every promise a sprint made has been kept.
 *
 * The release gate's own question, asked of the commitment rather than of the
 * calendar: a Must whose plan has not delivered is an open promise, and the
 * scoring is {@link scoreItem}'s rather than a second reading of the checkbox.
 *
 * @param sprint - the sprint to judge.
 * @param delivered - which of its plans the estate reports as delivered, by slug.
 * @returns the slugs of the Musts still open; empty means every promise kept.
 */
export const openPromises = (sprint: Sprint, delivered: ReadonlySet<string>): string[] =>
  sprint.items
    .filter(isPromised)
    .filter((item) => scoreItem(item, delivered.has(item.plan)) !== 'done')
    .map((item) => item.plan);
