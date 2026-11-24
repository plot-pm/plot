import type { ReleaseFinishRecord } from '../entities/release-finish-record.js';
import type { PortResult } from '../port-result.js';

/**
 * Keeps the last finish record of each release version — one file per version,
 * local to the machine that wrote it.
 *
 * The record says what one finish did. Nothing reads it to decide whether a
 * release owes plans; `releaseUnbooked` reads git for that.
 */
export interface ReleaseFinishRecordStore {
  /**
   * Reads the record of one version.
   *
   * @param version - the tag spelling `vN.N.N`.
   * @returns `null` where there is no file, the version is not `vN.N.N`, or the
   *   file is not one this Plot knows (another `v`, unparseable); `failed` where
   *   the read itself broke.
   */
  read(version: string): Promise<PortResult<ReleaseFinishRecord | null>>;

  /**
   * Replaces the record of `record.version`, whole or not at all.
   *
   * @param record - the record to write.
   * @returns `failed` where the version is not `vN.N.N` or the write broke.
   */
  write(record: ReleaseFinishRecord): Promise<PortResult<void>>;
}
