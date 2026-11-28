import type { ReleaseHoldPersonRecord } from '../entities/release-hold-person.js';
import type { PortResult } from '../port-result.js';

/**
 * Keeps a person's last act on the release hold: one file per repository,
 * local to the machine that wrote it. The hold and lift controllers write it;
 * fleetd and `plot-ask.mjs merge` only read it.
 */
export interface ReleaseHoldPersonStore {
  /**
   * Reads the record.
   *
   * @returns `null` where there is no file or the file does not parse as a record of this
   *   version; `failed` where the read itself broke.
   */
  read(): Promise<PortResult<ReleaseHoldPersonRecord | null>>;

  /**
   * Replaces the record, whole or not at all.
   *
   * @param record - the record to write.
   */
  write(record: ReleaseHoldPersonRecord): Promise<PortResult<void>>;
}
