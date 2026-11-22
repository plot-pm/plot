import type { PortResult } from '../port-result.js';
import type { WriteProbeReading } from '../rules/write-probe.js';

/**
 * One prompt file the probe tests, or the refusal of the charter that names it.
 *
 * - `file`: the absolute path of the prompt file the loop sources; `charter`
 *   names the charter that declares it, `null` for the fallback prompt.
 * - `refused`: the charter's resolution was refused, so no file is known.
 */
export type ProbePrompt =
  | { readonly file: string; readonly charter: string | null }
  | { readonly refused: string };

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
   * @param prompts - the prompt files the agents being started source. Each
   *   distinct file is probed once.
   * @returns `no` where any probed file answers `no`; otherwise the first
   *   result that is not `yes`, or `yes` where every file answers `yes`.
   *   `unaskable` names the probed file in its reason, and a refused charter
   *   answers `unaskable` with the charter's reason. An empty `prompts` answers
   *   `unaskable`.
   */
  check(command: string, prompts: readonly ProbePrompt[]): Promise<PortResult<WriteProbeReading>>;
}
