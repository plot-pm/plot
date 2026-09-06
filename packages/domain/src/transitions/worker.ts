import { WorkerStateSchema, type WorkerState } from '../entities/fleet.js';
import { STATE_SOURCE, type StateSource } from './agent.js';

/*
 * THE MOVE GRAPH IS `transitions/agent.ts`'s AND IS NOT REDECLARED HERE.
 * `entities/fleet.ts:122` says so in its own declaration — the scan's eight are
 * *"the same eight the Agent carries, read per branch … the rule it wants is
 * transitions/agent.ts"* — and a second `NEXT` over one set of states is the
 * Wave/Slice-shaped defect this repo already carries once. {@link
 * workerStateSource} reads `STATE_SOURCE` rather than restating it.
 *
 * WHAT THIS FILE ADDS is the half only a process can answer, and CLAUDE.md draws
 * the line: four of the eight are process facts read from the process table
 * (`running`, `failed`, `ended`, `none`), two are AGENT facts read from the desk
 * (`waiting`, `stalled`), `finished` is a process fact the desk refines, and
 * `elsewhere` is a Machine answer. `plot-worker-state.sh:46` decides the two workflow states from
 * the TREE, never from the process — an exited process is a precondition for
 * reading them, not the reason they hold.
 *
 * SO THE REFUSALS HERE ARE ABOUT WHO READ WHAT. A workflow state claimed from
 * the process table, or a process state claimed from the desk, is a reading
 * whose source cannot have produced it — and every worker exits 0, so the exit
 * code cannot tell a finished task from an abandoned one.
 */

/**
 * The states, in the order a process passes through them.
 *
 * Re-exported as a value because a renderer groups by state and needs the
 * order; `WorkerStateSchema.options` carries the same eight and is the source.
 * **The states are not redeclared** — `entities/fleet.ts:122` owns them.
 *
 * The two TASK states sit beside `finished` rather than after `ended`: all
 * three arrive where the process exited, and what separates them is the desk.
 */
export const WORKER_LIFECYCLE: readonly WorkerState[] = [
  'none',
  'running',
  'finished',
  'waiting',
  'stalled',
  'failed',
  'ended',
  'elsewhere',
];

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape the other five transition files use, and for the same reason:
 * a worker's state is joined from the process table and the desk, and the
 * domain reaches neither.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a worker reading refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'source-cannot-answer'
  | 'exit-code-cannot-decide'
  | 'no-worktree-here'
  | 'precondition-unmet';

/**
 * A refused reading, naming which gate fired.
 *
 * @see RefusalReason for the gates.
 */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The branch whose worker the refusal is about. */
  readonly branch: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A reading that holds: the state, and which component produced it.
 *
 * Carries nothing to write. Nothing stores a `WorkerState`; the scan re-derives
 * it per branch every run.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The branch whose worker this is about. */
  readonly branch: string;
  /** The state read. */
  readonly state: WorkerState;
  /** Which component's reading it is. */
  readonly source: StateSource;
  /** Whether the process is still alive. */
  readonly alive: boolean;
}

/** What a worker reading answers: the state, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a held reading.
 *
 * @param result - the result to test.
 * @returns true when the reading holds.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the reading.
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

const known = (state: string): state is WorkerState =>
  (WorkerStateSchema.options as readonly string[]).includes(state);

/**
 * Which component reads a given worker state.
 *
 * Delegates to `transitions/agent.ts`'s `STATE_SOURCE` rather than restating
 * it: the eight are one set, and two tables over one set drift.
 *
 * @param state - the state read.
 * @returns `worker` for a process fact, `desk` for a task fact, `machine` for
 *   the answer that this machine has nowhere to look.
 */
export const workerStateSource = (state: WorkerState): StateSource => STATE_SOURCE[state];

/** The two states the DESK decides, never the process. */
const TASK_STATES: readonly WorkerState[] = ['waiting', 'stalled'];

/** What was read of one worker, and by which component. */
export interface WorkerStateReading {
  /** The branch whose desk was looked at. */
  branch: string;
  /** The state read. */
  state: string;
  /** Which component produced the reading. */
  source: StateSource;
  /** The process's exit code, or null where no process had exited. */
  exitCode: number | null;
  /** Whether a worktree for this branch exists on this machine. */
  worktreeHere: boolean;
}

/**
 * Whether a worker reading is one its source could have produced.
 *
 * Callable alone, because a caller must know whether to trust a reading before
 * acting on it. It is not a permission: {@link readWorkerState} re-checks.
 *
 * @param reading - the state read, and which component read it.
 * @returns true when the gates would pass.
 */
export const workerStateReadable = (reading: WorkerStateReading): boolean =>
  !isRefusal(readWorkerState(reading));

/**
 * Judges one worker reading against the component that produced it.
 *
 * **The exit code cannot decide a task state.** Every worker exits 0, so a
 * caller offering `waiting` or `stalled` on the strength of the process alone
 * is reading the one signal that cannot separate them —
 * `plot-worker-state.sh:46` reads the TREE for both.
 *
 * **`elsewhere` needs no worktree and every other state needs one.** It means
 * *no worktree on this machine*; a caller reporting it while a desk is here is
 * describing a different agent, and a caller reporting any other state with no
 * desk read something that is not there.
 *
 * @param reading - the state read, which component read it, the exit code, and
 *   whether a worktree exists here.
 * @param preconditions - readings a caller measured.
 * @returns a decision carrying the state and its source, or a refusal naming
 *   the gate that fired: `state-unrecognised`, `source-cannot-answer`,
 *   `exit-code-cannot-decide`, `no-worktree-here` or `precondition-unmet`.
 */
export const readWorkerState = (
  reading: WorkerStateReading,
  preconditions: readonly Precondition[] = [],
): TransitionResult => {
  if (!known(reading.state)) {
    return refuse(
      reading.branch,
      'state-unrecognised',
      `'${reading.state}' is not a worker state — the eight are ${WorkerStateSchema.options.join(', ')}.`,
    );
  }
  const state: WorkerState = reading.state;
  const owner = STATE_SOURCE[state];

  if (reading.source !== owner) {
    return refuse(
      reading.branch,
      'source-cannot-answer',
      `'${state}' is a ${owner} fact and was read from the ${reading.source} — a ${reading.source} cannot produce it.`,
    );
  }

  if ((TASK_STATES as readonly string[]).includes(state) && reading.exitCode === 0) {
    return refuse(
      reading.branch,
      'exit-code-cannot-decide',
      `'${state}' cannot be decided from exit 0 — every worker exits 0, so the exit code cannot say whether the task finished. The desk decides it.`,
    );
  }

  if (state === 'elsewhere' && reading.worktreeHere) {
    return refuse(
      reading.branch,
      'no-worktree-here',
      `'elsewhere' means no worktree on this machine, and a desk for '${reading.branch}' is here — this names a different agent.`,
    );
  }

  if (state !== 'elsewhere' && !reading.worktreeHere) {
    return refuse(
      reading.branch,
      'no-worktree-here',
      `'${state}' was read for '${reading.branch}' with no worktree on this machine — that is 'elsewhere', which is the question being unanswerable rather than answered.`,
    );
  }

  const blocked = unmet(reading.branch, preconditions);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    branch: reading.branch,
    state,
    source: owner,
    alive: state === 'running',
  };
};
