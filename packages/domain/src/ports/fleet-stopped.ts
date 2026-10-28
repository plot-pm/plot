import type { FleetStopped } from '../entities/fleet-stopped.js';
import type { PortResult } from '../port-result.js';

/**
 * Keeps the fleet's stopped-branches record — one file per repository.
 *
 * `plot-fleetctl.sh --stop` is the only writer of a full record, and
 * `--start` is the only writer of its clear. Nothing else writes it.
 */
export interface FleetStoppedStore {
  /**
   * Reads the record.
   *
   * @returns `null` where there is no file or the file is not one this Plot
   *   knows (another `v`, unparseable); `failed` where the read itself broke.
   *   Null holds nothing: no record is not an empty stop list.
   */
  read(): Promise<PortResult<FleetStopped | null>>;

  /**
   * Replaces the record, whole or not at all.
   *
   * @param record - the record to write.
   */
  write(record: FleetStopped): Promise<PortResult<void>>;

  /**
   * Removes the record, where one exists.
   *
   * Absence of a file and absence of a record read the same on the next
   * {@link read}, so clearing is idempotent.
   */
  clear(): Promise<PortResult<void>>;
}
