import type { PortResult } from '../port-result.js';

/** One answer given to a blocked desk. */
export interface AnswerRecord {
  /** The desk the question was asked on, absolute. */
  worktree: string;
  /** When the question's marker was written, ISO-8601 — half of the row's key. */
  askedAt: string;
  /** The question's first line, as the marker stated it. */
  question: string;
  /** The answer a person or `unblocker` gave. */
  answer: string;
  /** Who answered: `unblocker`, or a person's handle. */
  author: string;
  /** `started`, `answered`, `refused <reason>`, or `failed`. */
  outcome: string;
}

/**
 * Reads and appends `.plot/state/answers.tsv` — one row per answer given to a
 * blocked desk, keyed on `(worktree, askedAt)`.
 *
 * **A PORT, NOT A FILE WRITE IN THE CALLER.** The layering rule points inward:
 * `continueOnDesk` is a controller and must call the domain rather than reach
 * the world itself. This is the one write a person's answer earns — a record
 * that an answer was given, once, for this question — and the adapter is the
 * only thing allowed to touch the disk for it.
 *
 * **MACHINE-LOCAL, UNDER THE COMMON GIT DIR, NEVER A DESK'S OWN.** The same
 * placement {@link FreshAgentRecordStore} uses, and for the same reason:
 * `plot-reap.sh` removes a finished desk, and a record written to one is
 * destroyed by the reap that measured it.
 *
 * **APPEND-ONLY, ONE ROW PER ANSWER.** A row is a measurement — this question,
 * asked at this time on this desk, was answered this way — so a second answer
 * to a different question on the same desk is a second row, never an
 * overwrite.
 *
 * **KEYED ON `(worktree, askedAt)`, THE MARKER'S OWN MODIFICATION TIME.** The
 * same key `escalations.tsv` already uses: a new question has a new
 * `askedAt`, so telling one question's answer from another's needs no
 * separate counter.
 *
 * **A MISSING FILE READS AS NO ROWS, AND AN UNREADABLE ONE IS `failed`; THE
 * CALLER READS BOTH AS ZERO ROWS, NEVER AS "ALREADY STARTED."** Absence must
 * never strand a question unanswered for a record this estate never wrote.
 */
export interface AnswerRecordStore {
  /**
   * Every row this record holds for one desk's question, in file order.
   *
   * @param worktree - the desk the question was asked on.
   * @param askedAt - the question's marker's modification time, ISO-8601.
   * @returns the rows for that question, oldest first. A missing file answers
   *   `answered([])`. Any other read error answers `failed()`, which the
   *   caller reads as zero rows.
   */
  rowsFor(worktree: string, askedAt: string): Promise<PortResult<readonly AnswerRecord[]>>;

  /**
   * Appends one row — one answer given.
   *
   * @param record - the desk, the question, the answer, the author and the outcome.
   * @returns nothing on success; `failed` where the write itself could not
   *   land. Never throws.
   */
  append(record: AnswerRecord): Promise<PortResult<void>>;
}
