import { z } from 'zod';

/**
 * The four counters as they are written to the record.
 *
 * **FOUR KEYS, AND THE KEY SET IS THE CONTRACT.** No summed fifth field is
 * written, and a test asserts the key set rather than the values — prose cannot
 * catch a total appearing beside them, which is a two-line change no review
 * would flag. See `rules/slice-tokens.ts` for the measurement that forbids it:
 * cache reads are 99.36% of a naive total, so a four-field sum is a cache-read
 * count wearing a cost's name.
 */
export const TokenCountsSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cacheCreationTokens: z.number().nonnegative(),
    cacheReadTokens: z.number().nonnegative(),
  })
  .strict();

/**
 * What one finished slice spent, as one line of the record.
 *
 * **WRITTEN ONCE, NEVER UPDATED — A SECOND RUN WRITES A SECOND LINE.** That
 * keeps the number a measurement with a timestamp rather than a running total
 * nobody can place in time. A reader wanting the latest takes the newest line
 * for the branch; a reader wanting the history has it.
 *
 * **MACHINE-LOCAL, AND THE LIMITS ARE STATED RATHER THAN SOLVED.** The record
 * lives under the common git dir's `.plot/state/`, which is git-ignored, so a
 * colleague's checkout reads NOTHING — not zero — and the record is
 * destructible. A committed record was weighed and declined: it would be
 * readable anywhere at the price of per-run token counts in permanent git
 * history, for a consumer that does not exist yet. A reading cheap to re-take
 * does not earn permanent storage in git.
 */
export const SliceSpendSchema = z
  .object({
    /** The branch that finished — the record's subject. */
    branch: z.string().min(1),
    /** When the record was written, ISO-8601. */
    at: z.string().min(1),
    /** The four counters, summed over the branch's whole run. */
    tokens: TokenCountsSchema,
    /** How many assistant turns the sum covers. */
    turns: z.number().nonnegative(),
    /**
     * Every model the branch's turns ran on, in first-seen order.
     *
     * A LIST, NEVER ONE NAME. The same count on two models is two different
     * costs, and a run corrected onto another model carries both.
     */
    models: z.array(z.string()),
  })
  .strict();

export type SliceSpend = z.infer<typeof SliceSpendSchema>;
export type TokenCountsRecord = z.infer<typeof TokenCountsSchema>;

/**
 * Parses one line of the record, or null where it is not one.
 *
 * **AN UNREADABLE LINE IS COUNTED, NEVER REPAIRED.** The record is
 * append-only and may hold a torn tail or a line from a format this Plot does
 * not know; guessing at one would put an invented number into a rollup.
 *
 * @param line - one raw line of the record.
 * @returns the parsed record, or null where the line is absent or unrecognised.
 */
export const decodeSliceSpend = (line: string): SliceSpend | null => {
  if (line.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = SliceSpendSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders one record as the line that is appended.
 *
 * JSON Lines rather than the budget record's TSV, and the reason is the shape:
 * `models` is a list and `tokens` is nested, neither of which a tab-separated
 * line carries without inventing a second separator. The atomic-append cap that
 * licenses the budget record's format does not apply — this is written once per
 * slice by one worker, not concurrently by eleven scripts.
 *
 * @param record - what the slice spent.
 * @returns the line, without its newline.
 */
export const encodeSliceSpend = (record: SliceSpend): string => JSON.stringify(record);
