import type { PortResult } from '../port-result.js';

/**
 * What one measurement of the machine's spawn cost read.
 *
 * The reading and nothing derived from it: the headroom verdict is the
 * domain's to compute, and a port that returned it would be an adapter
 * deciding.
 */
export interface MachineReading {
  /** The cost of forking one process, in milliseconds. */
  spawnCostMs: number;
  /** What taking the measurement itself cost, in milliseconds. */
  sampleMs: number;
  /** The 1-, 5- and 15-minute load averages. */
  loadAverage: readonly [number, number, number];
  /** How many cores the machine has. */
  cores: number;
}

/**
 * Measures the hardware every agent competes for — the MEASURED source.
 *
 * There is exactly one Machine, and that singularity is load-bearing: with
 * two, headroom would be a property of a pair rather than of a reading.
 */
export interface Machine {
  /**
   * Measures what forking a process currently costs.
   *
   * @param samples - how many forks to time.
   * @returns the reading; the verdict is the domain's to derive.
   */
  measure(samples: number): Promise<PortResult<MachineReading>>;

  /**
   * Names this machine.
   *
   * A worker dies ON a machine, so which one is worth recording — and an agent
   * whose worker runs elsewhere is only expressible if a machine has a name.
   *
   * @returns the hostname.
   */
  hostname(): Promise<PortResult<string>>;

  /**
   * This machine's address on the private network, where it is on one.
   *
   * A hostname/address question, which is why it is here and not on a port of
   * its own — the same component that names the machine says where the machine
   * can be reached.
   *
   * `''` where no private network is joined, and the emptiness is an ANSWER
   * rather than a failure: a machine outside a mesh has no mesh address, which
   * is the ordinary case and not a fault to report. A caller printing a second
   * URL prints none.
   *
   * @returns the address, or `''` where there is none.
   */
  privateAddress(): Promise<PortResult<string>>;
}
