import type { PortResult } from '../port-result.js';
import type { FleetdStart } from '../entities/fleetd-start.js';

/**
 * Carries what fleetd knows about its own current start from the daemon to a
 * reader asking `plot-fleetctl.sh --status` or the board's own fleet status.
 *
 * **IT IS AN ADAPTER'S PATH, NOT A CONNECTOR'S.** One local file: no account,
 * no credentials, no rate limit. It resolves from the COMMON git dir, the same
 * way {@link import('./supervision-report.js').SupervisionReportStore} does.
 *
 * **ONE WRITER, AND THE PORT CANNOT ENFORCE IT.** Only `registryd-main.ts`'s
 * `run()` calls {@link write}, once, at the top of the daemon's life. A reader
 * calls {@link read} and never the other.
 *
 * **NOTHING HERE DECIDES.** The port reads and writes. Whether the recorded
 * spawn contract is `current`/`stale`/`unknown` against a gate's own number is
 * {@link import('../rules/spawn-contract.js').spawnerStatus}'s answer.
 */
export interface FleetdStartStore {
  /**
   * Where this checkout's record lives.
   *
   * @returns an absolute path; `failed` where no common git dir resolves.
   */
  location(): Promise<PortResult<string>>;

  /**
   * Reads the record the running daemon wrote at its own start.
   *
   * **A MISSING, EMPTY, UNPARSEABLE OR UNRECOGNISED FILE IS `answered(null)`,
   * NOT `failed`.** All four mean *no fleetd start recorded that I can read* —
   * the state of every machine where the supervisor has never run.
   *
   * @returns the record, `null` where there is none to read, or `failed`.
   */
  read(): Promise<PortResult<FleetdStart | null>>;

  /**
   * Replaces the record with this process's own.
   *
   * @param record - what this process knows about its own start.
   * @returns nothing on success; `failed` where the write did not land.
   */
  write(record: FleetdStart): Promise<PortResult<void>>;
}
