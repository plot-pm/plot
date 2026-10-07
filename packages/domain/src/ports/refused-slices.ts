import type { PortResult } from '../port-result.js';

/**
 * Reads and appends `.plot/state/refused-slices.tsv` — one branch per line,
 * for each slice an agent was handed and could not take up.
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
   * Appends the branch, unless the record already holds it.
   *
   * An empty branch writes nothing and answers `answered`.
   *
   * @param branch - the branch the agent could not take up.
   * @returns nothing on success; `failed` where the path could not be
   *   resolved or the write could not land. Never throws.
   */
  record(branch: string): Promise<PortResult<void>>;
}
