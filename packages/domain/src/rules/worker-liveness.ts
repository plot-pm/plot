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

/**
 * The environment variable a worker loop sets to `1` on the process it replaces
 * itself with when it holds the token on a close-on-exec descriptor: the new
 * process finds the token on its path, and fd 3 holds whatever the new process
 * opened there.
 */
export const TOKEN_ON_PATH_ENV = 'PLOT_WORKER_TOKEN_ON_PATH';

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

/** The lowest exit code that names a death by signal: 128 plus the signal number, so 137 for `SIGKILL` and 143 for `SIGTERM`. */
export const SIGNAL_EXIT_MIN = 128;

/** What {@link workerLiveness} decides from. */
export interface LivenessReadings {
  /** The exit record's modification time, epoch milliseconds; `null` where no record exists. */
  readonly exitAtMs: number | null;
  /** The exit record's code; `null` where no record exists or it names no number. */
  readonly exitCode: number | null;
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
 * A current exit record is one not older than the token. It decides the
 * answer unless the token is held and the record's code is
 * {@link SIGNAL_EXIT_MIN} or more; such a record yields to the token.
 *
 * - `exited` — a current exit record decides; the process ended.
 * - `live` — no deciding exit record, the token is held, and the recorded pid
 *   answers, however long ago the launch was.
 * - `stray-holder` — no deciding exit record, the token is held, the recorded
 *   pid does not answer, and `Worker bound` from `startedAt` has not passed.
 * - `dead` — no deciding exit record, and the token is released, or held by a
 *   stray holder past `Worker bound` from `startedAt`.
 */
export type TokenLiveness = 'exited' | 'live' | 'stray-holder' | 'dead';

/** The answer and what it rests on: the token, or the start-time path for a desk with none. */
export type LivenessAnswer =
  | { readonly basis: 'token'; readonly liveness: TokenLiveness; readonly exitCurrent: boolean }
  | { readonly basis: 'start-time' };

/**
 * Decides a worker's liveness from its exit record and its token, in this
 * order: no token answers the start-time path; an exit record not older than
 * the token answers `exited`, unless the token is held and the record's code
 * is {@link SIGNAL_EXIT_MIN} or more; a released token answers `dead`; a held
 * token answers `live` when the recorded pid answers; a held token whose pid
 * does not answer answers `stray-holder` until `Worker bound` from `startedAt`
 * has passed, and `dead` after it.
 *
 * A held token outranks a signal death because a wrapper whose loop was
 * killed records 128 plus the signal while the harness the loop started still
 * holds the token and works in the desk. A code below 128 keeps `exited`, so a
 * finish whose harness child holds fd 3 for a moment reads as ended.
 *
 * An exit record older than the token is an earlier run's and is ignored:
 * `exitCurrent` is `false` for it. A current record that yields to a held
 * token keeps `exitCurrent` `true`.
 *
 * @param readings - the exit record's time, the token read, the pid's answer and the bound.
 * @returns the liveness and its basis.
 */
export const workerLiveness = (readings: LivenessReadings): LivenessAnswer => {
  const { token } = readings;
  if (token.state === 'none' || token.madeAtMs === null) return { basis: 'start-time' };
  const exitCurrent = readings.exitAtMs !== null && readings.exitAtMs >= token.madeAtMs;
  const yieldsToToken = token.state === 'held' && readings.exitCode !== null && readings.exitCode >= SIGNAL_EXIT_MIN;
  if (exitCurrent && !yieldsToToken) return { basis: 'token', liveness: 'exited', exitCurrent };
  if (token.state === 'released') return { basis: 'token', liveness: 'dead', exitCurrent };
  if (readings.pidAnswers) return { basis: 'token', liveness: 'live', exitCurrent };
  const pastBound =
    readings.workerBoundMs > 0 && readings.startedAtMs !== null && readings.nowMs - readings.startedAtMs >= readings.workerBoundMs;
  return { basis: 'token', liveness: pastBound ? 'dead' : 'stray-holder', exitCurrent };
};

/** The record the worker loop rewrites at the start of every pass and when its harness starts or ends. */
export const PASS_FILE = '.plot-worker.pass';

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
