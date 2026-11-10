import { execFileSync } from 'node:child_process';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { DeskMonitors } from '../../ports/desk-monitors.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The AgentMonitor script an earlier launch started. */
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

/** A shell interpreter at the head of a command line, as `ps` shows a script started through its shebang. */
const INTERPRETER = /^(?:\S*\/)?(?:ba|da|z)?sh\s+/;

/**
 * Whether a command line runs `script`: the script path is the command itself,
 * or the argument right after a shell interpreter. A process that only carries
 * the script's name in its arguments — an editor, `tail` — does not match.
 */
const runsScript = (command: string, script: string): boolean => {
  const rest = command.replace(INTERPRETER, '');
  return rest === script || rest.startsWith(`${script} `);
};

/**
 * Stops AgentMonitor processes that desks launched before fleetd wrote the
 * AgentMonitor's findings. `stop` sends SIGTERM only to a live pid whose
 * command line runs the monitor script.
 *
 * @param context - the repository and where its helper scripts live.
 * @returns the monitor port.
 */
export const deskMonitorsShell = (context: ShellContext): DeskMonitors => ({
  stop: (pids: readonly string[]): PortResult<readonly string[]> => {
    const signalled: string[] = [];
    for (const raw of pids) {
      const pid = Number(raw);
      if (!/^\d+$/.test(raw) || pid <= 1) continue;
      const command = commandOf(pid);
      if (command === null || !runsScript(command, scriptPath(context, AGENT_MONITOR))) continue;
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
