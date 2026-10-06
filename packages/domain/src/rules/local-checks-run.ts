/**
 * Reads what `plot-local-checks.mjs` printed, and what a failed check hands
 * back to the agent.
 */
import type { LocalChecksReading } from '../workflows/agent-loop.js';

/** How many lines of a failed check's output the resume carries. */
export const CHECKS_TAIL_LINES = 80;

/**
 * The commands `plot-local-checks.mjs` printed, in order.
 *
 * @param output - its standard output.
 * @returns every line that is not empty, not a `#` note and not the `summary:` line.
 */
export const printedCommands = (output: string): string[] =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('summary:'));

/**
 * The reading a failed check hands back.
 *
 * @param command - the command that failed, verbatim.
 * @param output - its combined output.
 * @returns the command and the last {@link CHECKS_TAIL_LINES} lines of its output.
 */
export const failedCheck = (command: string, output: string): LocalChecksReading => ({
  passed: false,
  command,
  tail: output.replace(/\n$/, '').split('\n').slice(-CHECKS_TAIL_LINES).join('\n'),
});
