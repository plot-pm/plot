import { accessSync, closeSync, constants, openSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { DeskMonitors, MonitorPids, MonitoredDesk } from '../../ports/desk-monitors.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The AgentMonitor script, which watches the agent's pull request. */
const AGENT_MONITOR = 'plot-agent-monitor.sh';

/** The BuildMonitor script, which watches the agent's CI run. */
const BUILD_MONITOR = 'plot-build-monitor.sh';

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Starts the AgentMonitor and the BuildMonitor as detached processes, with the
 * environment `plot-dispatch.sh`'s wrapper gives them: `PLOT_BRANCH`,
 * `PLOT_WORKTREE`, `PLOT_MANIFEST_FILE` and `PLOT_PID_FILE`.
 *
 * A script that is absent or not executable is skipped and reported as `''`,
 * as the wrapper skips it.
 *
 * @param context - the repository and where its helper scripts live.
 * @returns the monitors port.
 */
export const deskMonitorsShell = (context: ShellContext): DeskMonitors => ({
  start: (desk: MonitoredDesk): PortResult<MonitorPids> => {
    let out: number;
    try {
      out = openSync(desk.log, 'a');
    } catch {
      return failed<MonitorPids>();
    }
    const env = {
      ...process.env,
      PLOT_BRANCH: desk.branch,
      PLOT_WORKTREE: desk.worktree,
      PLOT_MANIFEST_FILE: desk.manifestFile,
      PLOT_PID_FILE: desk.pidFile,
    };
    const startOne = (name: string): string => {
      const file = scriptPath(context, name);
      if (!isExecutable(file)) return '';
      const child = spawn(file, [], { cwd: desk.worktree, detached: true, stdio: ['ignore', out, out], env });
      child.on('error', (err) => console.error(`${name} failed to start:`, err));
      child.unref();
      return child.pid === undefined ? '' : String(child.pid);
    };
    try {
      return answered({ agentMonitorPid: startOne(AGENT_MONITOR), buildMonitorPid: startOne(BUILD_MONITOR) });
    } finally {
      closeSync(out);
    }
  },
});
