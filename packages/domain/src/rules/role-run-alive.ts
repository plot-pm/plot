/**
 * Whether a role run for a subject is still alive.
 *
 * The caller reads the run's recorded pid and asks the process table; this
 * rule decides what an unanswerable check means. The error biases by what a
 * wrong answer costs:
 *
 * - **fixer and main-repair write** — the fixer commits to the PR's branch,
 *   main-repair opens a fix PR. A wrong *not-alive* starts a second writer
 *   beside a live one, so an unanswerable check reads as alive, as
 *   `deskLoopAlive`'s caller does.
 * - **reviewer and unblocker write nothing** — `review.ts` owns the reviewer's
 *   status write, and fleetd hands the unblocker's answer to `continue`. A
 *   wrong *alive* holds the subject's next run until a person looks; a wrong
 *   *not-alive* costs one duplicate run's spend. An unanswerable check reads
 *   as not alive, so a recycled or unreadable pid never blocks a read-only
 *   role for good.
 *
 * @concept role-run-alive
 */
import type { RoleName } from './role-command.js';

/** What the process table said of one pid. */
export type PidCheck = 'alive' | 'dead' | 'unanswerable';

/** A role run's recorded pid and the check against it. */
export interface RoleRunReading {
  /** The role the run started as. */
  readonly role: RoleName;
  /** The pid as recorded, verbatim; `''` or absent when none was recorded. */
  readonly pid: string;
  /** Asks the process table about one pid; the caller's `kill -0`. */
  readonly check: (pid: string) => PidCheck;
}

/** The roles whose run changes the repository or the host. */
const WRITING_ROLES: ReadonlySet<RoleName> = new Set(['fixer', 'main-repair']);

/**
 * Whether a role run is alive.
 *
 * A pid that is empty or not a positive integer is not alive: no record
 * means nothing to wait on.
 *
 * @param reading - the role, its recorded pid and the process check.
 * @returns whether to treat the run as alive.
 */
export const roleRunAlive = (reading: RoleRunReading): boolean => {
  if (!/^[1-9][0-9]*$/.test(reading.pid)) return false;
  const check = reading.check(reading.pid);
  return check === 'unanswerable' ? WRITING_ROLES.has(reading.role) : check === 'alive';
};
