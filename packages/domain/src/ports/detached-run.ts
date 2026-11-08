import type { PortResult } from '../port-result.js';

/** What one detached run asks for. */
export interface DetachedRunRequest {
  /** The directory the command runs in, absolute. */
  readonly cwd: string;
  /** The shell fragment to run, such as `claude -p`; the prompt is its own argument. */
  readonly fragment: string;
  /** The prompt text. */
  readonly prompt: string;
  /** Extra environment on top of the starting process's own. */
  readonly env: Readonly<Record<string, string>>;
  /** Where the run's combined output is appended. */
  readonly logFile: string;
  /** How long the run may take, in seconds; `0` for no bound. */
  readonly boundSeconds: number;
  /** The state files the run marks when it starts and records its exit code in when it ends. */
  readonly stateFiles: readonly string[];
}

/**
 * Starts an agent run that outlives the process that starts it.
 *
 * The run's parent is `init`, so stopping the starting process's tree does not
 * reach it. The run records its own pid and start in each state file when it
 * starts and its exit code when it ends; nothing in the starting process
 * observes the end.
 */
export interface DetachedRun {
  /**
   * Starts the run and returns once it is marked.
   *
   * @param request - the command, its prompt and environment, the log, the bound and the state files.
   * @returns the run's pid; `failed` where the run could not be started.
   */
  start(request: DetachedRunRequest): Promise<PortResult<number>>;
}
