import type { PortResult } from '../port-result.js';
import type { ForwardRefusal, SyncPrRefresh } from '../rules/state-sync.js';

/**
 * What the forward sync reads from, and writes to, the machine it runs on.
 *
 * Both answers are machine-local, under the common git directory, so a desk
 * and the main checkout name the same lock and the same refusal.
 */
export interface StateSyncRecord {
  /**
   * Whether a writer holds the default-branch push lock.
   *
   * @returns true where the lock directory names a live holder younger than the stale bound; false where no lock
   *   exists or its holder is dead or older than the bound (the helper breaks such a lock); `'unknown'` where the
   *   lock exists and its owner could not be read.
   */
  lockHeld(now: number): Promise<boolean | 'unknown'>;

  /** Reads the conflict a tick recorded; null where none is recorded. A failed read is a failed result. */
  refusal(): Promise<PortResult<ForwardRefusal | null>>;

  /** Records the conflict a tick met, replacing any earlier one. */
  refuse(refusal: ForwardRefusal): Promise<PortResult<void>>;

  /** Removes the recorded conflict. Removing none is not a failure. */
  clear(): Promise<PortResult<void>>;

  /** Reads the last sync pull request refresh; null where none is recorded. A failed read is a failed result. */
  refreshed(): Promise<PortResult<SyncPrRefresh | null>>;

  /** Records a refresh the host took, replacing any earlier one. */
  noteRefresh(refresh: SyncPrRefresh): Promise<PortResult<void>>;
}
