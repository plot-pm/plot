import type { PortResult } from '../port-result.js';
import type { WriteProbeReading } from '../rules/write-probe.js';

/**
 * Proves that the configured `Worker command` can write, by running it once
 * in a scratch desk and checking for the file it was told to touch.
 *
 * The reading and nothing derived from it — `rules/write-probe.ts` answers
 * `proceed` or `refuse` from the value this returns. A port that returned the
 * verdict would be an adapter deciding.
 */
export interface WriteProbe {
  /**
   * Runs the configured `Worker command` once against a scratch desk, asks it
   * to touch a file, and reports whether the file appeared.
   *
   * The scratch desk is cut and removed by this call; it pushes no ref, writes
   * no manifest and touches no registry entry.
   *
   * @param command - the configured `Worker command` value, already checked
   *   non-empty and not `none`.
   * @returns `yes` or `no` for an observed outcome; `unanswerable` where the
   *   probe itself could not run to a conclusion — nothing is evidence either
   *   way.
   */
  check(command: string): Promise<PortResult<WriteProbeReading>>;
}
