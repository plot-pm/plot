import type { IssueWrite } from '../../entities/issue-write.js';
import type { IssueWriteSpool } from '../../ports/issue-write-spool.js';
import type { Tracker } from '../../ports/tracker.js';

/**
 * Hands the row a successful tracker write changed to the spool fleetd drains
 * into the issue index.
 *
 * Best effort: the tracker already took the write, so a spool that does not
 * answer, or a tracker whose `spender` does not, leaves the index as it is and
 * the next issue pass reads the row. The caller calls this only after the
 * tracker answered `opened` or `written`; a refused or failed write hands
 * nothing.
 *
 * @param tracker - the tracker the write went through; its `spender` names the connector and account.
 * @param spool - where the write goes.
 * @param change - what the tracker answered to the write.
 * @returns whether the write reached the spool.
 */
export const handOffIssueWrite = async (
  tracker: Pick<Tracker, 'spender'>,
  spool: IssueWriteSpool,
  change: Omit<IssueWrite, 'connector' | 'account'>,
): Promise<boolean> => {
  try {
    const spender = await tracker.spender();
    if (!spender.ok) return false;
    const { connector, account } = spender.value;
    const appended = await spool.append({ connector, ...(account === null ? {} : { account }), ...change });
    return appended.ok;
  } catch {
    return false;
  }
};
