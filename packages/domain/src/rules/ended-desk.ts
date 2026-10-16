/**
 * Whether a desk whose loop ended still owes a person anything.
 *
 * A desk that ended at the bound, whose slice merged, whose tree is clean, whose
 * commits are all pushed and which holds no `PLOT-BLOCKED` question owes
 * nothing: it is reapable, and its row leaves *Waiting on you*.
 *
 * @concept desk-lifecycle
 */

import type { EndingReading } from '../entities/ending.js';

/**
 * What was measured of one ended desk.
 *
 * Every field except `ending` is `null` where nobody asked. A `null` never
 * counts as the clean answer.
 */
export interface EndedDeskReadings {
  /** The desk's `.plot-worker.ending.json`, read; `absent` where the file is not there. */
  readonly ending: EndingReading;
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

const hours = (seconds: number): string => `${Math.round((seconds / 3600) * 10) / 10}`;

/**
 * Where an ended desk belongs.
 *
 * The desk owes nothing only when the ending record reads `bound` and every
 * other reading is a definite clean answer. A missing, unreadable or
 * non-`bound` record, a merge nobody asked about, and any unlanded work, dirty
 * tree or `PLOT-BLOCKED` question each leave the desk with a person.
 *
 * @param readings - what was measured of the desk.
 * @returns whether a person is owed, and the row text.
 */
export const endedDeskPlacement = (readings: EndedDeskReadings): EndedDeskPlacement => {
  const owed: EndedDeskPlacement = { owesPerson: true, note: '' };
  if (readings.ending.read !== 'ended' || readings.ending.ending.reason !== 'bound') return owed;
  if (
    readings.merged !== true ||
    readings.dirty !== false ||
    readings.unlanded !== false ||
    readings.blockedQuestion !== false
  ) {
    return owed;
  }
  const after = readings.boundSeconds === null ? 'at the bound' : `after ${hours(readings.boundSeconds)} h`;
  return { owesPerson: false, note: `ended ${after} with no slice offered — reaped on the next pass` };
};
