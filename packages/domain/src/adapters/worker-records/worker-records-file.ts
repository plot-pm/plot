import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, type StdioOptions } from 'node:child_process';
import { constants } from 'node:os';
import { join } from 'node:path';

import type { AgentStart, StartedAgent, LaunchRecordFiles, LaunchRecords } from '../../ports/worker-records.js';
import type { AgentEndReading } from '../../rules/worker-ending.js';

/** The file name, inside a desk, of the WorkerMonitor's findings. */
const WORKER_FINDINGS_FILENAME = '.plot-worker.monitor.worker.jsonl';

const write = (file: string, text: string): boolean => {
  try {
    writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
};

/**
 * The worker records as files, and start times read with `ps -o lstart=`
 * under `LC_ALL=C`, so the text has one form in every locale.
 *
 * @param files - the record files of one desk.
 * @returns the records port.
 */
export const workerRecordsFile = (files: LaunchRecordFiles): LaunchRecords => ({
  writeWrapperPid: (pid) => write(files.wrapperPidFile, String(pid)),
  writeAgentPid: (pid) => write(files.pidFile, String(pid)),
  writeAgentStarted: (text) => write(files.pidStartedFile, text),
  writeExit: (code) => write(files.exitFile, String(code)),
  removeExit: () => {
    try {
      rmSync(files.exitFile, { force: true });
      return true;
    } catch {
      return false;
    }
  },

  startedText: (pid) => {
    try {
      const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, LC_ALL: 'C' },
      });
      return out.replace(/\n+$/, '');
    } catch {
      return '';
    }
  },

  manifestWorktree: (manifestFile) => {
    if (manifestFile === '') return '';
    try {
      const manifest: unknown = JSON.parse(readFileSync(manifestFile, 'utf8'));
      const worktree = (manifest as { worktree?: unknown } | null)?.worktree;
      return typeof worktree === 'string' ? worktree : '';
    } catch {
      return '';
    }
  },

  appendFinding: (desk, line) => {
    try {
      appendFileSync(join(desk, WORKER_FINDINGS_FILENAME), line);
      return true;
    } catch {
      return false;
    }
  },
});

/**
 * Starts the agent as `bash -c <command>`, attached and with inherited stdio.
 *
 * `bash` and not `sh`: bash replaces itself with the command's last simple
 * command, so `.plot-worker.pid` names the command's own process, as the
 * `( $cmd )` subshell of the `sh` wrapper did. Ubuntu's `dash -c` forks it.
 *
 * `ended` resolves with the exit code, or with the signal's number where a
 * signal ended the agent. A token descriptor reaches the agent as fd 3.
 *
 * @returns the agent start port.
 */
export const agentStartShell = (): AgentStart => ({
  start: (command, env, tokenFd = null): StartedAgent | null => {
    const stdio: StdioOptions = tokenFd === null ? 'inherit' : ['inherit', 'inherit', 'inherit', tokenFd];
    const child = spawn('bash', ['-c', command], { stdio, env });
    if (child.pid === undefined) return null;
    const ended = new Promise<AgentEndReading>((resolve) => {
      child.once('exit', (code, signal) => {
        resolve({ code, signal: signal === null ? null : (constants.signals[signal] ?? null) });
      });
    });
    return { pid: child.pid, ended };
  },
});
