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
  /** The log the monitors write their own output to, appended. */
  log: string;
}

/** The pids of the monitors one start began; `''` for a monitor not started. */
export interface MonitorPids {
  agentMonitorPid: string;
  buildMonitorPid: string;
}

/**
 * Starts the monitors that watch one agent on one desk: the AgentMonitor for
 * its pull request and the BuildMonitor for its CI run.
 *
 * Each monitor publishes to its default findings file in the desk and ends on
 * its own once the pid in `pidFile` is gone.
 */
export interface DeskMonitors {
  /**
   * Starts both monitors for `desk`, detached.
   *
   * @param desk - the agent the monitors watch.
   * @returns the pids started; a monitor whose script is absent is reported
   *   as `''`. `failed` when the log cannot be opened.
   */
  start(desk: MonitoredDesk): PortResult<MonitorPids>;
}
