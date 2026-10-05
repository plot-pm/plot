import { answered, failed, type PortResult } from '../../port-result.js';
import type { BoundedRun, BoundedRunResult } from '../../ports/bounded-run.js';

/** What a fixture `BoundedRun` answers, regardless of the command asked for. */
export interface BoundedRunFixture {
  /** The result every call answers with; absent means every call fails. */
  result?: BoundedRunResult;
  /** Every call this estate received: command, args and options, in order. */
  calls?: { command: string; args: readonly string[]; cwd: string }[];
}

/**
 * Answers bounded-run questions from a table instead of a real process.
 *
 * The driven-side twin of `boundedRunProcess`: same port, no child process
 * behind it. A caller holding this needs no executable and no clock, which is
 * what lets a test assert on a timed-out run without waiting for one.
 *
 * @param fixture - the result to answer with, and where to record calls.
 * @returns a `BoundedRun` backed by that fixture.
 */
export const boundedRunFixture = (fixture: BoundedRunFixture = {}): BoundedRun => ({
  run: async (command, args, options): Promise<PortResult<BoundedRunResult>> => {
    fixture.calls?.push({ command, args, cwd: options.cwd });
    return fixture.result === undefined ? failed<BoundedRunResult>() : answered(fixture.result);
  },
});
