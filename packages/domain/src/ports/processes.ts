import type { PortResult } from '../port-result.js';
import type { WorkerState, WorkerActivity } from '../entities/fleet.js';

/**
 * One reading of an agent's desk and the process on it.
 *
 * Named for the reading rather than for the worker because it is not purely a
 * worker's: four of the eight states are process-table observations, two
 * (`waiting`, `stalled`) are facts about what the AGENT still owes, `finished`
 * is a process fact the desk refines, and `elsewhere` is the machine's answer.
 * A caller reads all eight from here and the source of each is what decides
 * which entity it belongs to.
 *
 * The state, the pid and the exit code are facts and nothing here renders
 * them: two callers need different shapes of one computation, so this carries
 * the computation's result and neither of their formats.
 */
export interface ProcessReading {
  /** The state, across the six process observations and two task states. */
  state: WorkerState;
  /** The pid, or `''` where no record named one. */
  pid: string;
  /** The recorded exit code, or `''` where none was recorded. */
  exitCode: string;
  /** Whether a running worker's descendants are burning CPU. */
  activity: WorkerActivity;
}

/**
 * Reads the process table — the DERIVED source of truth about running work.
 *
 * The port answers about processes only. Whether the WORK is done is a
 * question about the desk rather than the process, because every worker exits
 * zero: the one that opened its PR, the one that stopped to ask, and the one
 * that left work on the floor all landed on the same exit code.
 */
export interface Processes {
  /**
   * Whether a pid is alive.
   *
   * @param pid - the process id to test.
   * @returns true when a process holds the pid.
   */
  isAlive(pid: number): Promise<PortResult<boolean>>;

  /**
   * Reads the worker state of the agent whose desk is this worktree.
   *
   * @param worktree - the worktree's absolute path.
   * @param hasPr - whether the branch already has a PR; refines `finished`.
   * @returns what the process table and the desk together report.
   */
  workerState(worktree: string, hasPr: boolean): Promise<PortResult<ProcessReading>>;

  /**
   * When a process started, as epoch milliseconds.
   *
   * Pids are reused, so liveness alone can name a process Plot never started.
   * A start time at or after the moment a claim was stamped is what closes
   * that window.
   *
   * @param pid - the process id to ask about.
   * @returns the start time; a failure where the process is gone.
   */
  startedAt(pid: number): Promise<PortResult<number>>;

  /**
   * How long a process has been up, in seconds.
   *
   * `null` where nothing is running under the pid, and that emptiness is the
   * READING rather than a failure — which is what makes this a separate
   * operation from {@link Processes.startedAt} instead of arithmetic on it.
   * A start time reports `failed` for a dead pid; elapsed time reports
   * *nothing is running*, and a panel renders the two differently.
   *
   * Deriving one from the other would also measure against the caller's own
   * clock, adding a second source of error to an answer the process table
   * already gives directly.
   *
   * @param pid - the process id to ask about.
   * @returns the elapsed seconds, or null where the pid holds no process.
   */
  uptimeSeconds(pid: number): Promise<PortResult<number | null>>;
}
