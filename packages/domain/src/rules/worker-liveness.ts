/**
 * Whether a desk's worker lives, read from the liveness token its wrapper made.
 *
 * The node wrapper makes a FIFO at {@link TOKEN_FILENAME} in the desk and
 * passes it to the agent as fd 3. The agent's shell, the worker loop and the
 * harness the loop starts hold it. A reader that opens it without blocking
 * gets `EAGAIN` while a holder lives and end-of-file once none is left.
 *
 * @concept worker-liveness
 */

/** The token's file name inside a desk. */
export const TOKEN_FILENAME = '.plot-worker.token.fifo';

/** The descriptor number the agent and every holder it starts receive the token on. */
export const TOKEN_FD = 3;

/** The environment variable that tells the agent the token is on {@link TOKEN_FD}. */
export const TOKEN_FD_ENV = 'PLOT_WORKER_TOKEN_FD';

/** The reason a released token with no exit record writes to the desk log and the AgentMonitor's findings. */
export const RELEASED_WITH_NO_EXIT = 'the token was released with no exit record';

/**
 * One read of the token.
 *
 * - `held` — the FIFO exists and a holder keeps it open.
 * - `released` — the FIFO exists and no holder is left.
 * - `none` — no FIFO at the path: absent, another kind of file, or unreadable.
 */
export type TokenState = 'held' | 'released' | 'none';

/** What one token read answered. */
export interface TokenReading {
  /** The token's state. */
  readonly state: TokenState;
  /** The FIFO's modification time, epoch milliseconds; `null` for `none`. */
  readonly madeAtMs: number | null;
}

/** What {@link workerLiveness} decides from. */
export interface LivenessReadings {
  /** The exit record's modification time, epoch milliseconds; `null` where no record exists. */
  readonly exitAtMs: number | null;
  /** The token read. */
  readonly token: TokenReading;
  /** Whether the recorded pid answers `kill(pid, 0)`. */
  readonly pidAnswers: boolean;
  /** The manifest's `startedAt`, epoch milliseconds; `null` where none was recorded or it does not parse. */
  readonly startedAtMs: number | null;
  /** The current time, epoch milliseconds. */
  readonly nowMs: number;
  /** `Worker bound` in milliseconds; `0` sets no bound. */
  readonly workerBoundMs: number;
}

/**
 * What the token says about the worker.
 *
 * - `exited` — an exit record not older than the token exists; the process ended.
 * - `live` — no current exit record, the token is held, the recorded pid
 *   answers, and `startedAt` lies less than `Worker bound` ago.
 * - `stray-holder` — no current exit record, the token is held, the recorded
 *   pid does not answer, and `Worker bound` has not passed.
 * - `dead` — no current exit record, and the token is released or held past
 *   `Worker bound`.
 */
export type TokenLiveness = 'exited' | 'live' | 'stray-holder' | 'dead';

/** The answer and what it rests on: the token, or the start-time path for a desk with none. */
export type LivenessAnswer =
  | { readonly basis: 'token'; readonly liveness: TokenLiveness; readonly exitCurrent: boolean }
  | { readonly basis: 'start-time' };

/**
 * Decides a worker's liveness from its exit record and its token, in this
 * order: no token answers the start-time path; an exit record not older than
 * the token answers `exited`; a released token answers `dead`; a held token
 * past `Worker bound` answers `dead`; a held token answers `live` when the
 * recorded pid answers and `stray-holder` when it does not.
 *
 * An exit record older than the token is an earlier run's and is ignored:
 * `exitCurrent` is `false` for it.
 *
 * @param readings - the exit record's time, the token read, the pid's answer and the bound.
 * @returns the liveness and its basis.
 */
export const workerLiveness = (readings: LivenessReadings): LivenessAnswer => {
  const { token } = readings;
  if (token.state === 'none' || token.madeAtMs === null) return { basis: 'start-time' };
  const exitCurrent = readings.exitAtMs !== null && readings.exitAtMs >= token.madeAtMs;
  if (exitCurrent) return { basis: 'token', liveness: 'exited', exitCurrent };
  if (token.state === 'released') return { basis: 'token', liveness: 'dead', exitCurrent };
  const pastBound =
    readings.workerBoundMs > 0 && readings.startedAtMs !== null && readings.nowMs - readings.startedAtMs >= readings.workerBoundMs;
  if (pastBound) return { basis: 'token', liveness: 'dead', exitCurrent };
  return { basis: 'token', liveness: readings.pidAnswers ? 'live' : 'stray-holder', exitCurrent };
};

/** The words a board row adds for a desk whose liveness rests on the start time. */
export const START_TIME_LABEL = 'liveness by start time';

/**
 * A board row's status with the liveness basis named where it is the start time.
 *
 * @param status - the row's status word; `''` where the row shows none.
 * @param basis - the basis {@link workerLiveness} answered, or `''` where no desk was read.
 * @returns `<status> · liveness by start time` for a non-empty status on the start-time basis; `status` otherwise.
 */
export const withLivenessBasis = (status: string, basis: 'token' | 'start-time' | ''): string =>
  basis === 'start-time' && status !== '' ? `${status} · ${START_TIME_LABEL}` : status;
