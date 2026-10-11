import type { PortResult } from '../port-result.js';

/**
 * The receipts a controller leaves under `.plot/state/action-receipts/`: one
 * file per action word (`dispatch`, `approve`, `deliver`, `release`).
 *
 * The controller, or the `--unowned-action` escape, writes one; the gate reads
 * it; the script spends it on its own exit 0. This port covers the read. It is
 * not `StateReceipts`, which a commit gate spends by value.
 */
export interface ActionReceipts {
  /**
   * Whether a receipt exists for an action. The receipt is left in place.
   *
   * @param action - the action word.
   * @returns `true` when the receipt file exists; `false` otherwise. Never throws.
   */
  clears(action: string): Promise<PortResult<boolean>>;
}
