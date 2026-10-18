import type { PortResult } from '../port-result.js';

/** Who refused a slice, why, and when; each field is `''` where the record holds none. */
export interface SliceRefusal {
  /** The session of the agent that refused the hand-over. */
  session: string;
  /** The refusal text, on one line. */
  reason: string;
  /** When the refusal was recorded, ISO 8601 UTC. */
  at: string;
}

/**
 * Reads and appends `.plot/state/refused-slices.tsv` — one line per slice an
 * agent was handed and could not take up: the branch, then optionally the
 * session, the reason and the ISO time, tab-separated. A line of the branch
 * alone, written before the columns existed, still reads.
 *
 * **MACHINE-LOCAL, UNDER THE COMMON GIT DIR, NEVER A DESK'S OWN.** The same
 * placement `SliceSpendRecord` and `FreshAgentRecordStore` use: `plot-reap.sh`
 * removes a finished desk, and a record written to one is destroyed by the
 * reap that measured it.
 *
 * **A SET, NOT A LOG.** A branch appears at most once. A person ends the hold
 * by removing the line, and nothing ages it out; the next refusal of that
 * branch writes the line again.
 *
 * **READ BY BRANCH, NEVER BY WORKTREE.** `rules/queue.ts`'s `refused` reading
 * asks this record about a branch, because the desk that refused it may carry
 * no manifest naming the branch by the time the supervisor looks.
 */
export interface RefusedSliceRecord {
  /**
   * Whether the record holds a line for the branch.
   *
   * A missing file and blank lines read as nothing refused. Any other read
   * error answers `failed()`.
   *
   * @param branch - the branch to ask about.
   * @returns whether the branch's line is present.
   */
  has(branch: string): Promise<PortResult<boolean>>;

  /**
   * Who refused the branch, why and when.
   *
   * @param branch - the branch to ask about.
   * @returns `null` where the record holds no line for the branch; a
   *   {@link SliceRefusal} with empty fields where the line is the branch alone.
   *   `failed()` on any read error other than a missing file.
   */
  refusal(branch: string): Promise<PortResult<SliceRefusal | null>>;

  /**
   * Appends the branch, unless the record already holds it.
   *
   * An empty branch writes nothing and answers `answered`. A tab or newline in
   * `detail` is written as a space.
   *
   * @param branch - the branch the agent could not take up.
   * @param detail - who refused and why; the adapter stamps the time.
   * @returns nothing on success; `failed` where the path could not be
   *   resolved or the write could not land. Never throws.
   */
  record(branch: string, detail?: { session: string; reason: string }): Promise<PortResult<void>>;
}
