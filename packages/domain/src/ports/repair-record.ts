import type { RepairRecord } from '../entities/repair-record.js';
import type { PortResult } from '../port-result.js';

/**
 * Keeps one red episode's repair record — one file per repository, local to
 * the machine that wrote it.
 *
 * Separate from `DefaultBranchStore`: that file's schema is `.strict()` with
 * no reader tolerant of an unknown field, so this episode-scoped state lives
 * in its own file rather than growing that one. Fleetd opens the record; a
 * person sets its `repairPr` through `plot-ask.mjs repair-pr <pr>`.
 */
export interface RepairRecordStore {
  /**
   * Reads the record.
   *
   * @returns `null` where there is no file or the file is not one this Plot
   *   knows (another `v`, unparseable); `failed` where the read itself broke.
   *   Null holds no open episode.
   */
  read(): Promise<PortResult<RepairRecord | null>>;

  /**
   * Replaces the record, whole or not at all.
   *
   * @param record - the record to write.
   */
  write(record: RepairRecord): Promise<PortResult<void>>;
}
