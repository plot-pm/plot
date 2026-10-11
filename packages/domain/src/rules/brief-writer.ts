/** The four answers {@link briefWriterState} gives, in a fixed order. */
export const BRIEF_WRITER_STATES = ['writing', 'failed', 'asked', 'none'] as const;

/**
 * What one branch's brief writer is doing: `writing` while its own writer
 * runs, `failed` where that writer recorded a failure, `asked` where an ask is
 * recorded and nothing runs, `none` otherwise.
 */
export type BriefWriterState = (typeof BRIEF_WRITER_STATES)[number];

/** What was measured of one branch's brief writer. */
export interface BriefWriterReadings {
  /**
   * Whether the branch still needs its brief written — `startability ===
   * 'needs-brief'`. `false` once the brief is on the default branch, also
   * while the writer's pid is still alive.
   */
  needsBrief: boolean;
  /**
   * Whether a writer started for THIS branch is alive now, read from the
   * branch's own state file. A run that named a different branch, or no
   * branch, gives `false`.
   */
  writing: boolean;
  /**
   * The writer's log path where its run recorded a non-zero exit or its pid
   * died, and no newer ask exists; `null` otherwise.
   */
  failed: string | null;
  /** Epoch milliseconds of the earliest counting ask, or `null` where none is recorded. */
  askedAt: number | null;
}

/**
 * What a branch's brief writer is doing, from the readings alone.
 *
 * `needsBrief` false gives `none` whatever the other readings say. Otherwise
 * `writing` gives `writing`, then a recorded `failed` gives `failed`, then a
 * recorded `askedAt` gives `asked`, and no reading gives `none`.
 *
 * @param readings - what was measured of the branch.
 * @returns the writer's state for this branch.
 */
export const briefWriterState = (readings: BriefWriterReadings): BriefWriterState => {
  if (!readings.needsBrief) return 'none';
  if (readings.writing) return 'writing';
  if (readings.failed !== null) return 'failed';
  return readings.askedAt === null ? 'none' : 'asked';
};

/** The note a row shows for its brief writer: which one, and the age of the ask it states. */
export interface BriefWriterNote {
  /** The writer's state; `none` gives no note. */
  kind: Exclude<BriefWriterState, 'none'>;
  /**
   * Milliseconds from the ask to `now` for `writing` and `asked`; `null` for
   * `failed`, and `null` where no ask is recorded.
   */
  ageMs: number | null;
}

/**
 * Which brief-writer note a row shows, and the age it states.
 *
 * @param state - the row's {@link BriefWriterState}.
 * @param askedAt - epoch milliseconds of the earliest counting ask, or `null`.
 * @param now - the reader's clock, in epoch milliseconds.
 * @returns `null` for `none`; otherwise the note's kind, with the ask's age
 *          for `writing` and `asked` where `askedAt` is recorded.
 */
export const briefWriterNote = (
  state: BriefWriterState,
  askedAt: number | null,
  now: number,
): BriefWriterNote | null => {
  if (state === 'none') return null;
  const ageMs = state === 'failed' || askedAt === null ? null : now - askedAt;
  return { kind: state, ageMs };
};
