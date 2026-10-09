/**
 * Whether a brief writer is at work on ONE branch, from readings alone.
 *
 * #1417: the fleet carried `briefAskedAt` on every not-started slice while a
 * writer worked, and an age cannot say when the work is done. This answers
 * the question an age cannot: is a writer running RIGHT NOW for this branch.
 */
export type BriefWriterState = 'writing' | 'failed' | 'asked' | 'none';

/** What was measured of one branch's brief writer. */
export interface BriefWriterReadings {
  /**
   * Whether this branch still needs its brief written — `startability ===
   * 'needs-brief'`, decided upstream by `startabilityVerdict`. `false` once
   * the brief lands on the default branch, even while a writer's pid is still
   * alive for a moment: a brief that exists is the answer, not the process
   * that wrote it.
   */
  needsBrief: boolean;
  /**
   * The writer's run state FOR THIS BRANCH — read from the branch's own state
   * file, never from the plan-keyed one. `'running'` only while a pid this
   * branch's run recorded is alive; `'failed'` where it recorded a non-zero
   * exit, or the pid died; `'none'` where nothing runs for this branch,
   * including a run that named a DIFFERENT branch or named none at all.
   *
   * A BRANCHLESS RUN NEVER READS `'running'` HERE. Wave 1 keeps the
   * plan-keyed reading for a run given no branch so every brief-less sibling
   * still reads `asked` — widening THIS reading to match would put the
   * indicator back on every sibling, the defect #1417 reports. The caller
   * passes `'none'` for a branchless run and lets `askedAt` carry the ask.
   */
  runState: 'running' | 'failed' | 'none';
  /**
   * Epoch milliseconds of the earliest counting ask, or null — carried for the
   * caller's note beside the indicator. Read but never decided on: an age
   * cannot say a writer is done, which is the defect this rule exists to fix.
   * See `briefAskedAt` in `brief-ask-log.ts`.
   */
  askedAt: number | null;
}

/**
 * What a branch's brief writer is doing, from one reading of the readings
 * above and no I/O.
 *
 * THE BRIEF GATES FIRST. `needsBrief` false answers `none` whatever `runState`
 * says — a brief that landed is the end of the question, even for a pid still
 * alive this instant, and a reading that let a live process outrank the brief
 * would hold `writing` on a row that already has what it needed.
 *
 * `runState` THEN DECIDES BETWEEN THE REMAINING THREE. `'running'` is
 * `writing`; `'failed'` is `failed`; `'none'` falls back to `askedAt` — a
 * recorded ask with nothing running now is `asked`, and no ask at all is
 * `none`.
 *
 * @param readings - what was measured of the branch.
 * @returns the writer's state for this branch.
 */
export const briefWriterState = (readings: BriefWriterReadings): BriefWriterState => {
  if (!readings.needsBrief) return 'none';
  if (readings.runState === 'running') return 'writing';
  if (readings.runState === 'failed') return 'failed';
  return readings.askedAt === null ? 'none' : 'asked';
};
