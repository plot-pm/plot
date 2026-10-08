/**
 * Whether a desk already holds a live loop — the refusal `continueOnDesk` asks
 * before its first write, so a continuation never starts a second worker
 * beside one still running (#1294).
 *
 * Three pid sources name a desk's worker: `.plot-worker.pid` (the file
 * `deskPidAlive` reads), and the manifest's `pid` and `wrapperPid`. This rule
 * takes the three as readings and returns the first that is alive, or none —
 * it does no I/O itself; the caller supplies each pid's aliveness via `kill
 * -0` or equivalent.
 *
 * **The direction is the opposite of `deskPidAlive`'s.** There, an
 * unanswerable `EPERM` reads as not-alive because a wrong *alive* would invent
 * a worker and narrow auto-dispatch's budget on no evidence. Here, a wrong
 * *not-alive* starts a SECOND loop on a desk that already holds one — the
 * defect this rule exists to prevent — so the caller must read `EPERM` as
 * alive for this rule's purpose, not reuse `deskPidAlive` unchanged.
 *
 * An absent, empty or non-numeric pid is not alive: no record means nothing
 * to refuse on, the same *absent is not false* reading `desk-manifest`
 * applies to an unnamed desk.
 *
 * @concept desk-loop-alive
 */

/** One pid source, as read from disk. */
export interface DeskPidReading {
  /** Where the pid came from — names the file or manifest field in a refusal. */
  readonly source: string;
  /** The pid as recorded, verbatim; `''` or absent when the source holds none. */
  readonly pid: string;
}

/** The desk's pid sources and whether each is alive. */
export interface DeskLoopReading {
  /** Every pid source the caller read for this desk, in the order to check. */
  readonly pids: readonly DeskPidReading[];
  /** Whether a given pid is alive; the caller's `kill -0`, memoised per pid. */
  readonly alive: (pid: string) => boolean;
}

/** A live loop already holds the desk. */
export interface DeskLoopAlive {
  readonly kind: 'alive';
  /** The first live pid found, in `pids` order. */
  readonly pid: string;
  /** Which source named it — for a refusal detail a person can act on. */
  readonly source: string;
}

/** No pid source names a live loop. */
export interface DeskLoopNone {
  readonly kind: 'none';
}

/** Whether a desk already holds a live loop. */
export type DeskLoop = DeskLoopAlive | DeskLoopNone;

/** A pid is a positive integer, written exactly — no sign, no decimal, no surrounding text. */
const isNumericPid = (pid: string): boolean => /^[1-9][0-9]*$/.test(pid);

/**
 * The first live pid among a desk's recorded sources, or none.
 *
 * Checked in the order `pids` is given — the caller supplies `.plot-worker.pid`
 * first, then the manifest's `pid`, then its `wrapperPid`, matching the order
 * the refusal detail should name them in. A pid can be recycled: a stale pid
 * file whose number a new, unrelated process now holds reads as alive here,
 * and that is accepted — the refusal names the pid and its source so a person
 * can judge it, and a wrongly-skipped refusal (a second loop on the desk) is
 * the worse failure.
 *
 * @param reading - the desk's pid sources and an aliveness check.
 * @returns the first live pid and its source, or `none` when every source is
 *   absent, empty, non-numeric or dead.
 */
export const deskLoopAlive = (reading: DeskLoopReading): DeskLoop => {
  for (const { source, pid } of reading.pids) {
    if (!isNumericPid(pid)) continue;
    if (reading.alive(pid)) return { kind: 'alive', pid, source };
  }
  return { kind: 'none' };
};

/**
 * The free-wait record's filename, matching `desk-fs.ts`'s own constant.
 *
 * A caller outside the `Desk` port — `continueOnDesk` reads this file
 * directly, the same way it reads `ENDING_FILENAME` via `deskEnding` rather
 * than through a port method, because the `Desk` port exposes writes only.
 */
export const FREE_WAIT_FILENAME = '.plot-worker.freewait';

/**
 * What the caller read of a desk's `.plot-worker.freewait` record.
 *
 * `null` is how a caller says the file was not there — the same convention
 * {@link readEnding} uses, and for the same reason: a missing record and an
 * empty one are different facts, even though this rule treats both as "not a
 * free wait."
 */
export interface FreeWaitReading {
  /** The record's text, verbatim; `null` when the file does not exist. */
  readonly text: string | null;
}

/**
 * Whether a desk's recorded free wait belongs to a given pid.
 *
 * **ABSENT IS NOT A FREE WAIT.** A missing file, an empty file, or one that
 * does not hold `pid` exactly (whitespace trimmed, nothing else forgiven)
 * answers false — the same *absent is not false* reading `desk-manifest` and
 * `ending` both apply to their own records. A loop whose free-wait record
 * cannot be trusted stays a `loop-alive` refusal rather than a stop.
 *
 * @param reading - the record's text, or that none was found.
 * @param pid - the pid `deskLoopAlive` named for this desk.
 * @returns whether the record names exactly this pid as waiting free.
 */
export const deskWaitsFree = (reading: FreeWaitReading, pid: string): boolean => {
  if (reading.text === null) return false;
  return reading.text.trim() === pid.trim() && pid.trim() !== '';
};
