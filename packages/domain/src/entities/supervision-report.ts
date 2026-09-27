import { z } from 'zod';

/**
 * The version word a report file carries.
 *
 * A LITERAL, so an unrecognised value fails the parse rather than the reader —
 * `PR_INDEX_VERSION`'s argument, and the same fallback is required here: a
 * report this Plot cannot parse means *the tick judged nothing I can read*, not
 * *the desks are fine*.
 */
export const SUPERVISION_REPORT_VERSION = 1;

/**
 * What one tick decided about one desk, as the report holds it.
 *
 * EXACTLY WHAT THE TICK EMITTED, AND NOTHING THE READER INFERRED. The verdict
 * and the cause are `supervise()`'s own words, carried outward; a reader that
 * re-derived either would be running the supervision twice against a desk that
 * may have changed between the two, which is the defect this whole record
 * removes.
 */
export const SupervisionReportRowSchema = z
  .object({
    /**
     * The branch the verdict is about, or `''` for an agent holding none.
     *
     * **NOT `.min(1)`, AND THAT WAS MEASURED RATHER THAN REASONED.** A FREE
     * agent is registered, has a desk cut detached at `origin/<main>` and holds
     * no slice, so the tick judges it with an empty branch —
     * `plot-dispatch.sh --start` creates exactly those. Written strict, one such
     * row made the WHOLE report unparseable: measured 2026-09-27 against the
     * live estate, a tick judging 8 agents wrote 2 free rows and all 8 desks
     * lost their cause, because the reader's fallback for a file it cannot
     * parse is to carry nothing.
     *
     * A row is dropped by the READER where it names no branch — the join is by
     * branch and an empty key matches no row — rather than by the schema, so one
     * unjoinable row costs itself and never the other seven.
     */
    branch: z.string(),
    /** The desk it is about, as the tick read it. */
    worktree: z.string(),
    /** What to do about this agent, verbatim from the tick. */
    verdict: z.string().min(1),
    /** Why, verbatim from the tick. */
    cause: z.string().min(1),
  })
  .strict();

/**
 * One tick's judgement of every desk it supervised.
 *
 * ## Why a file at all
 *
 * `plot-registryd` and the board are separate processes and nothing crossed
 * between them: the tick computed a {@link SupervisionCause} for every desk and
 * discarded it after printing one line to stdout. A board that asked
 * `supervise()` itself would double the per-agent host call the tick already
 * makes — 180 an hour at three agents — and would be the same defect reproduced
 * in a second place.
 *
 * ## Four constraints, and the record answers each
 *
 * - **ONE WRITER.** The daemon writes it and the board only reads it. A second
 *   writer would race: the `rename` is atomic, the read-decide-write sequence
 *   around it is not.
 * - **MACHINE-LOCAL.** It lives under the common git dir's `.plot/state/`, for
 *   the reason receipts do (`plot-boardctl.sh:83`): a record travelling in a
 *   commit would describe this machine's desks on every checkout that pulled it.
 * - **IT CARRIES ITS OWN CLOCK.** {@link at} is the tick's start, so a reader
 *   can age the record. `fleet.ts:2175` refuses a persisted verdict because *"a
 *   persisted verdict would be a cache git cannot reach"* — and this is not that
 *   kind of value. A supervision cause is derived from readings the board cannot
 *   take at any price (the desk's declaration, the attempts counter, the
 *   machine's headroom at that instant), which puts it on the BOUGHT ANSWER
 *   side of *Answers, never verdicts* alongside a host's `mergedAt`. What the
 *   rule still demands is that staleness can never pass as current, which is
 *   what this field is for and why a reader without a bound would be wrong.
 * - **THE TICK STILL HOLDS NOTHING.** The daemon never reads this file back, so
 *   no tick's decision depends on an earlier one and `kill -9` still costs
 *   exactly one tick. It is an outbound observation, like the log line beside
 *   it — not a journal and not a resume path.
 *
 * ## What absence means
 *
 * A missing report, an unparseable one, and a desk this report does not name all
 * mean *the tick did not judge this desk*. None of them means the desk is fine.
 */
export const SupervisionReportSchema = z
  .object({
    /** The format, so an older or newer file is unparseable rather than misread. */
    v: z.literal(SUPERVISION_REPORT_VERSION),
    /** When the tick that wrote this started, epoch milliseconds. */
    at: z.number().nonnegative(),
    /**
     * Every desk the tick judged, including the ones it left alone.
     *
     * THE `leave` ROWS ARE HERE THOUGH THE LOG DROPS THEM. `reportTick` filters
     * `verdict === 'leave'` before printing, because a log of a quiet estate
     * should be quiet. A reader asking *what does this desk owe* needs the
     * opposite: an absent row must mean the tick did not judge the desk, and if
     * the live ones were filtered out here it would also mean *a worker is
     * running*, which is a second meaning for one absence.
     */
    rows: z.array(SupervisionReportRowSchema),
  })
  .strict();

export type SupervisionReport = z.infer<typeof SupervisionReportSchema>;
export type SupervisionReportRow = z.infer<typeof SupervisionReportRowSchema>;

/**
 * Parses a report file's whole contents, or null where it is not one.
 *
 * AN UNREADABLE REPORT IS NOTHING TO START FROM, NEVER A FAILURE. An
 * unrecognised `v`, a shape that changed and a torn write all mean the same
 * thing to a reader: no desk was judged that I can read. Reporting a failure
 * instead would surface the next format change to an operator as a broken
 * board.
 *
 * @param text - the file's contents.
 * @returns the report, or null where it is absent or unrecognised.
 */
export const decodeSupervisionReport = (text: string): SupervisionReport | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = SupervisionReportSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a report for writing.
 *
 * @param report - what the tick decided.
 * @returns the file's contents.
 */
export const encodeSupervisionReport = (report: SupervisionReport): string =>
  `${JSON.stringify(report)}\n`;
