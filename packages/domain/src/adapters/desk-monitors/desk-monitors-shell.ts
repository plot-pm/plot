import { accessSync, closeSync, constants, openSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { DeskMonitors, MonitorPids, MonitoredDesk } from '../../ports/desk-monitors.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The AgentMonitor script, which watches the agent's pull request. */
const AGENT_MONITOR = 'plot-agent-monitor.sh';

/**
 * The command line of a live pid, or `null` when no process has that pid.
 *
 * `ps` exits non-zero for a pid it cannot find.
 */
const commandOf = (pid: number): string | null => {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Starts the AgentMonitor as a detached process, with the environment
 * `plot-dispatch.sh`'s wrapper gives it: `PLOT_BRANCH`, `PLOT_WORKTREE`,
 * `PLOT_MANIFEST_FILE` and `PLOT_PID_FILE`.
 *
 * A script that is absent or not executable is skipped and reported as `''`,
 * as the wrapper skips it. `stop` sends SIGTERM only to a live pid whose
 * command line names the monitor script.
 *
 * @param context - the repository and where its helper scripts live.
 * @returns the monitor port.
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
      return answered({ agentMonitorPid: startOne(AGENT_MONITOR) });
    } finally {
      closeSync(out);
    }
  },

  stop: (pids: readonly string[]): PortResult<readonly string[]> => {
    const signalled: string[] = [];
    for (const raw of pids) {
      const pid = Number(raw);
      if (!/^\d+$/.test(raw) || pid <= 1) continue;
      const command = commandOf(pid);
      if (command === null || !command.includes(AGENT_MONITOR)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        signalled.push(raw);
      } catch (err) {
        // ESRCH: the monitor ended between the `ps` and the signal.
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') return failed<readonly string[]>();
      }
    }
    return answered(signalled);
  },
});
