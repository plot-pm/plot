import type { PortResult } from '../port-result.js';
import type { FleetdHeartbeat } from '../entities/fleetd-heartbeat.js';

/**
 * Carries fleetd's heartbeat from the daemon to whoever asks whether fleetd is
 * alive.
 *
 * **IT IS AN ADAPTER'S PATH, NOT A CONNECTOR'S.** One local file: no account,
 * no credentials, no rate limit, and no process.
 *
 * **ONE WRITER, AND THE PORT CANNOT ENFORCE IT.** Only fleetd's `run()` calls
 * {@link write}. A reader calls {@link read} and never the other.
 *
 * **NOTHING HERE DECIDES.** Whether a heartbeat reads `live`, `stale` or
 * `absent` is {@link import('../rules/fleetd-live.js').fleetdLiveness}'s answer.
 */
export interface FleetdHeartbeatStore {
  /**
   * Reads the latest heartbeat.
   *
   * **A MISSING, EMPTY, UNPARSEABLE OR UNRECOGNISED FILE IS `answered(null)`,
   * NOT `failed`.** All four mean *no heartbeat I can read*.
   *
   * @returns the heartbeat, `null` where there is none to read, or `failed`.
   */
  read(): Promise<PortResult<FleetdHeartbeat | null>>;

  /**
   * Replaces the heartbeat, whole or not at all.
   *
   * @param heartbeat - what fleetd says about itself now.
   * @returns nothing on success; `failed` where the write did not land.
   */
  write(heartbeat: FleetdHeartbeat): Promise<PortResult<void>>;
}
