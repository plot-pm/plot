import type { PortResult } from '../port-result.js';
import type { WorkerState, WorkerActivity } from '../entities/fleet.js';

/**
 * What the process table says about one agent's worker.
 *
 * The state, the pid and the exit code are facts and nothing here renders
 * them: two callers need different shapes of one computation, so this carries
 * the computation's result and neither of their formats.
 */
export interface WorkerReading {
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
  workerState(worktree: string, hasPr: boolean): Promise<PortResult<WorkerReading>>;

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
}
