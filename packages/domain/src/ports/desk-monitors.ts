import type { PortResult } from '../port-result.js';

/**
 * Stops an AgentMonitor process that a desk launched before fleetd wrote the
 * AgentMonitor's findings, so a restarted desk keeps none.
 */
export interface DeskMonitors {
  /**
   * Stops the monitors an earlier launch began.
   *
   * A pid that is empty or already gone needs no signal. A live pid whose
   * command line names no monitor script is a reused pid and is left alone.
   *
   * @param pids - the monitor pids a manifest recorded.
   * @returns the pids that were signalled. `failed` when a monitor could not
   *   be signalled.
   */
  stop(pids: readonly string[]): PortResult<readonly string[]>;
}
