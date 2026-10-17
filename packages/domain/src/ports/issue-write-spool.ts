import type { IssueWrite } from '../entities/issue-write.js';
import type { PortResult } from '../port-result.js';

/**
 * Carries the writes Plot made to a tracker from the process that made them
 * to the one process that writes the issue index.
 *
 * A board entry is a one-shot process and `issues.json` has one writer, fleetd.
 * The entry appends here; fleetd drains the spool on its beat and folds the
 * writes into the index. The spool holds answers the tracker gave to a write
 * and decides nothing.
 */
export interface IssueWriteSpool {
  /**
   * Adds one write to the spool.
   *
   * @param write - what the tracker answered to a successful write.
   * @returns nothing on success; `failed` where the write did not land, and
   *   then the spool is unchanged.
   */
  append(write: IssueWrite): Promise<PortResult<void>>;

  /**
   * Takes every write the spool holds and empties it.
   *
   * @returns the writes in the order appended, an empty list where there are
   *   none; `failed` where the spool exists and could not be taken. A line
   *   that does not parse is dropped.
   */
  drain(): Promise<PortResult<IssueWrite[]>>;
}
