import type { ReleaseHoldRecord } from '../entities/release-hold.js';
import type { PortResult } from '../port-result.js';

/** Keeps the release hold record: one file per repository, local to the machine that wrote it. */
export interface ReleaseHoldStore {
  /**
   * Reads the record.
   *
   * @returns `null` where there is no file or the file does not parse as a record of this
   *   version; `failed` where the read itself broke.
   */
  read(): Promise<PortResult<ReleaseHoldRecord | null>>;

  /**
   * Replaces the record, whole or not at all.
   *
   * @param record - the record to write.
   */
  write(record: ReleaseHoldRecord): Promise<PortResult<void>>;
}
