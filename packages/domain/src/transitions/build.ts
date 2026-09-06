import { BuildStateSchema, buildIsRunning, type Build, type BuildState } from '../entities/build.js';

/*
 * THE HOST OWNS THIS LIFECYCLE AND PLOT ONLY READS IT, exactly as with the pull
 * request. A run is queued, runs, and ends one of four ways on the host's own
 * schedule; nothing here writes any of it, so a transition is a VERDICT on what
 * the host reported.
 *
 * THE HOST'S WORD IS KEPT VERBATIM. `entities/build.ts:8` — *"normalizing it is
 * lossy"* — so the four ends stay four rather than collapsing to pass/fail.
 * `cancelled` and `timed_out` are not `failure`: a cancelled run says somebody
 * stopped it and a timed-out one says the bound was hit, and both are repaired
 * differently from a red test.
 *
 * A RUN IS NOT A PIPELINE, AND THE IDENTITY SAYS SO. `entities/build.ts:38` —
 * *"Two builds of one pipeline minutes apart are different objects"* — so a
 * re-run is a NEW build with its own URL, never a finished one moving back to
 * `queued`. That is what makes all four ends terminal.
 */

/**
 * The states, in the order a run passes through them.
 *
 * Re-exported as a value because a renderer groups by state and needs the
 * order; `BuildStateSchema.options` carries the same six and is the source.
 * **The states are not redeclared** — `entities/build.ts:14` owns them.
 */
export const BUILD_LIFECYCLE: readonly BuildState[] = [
  'queued',
  'in_progress',
  'success',
  'failure',
  'cancelled',
  'timed_out',
];

/**
 * Which states each state may become.
 *
 * `queued -> cancelled` is legal without ever running: a queued run cancelled
 * before a runner picked it up never entered `in_progress`, and recording that
 * it did would claim work nobody did.
 *
 * `queued -> timed_out` is legal for the same reason, and it is the queue's own
 * bound rather than the run's — a job that never got a runner hits it.
 *
 * All four ends lead nowhere. A re-run is a NEW build with its own URL, so
 * nothing returns to `queued`.
 */
const NEXT: Readonly<Record<BuildState, readonly BuildState[]>> = {
  queued: ['in_progress', 'cancelled', 'timed_out'],
  in_progress: ['success', 'failure', 'cancelled', 'timed_out'],
  success: [],
  failure: [],
  cancelled: [],
  timed_out: [],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape the other transition files use, and for the same reason: a
 * build runs on a host, and the domain reaches no network.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a build transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'duration-without-end'
  | 'end-without-duration'
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
  /** The run the refusal is about, by its URL. */
  readonly url: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the state the host reported.
 *
 * Carries nothing to write. The host owns the run; a caller acts on
 * `conclusion` rather than recording this answer.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The run, by its URL — the identity. */
  readonly url: string;
  /** The state it held. */
  readonly from: BuildState;
  /** The state it now holds. */
  readonly to: BuildState;
  /** True when it passed, false when it did not, null while it still runs. */
  readonly conclusion: boolean | null;
}

/** What a build transition answers: the state, or the gate that stopped it. */
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

const refuse = (url: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  url,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param url - the run the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (url: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    url,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is BuildState =>
  (BuildStateSchema.options as readonly string[]).includes(state);

/** What `observeBuildState` needs beyond the build. */
export interface ObserveBuildInput {
  /** The state the host now reports. */
  to: string;
  /**
   * How long the run took in milliseconds, or null while it is still running.
   *
   * Read from the reading rather than from `build.durationMs`, which carries
   * what was known when the build was last fetched.
   */
  durationMs?: number | null;
  /** Readings a caller measured, such as whether the host answered at all. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a build may be observed to hold a given state.
 *
 * Callable alone, because a board must know whether a row's move is legal
 * before rendering it. It is not a permission: {@link observeBuildState}
 * re-checks.
 *
 * @param build - the build to test.
 * @param to - the state it would be observed in.
 * @returns true when the gates would pass.
 */
export const buildStateObservable = (build: Build, to: string): boolean =>
  !isRefusal(observeBuildState(build, { to, durationMs: build.durationMs }));

/**
 * Judges a change of build state that the host has already reported.
 *
 * **A duration and an end arrive together.** `entities/build.ts:55` carries
 * `durationMs` as null *"while it is still running"*, so a still-running state
 * with a duration and an ended state without one each describe a run the host
 * cannot have reported. The duration is asked from the input rather than from
 * the build, because the build holds what was known at the last fetch.
 *
 * A caller supplying no duration reading is believed: the parameter is optional
 * and both gates are skipped, which is what a caller with only a state has.
 *
 * @param build - the build, carrying the state it held.
 * @param input - the state the host now reports, its duration, plus any readings.
 * @returns a decision carrying the move, or a refusal naming the gate that
 *   fired: `state-unrecognised`, `state-unchanged`, `state-terminal`,
 *   `state-unreachable`, `duration-without-end`, `end-without-duration` or
 *   `precondition-unmet`.
 */
export const observeBuildState = (build: Build, input: ObserveBuildInput): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      build.url,
      'state-unrecognised',
      `'${input.to}' is not a build state — the six are ${BuildStateSchema.options.join(', ')}.`,
    );
  }
  const to: BuildState = input.to;

  if (build.state === to) {
    return refuse(build.url, 'state-unchanged', `build ${build.url} is already '${to}' — nothing moved.`);
  }

  if (NEXT[build.state].length === 0) {
    return refuse(
      build.url,
      'state-terminal',
      `build ${build.url} ended '${build.state}' — a re-run is a new build with its own URL, not this one starting again.`,
    );
  }

  if (!NEXT[build.state].includes(to)) {
    return refuse(
      build.url,
      'state-unreachable',
      `build ${build.url} cannot go '${build.state}' -> '${to}' — from '${build.state}' it may become ${NEXT[build.state].join(' or ')}.`,
    );
  }

  if (input.durationMs !== undefined) {
    const stillRunning = buildIsRunning({ ...build, state: to });
    if (stillRunning && input.durationMs !== null) {
      return refuse(
        build.url,
        'duration-without-end',
        `build ${build.url} is reported '${to}' with a duration of ${input.durationMs} ms — a run that has not ended has no duration.`,
      );
    }
    if (!stillRunning && input.durationMs === null) {
      return refuse(
        build.url,
        'end-without-duration',
        `build ${build.url} is reported '${to}' with no duration — a run that ended took some time, and the two are read from one payload.`,
      );
    }
  }

  const blocked = unmet(build.url, input.preconditions ?? []);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    url: build.url,
    from: build.state,
    to,
    conclusion: buildIsRunning({ ...build, state: to }) ? null : to === 'success',
  };
};
