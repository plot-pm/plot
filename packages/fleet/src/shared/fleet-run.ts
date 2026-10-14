import fs from 'node:fs';
import path from 'node:path';
import { readConfig, type ConfigReadOptions } from './config-reader.js';

/**
 * Shared machinery between the fleet's run kinds — today `auto-verify.ts` and
 * `auto-design.ts`. A verify run and a spec run each keep their own state file
 * shape and their own settlement rules, but both read a pid off the process
 * table, grace a run whose pid is not yet recorded, and read `Worker bound`
 * for how long a run may go. Pulling those three out is what keeps the two
 * pass files from drifting on a question neither owns.
 */

/**
 * Whether a process with this pid is alive.
 *
 * `kill(pid, 0)` sends no signal; it only asks. `EPERM` means a process
 * exists and this one may not signal it — still alive. Any other error,
 * `ESRCH` included, means no such process.
 *
 * @param pid - the process id.
 * @returns `true` when the process exists.
 */
export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** What {@link runGoing} reads of one run, whatever its state file's own shape adds. */
export interface GoingRun {
  /** The agent's pid; `0` until the run has started it. */
  readonly pid: number;
  /** Epoch milliseconds of the start. */
  readonly startedAt: number;
  /** The exit code, once the run ended in this fleet process. */
  readonly code?: number;
}

/**
 * Whether a run this fleet started is still going: no end recorded, and its
 * agent alive, or its agent not yet recorded inside `graceMs`.
 *
 * @param run - the run.
 * @param alive - whether a pid is alive.
 * @param now - epoch milliseconds.
 * @param graceMs - how long a run with no recorded pid still counts as going.
 * @returns `true` while the run is going.
 */
export const runGoing = (run: GoingRun, alive: (pid: number) => boolean, now: number, graceMs: number): boolean => {
  if (run.code !== undefined) return false;
  return run.pid > 0 ? alive(run.pid) : now - run.startedAt < graceMs;
};

/** The `## Plot Config` key whose seconds bound one run. */
export const WORKER_BOUND_KEY = 'Worker bound';

/**
 * `Worker bound` in seconds, or `defaultSeconds` where the key is absent or
 * not a positive whole number.
 *
 * @param opts - the repository and scripts directory to read through.
 * @param defaultSeconds - what to answer when the key does not parse.
 * @returns the bound, in seconds.
 */
export const boundSecondsOf = (opts: ConfigReadOptions, defaultSeconds: number): number => {
  const value = Number(readConfig(opts, WORKER_BOUND_KEY, String(defaultSeconds)));
  return Number.isInteger(value) && value > 0 ? value : defaultSeconds;
};

/**
 * Reads a run-kind's state file as JSON, falling back to `empty` where no
 * file exists.
 *
 * @param file - the state file's absolute path.
 * @param empty - the state to answer where no file exists.
 * @returns the parsed state; `null` where a file exists and cannot be read or parsed.
 */
export const readRunState = <T>(file: string, empty: T): T | null => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? empty : null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/**
 * Reads, changes and writes a run-kind's state file in one synchronous step,
 * so no other callback of this process writes between the read and the
 * write.
 *
 * @param file - the state file's absolute path.
 * @param empty - the state to read where no file exists.
 * @param change - the new state from the current one.
 * @returns the state written, or `null` where the current file cannot be read; nothing is written then.
 */
export const updateRunState = <T>(file: string, empty: T, change: (current: T) => T): T | null => {
  const current = readRunState(file, empty);
  if (current === null) return null;
  const next = change(current);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
  fs.renameSync(tmp, file);
  return next;
};
