/**
 * Whether a run ended because the harness CLI refused its arguments.
 *
 * Separate from `promptExit`: that rule answers whether an exit was a usage
 * limit, and this one answers whether the CLI refused the run before any agent
 * started. A non-zero exit with neither line is an agent that ran and failed.
 */

/** The shape of the line a harness prints when it refuses a run's arguments. */
export interface StartRefusalPatterns {
  /** The text the line opens with. */
  readonly lead: string;
  /** The text that ends the refusal sentence and starts the listing of known names. */
  readonly notFound: string;
  /** The text between the refusal sentence and the listing; the line must carry it. */
  readonly listing: string;
}

/** What {@link failedStart} read from one run's output. */
export type FailedStart = { readonly failed: true; readonly line: string } | { readonly failed: false };

/**
 * Whether a run's output is a start the CLI refused.
 *
 * The refusal must be the LAST non-empty line of the output: a CLI that refuses
 * writes nothing after it, and a refusal line an earlier run left in an
 * appended log is followed by whatever a later run wrote. An exit status of
 * `0` is never a failed start; `null` means the caller did not observe the
 * status and the output decides alone.
 *
 * @param input - the exit status, or `null` where unobserved, and the output this run appended.
 * @param patterns - the harness's refusal shape; `undefined` for a harness that names none.
 * @returns the refusal sentence (the line up to the end of `notFound`) where it is a failed start.
 */
export const failedStart = (
  input: { readonly status: number | null; readonly output: string },
  patterns: StartRefusalPatterns | undefined,
): FailedStart => {
  if (patterns === undefined || input.status === 0) return { failed: false };
  const lines = input.output.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const last = lines[lines.length - 1];
  if (last === undefined || !last.startsWith(patterns.lead)) return { failed: false };
  const end = last.indexOf(patterns.notFound, patterns.lead.length);
  if (end < 0 || !last.startsWith(patterns.listing, end + patterns.notFound.length)) return { failed: false };
  return { failed: true, line: last.slice(0, end + patterns.notFound.length) };
};
