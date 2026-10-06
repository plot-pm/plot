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
 * One finished slice's seal line — the whole-run sum `recordSliceSpend` takes
 * from a desk's transcripts at `seal_declaration`.
 *
 * **NO `kind` FIELD, AND THAT IS DELIBERATE.** Every seal line already on disk
 * before this slice was written this way, so the field cannot be made
 * required without breaking every line a prior Plot wrote. `sliceSpendKindOf`
 * is where a bare object is told apart from a run line — never a literal
 * schema discriminant, which an old line cannot carry.
 *
 * **WRITTEN ONCE PER SEAL, NEVER UPDATED — A SECOND SEAL WRITES A SECOND
 * LINE.** That keeps the number a measurement with a timestamp rather than a
 * running total nobody can place in time. A reader wanting the latest takes
 * the newest line for the branch; a reader wanting the history has it.
 *
 * **MACHINE-LOCAL, AND THE LIMITS ARE STATED RATHER THAN SOLVED.** The record
 * lives under the common git dir's `.plot/state/`, which is git-ignored, so a
 * colleague's checkout reads NOTHING — not zero — and the record is
 * destructible. A committed record was weighed and declined: it would be
 * readable anywhere at the price of per-run token counts in permanent git
 * history, for a consumer that does not exist yet. A reading cheap to re-take
 * does not earn permanent storage in git.
 */
export const SliceSpendSealSchema = z
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

export type SliceSpendSeal = z.infer<typeof SliceSpendSealSchema>;

/**
 * One model's cumulative figures as an SDK run reported them.
 *
 * **CUMULATIVE FOR THE SESSION, NEVER A DELTA** — the same figure
 * `AgentRunUsage` carries, plus the cost `ports/agent-run.ts` keeps separate.
 * A reader wanting what one run added derives it from the difference against
 * the session's previous line; see `readSpend`.
 */
export const RunModelSpendSchema = TokenCountsSchema.extend({
  /** The session's cumulative cost on this model, in dollars. */
  costUsd: z.number().nonnegative(),
}).strict();

export type RunModelSpend = z.infer<typeof RunModelSpendSchema>;

/**
 * One SDK run's line — appended once per run, beside the seal line the same
 * record holds for a `command`-run slice.
 *
 * **CARRIES THE SESSION'S CUMULATIVE FIGURES, NEVER A SUM THIS WRITER
 * COMPUTED.** The SDK's `modelUsage`/`total_cost_usd` already total a resumed
 * session's whole transcript (`AgentRunResult`), so this line repeats that
 * figure rather than re-deriving it. `turns` is the one per-run field: it
 * counts only the turns THIS run took, because the SDK does not report a
 * cumulative turn count.
 */
export const SliceSpendRunSchema = z
  .object({
    kind: z.literal('run'),
    /** The branch this run worked on. */
    branch: z.string().min(1),
    /** When this run ended, ISO-8601. */
    at: z.string().min(1),
    /** The session this run ran under — fresh or resumed. */
    sessionId: z.string().min(1),
    /** The role that ran — `worker`, or a board role such as `idea` or `brief`. */
    role: z.string(),
    /** The session's cumulative usage and cost, keyed by model. */
    models: z.record(z.string(), RunModelSpendSchema),
    /** The session's cumulative cost across every model, in dollars. */
    costUsd: z.number().nonnegative(),
    /** How many turns THIS run took — never cumulative. */
    turns: z.number().nonnegative(),
  })
  .strict();

export type SliceSpendRun = z.infer<typeof SliceSpendRunSchema>;

/**
 * One line of the record — a seal line (no `kind`) or a run line
 * (`kind: 'run'`).
 *
 * **THE UNION IS DISCRIMINATED BY A FIELD ONLY ONE SIDE HAS, NOT BY A SHARED
 * LITERAL.** Zod's `discriminatedUnion` requires every member to carry the
 * same key, which an already-written seal line cannot be made to do
 * retroactively. `z.union` tries each schema in order instead: a run line
 * fails the seal schema (`.strict()` rejects its extra fields) and falls
 * through to the run schema, and a seal line fails the run schema (no `kind`)
 * and is read by the seal schema. An old Plot's seal-only decoder still reads
 * every seal line on disk and reads a run line as unreadable, because its
 * schema has no `kind` member to fall through to.
 */
export const SliceSpendSchema = z.union([SliceSpendSealSchema, SliceSpendRunSchema]);

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
 * `models` is a list or a map and `tokens` is nested, neither of which a
 * tab-separated line carries without inventing a second separator. The
 * atomic-append cap that licenses the budget record's format does not apply —
 * this is written once per seal or once per run, not concurrently by eleven
 * scripts.
 *
 * @param record - what the slice spent.
 * @returns the line, without its newline.
 */
export const encodeSliceSpend = (record: SliceSpend): string => JSON.stringify(record);

/**
 * Whether a decoded line is a seal line or a run line.
 *
 * A TINY HELPER RATHER THAN A REPEATED `'kind' in record` AT EVERY CALL SITE —
 * the union's whole discrimination rule lives here once.
 *
 * @param record - a line {@link decodeSliceSpend} already parsed.
 * @returns `'run'` where the line carries `kind: 'run'`, `'seal'` otherwise.
 */
export const sliceSpendKindOf = (record: SliceSpend): 'seal' | 'run' =>
  'kind' in record && record.kind === 'run' ? 'run' : 'seal';
