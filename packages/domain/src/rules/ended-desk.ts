/**
 * Whether a desk whose loop ended still owes a person anything.
 *
 * A desk whose free wait ran out, whose slice merged, whose tree is clean, whose
 * commits are all pushed and which holds no `PLOT-BLOCKED` question owes
 * nothing: its row leaves *Waiting on you*.
 *
 * @concept desk-lifecycle
 */

import type { EndingReading } from '../entities/ending.js';

/**
 * What was measured of one ended desk.
 *
 * Every field except `ending` and `exit` is `null` where nobody asked. A `null`
 * never counts as the clean answer.
 */
export interface EndedDeskReadings {
  /** The desk's `.plot-worker.ending.json`, read; `absent` where the file is not there. */
  readonly ending: EndingReading;
  /** The desk's `.plot-worker.exit` text, verbatim; `null` where the file is absent. */
  readonly exit: string | null;
  /** Whether the host merged a PR for the desk's slice (`mergedAt`, never ancestry). */
  readonly merged: boolean | null;
  /** Whether the tree holds uncommitted work. */
  readonly dirty: boolean | null;
  /** Whether the desk holds commits no remote has. */
  readonly unlanded: boolean | null;
  /** Whether the desk carries a `PLOT-BLOCKED` question. */
  readonly blockedQuestion: boolean | null;
  /** The `Worker bound` in seconds, or `null` where it is not known. */
  readonly boundSeconds: number | null;
}

/** Where an ended desk belongs, and the words its row prints. */
export interface EndedDeskPlacement {
  /** True when a person must look at the desk; false when it only waits to be reaped. */
  readonly owesPerson: boolean;
  /** The row text; `''` when the desk owes a person and has no ending to word. */
  readonly note: string;
}

/** The exit code `agentLoop` ROW 2 names when the free wait reaches `Worker bound`. */
const FREE_WAIT_EXIT = '124';

const hours = (seconds: number): string => `${Math.round((seconds / 3600) * 10) / 10}`;

/**
 * Whether a desk's records show that its free wait ran out.
 *
 * `agentLoop` ROW 2 exits 124 and writes no ending; the wrapper records the
 * exit code in `.plot-worker.exit`; the supervisor's `killedWorkerEnding` then
 * writes `reason: unreadable, actor: supervisor` for the desk. Every other
 * 124 exit of the loop writes its own ending, so the supervisor's record beside
 * an exit of 124 names the free-wait end.
 *
 * An absent ending answers false: the supervisor has not recorded the end yet.
 *
 * @param ending - the desk's `.plot-worker.ending.json`, read.
 * @param exit - the desk's `.plot-worker.exit` text, verbatim; `null` where absent.
 * @returns true only for the supervisor's `unreadable` record beside an exit of 124.
 */
export const freeWaitEnded = (ending: EndingReading, exit: string | null): boolean =>
  ending.read === 'ended' &&
  ending.ending.reason === 'unreadable' &&
  ending.ending.actor === 'supervisor' &&
  exit?.trim() === FREE_WAIT_EXIT;

/**
 * Where an ended desk belongs.
 *
 * The desk owes nothing only when {@link freeWaitEnded} holds and every other
 * reading is a definite clean answer. A missing or unreadable record, any
 * other ending, a merge nobody asked about, and any unlanded work, dirty tree
 * or `PLOT-BLOCKED` question each leave the desk with a person.
 *
 * @param readings - what was measured of the desk.
 * @returns whether a person is owed, and the row text.
 */
export const endedDeskPlacement = (readings: EndedDeskReadings): EndedDeskPlacement => {
  const owed: EndedDeskPlacement = { owesPerson: true, note: '' };
  if (!freeWaitEnded(readings.ending, readings.exit)) return owed;
  if (
    readings.merged !== true ||
    readings.dirty !== false ||
    readings.unlanded !== false ||
    readings.blockedQuestion !== false
  ) {
    return owed;
  }
  const after = readings.boundSeconds === null ? 'at the wait bound' : `after ${hours(readings.boundSeconds)} h`;
  return { owesPerson: false, note: `ended ${after} with no slice offered — reaped on the next pass` };
};
