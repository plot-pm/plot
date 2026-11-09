import type { IdleInputs } from '../entities/ending.js';
import type { WorkerActivity } from '../entities/fleet.js';
import type { ProcessRow } from './pid-current.js';

/** One reading of `.plot-worker.log`. */
export interface LogStat {
  /** The size in bytes. */
  readonly bytes: number;
  /** The mtime, epoch milliseconds. */
  readonly mtimeMs: number;
}

/**
 * Reads working or idle from two readings of the worker log.
 *
 * @param before - the reading at the check before; `null` where there was none.
 * @param after - the reading now; `null` where the log is not there.
 * @returns `working` where the size or the mtime moved, `idle` where neither
 *   moved, and `''` where either reading is missing.
 */
export const logActivity = (before: LogStat | null, after: LogStat | null): WorkerActivity => {
  if (before === null || after === null) return '';
  return before.bytes !== after.bytes || before.mtimeMs !== after.mtimeMs ? 'working' : 'idle';
};

/**
 * Sums the CPU time of a process and every descendant in one table.
 *
 * @param table - one reading of the process table.
 * @param root - the pid at the top of the subtree.
 * @returns centiseconds; `null` where the table holds no row for the root.
 */
export const subtreeCpuCentis = (table: readonly ProcessRow[], root: number): number | null => {
  if (!table.some((r) => r.pid === root)) return null;
  const inTree = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of table) {
      if (!inTree.has(r.pid) && inTree.has(r.ppid)) {
        inTree.add(r.pid);
        grew = true;
      }
    }
  }
  return table.reduce((sum, r) => (inTree.has(r.pid) ? sum + r.cpuCentis : sum), 0);
};

/**
 * The CPU time a subtree gained between two table readings, as
 * `plot_worker_activity` compares two samples.
 *
 * @param before - the earlier table; `null` where none was read.
 * @param after - the table read now.
 * @param root - the pid at the top of the subtree.
 * @returns centiseconds gained; `null` where either table holds no row for the root.
 */
export const cpuDeltaCentis = (before: readonly ProcessRow[] | null, after: readonly ProcessRow[], root: number): number | null => {
  if (before === null) return null;
  const was = subtreeCpuCentis(before, root);
  const now = subtreeCpuCentis(after, root);
  return was === null || now === null ? null : now - was;
};

/**
 * Whether the idle watch's activity readings withhold `idle`.
 *
 * @param inputs - what one idle check read of the log and the CPU.
 * @returns `true` where the log moved, the CPU delta is positive, or the
 *   check measured no CPU delta.
 */
export const activityVeto = (inputs: IdleInputs): boolean =>
  inputs.log === 'working' || inputs.cpuDeltaCentis === null || inputs.cpuDeltaCentis > 0;
