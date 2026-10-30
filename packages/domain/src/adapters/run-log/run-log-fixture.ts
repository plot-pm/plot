import { answered, type PortResult } from '../../port-result.js';
import type { RunLog, RunLogLine } from '../../ports/run-log.js';

/** An in-memory {@link RunLog}, with the appended lines exposed for assertions. */
export interface RunLogFixture extends RunLog {
  /** The lines appended so far, in append order. */
  readonly lines: readonly RunLogLine[];
}

/**
 * An in-memory run log for tests: a list of lines, starting with `initial`.
 *
 * @param initial - the lines the log holds before the test acts.
 * @returns the log and the lines it holds.
 */
export const runLogFixture = (initial: readonly RunLogLine[] = []): RunLogFixture => {
  const lines: RunLogLine[] = [...initial];
  return {
    lines,
    read: async (): Promise<PortResult<readonly RunLogLine[]>> => answered([...lines]),
    append: async (line: RunLogLine): Promise<PortResult<void>> => {
      lines.push(line);
      return answered(undefined);
    },
  };
};
