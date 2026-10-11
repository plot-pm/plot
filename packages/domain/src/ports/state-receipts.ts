import type { PortResult } from '../port-result.js';

/**
 * The receipts a lifecycle write leaves under `.plot/state/state-receipts/`:
 * one file per receipt, named by the git blob oid of the repository-relative
 * path, holding `<path>\t<value>\n`.
 *
 * The owner of a `State:` line writes one; a commit gate spends it. This port
 * covers the spend only. The write side is `plot-state-receipt.sh`'s
 * `record_state_receipt` and `entry/ladder.ts`'s `recordStateReceipt`.
 */
export interface StateReceipts {
  /**
   * Clears a staged value against the path's receipt and deletes the receipt
   * when it matches, as one operation.
   *
   * A receipt written by an owning script and one written by the
   * `plot-state-receipt.sh --unowned` escape are the same file and clear the
   * same way. A receipt for another value does not clear and is not deleted.
   * One receipt clears one call: the second call for the same path and value
   * answers `false`.
   *
   * @param relPath - the repository-relative path of the plan or sprint file.
   * @param value - the `State:` value the commit stages.
   * @returns `true` when a receipt matched and was spent; `false` when none
   *   exists or its value differs. Never throws.
   */
  spend(relPath: string, value: string): Promise<PortResult<boolean>>;
}
