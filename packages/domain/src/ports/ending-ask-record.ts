import type { PortResult } from '../port-result.js';

/** One ending the supervisor put to a person. */
export interface EndingAskRecord {
  /** The plan the slice belongs to, as its file name without `.md`; `''` where unread. */
  plan: string;
  /** The branch the ending names. */
  branch: string;
  /** When the ending file was written, ISO-8601: the ending's identity on its desk. */
  endingAt: string;
  /** When the supervisor recorded the ask, ISO-8601. */
  at: string;
}

/**
 * Reads and appends `.plot/state/ending-asks.tsv`: one row per ending the
 * supervisor's tick put to a person, so a later tick does not ask about the
 * same ending again after the person answered and the marker is gone.
 *
 * **MACHINE-LOCAL, UNDER THE COMMON GIT DIR, NEVER A DESK'S OWN**, the same
 * placement as `fresh-agents.tsv`: a file in the desk would show as an
 * untracked change to the loop that resumes there.
 *
 * **A MISSING FILE IS AN EMPTY RECORD, AND AN UNREADABLE ONE IS `failed`.**
 * The caller reads both as "not asked": a repeat ask is a no-overwrite marker
 * write, and a missed ask leaves a stopped slice with nobody told.
 */
export interface EndingAskRecordStore {
  /**
   * Whether the record holds a row for this plan, branch and ending time.
   *
   * @param plan - the plan the slice belongs to.
   * @param branch - the slice's branch.
   * @param endingAt - the ending file's modification time, ISO-8601.
   * @returns `answered(true)` where a row matches, `answered(false)` where
   *   none does or the file is missing, `failed()` for any other read error.
   */
  asked(plan: string, branch: string, endingAt: string): Promise<PortResult<boolean>>;

  /**
   * Appends one row: one ending put to a person.
   *
   * @param record - the plan, the branch, the ending's time and when it was asked.
   * @returns nothing on success; `failed` where the write could not land.
   *   Never throws.
   */
  append(record: EndingAskRecord): Promise<PortResult<void>>;
}
