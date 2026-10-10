import { z } from 'zod';

/**
 * The version word the default-branch file carries.
 *
 * A literal, so a future format's file fails the parse rather than the reader.
 */
export const DEFAULT_BRANCH_VERSION = 1;

/** What the CI runs of one commit add up to. */
export const RunsStateSchema = z.enum(['red', 'green', 'pending', 'unknown']);
export type RunsState = z.infer<typeof RunsStateSchema>;

/** A workflow run that concluded as a failure, named so a reader can open it. */
export const FailingRunSchema = z
  .object({
    workflow: z.string(),
    conclusion: z.string(),
    url: z.string(),
  })
  .strict();
export type FailingRun = z.infer<typeof FailingRunSchema>;

/**
 * The newest commit whose runs all concluded, and what they added up to.
 *
 * Advances only when a commit settles; a HEAD still running never replaces it.
 */
export const SettledReadingSchema = z
  .object({
    sha: z.string(),
    state: RunsStateSchema,
  })
  .strict();
export type SettledReading = z.infer<typeof SettledReadingSchema>;

/**
 * What fleetd read about the default branch's CI, in its own file.
 *
 * Separate from the PR store, which holds answers about PRs. Written by fleetd
 * only; every other process reads it.
 */
export const DefaultBranchReadingSchema = z
  .object({
    v: z.literal(DEFAULT_BRANCH_VERSION),
    /** The default branch the reading is about. */
    branch: z.string(),
    /** The commit the branch pointed at when fleetd last read it. */
    headSha: z.string(),
    /** What the runs of `headSha` add up to now. */
    head: RunsStateSchema,
    /** The newest settled commit; absent until one has settled. */
    settled: SettledReadingSchema.optional(),
    /** The failing runs of the settled commit; empty unless it is red. */
    failingRuns: z.array(FailingRunSchema),
    /** When fleetd first saw `headSha`, ISO-8601, this machine's clock. */
    headSince: z.string(),
    /** When fleetd last asked the host for the runs of `headSha`, ISO-8601. */
    askedAt: z.string(),
    /** When fleetd wrote the file, ISO-8601. */
    at: z.string(),
  })
  .strict();
export type DefaultBranchReading = z.infer<typeof DefaultBranchReadingSchema>;

/**
 * Parses the file's text, or null where it is not one this Plot knows.
 *
 * Every failure is null — unparseable JSON, another `v`, an empty file — and
 * null holds nothing: no reading is not a red branch.
 *
 * @param text - the file's contents.
 * @returns the reading, or null where the text cannot be read as one.
 */
export const decodeDefaultBranch = (text: string): DefaultBranchReading | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = DefaultBranchReadingSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a reading as the text written to disk.
 *
 * @param reading - the reading to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeDefaultBranch = (reading: DefaultBranchReading): string =>
  `${JSON.stringify(reading, null, 2)}\n`;
