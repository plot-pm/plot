import type { PortResult } from '../port-result.js';

/** One fresh session the supervisor started for a spent correction budget. */
export interface FreshAgentRecord {
  /**
   * The plan the slice belongs to, as its file name without `.md`, or `''`
   * for a row written before the record named the plan.
   */
  plan: string;
  /** The branch the budget was spent on. */
  branch: string;
  /** The desk the fresh session ran in, absolute. */
  worktree: string;
  /** When the fresh session was started, ISO-8601. */
  at: string;
  /** The failing run's URL, or `''` where none was read. */
  runUrl: string;
}

/**
 * Reads and appends `.plot/state/fresh-agents.tsv` — one row per fresh
 * session the supervisor started for a slice that spent its correction
 * budget.
 *
 * **A PORT, NOT A FILE WRITE IN THE TICK.** The layering rule points inward:
 * the tick is a controller and must call the domain and never reach the
 * world itself. This is the one write {@link freshAgentAfterCorrections}'s
 * `start-fresh` verdict needs — recording that a slice already had its one
 * fresh session — and the adapter is the only thing allowed to touch the
 * disk for it.
 *
 * **MACHINE-LOCAL, UNDER THE COMMON GIT DIR, NEVER A DESK'S OWN.** The same
 * placement `SliceSpendRecord` and `refused_slices_path` both use, and for
 * the same reason: `plot-reap.sh` removes a finished desk, and a record
 * written to one is destroyed by the reap that measured it. A colleague's
 * checkout reads nothing from this file rather than zero, because the file is
 * gitignored like every other `.plot/state/` record.
 *
 * **APPEND-ONLY, ONE ROW PER START.** A row is a measurement — this session
 * was started at this time, for this slice — and a second spent budget on
 * the same slice is a second row rather than an overwrite, so the count this
 * port's caller derives is a count of rows, not a field it increments.
 *
 * **A MISSING FILE IS AN EMPTY RECORD, AND AN UNREADABLE ONE IS `failed`;
 * THE CALLER READS BOTH AS ZERO ROWS, NEVER AS "ALREADY STARTED."** Absence
 * can start one session too many, but it must never strand a slice at a
 * person for a record this estate never wrote.
 */
export interface FreshAgentRecordStore {
  /**
   * Every row the record holds for one slice, in file order.
   *
   * A slice is a plan and a branch. A row with an empty `plan`, written
   * before the record named the plan, counts for its branch under any plan.
   * A missing file answers `answered([])`. Any other read error answers
   * `failed()`, which the caller reads as zero rows.
   *
   * @param plan - the plan the slice belongs to.
   * @param branch - the slice's branch.
   * @returns the rows for that slice, oldest first.
   */
  rowsFor(plan: string, branch: string): Promise<PortResult<readonly FreshAgentRecord[]>>;

  /**
   * Appends one row — one fresh session started.
   *
   * @param record - the plan, the branch, the desk, when, and the failing run.
   * @returns nothing on success; `failed` where the write itself could not
   *   land. Never throws.
   */
  append(record: FreshAgentRecord): Promise<PortResult<void>>;
}
