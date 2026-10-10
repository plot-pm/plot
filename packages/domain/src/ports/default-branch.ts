import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { PortResult } from '../port-result.js';

/**
 * Keeps the default-branch reading — one file per repository.
 *
 * FLEETD IS THE ONLY WRITER. The queue read and any other process read the
 * file and never write it: `rename` makes each write atomic, not the
 * read-fold-write sequence around it.
 */
export interface DefaultBranchStore {
  /**
   * Reads the reading.
   *
   * @returns `null` where there is no file or the file is not one this Plot
   *   knows (another `v`, unparseable); `failed` where the read itself broke.
   *   Null holds nothing.
   */
  read(): Promise<PortResult<DefaultBranchReading | null>>;

  /**
   * Replaces the reading, whole or not at all.
   *
   * @param reading - the reading to write.
   */
  write(reading: DefaultBranchReading): Promise<PortResult<void>>;
}
