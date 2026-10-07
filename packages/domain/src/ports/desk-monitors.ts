import type { PortResult } from '../port-result.js';

/** What a monitor needs to know about the agent it watches. */
export interface MonitoredDesk {
  /** The branch the agent holds. */
  branch: string;
  /** The desk the agent runs in, absolute. */
  worktree: string;
  /** The manifest that names the agent, absolute. */
  manifestFile: string;
  /** The file holding the agent's pid; a monitor ends when that pid is gone. */
  pidFile: string;
  /** The log the monitor writes its own output to, appended. */
  log: string;
}

/** The pid of the monitor one start began; `''` for a monitor not started. */
export interface MonitorPids {
  agentMonitorPid: string;
}

/**
 * Starts the monitor that watches one agent on one desk: the AgentMonitor for
 * its pull request.
 *
 * The monitor publishes to its default findings file in the desk and ends on
 * its own once the pid in `pidFile` is gone.
 */
export interface DeskMonitors {
  /**
   * Starts the AgentMonitor for `desk`, detached.
   *
   * @param desk - the agent the monitor watches.
   * @returns the pid started; a monitor whose script is absent is reported
   *   as `''`. `failed` when the log cannot be opened.
   */
  start(desk: MonitoredDesk): PortResult<MonitorPids>;

  /**
   * Stops a monitor an earlier start began, so a desk keeps one.
   *
   * A pid that is empty or already gone needs no signal. A live pid whose
   * command line names no monitor script is a reused pid and is left alone.
   *
   * @param pids - the monitor pids a manifest recorded.
   * @returns the pids that were signalled. `failed` when a monitor could not
   *   be signalled.
   */
  stop(pids: readonly string[]): PortResult<readonly string[]>;
}
