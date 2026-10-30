import { z } from 'zod';

import type { PortResult } from '../port-result.js';

/**
 * One action the delivery loop can take, worth a run-log line.
 *
 * `dispatch` — the board fanned a plan out to the registry.
 * `correction` — the desk's worker loop wrote a CI correction.
 * `fresh-agent` — the supervisor started a fresh session for a spent budget.
 * `deliver` — the board started a plan's delivery.
 * `notified` — a person was sent an idle-slice message (wave 2).
 */
// plot-state: classification — one action the delivery loop took on a slice,
// or a notification it sent about one. A step never transitions into another:
// a slice's next line may name any step, in any order, because the loop acts
// on whatever the pulse shows it this tick.
export const RunLogStepSchema = z.enum(['dispatch', 'correction', 'fresh-agent', 'deliver', 'notified']);
export type RunLogStep = z.infer<typeof RunLogStepSchema>;

/**
 * What a logged step came to.
 *
 * `moved` — the step changed the slice: a dispatch started, a correction was
 * written, a fresh session began, a plan's delivery started, a message sent.
 * `failed` — the step was attempted and could not complete.
 * `partial` — the step's host answer was incomplete, neither a clean success
 * nor a clear failure.
 *
 * **THE SPLIT IS LOAD-BEARING.** Wave 2's idle clock counts only `moved`
 * lines; `failed` and `partial` never move it, so a slice stuck retrying a
 * broken correction still reads idle.
 */
// plot-state: classification — what a step's action came to. A line's outcome
// never transitions into another: each append is one tick's own answer, and
// the next line for the same slice is free to read differently.
export const RunLogOutcomeSchema = z.enum(['moved', 'failed', 'partial']);
export type RunLogOutcome = z.infer<typeof RunLogOutcomeSchema>;

/** One line of the run log — one action the delivery loop took on a slice. */
export interface RunLogLine {
  /** The plan the slice belongs to, as its file name without `.md`. */
  plan: string;
  /** The slice's branch; `''` for a step that names no single branch (a plan-wide dispatch fan-out or delivery). */
  branch: string;
  /** The slice's open PR number as a string, or `''` where none is known. */
  pr: string;
  /** The slice's head commit, or `''` where none is known. */
  head: string;
  /** Which action this line records. */
  step: RunLogStep;
  /** What the action came to; free text may follow, escaped by the adapter. */
  outcome: string;
  /** When the action happened, ISO-8601. */
  at: string;
}

/**
 * Reads and appends `.plot/state/run-log.tsv` — one line per action the
 * delivery loop takes: a dispatch, a CI correction, a fresh session, a
 * delivery start, or an idle notification.
 *
 * **AN ACTION RECORD, NOT AN INDEX.** It records what the loop did, the way
 * `fresh-agents.tsv` and `escalations.tsv` do. No rule reads a host fact
 * (merged, checks, review state) from it — those come from the PR index and
 * the default-branch reading. Only the idle-slice rule (wave 2) reads it, and
 * only to find when a slice last moved.
 *
 * **A LINE IS WRITTEN ONLY WHEN THE LOOP ACTS**, never on a per-tick
 * evaluation that answers the same thing every pass. A rule that logged on
 * every 60 s tick would write about 1,440 lines a day per waiting slice, and
 * the slice would never read idle.
 *
 * **MACHINE-LOCAL, UNDER THE COMMON GIT DIR, NEVER A DESK'S OWN.** The same
 * placement {@link FreshAgentRecordStore} uses: `plot-reap.sh` removes a
 * finished desk, and a line written to one is destroyed by the reap that
 * measured it.
 *
 * **A MISSING FILE READS AS NO LINES; AN UNREADABLE ONE READS `failed`.**
 * Absence is not false — a repository that has taken no loop action yet and a
 * repository this read could not open must never answer the same way to a
 * caller that tells them apart.
 *
 * **A TORN OR UNPARSEABLE LINE IS SKIPPED**, the same choice every other
 * `.plot/state/` reader makes: a corrupted line contributing a wrong reading
 * is worse than it contributing nothing.
 *
 * **APPEND-ONLY, NO ROTATION.** Each append is one `O_APPEND` write of one
 * line under `PIPE_BUF`, so two processes — the looping board and a desk's
 * worker loop — never interleave. The existing append-only records on this
 * estate hold 277 and 208 lines with no cap; this one carries the same
 * contract.
 */
export interface RunLog {
  /**
   * Every line the log holds, in file order.
   *
   * @returns the lines, oldest first. A missing file answers `answered([])`.
   *   Any other read error answers `failed()`.
   */
  read(): Promise<PortResult<readonly RunLogLine[]>>;

  /**
   * Appends one line — one action the loop took.
   *
   * @param line - the slice, the step, the outcome and when it happened.
   * @returns nothing on success; `failed` where the write itself could not
   *   land. Never throws.
   */
  append(line: RunLogLine): Promise<PortResult<void>>;
}
