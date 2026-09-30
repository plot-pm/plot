import type { PortResult } from '../port-result.js';

/**
 * The backstop sweep over temp paths a SIGKILL left behind.
 *
 * `lastAt` and `sweep` are separate so the caller decides whether a sweep is
 * owed (`rules/temp-sweep.ts`) and the adapter only reads and performs.
 */
export interface TempSweep {
  /**
   * When the last sweep ran.
   *
   * @returns epoch ms, or null when no sweep has run on this checkout.
   */
  lastAt(): Promise<number | null>;

  /**
   * Removes the sweepable entries and records the time of this run.
   *
   * @returns the sweep's summary line, or `failed` when the sweep did not run.
   */
  sweep(): Promise<PortResult<string>>;
}
