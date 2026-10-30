import type { DeskDeadAnswer } from './desk-dead.js';

/** Who wrote a desk's `PLOT-BLOCKED` marker; absent on a marker an agent wrote itself. */
export type MarkerAuthor = 'fleetd' | 'loop';

/** One desk's marker, as `unblockerDue` needs it. */
export interface UnblockerMarkerReading {
  /** The marker's modification time, ISO-8601 — half of the answer record's key. */
  askedAt: string;
  /** Who wrote the marker; absent where an agent wrote its own. */
  author?: MarkerAuthor;
}

/** What `unblockerDue` reads to decide one desk. */
export interface UnblockerDueReading {
  /** The desk's marker, or `null` where it holds none. */
  marker: UnblockerMarkerReading | null;
  /** Whether the desk's agent can still be trusted to act. */
  deskDead: DeskDeadAnswer;
  /** Whether an unblocker is already running on this desk. */
  liveFixer: boolean;
  /** The outcomes already recorded for this marker's `(worktree, askedAt)` key, in any order. */
  recordedOutcomes: readonly string[];
}

/** Whether an unblocker should start on a desk, and why not when it should not. */
export type UnblockerDueAnswer =
  | { start: true }
  | { start: false; why: 'no-marker' | 'not-waiting' | 'tagged-marker' | 'live-fixer' | 'already-recorded' };

/**
 * Whether fleetd should start an `unblocker` run against one desk's question.
 *
 * **ANSWERABLE ONLY WHEN AN AGENT WROTE ITS OWN QUESTION.** A marker tagged
 * `fleetd` or `loop` is terminal — the loop already ended that desk's turn, or
 * fleetd itself asked a person — and no unblocker run answers either: both
 * {@link MarkerAuthor} values refuse `tagged-marker`. An untagged marker is an
 * agent's own `PLOT-BLOCKED:` write, which is exactly what this role answers.
 *
 * **`deskDead.why === 'waiting'` IS THE ONLY LIVE READING THAT ADMITS A
 * START.** `deskDead` already folds "has a marker" into `waiting`, so a
 * `live`, `elsewhere` or `unread` desk, or one that is simply dead, refuses
 * `not-waiting` regardless of what `marker` carries — matching
 * `deskDead`'s own precedence.
 *
 * **ONE UNBLOCKER AT A TIME.** `liveFixer` is true for the run this question
 * already started, so a desk is never asked twice while its first answer is
 * still in flight.
 *
 * **ANY RECORDED OUTCOME REFUSES, NOT JUST `started`.** A `started`,
 * `answered`, `refused …` or `failed` row for this exact `(worktree, askedAt)`
 * key all mean this question has already been given to an unblocker once; a
 * failed or refused attempt is not retried automatically, the same way a
 * fresh-agent `needs-a-person` episode is not re-escalated once recorded. A
 * genuinely new question gets a new `askedAt` from its own marker, which is a
 * new key with no recorded rows.
 *
 * @param reading - the desk's marker, its `deskDead` answer, whether an
 *   unblocker already runs there, and the outcomes already recorded for this
 *   marker's key.
 * @returns `{ start: true }`, or `{ start: false, why }`.
 */
export const unblockerDue = (reading: UnblockerDueReading): UnblockerDueAnswer => {
  if (reading.marker === null) return { start: false, why: 'no-marker' };
  if (reading.deskDead.dead || reading.deskDead.why !== 'waiting') return { start: false, why: 'not-waiting' };
  if (reading.marker.author !== undefined) return { start: false, why: 'tagged-marker' };
  if (reading.liveFixer) return { start: false, why: 'live-fixer' };
  if (reading.recordedOutcomes.length > 0) return { start: false, why: 'already-recorded' };
  return { start: true };
};
