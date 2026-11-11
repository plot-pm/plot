import { lstartMs, type ProcessRow } from '../../rules/pid-current.js';
import type { ProcessRunner } from '../git-dirs/git-dirs.js';
import { runProcess } from '../run-script.js';
import { centisOf } from './processes-shell.js';

/** One `ps` read: the rows, or the exit code of a `ps` that failed. */
export type TableRead = { ok: true; rows: readonly ProcessRow[] } | { ok: false; code: number };

/** The arguments of the one `ps` call that reads the whole table. */
export const TABLE_ARGS = ['-A', '-o', 'pid=,ppid=,lstart=,time=,comm='] as const;

/** The environment every start-time read runs under, so `lstart` prints in one format. */
const C_LOCALE = { LC_ALL: 'C' } as const;

/**
 * Parses the output of `ps -A -o pid=,ppid=,lstart=,time=,comm=` under
 * `LC_ALL=C`. A line that does not fit the shape is skipped.
 *
 * @param stdout - what `ps` printed.
 * @returns one row per process line.
 */
export const parseTable = (stdout: string): ProcessRow[] => {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      startedAt: lstartMs(m[3]!),
      cpuCentis: centisOf(m[4]!),
      comm: m[5]!.trim(),
    });
  }
  return rows;
};

/**
 * Reads the process table with one `ps` per call.
 *
 * @param run - starts the process; {@link runProcess} by default.
 * @returns the reader of the whole table and of one pid's start time.
 */
export const processesTable = (run: ProcessRunner = runProcess) => ({
  /**
   * Reads every process in one `ps` call.
   *
   * @returns the rows, or the exit code where `ps` exited non-zero.
   */
  read: async (): Promise<TableRead> => {
    const ran = await run('ps', [...TABLE_ARGS], { env: C_LOCALE });
    return ran.code === 0 ? { ok: true, rows: parseTable(ran.stdout) } : { ok: false, code: ran.code };
  },

  /**
   * Reads one pid's start time with `ps -o lstart= -p <pid>` under `LC_ALL=C`.
   *
   * @param pid - the process to ask about.
   * @returns epoch milliseconds, or `null` where no process holds the pid or
   *   the start does not parse.
   */
  startedAt: async (pid: number): Promise<number | null> => {
    const ran = await run('ps', ['-o', 'lstart=', '-p', String(pid)], { env: C_LOCALE });
    return ran.code === 0 ? lstartMs(ran.stdout) : null;
  },
});
