/**
 * What a board run's state file and log say about the run.
 *
 * @concept run-state
 */

/** The record a `running <pid>` marker reads as once its board no longer holds the run. */
export const STOPPED_RECORD = 'on the board stopping before the run ended';

/** The record a detached run's marker reads as once its pid is gone and no exit code was recorded. */
export const NO_EXIT_RECORD = 'the run ended without an exit record';

/**
 * How much later than its recorded start a pid may read as started and still
 * be the recorded process, in milliseconds.
 */
export const START_TOLERANCE_MS = 5000;

/** A parsed `running <pid> [<startedAt>] [detached]` marker. */
export interface RunMarkerReading {
  /** The pid of the process that holds the run. */
  readonly pid: number;
  /** Epoch milliseconds at which that process started, or `null` where the marker records none. */
  readonly startedAt: number | null;
  /** Whether the pid is the run's own, started by a launcher that outlives the board. */
  readonly detached: boolean;
}

/** What {@link runStateOf} reads. */
export interface RunStateReading {
  /** The state file's trimmed content; `null` where it cannot be read. */
  readonly recorded: string | null;
  /** Whether the log exists. */
  readonly logExists: boolean;
  /** The content parsed as a marker; `null` where it is an exit code. */
  readonly marker: RunMarkerReading | null;
  /** Whether the marker's pid is the reading process. */
  readonly ownPid: boolean;
  /** Whether the reading process still holds the run. */
  readonly held: boolean;
  /** Whether a process with the marker's pid exists. */
  readonly alive: boolean;
  /** Epoch milliseconds at which that pid started, or `null` where the OS cannot say. */
  readonly actualStartedAt: number | null;
}

/** One run's state. */
export interface RunStateAnswer {
  /** `unknown` — no log and no state file; `running`; `done` — code `0`; `failed` — any other record. */
  readonly state: 'unknown' | 'running' | 'done' | 'failed';
  /** The recorded code as written; `''` where none is recorded or the run is running. */
  readonly recorded: string;
}

/**
 * Reads one run's state.
 *
 * An unreadable state file reads `running` where the log exists and `unknown`
 * where it does not. An exit code reads `done` for `0` and `failed` otherwise.
 * A marker reads `running` while its pid is alive and is not a reused pid; a
 * pid that started more than {@link START_TOLERANCE_MS} after the marker's
 * start is reused. The reading process's own pid reads `running` only while it
 * holds the run. A marker that reads gone reads `failed` with
 * {@link NO_EXIT_RECORD} where it names a detached run's pid and
 * {@link STOPPED_RECORD} where it names a board.
 *
 * @param reading - the file's content and what the process table says about its pid.
 * @returns the state, and the recorded code where one is recorded.
 */
export const runStateOf = (reading: RunStateReading): RunStateAnswer => {
  const { recorded, marker } = reading;
  if (recorded === null) return { state: reading.logExists ? 'running' : 'unknown', recorded: '' };
  if (marker === null) return { state: recorded === '0' ? 'done' : 'failed', recorded };
  const recycled =
    marker.startedAt !== null &&
    reading.actualStartedAt !== null &&
    reading.actualStartedAt > marker.startedAt + START_TOLERANCE_MS;
  const holds = reading.ownPid ? reading.held : reading.alive && !recycled;
  if (holds) return { state: 'running', recorded: '' };
  return { state: 'failed', recorded: marker.detached ? NO_EXIT_RECORD : STOPPED_RECORD };
};
